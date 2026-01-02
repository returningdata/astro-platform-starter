import type { APIRoute } from 'astro';
import {
    isDiscordOAuthConfigured,
    getAuthorizationUrl,
    generateOAuthState
} from '../../../../utils/discord-oauth';

export const prerender = false;

// Cookie settings for OAuth state
const STATE_COOKIE_NAME = 'discord_oauth_state';
const STATE_COOKIE_MAX_AGE = 600; // 10 minutes

export const GET: APIRoute = async ({ request }) => {
    try {
        // Check if Discord OAuth is configured
        if (!isDiscordOAuthConfigured()) {
            return new Response(JSON.stringify({
                success: false,
                error: 'Discord OAuth is not configured. Please set the required environment variables.'
            }), {
                status: 503,
                headers: { 'Content-Type': 'application/json' }
            });
        }

        // Generate state parameter for CSRF protection
        const state = generateOAuthState();

        // Determine the redirect URI based on the request
        const url = new URL(request.url);
        const redirectUri = `${url.origin}/api/auth/discord/callback`;

        // Generate the authorization URL
        const authorizationUrl = getAuthorizationUrl(redirectUri, state);

        // Create a secure cookie to store the state
        const stateCookie = `${STATE_COOKIE_NAME}=${state}; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=${STATE_COOKIE_MAX_AGE}`;

        // Redirect to Discord
        return new Response(null, {
            status: 302,
            headers: {
                'Location': authorizationUrl,
                'Set-Cookie': stateCookie
            }
        });
    } catch (error) {
        console.error('Discord OAuth initiation error:', error);
        return new Response(JSON.stringify({
            success: false,
            error: 'Failed to initiate Discord authentication'
        }), {
            status: 500,
            headers: { 'Content-Type': 'application/json' }
        });
    }
};
