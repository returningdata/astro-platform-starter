import type { APIRoute } from 'astro';
import { invalidateIntelSession } from '../../../utils/google-oauth';

export const prerender = false;

export const POST: APIRoute = async ({ request }) => {
    try {
        const clearCookie = await invalidateIntelSession(request);

        return new Response(JSON.stringify({
            success: true,
            message: 'Logged out successfully'
        }), {
            status: 200,
            headers: {
                'Content-Type': 'application/json',
                'Set-Cookie': clearCookie
            }
        });
    } catch (error) {
        console.error('Intel logout error:', error);
        return new Response(JSON.stringify({
            success: false,
            error: 'Logout failed'
        }), {
            status: 500,
            headers: { 'Content-Type': 'application/json' }
        });
    }
};
