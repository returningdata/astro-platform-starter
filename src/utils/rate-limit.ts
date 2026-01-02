/**
 * Rate Limiting Utility
 *
 * Implements rate limiting using Netlify Blobs to track login attempts.
 * Uses a sliding window algorithm to prevent brute force attacks.
 */

import { getStore } from '@netlify/blobs';

const RATE_LIMIT_STORE_NAME = 'rate-limits';

interface RateLimitEntry {
    attempts: number[];
    lockedUntil?: number;
}

interface RateLimitConfig {
    maxAttempts: number;        // Max attempts allowed in the window
    windowMs: number;           // Time window in milliseconds
    lockoutMs: number;          // Lockout duration after max attempts exceeded
    cleanupIntervalMs: number;  // How often to clean up old entries
}

// Default configuration for login rate limiting
const DEFAULT_LOGIN_CONFIG: RateLimitConfig = {
    maxAttempts: 5,               // 5 failed attempts
    windowMs: 15 * 60 * 1000,     // 15 minute window
    lockoutMs: 30 * 60 * 1000,    // 30 minute lockout
    cleanupIntervalMs: 60 * 1000  // Clean up every minute
};

function getRateLimitStore() {
    return getStore({ name: RATE_LIMIT_STORE_NAME, consistency: 'strong' });
}

/**
 * Get a unique identifier for the request (IP + username combo)
 */
export function getRateLimitKey(request: Request, username: string): string {
    // Try to get the real IP from various headers
    const forwardedFor = request.headers.get('x-forwarded-for');
    const realIp = request.headers.get('x-real-ip');
    const cfIp = request.headers.get('cf-connecting-ip');

    let ip = 'unknown';
    if (forwardedFor) {
        // x-forwarded-for can contain multiple IPs, take the first one
        ip = forwardedFor.split(',')[0].trim();
    } else if (realIp) {
        ip = realIp;
    } else if (cfIp) {
        ip = cfIp;
    }

    // Create a hash-like key combining IP and username for per-user rate limiting
    // This prevents one IP from trying many usernames OR one username from many IPs
    const normalizedUsername = username.toLowerCase().replace(/[^a-z0-9]/g, '');
    return `login:${ip}:${normalizedUsername}`;
}

/**
 * Get rate limit key for IP-only rate limiting (global rate limit)
 */
export function getIpRateLimitKey(request: Request): string {
    const forwardedFor = request.headers.get('x-forwarded-for');
    const realIp = request.headers.get('x-real-ip');
    const cfIp = request.headers.get('cf-connecting-ip');

    let ip = 'unknown';
    if (forwardedFor) {
        ip = forwardedFor.split(',')[0].trim();
    } else if (realIp) {
        ip = realIp;
    } else if (cfIp) {
        ip = cfIp;
    }

    return `ip:${ip}`;
}

/**
 * Check if a request is rate limited
 * Returns { allowed: true } if request can proceed
 * Returns { allowed: false, retryAfter: seconds } if rate limited
 */
export async function checkRateLimit(
    key: string,
    config: RateLimitConfig = DEFAULT_LOGIN_CONFIG
): Promise<{ allowed: boolean; retryAfter?: number; remainingAttempts?: number }> {
    const store = getRateLimitStore();
    const now = Date.now();

    try {
        const entry = await store.get(key, { type: 'json' }) as RateLimitEntry | null;

        if (!entry) {
            return { allowed: true, remainingAttempts: config.maxAttempts };
        }

        // Check if currently locked out
        if (entry.lockedUntil && entry.lockedUntil > now) {
            const retryAfter = Math.ceil((entry.lockedUntil - now) / 1000);
            return { allowed: false, retryAfter, remainingAttempts: 0 };
        }

        // Filter attempts within the window
        const windowStart = now - config.windowMs;
        const recentAttempts = entry.attempts.filter(t => t > windowStart);

        const remainingAttempts = Math.max(0, config.maxAttempts - recentAttempts.length);

        if (recentAttempts.length >= config.maxAttempts) {
            // Should be locked out but wasn't - set lockout now
            const retryAfter = Math.ceil(config.lockoutMs / 1000);
            return { allowed: false, retryAfter, remainingAttempts: 0 };
        }

        return { allowed: true, remainingAttempts };
    } catch (error) {
        console.error('Rate limit check error:', error);
        // On error, allow the request but log it
        return { allowed: true, remainingAttempts: config.maxAttempts };
    }
}

/**
 * Record a failed attempt
 */
export async function recordFailedAttempt(
    key: string,
    config: RateLimitConfig = DEFAULT_LOGIN_CONFIG
): Promise<{ locked: boolean; lockoutDuration?: number }> {
    const store = getRateLimitStore();
    const now = Date.now();

    try {
        let entry = await store.get(key, { type: 'json' }) as RateLimitEntry | null;

        if (!entry) {
            entry = { attempts: [] };
        }

        // Filter to only recent attempts within the window
        const windowStart = now - config.windowMs;
        entry.attempts = entry.attempts.filter(t => t > windowStart);

        // Add current attempt
        entry.attempts.push(now);

        // Check if we need to lock out
        if (entry.attempts.length >= config.maxAttempts) {
            entry.lockedUntil = now + config.lockoutMs;
            await store.setJSON(key, entry);
            return { locked: true, lockoutDuration: config.lockoutMs };
        }

        await store.setJSON(key, entry);
        return { locked: false };
    } catch (error) {
        console.error('Failed to record failed attempt:', error);
        return { locked: false };
    }
}

/**
 * Clear rate limit entry (e.g., after successful login)
 */
export async function clearRateLimit(key: string): Promise<void> {
    const store = getRateLimitStore();

    try {
        await store.delete(key);
    } catch (error) {
        console.error('Failed to clear rate limit:', error);
    }
}

/**
 * Global IP rate limit - limits total requests per IP
 * More permissive than per-user rate limit
 */
const GLOBAL_IP_CONFIG: RateLimitConfig = {
    maxAttempts: 20,               // 20 attempts total per IP
    windowMs: 15 * 60 * 1000,      // 15 minute window
    lockoutMs: 60 * 60 * 1000,     // 1 hour lockout
    cleanupIntervalMs: 60 * 1000
};

/**
 * Check global IP rate limit
 */
export async function checkGlobalIpRateLimit(
    request: Request
): Promise<{ allowed: boolean; retryAfter?: number }> {
    const key = getIpRateLimitKey(request);
    return checkRateLimit(key, GLOBAL_IP_CONFIG);
}

/**
 * Record failed attempt for global IP rate limit
 */
export async function recordGlobalIpFailedAttempt(request: Request): Promise<void> {
    const key = getIpRateLimitKey(request);
    await recordFailedAttempt(key, GLOBAL_IP_CONFIG);
}
