import type { APIRoute } from 'astro';
import { validateSession } from '../../../utils/session';

export const prerender = false;

export const GET: APIRoute = async ({ request }) => {
    try {
        const user = await validateSession(request);

        if (!user) {
            return new Response(JSON.stringify({
                authenticated: false,
                error: 'Not authenticated'
            }), {
                status: 401,
                headers: { 'Content-Type': 'application/json' }
            });
        }

        return new Response(JSON.stringify({
            authenticated: true,
            user
        }), {
            status: 200,
            headers: { 'Content-Type': 'application/json' }
        });
    } catch (error) {
        console.error('Session validation error:', error);
        return new Response(JSON.stringify({
            authenticated: false,
            error: 'An error occurred'
        }), {
            status: 500,
            headers: { 'Content-Type': 'application/json' }
        });
    }
};
