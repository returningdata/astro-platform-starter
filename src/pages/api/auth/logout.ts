import type { APIRoute } from 'astro';
import { invalidateSession } from '../../../utils/session';

export const prerender = false;

export const POST: APIRoute = async ({ request }) => {
    try {
        // Invalidate the session and get cookie to clear it
        const clearCookie = await invalidateSession(request);

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
        console.error('Logout error:', error);
        return new Response(JSON.stringify({
            success: false,
            error: 'An error occurred during logout'
        }), {
            status: 500,
            headers: { 'Content-Type': 'application/json' }
        });
    }
};
