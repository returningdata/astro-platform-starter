import type { APIRoute } from 'astro';
import { getIntelSession } from '../../../utils/google-oauth';

export const prerender = false;

export const GET: APIRoute = async ({ request }) => {
    try {
        const session = await getIntelSession(request);

        if (session) {
            return new Response(JSON.stringify({
                authenticated: true,
                user: {
                    id: session.user.id,
                    email: session.user.email,
                    name: session.user.name,
                    picture: session.user.picture,
                    clearanceLevel: session.user.clearanceLevel,
                    discordId: session.user.discordId,
                    discordUsername: session.user.discordUsername,
                    officerName: session.user.officerName,
                    callsign: session.user.callsign,
                    badgeNumber: session.user.badgeNumber,
                    profileComplete: session.user.profileComplete,
                },
            }), {
                status: 200,
                headers: { 'Content-Type': 'application/json' }
            });
        }

        return new Response(JSON.stringify({
            authenticated: false,
        }), {
            status: 200,
            headers: { 'Content-Type': 'application/json' }
        });
    } catch (error) {
        console.error('Intel session check error:', error);
        return new Response(JSON.stringify({
            authenticated: false,
            error: 'Session check failed'
        }), {
            status: 500,
            headers: { 'Content-Type': 'application/json' }
        });
    }
};
