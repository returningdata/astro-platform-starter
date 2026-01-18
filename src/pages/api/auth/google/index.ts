import type { APIRoute } from 'astro';
import {
    isGoogleOAuthConfigured,
    getGoogleAuthorizationUrl,
    generateOAuthState,
} from '../../../../utils/google-oauth';

export const prerender = false;

// Cookie settings for OAuth state
const STATE_COOKIE_NAME = 'google_oauth_state';
const RETURN_TO_COOKIE_NAME = 'google_oauth_return_to';
const COOKIE_MAX_AGE = 600; // 10 minutes

function isValidReturnPath(path: string): boolean {
    // Only allow internal paths (starting with /) and specific allowed paths
    if (!path.startsWith('/')) return false;
    // Allow any internal path that doesn't try to escape
    if (path.includes('//') || path.includes('..')) return false;
    return true;
}

export const GET: APIRoute = async ({ request }) => {
    try {
        // Check if Google OAuth is configured
        if (!isGoogleOAuthConfigured()) {
            return new Response(JSON.stringify({
                success: false,
                error: 'Google OAuth is not configured. Please set the required environment variables.'
            }), {
                status: 503,
                headers: { 'Content-Type': 'application/json' }
            });
        }

        // Get returnTo parameter from query string
        const url = new URL(request.url);
        const returnTo = url.searchParams.get('returnTo');

        // Generate state parameter for CSRF protection (includes timestamp for replay protection)
        const state = generateOAuthState();

        // Determine the redirect URI based on the request
        const redirectUri = `${url.origin}/api/auth/google/callback`;

        // Generate the authorization URL
        const authorizationUrl = getGoogleAuthorizationUrl(redirectUri, state);

        // Create secure cookies to store the state
        const stateCookie = `${STATE_COOKIE_NAME}=${state}; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=${COOKIE_MAX_AGE}`;

        // Redirect to Google with cookies set
        const headers = new Headers();
        headers.set('Location', authorizationUrl);
        headers.append('Set-Cookie', stateCookie);

        // Store returnTo path in a cookie if valid
        if (returnTo && isValidReturnPath(returnTo)) {
            const returnToCookie = `${RETURN_TO_COOKIE_NAME}=${encodeURIComponent(returnTo)}; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=${COOKIE_MAX_AGE}`;
            headers.append('Set-Cookie', returnToCookie);
        }

        return new Response(null, {
            status: 302,
            headers
        });
    } catch (error) {
        console.error('Google OAuth initiation error:', error);
        return new Response(JSON.stringify({
            success: false,
            error: 'Failed to initiate Google authentication'
        }), {
            status: 500,
            headers: { 'Content-Type': 'application/json' }
        });
    }
};
