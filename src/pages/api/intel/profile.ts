import type { APIRoute } from 'astro';
import { getStore } from '@netlify/blobs';
import {
    getIntelSession,
    updateIntelUserProfile,
    type IntelUser
} from '../../../utils/google-oauth';

export const prerender = false;

/**
 * Look up officer information from chain of command data by Discord ID
 */
async function lookupOfficerByDiscordId(discordId: string): Promise<{
    officerName?: string;
    callsign?: string;
    badgeNumber?: string;
} | null> {
    try {
        const store = getStore({ name: 'department-data', consistency: 'strong' });
        const data = await store.get('department-data', { type: 'json' }) as any;

        if (!data) return null;

        // Search through command positions
        if (data.commandPositions) {
            for (const position of data.commandPositions) {
                if (position.discordId === discordId && position.name) {
                    return {
                        officerName: position.name,
                        callsign: position.callSign,
                        badgeNumber: position.callSign // Use callSign as badge number for command positions
                    };
                }
            }
        }

        // Search through rank positions
        if (data.rankPositions) {
            for (const rankGroup of data.rankPositions) {
                for (const member of rankGroup.members || []) {
                    if (member.discordId === discordId && member.name) {
                        return {
                            officerName: member.name,
                            callsign: member.callSign,
                            badgeNumber: member.callSign // Use callSign as badge number
                        };
                    }
                }
            }
        }

        // Search through subdivision leadership
        if (data.subdivisionLeadership) {
            for (const leader of data.subdivisionLeadership) {
                if (leader.discordId === discordId && leader.name) {
                    return {
                        officerName: leader.name,
                        callsign: leader.callSign,
                        badgeNumber: leader.callSign
                    };
                }
            }
        }

        return null;
    } catch (error) {
        console.error('Error looking up officer:', error);
        return null;
    }
}

// GET - Get current user profile or lookup officer by Discord ID
export const GET: APIRoute = async ({ request }) => {
    try {
        const session = await getIntelSession(request);
        if (!session) {
            return new Response(JSON.stringify({ error: 'Unauthorized' }), {
                status: 401,
                headers: { 'Content-Type': 'application/json' }
            });
        }

        const url = new URL(request.url);
        const discordId = url.searchParams.get('discordId');

        // If discordId provided, lookup officer info
        if (discordId) {
            const officerInfo = await lookupOfficerByDiscordId(discordId);
            return new Response(JSON.stringify({
                success: true,
                officerInfo: officerInfo || null,
                found: !!officerInfo
            }), {
                status: 200,
                headers: { 'Content-Type': 'application/json' }
            });
        }

        // Otherwise return current user profile
        return new Response(JSON.stringify({
            success: true,
            user: session.user
        }), {
            status: 200,
            headers: { 'Content-Type': 'application/json' }
        });
    } catch (error) {
        console.error('Error in profile GET:', error);
        return new Response(JSON.stringify({ error: 'Failed to fetch profile' }), {
            status: 500,
            headers: { 'Content-Type': 'application/json' }
        });
    }
};

// PUT - Update user profile (Discord info, etc.)
export const PUT: APIRoute = async ({ request }) => {
    try {
        const session = await getIntelSession(request);
        if (!session) {
            return new Response(JSON.stringify({ error: 'Unauthorized' }), {
                status: 401,
                headers: { 'Content-Type': 'application/json' }
            });
        }

        const body = await request.json();
        const { discordUsername, discordId } = body;

        if (!discordUsername || !discordId) {
            return new Response(JSON.stringify({ error: 'Discord Username and Discord ID are required' }), {
                status: 400,
                headers: { 'Content-Type': 'application/json' }
            });
        }

        // Validate Discord ID format (should be a snowflake - large number)
        if (!/^\d{17,19}$/.test(discordId)) {
            return new Response(JSON.stringify({ error: 'Invalid Discord ID format. It should be a 17-19 digit number.' }), {
                status: 400,
                headers: { 'Content-Type': 'application/json' }
            });
        }

        // Lookup officer info from chain of command
        const officerInfo = await lookupOfficerByDiscordId(discordId);

        // Update user profile
        const updatedUser = await updateIntelUserProfile(session.user.id, {
            discordUsername,
            discordId,
            officerName: officerInfo?.officerName,
            callsign: officerInfo?.callsign,
            badgeNumber: officerInfo?.badgeNumber
        });

        if (!updatedUser) {
            return new Response(JSON.stringify({ error: 'User not found' }), {
                status: 404,
                headers: { 'Content-Type': 'application/json' }
            });
        }

        // Clear the needs_profile cookie
        const clearCookie = 'intel_needs_profile=; Path=/; Max-Age=0';

        return new Response(JSON.stringify({
            success: true,
            user: updatedUser,
            officerFound: !!officerInfo
        }), {
            status: 200,
            headers: {
                'Content-Type': 'application/json',
                'Set-Cookie': clearCookie
            }
        });
    } catch (error) {
        console.error('Error updating profile:', error);
        return new Response(JSON.stringify({ error: 'Failed to update profile' }), {
            status: 500,
            headers: { 'Content-Type': 'application/json' }
        });
    }
};
