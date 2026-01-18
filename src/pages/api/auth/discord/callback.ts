import type { APIRoute } from 'astro';
import {
    exchangeCodeForToken,
    getDiscordUser,
    getGuildMember,
    determineUserRole,
    createAdminUserFromDiscord,
    validateOAuthState,
} from '../../../../utils/discord-oauth';
import { createSession, isSessionSecretConfigured } from '../../../../utils/session';
import { logLogin } from '../../../../utils/discord-webhook';

export const prerender = false;

// Cookie names for OAuth state and PKCE
const STATE_COOKIE_NAME = 'discord_oauth_state';
const PKCE_COOKIE_NAME = 'discord_oauth_pkce';
const RETURN_TO_COOKIE_NAME = 'discord_oauth_return_to';

/**
 * Parse cookies from request header
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
 * Create clear cookies for cleanup
 */
function createClearCookies(): string[] {
    return [
        `${STATE_COOKIE_NAME}=; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=0`,
        `${PKCE_COOKIE_NAME}=; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=0`,
        `${RETURN_TO_COOKIE_NAME}=; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=0`,
    ];
}

/**
 * Validate returnTo path to prevent open redirect vulnerabilities
 */
function isValidReturnPath(path: string): boolean {
    if (!path || typeof path !== 'string') return false;
    // Only allow internal paths (starting with /)
    if (!path.startsWith('/')) return false;
    // Prevent protocol-relative URLs and path traversal
    if (path.includes('//') || path.includes('..')) return false;
    return true;
}

export const GET: APIRoute = async ({ request }) => {
    try {
        // Pre-flight check: Ensure session management is configured
        if (!isSessionSecretConfigured()) {
            console.error('Discord OAuth callback attempted but SESSION_SECRET is not configured');
            return new Response(null, {
                status: 302,
                headers: {
                    'Location': '/admin/login?error=server_config'
                }
            });
        }

        const url = new URL(request.url);
        const code = url.searchParams.get('code');
        const state = url.searchParams.get('state');
        const error = url.searchParams.get('error');
        const errorDescription = url.searchParams.get('error_description');

        // Handle OAuth errors from Discord
        if (error) {
            console.error('Discord OAuth error:', error, errorDescription);
            return new Response(null, {
                status: 302,
                headers: {
                    'Location': `/admin/login?error=discord_${error}`
                }
            });
        }

        // Verify required parameters
        if (!code || !state) {
            return new Response(null, {
                status: 302,
                headers: {
                    'Location': '/admin/login?error=missing_params'
                }
            });
        }

        // Parse cookies
        const cookies = parseCookies(request.headers.get('cookie'));
        const storedState = cookies[STATE_COOKIE_NAME];
        const codeVerifier = cookies[PKCE_COOKIE_NAME];

        // Verify state parameter with enhanced validation (includes timestamp check)
        const stateValidation = validateOAuthState(storedState, state);
        if (!stateValidation.valid) {
            console.error('State validation failed:', stateValidation.reason);
            return new Response(null, {
                status: 302,
                headers: {
                    'Location': `/admin/login?error=state_${stateValidation.reason?.toLowerCase().replace(/\s+/g, '_') || 'invalid'}`
                }
            });
        }

        // Exchange code for token with PKCE verifier
        const redirectUri = `${url.origin}/api/auth/discord/callback`;
        const tokenData = await exchangeCodeForToken(code, redirectUri, codeVerifier);

        // Get Discord user information
        const discordUser = await getDiscordUser(tokenData.access_token);

        // Get guild member information to check roles
        const guildMember = await getGuildMember(discordUser.id);

        if (!guildMember) {
            // User is not a member of the guild
            await logLogin(
                { username: discordUser.username, id: `discord-${discordUser.id}` },
                false,
                'Not a member of the Discord server'
            );

            return new Response(null, {
                status: 302,
                headers: {
                    'Location': '/admin/login?error=not_member'
                }
            });
        }

        // Determine user role based on Discord roles (now includes pagePermissions)
        const roleInfo = await determineUserRole(guildMember.roles);

        if (!roleInfo) {
            // User doesn't have any valid admin roles
            await logLogin(
                { username: discordUser.username, id: `discord-${discordUser.id}` },
                false,
                'No admin role assigned in Discord'
            );

            return new Response(null, {
                status: 302,
                headers: {
                    'Location': '/admin/login?error=no_role'
                }
            });
        }

        // Create admin user from Discord data (with page permissions)
        const adminUser = createAdminUserFromDiscord(discordUser, roleInfo);

        // Log successful login
        await logLogin(
            {
                id: adminUser.id,
                username: adminUser.username,
                displayName: adminUser.displayName,
                role: adminUser.role
            },
            true,
            'Discord OAuth (PKCE)'
        );

        // Create session with request binding
        const { cookie: sessionCookie } = await createSession(adminUser, request);

        // Clear OAuth cookies and set session cookie
        const clearCookies = createClearCookies();

        // Determine redirect location - use returnTo cookie if valid, otherwise default to /admin
        const returnToEncoded = cookies[RETURN_TO_COOKIE_NAME];
        let redirectLocation = '/admin';
        if (returnToEncoded) {
            try {
                const returnTo = decodeURIComponent(returnToEncoded);
                if (isValidReturnPath(returnTo)) {
                    redirectLocation = returnTo;
                }
            } catch {
                // Invalid encoding, use default
            }
        }

        // Redirect with cookies
        const headers = new Headers();
        headers.set('Location', redirectLocation);
        for (const clearCookie of clearCookies) {
            headers.append('Set-Cookie', clearCookie);
        }
        headers.append('Set-Cookie', sessionCookie);

        return new Response(null, {
            status: 302,
            headers
        });
    } catch (error) {
        console.error('Discord OAuth callback error:', error);

        // Log the failed attempt
        await logLogin(
            { username: 'Unknown Discord User' },
            false,
            `OAuth callback error: ${error instanceof Error ? error.message : 'Unknown error'}`
        );

        return new Response(null, {
            status: 302,
            headers: {
                'Location': '/admin/login?error=callback_failed'
            }
        });
    }
};
