/**
 * Discord OAuth2 Utility
 *
 * Handles Discord OAuth2 authentication flow and role-based access control.
 * Uses environment variables for sensitive configuration.
 * Now supports configurable role mappings from the admin panel.
 *
 * Security enhancements:
 * - PKCE (Proof Key for Code Exchange) support for additional security
 * - Nonce validation to prevent replay attacks
 * - Token binding to session
 */

import type { AdminUser, PagePermission } from './session';
import { getStore } from '@netlify/blobs';

// Discord API endpoints
const DISCORD_API_BASE = 'https://discord.com/api/v10';
const DISCORD_OAUTH_AUTHORIZE = 'https://discord.com/oauth2/authorize';
const DISCORD_OAUTH_TOKEN = `${DISCORD_API_BASE}/oauth2/token`;

// OAuth2 scopes needed for authentication
const OAUTH_SCOPES = ['identify', 'guilds.members.read'];

// PKCE code verifier length (43-128 characters recommended)
const PKCE_VERIFIER_LENGTH = 64;

/**
 * Role mapping interface for configurable roles
 */
interface DiscordRoleMapping {
    id: string;
    discordRoleId: string;
    roleName: string;
    internalRole: 'super_admin' | 'subdivision_overseer' | 'custom';
    permissions: string[];
    pagePermissions?: PagePermission[];
    priority: number;
    description?: string;
    isActive?: boolean;
}

interface RolesConfig {
    discordRoleMappings: DiscordRoleMapping[];
}

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
    // Try Netlify.env first if available
    if (typeof Netlify !== 'undefined' && Netlify.env) {
        const value = Netlify.env.get(name);
        if (value) return value;
    }

    // Fall back to process.env
    if (typeof process !== 'undefined' && process.env) {
        return process.env[name];
    }

    return undefined;
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
 * Generate the OAuth2 authorization URL with optional PKCE support
 */
export function getAuthorizationUrl(
    redirectUri: string,
    state: string,
    codeChallenge?: string
): string {
    const config = getDiscordConfig();

    const params = new URLSearchParams({
        client_id: config.clientId,
        redirect_uri: redirectUri,
        response_type: 'code',
        scope: OAUTH_SCOPES.join(' '),
        state: state,
        prompt: 'consent'
    });

    // Add PKCE parameters if code challenge is provided
    if (codeChallenge) {
        params.set('code_challenge', codeChallenge);
        params.set('code_challenge_method', 'S256');
    }

    return `${DISCORD_OAUTH_AUTHORIZE}?${params.toString()}`;
}

/**
 * Exchange authorization code for access token with optional PKCE support
 */
