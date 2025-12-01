import type { APIRoute } from 'astro';

export const prerender = false;

export const POST: APIRoute = async ({ request }) => {
    try {
        const body = await request.json();
        const { username, password } = body;

        if (!username || !password) {
            return new Response(JSON.stringify({
                success: false,
                error: 'Username and password are required'
            }), {
                status: 400,
                headers: { 'Content-Type': 'application/json' }
            });
        }

        const validUsername = 'DPPD_ADMIN';
        const validPassword = 'DPPD_High_Command2025!@';

        if (username === validUsername && password === validPassword) {
            return new Response(JSON.stringify({
                success: true,
                message: 'Login successful'
            }), {
                status: 200,
                headers: { 'Content-Type': 'application/json' }
            });
        }

        return new Response(JSON.stringify({
            success: false,
            error: 'Invalid credentials'
        }), {
            status: 401,
            headers: { 'Content-Type': 'application/json' }
        });
    } catch (error) {
        return new Response(JSON.stringify({
            success: false,
            error: 'An error occurred'
        }), {
            status: 500,
            headers: { 'Content-Type': 'application/json' }
        });
    }
};
