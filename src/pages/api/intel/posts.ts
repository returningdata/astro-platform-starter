import type { APIRoute } from 'astro';
import { getStore } from '@netlify/blobs';
import { validateSession } from '../../../utils/session';
import { getIntelSession, hasRequiredClearance, CLEARANCE_DISPLAY_NAMES } from '../../../utils/google-oauth';
import type { IntelThread } from './threads';

export const prerender = false;

const INTEL_POSTS_STORE = 'intel-posts';
const INTEL_THREADS_STORE = 'intel-threads';

export interface IntelPost {
    id: string;
    threadId: string;
    content: string;
    author: string;
    authorRole: string;
    createdAt: number;
    updatedAt: number;
    attachments?: string[];
}

// GET - List all posts for a thread (admin only)
export const GET: APIRoute = async ({ request }) => {
    try {
        const user = await validateSession(request);
        if (!user) {
            return new Response(JSON.stringify({ error: 'Unauthorized' }), {
                status: 401,
                headers: { 'Content-Type': 'application/json' }
            });
        }

        // Check permission
        if (user.role !== 'super_admin' && !user.permissions.includes('intel-management')) {
            return new Response(JSON.stringify({ error: 'Forbidden' }), {
                status: 403,
                headers: { 'Content-Type': 'application/json' }
            });
        }

        const url = new URL(request.url);
        const threadId = url.searchParams.get('threadId');

        if (!threadId) {
            return new Response(JSON.stringify({ error: 'Thread ID required' }), {
                status: 400,
                headers: { 'Content-Type': 'application/json' }
            });
        }

        const store = getStore({ name: INTEL_POSTS_STORE, consistency: 'strong' });
        const { blobs } = await store.list({ prefix: `${threadId}-` });

        const posts: IntelPost[] = [];
        for (const blob of blobs) {
            const post = await store.get(blob.key, { type: 'json' }) as IntelPost;
            if (post) {
                posts.push(post);
            }
        }

        // Sort by creation date (oldest first)
        posts.sort((a, b) => a.createdAt - b.createdAt);

        return new Response(JSON.stringify({ posts }), {
            status: 200,
            headers: { 'Content-Type': 'application/json' }
        });
    } catch (error) {
        console.error('Error fetching posts:', error);
        return new Response(JSON.stringify({ error: 'Failed to fetch posts' }), {
            status: 500,
            headers: { 'Content-Type': 'application/json' }
        });
    }
};

