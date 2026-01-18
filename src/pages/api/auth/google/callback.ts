import type { APIRoute } from 'astro';
import {
    exchangeGoogleCodeForToken,
    getGoogleUser,
    validateOAuthState,
    getOrCreateIntelUser,
    createIntelSession,
} from '../../../../utils/google-oauth';

export const prerender = false;

// Cookie names (must match index.ts)
const STATE_COOKIE_NAME = 'google_oauth_state';
const RETURN_TO_COOKIE_NAME = 'google_oauth_return_to';
const NEEDS_PROFILE_COOKIE_NAME = 'intel_needs_profile';

/**
 * Parse cookies from request
 */
function parseCookies(cookieHeader: string | null): Record<string, string> {
    if (!cookieHeader) return {};
    return Object.fromEntries(
        cookieHeader.split(';').map(c => {
            const [key, ...value] = c.trim().split('=');
            return [key, value.join('=')];
        })
    );
}

/**
 * Create cookies that clear the OAuth state
 */
function createClearCookies(): string[] {
    return [
        `${STATE_COOKIE_NAME}=; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=0`,
        `${RETURN_TO_COOKIE_NAME}=; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=0`,
    ];
}

export const GET: APIRoute = async ({ request }) => {
    const url = new URL(request.url);
    const cookies = parseCookies(request.headers.get('cookie'));

    try {
        // Check for error from Google
        const error = url.searchParams.get('error');
        if (error) {
            console.error('Google OAuth error:', error);
            const redirectUrl = '/intel/login?error=google_access_denied';
            const headers = new Headers();
            headers.set('Location', redirectUrl);
            createClearCookies().forEach(c => headers.append('Set-Cookie', c));
            return new Response(null, { status: 302, headers });
        }

        // Get required parameters
        const code = url.searchParams.get('code');
        const state = url.searchParams.get('state');
        const storedState = cookies[STATE_COOKIE_NAME];

        if (!code || !state || !storedState) {
            console.error('Missing OAuth parameters');
            const redirectUrl = '/intel/login?error=missing_params';
            const headers = new Headers();
            headers.set('Location', redirectUrl);
            createClearCookies().forEach(c => headers.append('Set-Cookie', c));
            return new Response(null, { status: 302, headers });
        }

        // Validate state parameter
        const stateValidation = validateOAuthState(storedState, state);
        if (!stateValidation.valid) {
            console.error('State validation failed:', stateValidation.reason);
            const redirectUrl = '/intel/login?error=state_mismatch';
            const headers = new Headers();
            headers.set('Location', redirectUrl);
            createClearCookies().forEach(c => headers.append('Set-Cookie', c));
            return new Response(null, { status: 302, headers });
        }

        // Exchange code for token
        const redirectUri = `${url.origin}/api/auth/google/callback`;
        const tokenResponse = await exchangeGoogleCodeForToken(code, redirectUri);

        // Get user info from Google
        const googleUser = await getGoogleUser(tokenResponse.access_token);

        // Get or create Intel user
        const { user: intelUser, isNewUser } = await getOrCreateIntelUser(googleUser);

        // Create Intel session
        const { cookie: sessionCookie } = await createIntelSession(intelUser, request);

        // Determine redirect destination
        let redirectTo = '/intel';
        const storedReturnTo = cookies[RETURN_TO_COOKIE_NAME];
        if (storedReturnTo) {
            const decodedPath = decodeURIComponent(storedReturnTo);
            if (decodedPath.startsWith('/') && !decodedPath.includes('//') && !decodedPath.includes('..')) {
                redirectTo = decodedPath;
            }
        }

        // Build response with session cookie and cleared OAuth cookies
        const headers = new Headers();
        headers.set('Location', redirectTo);
        headers.append('Set-Cookie', sessionCookie);
        createClearCookies().forEach(c => headers.append('Set-Cookie', c));

        // If new user or profile not complete, set a cookie to trigger the profile popup
        if (isNewUser || !intelUser.profileComplete) {
            headers.append('Set-Cookie', `${NEEDS_PROFILE_COOKIE_NAME}=true; Path=/; Max-Age=3600`);
        }

        return new Response(null, { status: 302, headers });

    } catch (error) {
        console.error('Google OAuth callback error:', error);
        const redirectUrl = '/intel/login?error=callback_failed';
        const headers = new Headers();
        headers.set('Location', redirectUrl);
        createClearCookies().forEach(c => headers.append('Set-Cookie', c));
        return new Response(null, { status: 302, headers });
    }
};
