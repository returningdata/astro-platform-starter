/**
 * Google OAuth2 Utility
 *
 * Handles Google OAuth2 authentication flow for intel page access.
 * Uses environment variables for sensitive configuration.
 *
 * Security enhancements:
 * - State parameter validation for CSRF protection
 * - Nonce generation for replay attack prevention
 * - Constant-time comparison to prevent timing attacks
 */

import { getStore } from '@netlify/blobs';

// Google API endpoints
const GOOGLE_OAUTH_AUTHORIZE = 'https://accounts.google.com/o/oauth2/v2/auth';
const GOOGLE_OAUTH_TOKEN = 'https://oauth2.googleapis.com/token';
const GOOGLE_USERINFO_URL = 'https://www.googleapis.com/oauth2/v2/userinfo';

// OAuth2 scopes needed for authentication
const OAUTH_SCOPES = ['openid', 'email', 'profile'];

/**
 * Google user data from the userinfo endpoint
 */
export interface GoogleUser {
    id: string;
    email: string;
    verified_email: boolean;
    name: string;
    given_name: string;
    family_name: string;
    picture: string;
}

/**
 * Clearance levels for Intel users
 * PT = Public Trust (lowest)
 * C = Confidential
 * S = Secret
 * TS = Top Secret
 * TS/SCI = Top Secret/Sensitive Compartmented Information
 * SA = Special Access (highest)
 */
export type ClearanceLevel = 'pending' | 'public_trust' | 'confidential' | 'secret' | 'top_secret' | 'top_secret_sci' | 'special_access' | 'denied';

/**
 * Clearance level hierarchy (higher index = higher clearance)
 */
export const CLEARANCE_HIERARCHY: ClearanceLevel[] = [
    'denied',
    'pending',
    'public_trust',
    'confidential',
    'secret',
    'top_secret',
    'top_secret_sci',
    'special_access'
];

/**
 * Display names for clearance levels
 */
export const CLEARANCE_DISPLAY_NAMES: Record<ClearanceLevel, string> = {
    'pending': 'Pending',
    'public_trust': 'Public Trust',
    'confidential': 'Confidential',
    'secret': 'Secret',
    'top_secret': 'Top Secret',
    'top_secret_sci': 'Top Secret/SCI',
    'special_access': 'Special Access',
    'denied': 'Denied'
};

/**
 * Short codes for clearance levels (for badges)
 */
export const CLEARANCE_SHORT_CODES: Record<ClearanceLevel, string> = {
    'pending': 'P',
    'public_trust': 'PT',
    'confidential': 'C',
    'secret': 'S',
    'top_secret': 'TS',
    'top_secret_sci': 'TS/SCI',
    'special_access': 'SA',
    'denied': 'X'
};

/**
 * Intel user with clearance level and officer information
 */
export interface IntelUser {
    id: string;
    googleId: string;
    email: string;
    name: string;
    picture: string;
    clearanceLevel: ClearanceLevel;
    createdAt: number;
    lastLogin: number;
    // Additional officer info (collected on first login)
    discordUsername?: string;
    discordId?: string;
    officerName?: string;
    callsign?: string;
    badgeNumber?: string;
    profileComplete: boolean;
}

/**
 * OAuth2 token response
 */
interface TokenResponse {
    access_token: string;
    token_type: string;
    expires_in: number;
    refresh_token?: string;
    scope: string;
    id_token?: string;
}

/**
 * Intel session stored in cookies
 */
export interface IntelSession {
    sessionId: string;
    user: IntelUser;
    createdAt: number;
    expiresAt: number;
    lastActivity: number;
}

const INTEL_SESSION_COOKIE_NAME = 'dppd_intel_session';
const INTEL_SESSION_STORE_NAME = 'intel-sessions';
const INTEL_USERS_STORE_NAME = 'intel-users';
const INTEL_LOGIN_LOG_STORE_NAME = 'intel-login-logs';
const SESSION_EXPIRY_MS = 24 * 60 * 60 * 1000; // 24 hours

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
 * Check if Google OAuth is configured
 */
export function isGoogleOAuthConfigured(): boolean {
    const clientId = getEnv('GOOGLE_CLIENT_ID');
    const clientSecret = getEnv('GOOGLE_CLIENT_SECRET');

    return !!(clientId && clientSecret);
}

