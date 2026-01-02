/**
 * Secure Session Management Utility
 *
 * This module provides secure server-side session management using:
 * - Cryptographically signed session tokens (HMAC-SHA256)
 * - HTTP-only, Secure cookies
 * - Server-side session validation via Netlify Blobs
 */

import { getStore } from '@netlify/blobs';

const SESSION_COOKIE_NAME = 'dppd_session';
const SESSION_STORE_NAME = 'admin-sessions';
const SESSION_EXPIRY_MS = 24 * 60 * 60 * 1000; // 24 hours

export interface AdminUser {
    id: string;
    username: string;
    displayName: string;
    role: 'super_admin' | 'subdivision_overseer' | 'custom';
    permissions: string[];
}

export interface Session {
    sessionId: string;
    user: AdminUser;
    createdAt: number;
    expiresAt: number;
}

/**
 * Custom error class for missing session secret
 */
export class SessionSecretMissingError extends Error {
    constructor() {
        super(
            'SESSION_SECRET environment variable is not set. ' +
            'This is required for secure session management. ' +
            'Please set SESSION_SECRET to a random string of at least 32 characters.'
        );
        this.name = 'SessionSecretMissingError';
    }
}

/**
 * Check if session secret is available (for pre-flight checks)
 */
export function isSessionSecretConfigured(): boolean {
    const secret = typeof Netlify !== 'undefined'
        ? Netlify.env.get('SESSION_SECRET')
        : process.env.SESSION_SECRET;

    if (secret) {
        return true;
    }

    // In development or preview, we use a fallback
    const context = typeof Netlify !== 'undefined'
        ? Netlify.env.get('CONTEXT')
        : process.env.CONTEXT;
    const isDev = process.env.NODE_ENV === 'development' ||
        context === 'dev' ||
        context === 'dev-server' ||
        context === 'deploy-preview' ||
        context === 'branch-deploy';

    return isDev;
}

/**
 * Get the session secret from environment variables
 * SECURITY: SESSION_SECRET must be set in production
 */
function getSessionSecret(): string {
    const secret = typeof Netlify !== 'undefined'
        ? Netlify.env.get('SESSION_SECRET')
        : process.env.SESSION_SECRET;

    if (!secret) {
        // In development or preview, we can use a fallback but log a warning
        const context = typeof Netlify !== 'undefined'
            ? Netlify.env.get('CONTEXT')
            : process.env.CONTEXT;
        const isDev = process.env.NODE_ENV === 'development' ||
            context === 'dev' ||
            context === 'dev-server' ||
            context === 'deploy-preview' ||
            context === 'branch-deploy';

        if (isDev) {
            console.warn('SESSION_SECRET not set. Using development-only fallback. DO NOT use in production!');
            // Use a development-only fallback that includes a timestamp to make sessions ephemeral
            return `dev-session-secret-${process.env.BUILD_ID || 'local'}-not-for-production`;
        }

        // In production, this is a critical error
        throw new SessionSecretMissingError();
    }

    // Validate secret strength
    if (secret.length < 32) {
        console.warn('SESSION_SECRET is less than 32 characters. Consider using a longer secret for better security.');
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
 * Verify an HMAC-SHA256 signature for session data
 */
async function verifySignature(sessionId: string, signature: string): Promise<boolean> {
    const expectedSignature = await signSessionId(sessionId);
    // Constant-time comparison to prevent timing attacks
    if (expectedSignature.length !== signature.length) {
        return false;
    }
    let result = 0;
    for (let i = 0; i < expectedSignature.length; i++) {
        result |= expectedSignature.charCodeAt(i) ^ signature.charCodeAt(i);
    }
    return result === 0;
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
    const isValid = await verifySignature(sessionId, signature);
    return isValid ? sessionId : null;
}

/**
 * Get the session store
 */
function getSessionStore() {
    return getStore({ name: SESSION_STORE_NAME, consistency: 'strong' });
}

/**
 * Create a new session for a user
 */
export async function createSession(user: AdminUser): Promise<{ token: string; cookie: string }> {
    const sessionId = generateSessionId();
    const now = Date.now();
    const session: Session = {
        sessionId,
        user,
        createdAt: now,
        expiresAt: now + SESSION_EXPIRY_MS
    };

    const store = getSessionStore();
    await store.setJSON(sessionId, session);

    const signedToken = await createSignedToken(sessionId);

    // Create HTTP-only, Secure cookie
    const cookie = `${SESSION_COOKIE_NAME}=${signedToken}; HttpOnly; Secure; SameSite=Strict; Path=/; Max-Age=${SESSION_EXPIRY_MS / 1000}`;

    return { token: signedToken, cookie };
}

/**
 * Get and validate a session from a request
 */
export async function getSession(request: Request): Promise<Session | null> {
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

    const token = cookies[SESSION_COOKIE_NAME];
    if (!token) {
        return null;
    }

    // Verify signature and extract session ID
    const sessionId = await parseSignedToken(token);
    if (!sessionId) {
        return null;
    }

    // Get session from store
    const store = getSessionStore();
    const session = await store.get(sessionId, { type: 'json' }) as Session | null;

    if (!session) {
        return null;
    }

    // Check if session has expired
    if (Date.now() > session.expiresAt) {
        // Clean up expired session
        await store.delete(sessionId);
        return null;
    }

    return session;
}

/**
 * Validate a session and return the user
 */
export async function validateSession(request: Request): Promise<AdminUser | null> {
    const session = await getSession(request);
    return session?.user ?? null;
}

/**
 * Invalidate (logout) a session
 */
export async function invalidateSession(request: Request): Promise<string> {
    const session = await getSession(request);

    if (session) {
        const store = getSessionStore();
        await store.delete(session.sessionId);
    }

    // Return a cookie that clears the session
    return `${SESSION_COOKIE_NAME}=; HttpOnly; Secure; SameSite=Strict; Path=/; Max-Age=0`;
}

/**
 * Check if user has a specific permission
 */
export function hasPermission(user: AdminUser | null, permission: string): boolean {
    if (!user) return false;
    if (user.role === 'super_admin') return true;

    // Special handling for subdivision overseer
    if (user.role === 'subdivision_overseer') {
        if (permission === 'department-data-subdivisions' || permission === 'subdivisions') {
            return true;
        }
        if (permission === 'department-data') {
            return user.permissions.includes('department-data-subdivisions');
        }
    }

    return user.permissions.includes(permission);
}

/**
 * Create a redirect response to the login page
 */
export function redirectToLogin(): Response {
    return new Response(null, {
        status: 302,
        headers: {
            'Location': '/admin/login'
        }
    });
}

/**
 * Create a response with session cookie
 */
export function createResponseWithSession(body: string, cookie: string, status: number = 200): Response {
    return new Response(body, {
        status,
        headers: {
            'Content-Type': 'application/json',
            'Set-Cookie': cookie
        }
    });
}
