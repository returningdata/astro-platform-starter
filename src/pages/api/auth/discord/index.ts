import type { APIRoute } from 'astro';
import {
    isDiscordOAuthConfigured,
    getAuthorizationUrl,
    generateOAuthState,
    generateCodeVerifier,
    generateCodeChallenge,
} from '../../../../utils/discord-oauth';

export const prerender = false;

// Cookie settings for OAuth state and PKCE
const STATE_COOKIE_NAME = 'discord_oauth_state';
const PKCE_COOKIE_NAME = 'discord_oauth_pkce';
const COOKIE_MAX_AGE = 600; // 10 minutes

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

        // Generate state parameter for CSRF protection (includes timestamp for replay protection)
        const state = generateOAuthState();

        // Generate PKCE code verifier and challenge
        const codeVerifier = generateCodeVerifier();
        const codeChallenge = await generateCodeChallenge(codeVerifier);

        // Determine the redirect URI based on the request
        const url = new URL(request.url);
        const redirectUri = `${url.origin}/api/auth/discord/callback`;

        // Generate the authorization URL with PKCE
        const authorizationUrl = getAuthorizationUrl(redirectUri, state, codeChallenge);

        // Create secure cookies to store the state and PKCE verifier
        const stateCookie = `${STATE_COOKIE_NAME}=${state}; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=${COOKIE_MAX_AGE}`;
        const pkceCookie = `${PKCE_COOKIE_NAME}=${codeVerifier}; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=${COOKIE_MAX_AGE}`;

        // Redirect to Discord with both cookies set
        const headers = new Headers();
        headers.set('Location', authorizationUrl);
        headers.append('Set-Cookie', stateCookie);
        headers.append('Set-Cookie', pkceCookie);

        return new Response(null, {
            status: 302,
            headers
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
