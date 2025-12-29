import type { APIRoute } from 'astro';
import { getStore } from '@netlify/blobs';

export const prerender = false;

// Session timeout in milliseconds (2 minutes)
const SESSION_TIMEOUT = 2 * 60 * 1000;
// Cleanup threshold - remove sessions older than this (5 minutes)
const CLEANUP_THRESHOLD = 5 * 60 * 1000;

/**
 * Generate a simple session ID if not provided
 */
function generateSessionId(): string {
    return Math.random().toString(36).substring(2, 15) + Math.random().toString(36).substring(2, 15);
}

/**
 * Clean up stale sessions from the active sessions object
 */
function cleanupStaleSessions(sessions: Record<string, number>): Record<string, number> {
    const now = Date.now();
    const cleaned: Record<string, number> = {};

    for (const [sessionId, lastSeen] of Object.entries(sessions)) {
        // Keep sessions that are not older than the cleanup threshold
        if ((now - lastSeen) < CLEANUP_THRESHOLD) {
            cleaned[sessionId] = lastSeen;
        }
    }

    return cleaned;
}

export const POST: APIRoute = async ({ request }) => {
    try {
        // Handle both JSON and sendBeacon (text/plain) content types
        const contentType = request.headers.get('content-type') || '';
        let body;
        if (contentType.includes('application/json')) {
            body = await request.json();
        } else {
            // sendBeacon sends as text/plain
            const text = await request.text();
            try {
                body = JSON.parse(text);
            } catch {
                body = { sessionId: text };
            }
        }
        let sessionId = body.sessionId;

        // Handle leave action (from sendBeacon on page unload)
        if (body.action === 'leave' && sessionId) {
            const store = getStore({ name: 'visitor-tracking', consistency: 'strong' });
            let activeSessions = await store.get('active-sessions', { type: 'json' }) as Record<string, number> | null;
            if (activeSessions && activeSessions[sessionId]) {
                delete activeSessions[sessionId];
                await store.setJSON('active-sessions', activeSessions);
            }
            return new Response(JSON.stringify({ success: true }), {
                status: 200,
                headers: { 'Content-Type': 'application/json' }
            });
        }

        // If no session ID provided, generate one
        if (!sessionId) {
            sessionId = generateSessionId();
        }

        const store = getStore({ name: 'visitor-tracking', consistency: 'strong' });

        // Get current active sessions
        let activeSessions = await store.get('active-sessions', { type: 'json' }) as Record<string, number> | null;

        if (!activeSessions) {
            activeSessions = {};
        }

        // Clean up stale sessions periodically
        activeSessions = cleanupStaleSessions(activeSessions);

        // Update this session's last seen timestamp
        activeSessions[sessionId] = Date.now();

        // Save back to store
        await store.setJSON('active-sessions', activeSessions);

        // Count active users (within timeout period)
        const now = Date.now();
        const activeCount = Object.values(activeSessions).filter(lastSeen => (now - lastSeen) < SESSION_TIMEOUT).length;

        return new Response(JSON.stringify({
            success: true,
            sessionId: sessionId,
            activeUsers: activeCount
        }), {
            status: 200,
            headers: { 'Content-Type': 'application/json' }
        });
    } catch (error) {
        console.error('Error in visitor heartbeat:', error);
        return new Response(JSON.stringify({
            success: false,
            error: String(error)
        }), {
            status: 500,
            headers: { 'Content-Type': 'application/json' }
        });
    }
};

// GET endpoint to retrieve current active user count
export const GET: APIRoute = async () => {
    try {
        const store = getStore({ name: 'visitor-tracking', consistency: 'strong' });
        const activeSessions = await store.get('active-sessions', { type: 'json' }) as Record<string, number> | null;

        let activeCount = 0;
        if (activeSessions) {
            const now = Date.now();
            activeCount = Object.values(activeSessions).filter(lastSeen => (now - lastSeen) < SESSION_TIMEOUT).length;
        }

        return new Response(JSON.stringify({
            success: true,
            activeUsers: activeCount
        }), {
            status: 200,
            headers: { 'Content-Type': 'application/json' }
        });
    } catch (error) {
        console.error('Error getting active users:', error);
        return new Response(JSON.stringify({
            success: false,
            activeUsers: 0,
            error: String(error)
        }), {
            status: 500,
            headers: { 'Content-Type': 'application/json' }
        });
    }
};

// DELETE endpoint to remove a session (when user leaves)
export const DELETE: APIRoute = async ({ request }) => {
    try {
        const body = await request.json();
        const sessionId = body.sessionId;

        if (!sessionId) {
            return new Response(JSON.stringify({
                success: false,
                error: 'No session ID provided'
            }), {
                status: 400,
                headers: { 'Content-Type': 'application/json' }
            });
        }

        const store = getStore({ name: 'visitor-tracking', consistency: 'strong' });

        // Get current active sessions
        let activeSessions = await store.get('active-sessions', { type: 'json' }) as Record<string, number> | null;

        if (activeSessions && activeSessions[sessionId]) {
            delete activeSessions[sessionId];
            await store.setJSON('active-sessions', activeSessions);
        }

        return new Response(JSON.stringify({
            success: true
        }), {
            status: 200,
            headers: { 'Content-Type': 'application/json' }
        });
    } catch (error) {
        console.error('Error removing session:', error);
        return new Response(JSON.stringify({
            success: false,
            error: String(error)
        }), {
            status: 500,
            headers: { 'Content-Type': 'application/json' }
        });
    }
};
