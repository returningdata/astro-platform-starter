import type { APIRoute } from 'astro';
import {
    exchangeCodeForToken,
    getDiscordUser,
    getGuildMember,
    determineUserRole,
    createAdminUserFromDiscord
} from '../../../../utils/discord-oauth';
import { createSession, isSessionSecretConfigured } from '../../../../utils/session';
import { logLogin } from '../../../../utils/discord-webhook';

export const prerender = false;

// Cookie name for OAuth state
const STATE_COOKIE_NAME = 'discord_oauth_state';

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

        // Verify state parameter (CSRF protection)
        const cookies = parseCookies(request.headers.get('cookie'));
        const storedState = cookies[STATE_COOKIE_NAME];

        if (!storedState || storedState !== state) {
            console.error('State mismatch:', { storedState, receivedState: state });
            return new Response(null, {
                status: 302,
                headers: {
                    'Location': '/admin/login?error=state_mismatch'
                }
            });
        }

        // Exchange code for token
        const redirectUri = `${url.origin}/api/auth/discord/callback`;
        const tokenData = await exchangeCodeForToken(code, redirectUri);

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

        // Determine user role based on Discord roles
        const roleInfo = determineUserRole(guildMember.roles);

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

        // Create admin user from Discord data
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
            'Discord OAuth'
        );

        // Create session
        const { cookie: sessionCookie } = await createSession(adminUser);

        // Clear the state cookie and set the session cookie
        const clearStateCookie = `${STATE_COOKIE_NAME}=; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=0`;

        // Redirect to admin dashboard with session cookie
        return new Response(null, {
            status: 302,
            headers: {
                'Location': '/admin',
                'Set-Cookie': [clearStateCookie, sessionCookie].join(', ')
            }
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
