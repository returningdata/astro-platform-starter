/**
 * Discord OAuth2 Utility
 *
 * Handles Discord OAuth2 authentication flow and role-based access control.
 * Uses environment variables for sensitive configuration.
 */

import type { AdminUser } from './session';

// Discord API endpoints
const DISCORD_API_BASE = 'https://discord.com/api/v10';
const DISCORD_OAUTH_AUTHORIZE = 'https://discord.com/oauth2/authorize';
const DISCORD_OAUTH_TOKEN = `${DISCORD_API_BASE}/oauth2/token`;

// OAuth2 scopes needed for authentication
const OAUTH_SCOPES = ['identify', 'guilds.members.read'];

/**
 * Discord user data from the /users/@me endpoint
 */
export interface DiscordUser {
    id: string;
    username: string;
    discriminator: string;
    global_name: string | null;
    avatar: string | null;
}

/**
 * Discord guild member data
 */
export interface DiscordGuildMember {
    user?: DiscordUser;
    nick: string | null;
    avatar: string | null;
    roles: string[];
    joined_at: string;
}

/**
 * OAuth2 token response
 */
interface TokenResponse {
    access_token: string;
    token_type: string;
    expires_in: number;
    refresh_token: string;
    scope: string;
}

/**
 * Get environment variable using Netlify or process.env
 */
function getEnv(name: string): string | undefined {
    return typeof Netlify !== 'undefined'
        ? Netlify.env.get(name)
        : process.env[name];
}

/**
 * Check if Discord OAuth is configured
 */
export function isDiscordOAuthConfigured(): boolean {
    const clientId = getEnv('DISCORD_CLIENT_ID');
    const clientSecret = getEnv('DISCORD_CLIENT_SECRET');
    const guildId = getEnv('DISCORD_GUILD_ID');
    const botToken = getEnv('DISCORD_BOT_TOKEN');

    return !!(clientId && clientSecret && guildId && botToken);
}

/**
 * Get Discord OAuth2 configuration
 */
export function getDiscordConfig() {
    return {
        clientId: getEnv('DISCORD_CLIENT_ID') || '',
        clientSecret: getEnv('DISCORD_CLIENT_SECRET') || '',
        guildId: getEnv('DISCORD_GUILD_ID') || '',
        botToken: getEnv('DISCORD_BOT_TOKEN') || '',
        superAdminRoleId: getEnv('DISCORD_SUPERADMIN_ROLE_ID') || '',
        subdivRoleId: getEnv('DISCORD_SUBDIV_ROLE_ID') || '',
        allOthersRoleId: getEnv('DISCORD_ALLOTHERS_ROLE_ID') || '',
    };
}

/**
 * Generate the OAuth2 authorization URL
 */
export function getAuthorizationUrl(redirectUri: string, state: string): string {
    const config = getDiscordConfig();

    const params = new URLSearchParams({
        client_id: config.clientId,
        redirect_uri: redirectUri,
        response_type: 'code',
        scope: OAUTH_SCOPES.join(' '),
        state: state,
        prompt: 'consent'
    });

    return `${DISCORD_OAUTH_AUTHORIZE}?${params.toString()}`;
}

/**
 * Exchange authorization code for access token
 */
export async function exchangeCodeForToken(
    code: string,
    redirectUri: string
): Promise<TokenResponse> {
    const config = getDiscordConfig();

    const params = new URLSearchParams({
        client_id: config.clientId,
        client_secret: config.clientSecret,
        grant_type: 'authorization_code',
        code: code,
        redirect_uri: redirectUri
    });

    const response = await fetch(DISCORD_OAUTH_TOKEN, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/x-www-form-urlencoded'
        },
        body: params.toString()
    });

    if (!response.ok) {
        const error = await response.text();
        console.error('Token exchange failed:', error);
        throw new Error(`Failed to exchange code for token: ${response.status}`);
    }

    return response.json();
}

/**
 * Get Discord user information
 */
export async function getDiscordUser(accessToken: string): Promise<DiscordUser> {
    const response = await fetch(`${DISCORD_API_BASE}/users/@me`, {
        headers: {
            Authorization: `Bearer ${accessToken}`
        }
    });

    if (!response.ok) {
        throw new Error(`Failed to get Discord user: ${response.status}`);
    }

    return response.json();
}

/**
 * Get guild member information using the bot token
 * This is more reliable than using the user's access token
 */
export async function getGuildMember(userId: string): Promise<DiscordGuildMember | null> {
    const config = getDiscordConfig();

    const response = await fetch(
        `${DISCORD_API_BASE}/guilds/${config.guildId}/members/${userId}`,
        {
            headers: {
                Authorization: `Bot ${config.botToken}`
            }
        }
    );

    if (response.status === 404) {
        // User is not a member of the guild
        return null;
    }

    if (!response.ok) {
        const error = await response.text();
        console.error('Failed to get guild member:', error);
        throw new Error(`Failed to get guild member: ${response.status}`);
    }

    return response.json();
}

/**
 * Determine user role based on Discord roles
 */
export function determineUserRole(memberRoles: string[]): {
    role: AdminUser['role'];
    permissions: string[];
} | null {
    const config = getDiscordConfig();

    // Check for Super Admin role
    if (config.superAdminRoleId && memberRoles.includes(config.superAdminRoleId)) {
        return {
            role: 'super_admin',
            permissions: [
                'warehouse',
                'events',
                'resources',
                'uniforms',
                'theme-settings',
                'department-data',
                'subdivisions',
                'user-management'
            ]
        };
    }

    // Check for Subdivision Overseer role
    if (config.subdivRoleId && memberRoles.includes(config.subdivRoleId)) {
        return {
            role: 'subdivision_overseer',
            permissions: ['department-data-subdivisions', 'subdivisions']
        };
    }

    // Check for All Others role (basic access)
    if (config.allOthersRoleId && memberRoles.includes(config.allOthersRoleId)) {
        return {
            role: 'custom',
            permissions: ['warehouse', 'events', 'resources', 'uniforms']
        };
    }

    // No valid role found
    return null;
}

/**
 * Generate a cryptographically secure state parameter
 */
export function generateOAuthState(): string {
    const array = new Uint8Array(32);
    crypto.getRandomValues(array);
    return Array.from(array, byte => byte.toString(16).padStart(2, '0')).join('');
}

/**
 * Create an AdminUser from Discord data
 */
export function createAdminUserFromDiscord(
    discordUser: DiscordUser,
    roleInfo: { role: AdminUser['role']; permissions: string[] }
): AdminUser {
    return {
        id: `discord-${discordUser.id}`,
        username: discordUser.username,
        displayName: discordUser.global_name || discordUser.username,
        role: roleInfo.role,
        permissions: roleInfo.permissions
    };
}
