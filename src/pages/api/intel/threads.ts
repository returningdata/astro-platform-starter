import type { APIRoute } from 'astro';
import { getStore } from '@netlify/blobs';
import { validateSession } from '../../../utils/session';
import { type ClearanceLevel, CLEARANCE_HIERARCHY } from '../../../utils/google-oauth';

export const prerender = false;

const INTEL_THREADS_STORE = 'intel-threads';

export interface IntelThread {
    id: string;
    title: string;
    description: string;
    category: 'gang' | 'militia' | 'cartel' | 'crime_family' | 'motorcycle_club' | 'other';
    requiredClearance: ClearanceLevel;
    createdBy: string;
    createdAt: number;
    updatedAt: number;
    isPinned: boolean;
    isLocked: boolean;
    postCount: number;
    image?: string; // Gang/organization image URL
}

// GET - List all threads (admin only)
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

        const store = getStore({ name: INTEL_THREADS_STORE, consistency: 'strong' });
        const { blobs } = await store.list();

        const threads: IntelThread[] = [];
        for (const blob of blobs) {
            const thread = await store.get(blob.key, { type: 'json' }) as IntelThread;
            if (thread) {
                threads.push(thread);
            }
        }

        // Sort by pinned first, then by updatedAt
        threads.sort((a, b) => {
            if (a.isPinned !== b.isPinned) return a.isPinned ? -1 : 1;
            return b.updatedAt - a.updatedAt;
        });

        return new Response(JSON.stringify({ threads }), {
            status: 200,
            headers: { 'Content-Type': 'application/json' }
        });
    } catch (error) {
        console.error('Error fetching threads:', error);
        return new Response(JSON.stringify({ error: 'Failed to fetch threads' }), {
            status: 500,
            headers: { 'Content-Type': 'application/json' }
        });
    }
};

// POST - Create new thread (admin only)
export const POST: APIRoute = async ({ request }) => {
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
        const { title, description, category, requiredClearance } = body;

        if (!title || !description || !category || !requiredClearance) {
            return new Response(JSON.stringify({ error: 'Missing required fields' }), {
                status: 400,
                headers: { 'Content-Type': 'application/json' }
            });
        }

        const store = getStore({ name: INTEL_THREADS_STORE, consistency: 'strong' });

        const threadId = `thread-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;
        const now = Date.now();

        const thread: IntelThread = {
            id: threadId,
            title,
            description,
            category,
            requiredClearance,
            createdBy: user.displayName,
            createdAt: now,
            updatedAt: now,
            isPinned: false,
            isLocked: false,
            postCount: 0,
        };

        await store.setJSON(threadId, thread);

        return new Response(JSON.stringify({ success: true, thread }), {
            status: 201,
            headers: { 'Content-Type': 'application/json' }
        });
    } catch (error) {
        console.error('Error creating thread:', error);
        return new Response(JSON.stringify({ error: 'Failed to create thread' }), {
            status: 500,
            headers: { 'Content-Type': 'application/json' }
        });
    }
};

// PUT - Update thread (admin only)
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
        const { id, title, description, category, requiredClearance, isPinned, isLocked, image } = body;

        if (!id) {
            return new Response(JSON.stringify({ error: 'Thread ID required' }), {
                status: 400,
                headers: { 'Content-Type': 'application/json' }
            });
        }

        const store = getStore({ name: INTEL_THREADS_STORE, consistency: 'strong' });
        const existingThread = await store.get(id, { type: 'json' }) as IntelThread | null;

        if (!existingThread) {
            return new Response(JSON.stringify({ error: 'Thread not found' }), {
                status: 404,
                headers: { 'Content-Type': 'application/json' }
            });
        }

        const updatedThread: IntelThread = {
            ...existingThread,
            title: title ?? existingThread.title,
            description: description ?? existingThread.description,
            category: category ?? existingThread.category,
            requiredClearance: requiredClearance ?? existingThread.requiredClearance,
            isPinned: isPinned ?? existingThread.isPinned,
            isLocked: isLocked ?? existingThread.isLocked,
            image: image ?? existingThread.image,
            updatedAt: Date.now(),
        };

        await store.setJSON(id, updatedThread);

        return new Response(JSON.stringify({ success: true, thread: updatedThread }), {
            status: 200,
            headers: { 'Content-Type': 'application/json' }
        });
    } catch (error) {
        console.error('Error updating thread:', error);
        return new Response(JSON.stringify({ error: 'Failed to update thread' }), {
            status: 500,
            headers: { 'Content-Type': 'application/json' }
        });
    }
};

// DELETE - Delete thread (admin only)
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
            return new Response(JSON.stringify({ error: 'Thread ID required' }), {
                status: 400,
                headers: { 'Content-Type': 'application/json' }
            });
        }

        const store = getStore({ name: INTEL_THREADS_STORE, consistency: 'strong' });

        // Also delete all posts in this thread
        const postsStore = getStore({ name: 'intel-posts', consistency: 'strong' });
        const { blobs } = await postsStore.list({ prefix: `${id}-` });
        for (const blob of blobs) {
            await postsStore.delete(blob.key);
        }

        await store.delete(id);

        return new Response(JSON.stringify({ success: true }), {
            status: 200,
            headers: { 'Content-Type': 'application/json' }
        });
    } catch (error) {
        console.error('Error deleting thread:', error);
        return new Response(JSON.stringify({ error: 'Failed to delete thread' }), {
            status: 500,
            headers: { 'Content-Type': 'application/json' }
        });
    }
};