// POST - Create new post (intel users with sufficient clearance OR admins with intel-management permission)
export const POST: APIRoute = async ({ request }) => {
    try {
        // Check for Intel session first (Google OAuth users)
        const intelSession = await getIntelSession(request);

        // Check for Admin session (admin panel users)
        const adminUser = await validateSession(request);

        // Must have at least one valid session
        if (!intelSession && !adminUser) {
            return new Response(JSON.stringify({ error: 'Unauthorized' }), {
                status: 401,
                headers: { 'Content-Type': 'application/json' }
            });
        }

        // If only admin session, check intel-management permission
        if (!intelSession && adminUser) {
            if (adminUser.role !== 'super_admin' && !adminUser.permissions.includes('intel-management')) {
                return new Response(JSON.stringify({ error: 'Forbidden' }), {
                    status: 403,
                    headers: { 'Content-Type': 'application/json' }
                });
            }
        }

        // If intel session, check if clearance is not pending/denied
        if (intelSession) {
            if (intelSession.user.clearanceLevel === 'pending' || intelSession.user.clearanceLevel === 'denied') {
                return new Response(JSON.stringify({
                    error: 'Access pending',
                    message: intelSession.user.clearanceLevel === 'pending'
                        ? 'Your access is pending approval.'
                        : 'Your access has been denied.',
                }), {
                    status: 403,
                    headers: { 'Content-Type': 'application/json' }
                });
            }
        }

        const body = await request.json();
        const { threadId, content, attachments } = body;

        if (!threadId || !content) {
            return new Response(JSON.stringify({ error: 'Missing required fields' }), {
                status: 400,
                headers: { 'Content-Type': 'application/json' }
            });
        }

        // Verify thread exists and is not locked
        const threadsStore = getStore({ name: INTEL_THREADS_STORE, consistency: 'strong' });
        const thread = await threadsStore.get(threadId, { type: 'json' }) as IntelThread | null;

        if (!thread) {
            return new Response(JSON.stringify({ error: 'Thread not found' }), {
                status: 404,
                headers: { 'Content-Type': 'application/json' }
            });
        }

        // Check clearance level via intel session
        if (intelSession) {
            if (!hasRequiredClearance(intelSession.user.clearanceLevel, thread.requiredClearance)) {
                return new Response(JSON.stringify({
                    error: 'Insufficient clearance',
                    message: `This thread requires ${CLEARANCE_DISPLAY_NAMES[thread.requiredClearance]} clearance.`,
                }), {
                    status: 403,
                    headers: { 'Content-Type': 'application/json' }
                });
            }
        }

        if (thread.isLocked) {
            return new Response(JSON.stringify({ error: 'Thread is locked' }), {
                status: 403,
                headers: { 'Content-Type': 'application/json' }
            });
        }

        const store = getStore({ name: INTEL_POSTS_STORE, consistency: 'strong' });

        const postId = `${threadId}-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;
        const now = Date.now();

        // Determine author name and role based on session type
        let authorName: string;
        let authorRole: string;

        if (intelSession) {
            // Intel session user - use officer name or Google name
            authorName = intelSession.user.officerName || intelSession.user.name;
            authorRole = intelSession.user.callsign
                ? `Officer (${intelSession.user.callsign})`
                : 'Officer';
        } else if (adminUser) {
            // Admin session user
            authorName = adminUser.displayName;
            authorRole = adminUser.role === 'super_admin' ? 'Super Admin' :
                        adminUser.role === 'subdivision_overseer' ? 'Subdivision Overseer' : 'Officer';
        } else {
            // This shouldn't happen due to earlier checks
            return new Response(JSON.stringify({ error: 'Unauthorized' }), {
                status: 401,
                headers: { 'Content-Type': 'application/json' }
            });
        }

        const post: IntelPost = {
            id: postId,
            threadId,
            content,
            author: authorName,
            authorRole: authorRole,
            createdAt: now,
            updatedAt: now,
            attachments: attachments || [],
        };

        await store.setJSON(postId, post);

        // Update thread's post count and updatedAt
        thread.postCount = (thread.postCount || 0) + 1;
        thread.updatedAt = now;
        await threadsStore.setJSON(threadId, thread);

        return new Response(JSON.stringify({ success: true, post }), {
            status: 201,
            headers: { 'Content-Type': 'application/json' }
        });
    } catch (error) {
        console.error('Error creating post:', error);
        return new Response(JSON.stringify({ error: 'Failed to create post' }), {
            status: 500,
            headers: { 'Content-Type': 'application/json' }
        });
    }
};

// PUT - Update post (admin only)
export const PUT: APIRoute = async ({ request }) => {
    try {
        const user = await validateSession(request);
        if (!user) {
            return new Response(JSON.stringify({ error: 'Unauthorized' }), {
                status: 401,
                headers: { 'Content-Type': 'application/json' }
            });
        }

        // Check permission
        if (user.role !== 'super_admin' && !user.permissions.includes('intel-management')) {
            return new Response(JSON.stringify({ error: 'Forbidden' }), {
                status: 403,
                headers: { 'Content-Type': 'application/json' }
            });
        }

        const body = await request.json();
        const { id, content, attachments } = body;

        if (!id) {
            return new Response(JSON.stringify({ error: 'Post ID required' }), {
                status: 400,
                headers: { 'Content-Type': 'application/json' }
            });
        }

        const store = getStore({ name: INTEL_POSTS_STORE, consistency: 'strong' });
        const existingPost = await store.get(id, { type: 'json' }) as IntelPost | null;

        if (!existingPost) {
            return new Response(JSON.stringify({ error: 'Post not found' }), {
                status: 404,
                headers: { 'Content-Type': 'application/json' }
            });
        }

        const updatedPost: IntelPost = {
            ...existingPost,
            content: content ?? existingPost.content,
            attachments: attachments ?? existingPost.attachments,
            updatedAt: Date.now(),
        };

        await store.setJSON(id, updatedPost);

        return new Response(JSON.stringify({ success: true, post: updatedPost }), {
            status: 200,
            headers: { 'Content-Type': 'application/json' }
        });
    } catch (error) {
        console.error('Error updating post:', error);
        return new Response(JSON.stringify({ error: 'Failed to update post' }), {
            status: 500,
            headers: { 'Content-Type': 'application/json' }
        });
    }
};

// DELETE - Delete post (admin only)
export const DELETE: APIRoute = async ({ request }) => {
    try {
        const user = await validateSession(request);
        if (!user) {
            return new Response(JSON.stringify({ error: 'Unauthorized' }), {
                status: 401,
                headers: { 'Content-Type': 'application/json' }
            });
        }

        // Check permission
        if (user.role !== 'super_admin' && !user.permissions.includes('intel-management')) {
            return new Response(JSON.stringify({ error: 'Forbidden' }), {
                status: 403,
                headers: { 'Content-Type': 'application/json' }
            });
        }

        const url = new URL(request.url);
        const id = url.searchParams.get('id');

        if (!id) {
            return new Response(JSON.stringify({ error: 'Post ID required' }), {
                status: 400,
                headers: { 'Content-Type': 'application/json' }
            });
        }

        const store = getStore({ name: INTEL_POSTS_STORE, consistency: 'strong' });
        const post = await store.get(id, { type: 'json' }) as IntelPost | null;

        if (post) {
            // Update thread's post count
            const threadsStore = getStore({ name: INTEL_THREADS_STORE, consistency: 'strong' });
            const thread = await threadsStore.get(post.threadId, { type: 'json' }) as IntelThread | null;
            if (thread) {
                thread.postCount = Math.max(0, (thread.postCount || 1) - 1);
                await threadsStore.setJSON(post.threadId, thread);
            }
        }

        await store.delete(id);

        return new Response(JSON.stringify({ success: true }), {
            status: 200,
            headers: { 'Content-Type': 'application/json' }
        });
    } catch (error) {
        console.error('Error deleting post:', error);
        return new Response(JSON.stringify({ error: 'Failed to delete post' }), {
            status: 500,
            headers: { 'Content-Type': 'application/json' }
        });
    }
};