export async function exchangeCodeForToken(
    code: string,
    redirectUri: string,
    codeVerifier?: string
): Promise<TokenResponse> {
    const config = getDiscordConfig();

    const params = new URLSearchParams({
        client_id: config.clientId,
        client_secret: config.clientSecret,
        grant_type: 'authorization_code',
        code: code,
        redirect_uri: redirectUri
    });

    // Add PKCE code verifier if provided
    if (codeVerifier) {
        params.set('code_verifier', codeVerifier);
    }

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
 * Get configurable role mappings from blob store
 */
async function getConfigurableRoleMappings(): Promise<DiscordRoleMapping[]> {
    try {
        const store = getStore({ name: 'roles-config', consistency: 'strong' });
        const data = await store.get('config', { type: 'json' }) as RolesConfig | null;
        if (data?.discordRoleMappings && data.discordRoleMappings.length > 0) {
            // Sort by priority (higher first)
            return [...data.discordRoleMappings].sort((a, b) => b.priority - a.priority);
        }
        return [];
    } catch (error) {
        console.error('Error fetching role mappings:', error);
        return [];
    }
}

/**
 * Determine user role based on Discord roles
 * First checks configurable role mappings, then falls back to environment variables
 * Now includes page-level permissions from role mappings
 */
export async function determineUserRole(memberRoles: string[]): Promise<{
    role: AdminUser['role'];
    permissions: string[];
    pagePermissions?: PagePermission[];
} | null> {
    // First, check configurable role mappings
    const configurableRoleMappings = await getConfigurableRoleMappings();

    if (configurableRoleMappings.length > 0) {
        // Check configurable mappings in priority order
        for (const mapping of configurableRoleMappings) {
            // Skip inactive mappings
            if (mapping.isActive === false) continue;

            if (memberRoles.includes(mapping.discordRoleId)) {
                return {
                    role: mapping.internalRole,
                    permissions: mapping.permissions,
                    pagePermissions: mapping.pagePermissions,
                };
            }
        }
    }

    // Fall back to environment variable-based role checking
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
                'user-management',
                'roles-management'
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
 * Generate a cryptographically secure state parameter with nonce
 * The state includes both a random component and a timestamp for replay protection
 */
export function generateOAuthState(): string {
    const array = new Uint8Array(32);
    crypto.getRandomValues(array);
    const randomPart = Array.from(array, byte => byte.toString(16).padStart(2, '0')).join('');
    // Include timestamp for replay attack protection (state expires in 10 minutes)
    const timestamp = Date.now().toString(36);
    return `${randomPart}.${timestamp}`;
}

/**
 * Validate OAuth state including timestamp check
 */
export function validateOAuthState(storedState: string, receivedState: string): { valid: boolean; reason?: string } {
    if (!storedState || !receivedState) {
        return { valid: false, reason: 'Missing state parameter' };
    }

    // Constant-time comparison for the state
    if (storedState.length !== receivedState.length) {
        return { valid: false, reason: 'State mismatch' };
    }

    let result = 0;
    for (let i = 0; i < storedState.length; i++) {
        result |= storedState.charCodeAt(i) ^ receivedState.charCodeAt(i);
    }

    if (result !== 0) {
        return { valid: false, reason: 'State mismatch' };
    }

    // Check timestamp to prevent replay attacks
    const parts = receivedState.split('.');
    if (parts.length >= 2) {
        const timestamp = parseInt(parts[1], 36);
        const now = Date.now();
        const maxAge = 10 * 60 * 1000; // 10 minutes

        if (now - timestamp > maxAge) {
            return { valid: false, reason: 'State expired' };
        }
    }

    return { valid: true };
}

/**
 * Generate PKCE code verifier (cryptographically random string)
 */
export function generateCodeVerifier(): string {
    const array = new Uint8Array(PKCE_VERIFIER_LENGTH);
    crypto.getRandomValues(array);
    // Use URL-safe base64 encoding
    return base64UrlEncode(array);
}

/**
 * Generate PKCE code challenge from verifier using SHA-256
 */
export async function generateCodeChallenge(verifier: string): Promise<string> {
    const encoder = new TextEncoder();
    const data = encoder.encode(verifier);
    const digest = await crypto.subtle.digest('SHA-256', data);
    return base64UrlEncode(new Uint8Array(digest));
}

/**
 * URL-safe Base64 encoding
 */
function base64UrlEncode(buffer: Uint8Array): string {
    // Convert to base64
    let binary = '';
    for (let i = 0; i < buffer.length; i++) {
        binary += String.fromCharCode(buffer[i]);
    }
    const base64 = btoa(binary);

    // Make URL-safe
    return base64
        .replace(/\+/g, '-')
        .replace(/\//g, '_')
        .replace(/=+$/, '');
}

/**
 * Generate a nonce for additional security
 */
export function generateNonce(): string {
    const array = new Uint8Array(16);
    crypto.getRandomValues(array);
    return Array.from(array, byte => byte.toString(16).padStart(2, '0')).join('');
}

/**
 * Create an AdminUser from Discord data with page permissions
 */
export function createAdminUserFromDiscord(
    discordUser: DiscordUser,
    roleInfo: { role: AdminUser['role']; permissions: string[]; pagePermissions?: PagePermission[] }
): AdminUser {
    return {
        id: `discord-${discordUser.id}`,
        username: discordUser.username,
        displayName: discordUser.global_name || discordUser.username,
        role: roleInfo.role,
        permissions: roleInfo.permissions,
        pagePermissions: roleInfo.pagePermissions,
    };
}
