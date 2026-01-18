import type { APIRoute } from 'astro';
import { getStore } from '@netlify/blobs';
import { validateSession } from '../../../utils/session';
import type { ClearanceLevel } from '../../../utils/google-oauth';

export const prerender = false;

const INTEL_USERS_STORE = 'intel-users';

interface IntelUser {
    id: string;
    email: string;
    name: string;
    picture?: string;
    clearanceLevel: ClearanceLevel;
    createdAt: number;
    lastLogin: number;
    discordUsername?: string;
    discordId?: string;
    officerName?: string;
    callsign?: string;
    badgeNumber?: string;
}

// GET - Get user by Discord ID
export const GET: APIRoute = async ({ request }) => {
    try {
        const user = await validateSession(request);
        if (!user) {
            return new Response(JSON.stringify({ error: 'Unauthorized' }), {
                status: 401,
                headers: { 'Content-Type': 'application/json' }
            });
        }

        // Only super_admin can access this endpoint
        if (user.role !== 'super_admin') {
            return new Response(JSON.stringify({ error: 'Forbidden - Super Admin access required' }), {
                status: 403,
                headers: { 'Content-Type': 'application/json' }
            });
        }

        const url = new URL(request.url);
        const discordId = url.searchParams.get('discordId');

        if (!discordId) {
            return new Response(JSON.stringify({ error: 'Discord ID required' }), {
                status: 400,
                headers: { 'Content-Type': 'application/json' }
            });
        }

        const store = getStore({ name: INTEL_USERS_STORE, consistency: 'strong' });
        const { blobs } = await store.list();

        // Search for user with matching Discord ID
        for (const blob of blobs) {
            const intelUser = await store.get(blob.key, { type: 'json' }) as IntelUser | null;
            if (intelUser && intelUser.discordId === discordId) {
                return new Response(JSON.stringify({
                    found: true,
                    user: {
                        id: intelUser.id,
                        name: intelUser.name,
                        email: intelUser.email,
                        picture: intelUser.picture,
                        discordUsername: intelUser.discordUsername,
                        discordId: intelUser.discordId,
                        clearanceLevel: intelUser.clearanceLevel,
                        officerName: intelUser.officerName,
                        callsign: intelUser.callsign,
                        badgeNumber: intelUser.badgeNumber,
                        createdAt: intelUser.createdAt,
                        lastLogin: intelUser.lastLogin,
                    }
                }), {
                    status: 200,
                    headers: { 'Content-Type': 'application/json' }
                });
            }
        }

        return new Response(JSON.stringify({
            found: false,
            message: 'No user found with this Discord ID'
        }), {
            status: 200,
            headers: { 'Content-Type': 'application/json' }
        });
    } catch (error) {
        console.error('Error looking up user:', error);
        return new Response(JSON.stringify({ error: 'Failed to lookup user' }), {
            status: 500,
            headers: { 'Content-Type': 'application/json' }
        });
    }
};

// PUT - Update user clearance by Discord ID
export const PUT: APIRoute = async ({ request }) => {
    try {
        const user = await validateSession(request);
        if (!user) {
            return new Response(JSON.stringify({ error: 'Unauthorized' }), {
                status: 401,
                headers: { 'Content-Type': 'application/json' }
            });
        }

        // Only super_admin can access this endpoint
        if (user.role !== 'super_admin') {
            return new Response(JSON.stringify({ error: 'Forbidden - Super Admin access required' }), {
                status: 403,
                headers: { 'Content-Type': 'application/json' }
            });
        }

        const body = await request.json();
        const { discordId, clearanceLevel } = body;

        if (!discordId || !clearanceLevel) {
            return new Response(JSON.stringify({ error: 'Discord ID and clearance level are required' }), {
                status: 400,
                headers: { 'Content-Type': 'application/json' }
            });
        }

        // Validate clearance level
        const validClearanceLevels = ['denied', 'pending', 'public_trust', 'confidential', 'secret', 'top_secret', 'top_secret_sci', 'special_access'];
        if (!validClearanceLevels.includes(clearanceLevel)) {
            return new Response(JSON.stringify({ error: 'Invalid clearance level' }), {
                status: 400,
                headers: { 'Content-Type': 'application/json' }
            });
        }

        const store = getStore({ name: INTEL_USERS_STORE, consistency: 'strong' });
        const { blobs } = await store.list();

        // Search for user with matching Discord ID
        for (const blob of blobs) {
            const intelUser = await store.get(blob.key, { type: 'json' }) as IntelUser | null;
            if (intelUser && intelUser.discordId === discordId) {
                // Update clearance level
                intelUser.clearanceLevel = clearanceLevel as ClearanceLevel;
                await store.setJSON(blob.key, intelUser);

                return new Response(JSON.stringify({
                    success: true,
                    user: {
                        id: intelUser.id,
                        name: intelUser.name,
                        discordUsername: intelUser.discordUsername,
                        discordId: intelUser.discordId,
                        clearanceLevel: intelUser.clearanceLevel,
                    }
                }), {
                    status: 200,
                    headers: { 'Content-Type': 'application/json' }
                });
            }
        }

        return new Response(JSON.stringify({
            error: 'No user found with this Discord ID'
        }), {
            status: 404,
            headers: { 'Content-Type': 'application/json' }
        });
    } catch (error) {
        console.error('Error updating clearance:', error);
        return new Response(JSON.stringify({ error: 'Failed to update clearance' }), {
            status: 500,
            headers: { 'Content-Type': 'application/json' }
        });
    }
};