/**
 * Get Google OAuth2 configuration
 */
export function getGoogleConfig() {
    return {
        clientId: getEnv('GOOGLE_CLIENT_ID') || '',
        clientSecret: getEnv('GOOGLE_CLIENT_SECRET') || '',
    };
}

/**
 * Generate the OAuth2 authorization URL
 */
export function getGoogleAuthorizationUrl(
    redirectUri: string,
    state: string
): string {
    const config = getGoogleConfig();

    const params = new URLSearchParams({
        client_id: config.clientId,
        redirect_uri: redirectUri,
        response_type: 'code',
        scope: OAUTH_SCOPES.join(' '),
        state: state,
        access_type: 'offline',
        prompt: 'consent'
    });

    return `${GOOGLE_OAUTH_AUTHORIZE}?${params.toString()}`;
}

/**
 * Exchange authorization code for access token
 */
export async function exchangeGoogleCodeForToken(
    code: string,
    redirectUri: string
): Promise<TokenResponse> {
    const config = getGoogleConfig();

    const params = new URLSearchParams({
        client_id: config.clientId,
        client_secret: config.clientSecret,
        grant_type: 'authorization_code',
        code: code,
        redirect_uri: redirectUri
    });

    const response = await fetch(GOOGLE_OAUTH_TOKEN, {
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
 * Get Google user information
 */
export async function getGoogleUser(accessToken: string): Promise<GoogleUser> {
    const response = await fetch(GOOGLE_USERINFO_URL, {
        headers: {
            Authorization: `Bearer ${accessToken}`
        }
    });

    if (!response.ok) {
        throw new Error(`Failed to get Google user: ${response.status}`);
    }

    return response.json();
}

/**
 * Generate a cryptographically secure state parameter with nonce
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
 * Get session secret
 */
function getSessionSecret(): string {
    let secret = getEnv('SESSION_SECRET');

    if (!secret) {
        let context = getEnv('CONTEXT');

        const isDev = (typeof process !== 'undefined' && process.env?.NODE_ENV === 'development') ||
            context === 'dev' ||
            context === 'dev-server' ||
            context === 'deploy-preview' ||
            context === 'branch-deploy';

        if (isDev) {
            console.warn('SESSION_SECRET not set. Using development-only fallback.');
            const buildId = (typeof process !== 'undefined' && process.env?.BUILD_ID) || 'local';
            return `dev-session-secret-${buildId}-not-for-production`;
        }

        throw new Error('SESSION_SECRET environment variable is not set');
    }

    return secret;
}

/**
 * Generate a cryptographically random session ID
 */
function generateSessionId(): string {
    const array = new Uint8Array(32);
    crypto.getRandomValues(array);
    return Array.from(array, byte => byte.toString(16).padStart(2, '0')).join('');
}

/**
 * Create an HMAC-SHA256 signature for session data
 */
async function signSessionId(sessionId: string): Promise<string> {
    const secret = getSessionSecret();
    const encoder = new TextEncoder();
    const key = await crypto.subtle.importKey(
        'raw',
        encoder.encode(secret),
        { name: 'HMAC', hash: 'SHA-256' },
        false,
        ['sign']
    );
    const signature = await crypto.subtle.sign(
        'HMAC',
        key,
        encoder.encode(sessionId)
    );
    return Array.from(new Uint8Array(signature), byte => byte.toString(16).padStart(2, '0')).join('');
}

/**
 * Create a signed session token
 */
async function createSignedToken(sessionId: string): Promise<string> {
    const signature = await signSessionId(sessionId);
    return `${sessionId}.${signature}`;
}

/**
 * Parse and verify a signed session token
 */
async function parseSignedToken(token: string): Promise<string | null> {
    const parts = token.split('.');
    if (parts.length !== 2) {
        return null;
    }
    const [sessionId, signature] = parts;
    const expectedSignature = await signSessionId(sessionId);

    // Constant-time comparison
    if (expectedSignature.length !== signature.length) {
        return false ? null : null;
    }
    let result = 0;
    for (let i = 0; i < expectedSignature.length; i++) {
        result |= expectedSignature.charCodeAt(i) ^ signature.charCodeAt(i);
    }
    return result === 0 ? sessionId : null;
}

/**
 * Get or create Intel user from Google user data
 */
export async function getOrCreateIntelUser(googleUser: GoogleUser): Promise<{ user: IntelUser; isNewUser: boolean }> {
    const store = getStore({ name: INTEL_USERS_STORE_NAME, consistency: 'strong' });
    const userId = `google-${googleUser.id}`;

    // Try to get existing user
    const existingUser = await store.get(userId, { type: 'json' }) as IntelUser | null;

    if (existingUser) {
        // Update last login
        existingUser.lastLogin = Date.now();
        // Ensure profileComplete field exists for legacy users
        if (existingUser.profileComplete === undefined) {
            existingUser.profileComplete = !!(existingUser.discordId && existingUser.discordUsername);
        }
        await store.setJSON(userId, existingUser);
        return { user: existingUser, isNewUser: false };
    }

    // Create new user
    const newUser: IntelUser = {
        id: userId,
        googleId: googleUser.id,
        email: googleUser.email,
        name: googleUser.name,
        picture: googleUser.picture,
        clearanceLevel: 'pending',
        createdAt: Date.now(),
        lastLogin: Date.now(),
        profileComplete: false,
    };

    await store.setJSON(userId, newUser);
    return { user: newUser, isNewUser: true };
}

/**
 * Log Intel user login
 */
export async function logIntelLogin(user: IntelUser, request: Request): Promise<void> {
    const store = getStore({ name: INTEL_LOGIN_LOG_STORE_NAME, consistency: 'strong' });

    const logEntry = {
        userId: user.id,
        email: user.email,
        name: user.name,
        clearanceLevel: user.clearanceLevel,
        timestamp: Date.now(),
        userAgent: request.headers.get('user-agent') || 'unknown',
    };

    // Store with timestamp-based key for easy chronological listing
    const logKey = `${Date.now()}-${user.id}`;
    await store.setJSON(logKey, logEntry);
}

/**
 * Create Intel session
 */
export async function createIntelSession(
    user: IntelUser,
    request?: Request
): Promise<{ token: string; cookie: string }> {
    const sessionId = generateSessionId();
    const now = Date.now();

    const session: IntelSession = {
        sessionId,
        user,
        createdAt: now,
        expiresAt: now + SESSION_EXPIRY_MS,
        lastActivity: now,
    };

    const store = getStore({ name: INTEL_SESSION_STORE_NAME, consistency: 'strong' });
    await store.setJSON(sessionId, session);

    // Log the login
    if (request) {
        await logIntelLogin(user, request);
    }

    const signedToken = await createSignedToken(sessionId);

    // Create HTTP-only, Secure cookie
    const cookie = `${INTEL_SESSION_COOKIE_NAME}=${signedToken}; HttpOnly; Secure; SameSite=Strict; Path=/; Max-Age=${SESSION_EXPIRY_MS / 1000}`;

    return { token: signedToken, cookie };
}

/**
 * Get and validate Intel session from request
 */
export async function getIntelSession(request: Request): Promise<IntelSession | null> {
    const cookieHeader = request.headers.get('cookie');
    if (!cookieHeader) {
        return null;
    }

    // Parse cookies
    const cookies = Object.fromEntries(
        cookieHeader.split(';').map(c => {
            const [key, ...value] = c.trim().split('=');
            return [key, value.join('=')];
        })
    );

    const token = cookies[INTEL_SESSION_COOKIE_NAME];
    if (!token) {
        return null;
    }

    // Verify signature and extract session ID
    const sessionId = await parseSignedToken(token);
    if (!sessionId) {
        return null;
    }

    // Get session from store
    const store = getStore({ name: INTEL_SESSION_STORE_NAME, consistency: 'strong' });
    const session = await store.get(sessionId, { type: 'json' }) as IntelSession | null;

    if (!session) {
        return null;
    }

    // Check if session has expired
    if (Date.now() > session.expiresAt) {
        await store.delete(sessionId);
        return null;
    }

    // Get latest user data (clearance level might have changed)
    const userStore = getStore({ name: INTEL_USERS_STORE_NAME, consistency: 'strong' });
    const latestUser = await userStore.get(session.user.id, { type: 'json' }) as IntelUser | null;
    if (latestUser) {
        session.user = latestUser;
    }

    // Update last activity
    session.lastActivity = Date.now();
    await store.setJSON(sessionId, session);

    return session;
}

/**
 * Invalidate (logout) Intel session
 */
export async function invalidateIntelSession(request: Request): Promise<string> {
    const session = await getIntelSession(request);

    if (session) {
        const store = getStore({ name: INTEL_SESSION_STORE_NAME, consistency: 'strong' });
        await store.delete(session.sessionId);
    }

    // Return a cookie that clears the session
    return `${INTEL_SESSION_COOKIE_NAME}=; HttpOnly; Secure; SameSite=Strict; Path=/; Max-Age=0`;
}

/**
 * Get all Intel users (for admin)
 */
export async function getAllIntelUsers(): Promise<IntelUser[]> {
    const store = getStore({ name: INTEL_USERS_STORE_NAME, consistency: 'strong' });
    const { blobs } = await store.list();

    const users: IntelUser[] = [];
    for (const blob of blobs) {
        const user = await store.get(blob.key, { type: 'json' }) as IntelUser;
        if (user) {
            users.push(user);
        }
    }

    return users.sort((a, b) => b.lastLogin - a.lastLogin);
}

/**
 * Update Intel user clearance level (admin only)
 */
export async function updateIntelUserClearance(
    userId: string,
    clearanceLevel: IntelUser['clearanceLevel']
): Promise<IntelUser | null> {
    const store = getStore({ name: INTEL_USERS_STORE_NAME, consistency: 'strong' });
    const user = await store.get(userId, { type: 'json' }) as IntelUser | null;

    if (!user) {
        return null;
    }

    user.clearanceLevel = clearanceLevel;
    await store.setJSON(userId, user);

    return user;
}

/**
 * Get Intel login logs (for admin)
 */
export async function getIntelLoginLogs(limit: number = 100): Promise<any[]> {
    const store = getStore({ name: INTEL_LOGIN_LOG_STORE_NAME, consistency: 'strong' });
    const { blobs } = await store.list();

    const logs: any[] = [];
    // Sort by key (timestamp-based) descending
    const sortedBlobs = blobs.sort((a, b) => b.key.localeCompare(a.key));

    for (const blob of sortedBlobs.slice(0, limit)) {
        const log = await store.get(blob.key, { type: 'json' });
        if (log) {
            logs.push(log);
        }
    }

    return logs;
}

/**
 * Update Intel user profile (Discord info, officer data)
 */
export async function updateIntelUserProfile(
    userId: string,
    profileData: {
        discordUsername?: string;
        discordId?: string;
        officerName?: string;
        callsign?: string;
        badgeNumber?: string;
    }
): Promise<IntelUser | null> {
    const store = getStore({ name: INTEL_USERS_STORE_NAME, consistency: 'strong' });
    const user = await store.get(userId, { type: 'json' }) as IntelUser | null;

    if (!user) {
        return null;
    }

    // Update profile fields
    if (profileData.discordUsername !== undefined) user.discordUsername = profileData.discordUsername;
    if (profileData.discordId !== undefined) user.discordId = profileData.discordId;
    if (profileData.officerName !== undefined) user.officerName = profileData.officerName;
    if (profileData.callsign !== undefined) user.callsign = profileData.callsign;
    if (profileData.badgeNumber !== undefined) user.badgeNumber = profileData.badgeNumber;

    // Mark profile as complete if Discord info is provided
    user.profileComplete = !!(user.discordId && user.discordUsername);

    await store.setJSON(userId, user);
    return user;
}

/**
 * Compare clearance levels - returns true if userClearance >= requiredClearance
 */
export function hasRequiredClearance(userClearance: ClearanceLevel, requiredClearance: ClearanceLevel): boolean {
    const userIndex = CLEARANCE_HIERARCHY.indexOf(userClearance);
    const requiredIndex = CLEARANCE_HIERARCHY.indexOf(requiredClearance);
    return userIndex >= requiredIndex;
}

/**
 * Get Intel user by ID
 */
export async function getIntelUserById(userId: string): Promise<IntelUser | null> {
    const store = getStore({ name: INTEL_USERS_STORE_NAME, consistency: 'strong' });
    return await store.get(userId, { type: 'json' }) as IntelUser | null;
}
