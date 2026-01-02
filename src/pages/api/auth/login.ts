import type { APIRoute } from 'astro';
import { getStore } from '@netlify/blobs';
import { logLogin } from '../../../utils/discord-webhook';
import { createSession, isSessionSecretConfigured, SessionSecretMissingError, type AdminUser } from '../../../utils/session';
import { verifyPassword, hashPassword, needsRehash } from '../../../utils/password';
import {
    checkRateLimit,
    checkGlobalIpRateLimit,
    recordFailedAttempt,
    recordGlobalIpFailedAttempt,
    clearRateLimit,
    getRateLimitKey
} from '../../../utils/rate-limit';

export const prerender = false;

interface StoredAdminUser {
    id: string;
    username: string;
    password: string;
    displayName: string;
    role: 'super_admin' | 'subdivision_overseer' | 'custom';
    permissions: string[];
    createdAt: string;
    updatedAt: string;
}

// All available admin pages/permissions
const ALL_PERMISSIONS = [
    'warehouse',
    'events',
    'resources',
    'uniforms',
    'theme-settings',
    'department-data',
    'subdivisions',
    'user-management'
];

/**
 * Get default admin credentials from environment variables
 * Falls back to secure generated defaults only if explicitly enabled
 */
function getDefaultUsers(): StoredAdminUser[] {
    const adminUsername = typeof Netlify !== 'undefined'
        ? Netlify.env.get('DEFAULT_ADMIN_USERNAME')
        : process.env.DEFAULT_ADMIN_USERNAME;

    const adminPassword = typeof Netlify !== 'undefined'
        ? Netlify.env.get('DEFAULT_ADMIN_PASSWORD')
        : process.env.DEFAULT_ADMIN_PASSWORD;

    const overseerUsername = typeof Netlify !== 'undefined'
        ? Netlify.env.get('DEFAULT_OVERSEER_USERNAME')
        : process.env.DEFAULT_OVERSEER_USERNAME;

    const overseerPassword = typeof Netlify !== 'undefined'
        ? Netlify.env.get('DEFAULT_OVERSEER_PASSWORD')
        : process.env.DEFAULT_OVERSEER_PASSWORD;

    // Only create default users if environment variables are properly set
    // This prevents hardcoded credentials from being used
    if (!adminUsername || !adminPassword) {
        console.warn('DEFAULT_ADMIN_USERNAME and DEFAULT_ADMIN_PASSWORD environment variables not set. Default admin account disabled.');
        return [];
    }

    const users: StoredAdminUser[] = [
        {
            id: 'admin-default',
            username: adminUsername,
            password: adminPassword, // Will be hashed when first stored
            displayName: 'DPPD Admin',
            role: 'super_admin',
            permissions: [...ALL_PERMISSIONS],
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString()
        }
    ];

    // Only add overseer if credentials are provided
    if (overseerUsername && overseerPassword) {
        users.push({
            id: 'subdivision-overseer-default',
            username: overseerUsername,
            password: overseerPassword,
            displayName: 'Subdivision Overseer',
            role: 'subdivision_overseer',
            permissions: ['department-data-subdivisions', 'subdivisions'],
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString()
        });
    }

    return users;
}

async function getUsersData(): Promise<StoredAdminUser[]> {
    try {
        const store = getStore({ name: 'admin-users', consistency: 'strong' });
        const data = await store.get('users', { type: 'json' });
        if (data && Array.isArray(data) && data.length > 0) {
            return data;
        }
        // Initialize with default users if no users exist
        const defaultUsers = getDefaultUsers();
        if (defaultUsers.length > 0) {
            // Hash default passwords before storing
            const usersWithHashedPasswords = await Promise.all(
                defaultUsers.map(async (user) => ({
                    ...user,
                    password: await hashPassword(user.password)
                }))
            );
            await store.setJSON('users', usersWithHashedPasswords);
            return usersWithHashedPasswords;
        }
        return [];
    } catch (error) {
        console.error('Error fetching users data:', error);
        // On error, return default users with hashed passwords
        // This ensures consistent behavior with password verification
        const defaultUsers = getDefaultUsers();
        if (defaultUsers.length > 0) {
            // Hash passwords for the fallback users too
            const usersWithHashedPasswords = await Promise.all(
                defaultUsers.map(async (user) => ({
                    ...user,
                    password: await hashPassword(user.password)
                }))
            );
            return usersWithHashedPasswords;
        }
        return [];
    }
}

/**
 * Update a user's password hash if needed (for rehashing with stronger parameters)
 */
async function updateUserPasswordIfNeeded(
    userId: string,
    newHashedPassword: string
): Promise<void> {
    try {
        const store = getStore({ name: 'admin-users', consistency: 'strong' });
        const users = await store.get('users', { type: 'json' }) as StoredAdminUser[] | null;

        if (!users) return;

        const userIndex = users.findIndex(u => u.id === userId);
        if (userIndex === -1) return;

        users[userIndex].password = newHashedPassword;
        users[userIndex].updatedAt = new Date().toISOString();

        await store.setJSON('users', users);
    } catch (error) {
        console.error('Error updating user password hash:', error);
    }
}

export const POST: APIRoute = async ({ request }) => {
    try {
        // Pre-flight check: Ensure session management is configured
        if (!isSessionSecretConfigured()) {
            console.error('Login attempted but SESSION_SECRET is not configured');
            return new Response(JSON.stringify({
                success: false,
                error: 'Server configuration error: Session management is not properly configured. Please contact the administrator.'
            }), {
                status: 503,
                headers: { 'Content-Type': 'application/json' }
            });
        }

        // Check global IP rate limit first
        const globalRateLimit = await checkGlobalIpRateLimit(request);
        if (!globalRateLimit.allowed) {
            return new Response(JSON.stringify({
                success: false,
                error: 'Too many login attempts from this IP. Please try again later.',
                retryAfter: globalRateLimit.retryAfter
            }), {
                status: 429,
                headers: {
                    'Content-Type': 'application/json',
                    'Retry-After': String(globalRateLimit.retryAfter || 3600)
                }
            });
        }

        const body = await request.json();
        const { username, password } = body;

        if (!username || !password) {
            // Log failed login attempt (missing credentials)
            await logLogin(
                { username: username || 'Unknown' },
                false,
                'Missing username or password'
            );

            // Record as failed attempt
            await recordGlobalIpFailedAttempt(request);

            return new Response(JSON.stringify({
                success: false,
                error: 'Username and password are required'
            }), {
                status: 400,
                headers: { 'Content-Type': 'application/json' }
            });
        }

        // Check per-user rate limit
        const rateLimitKey = getRateLimitKey(request, username);
        const rateLimit = await checkRateLimit(rateLimitKey);

        if (!rateLimit.allowed) {
            // Log rate-limited attempt
            await logLogin(
                { username },
                false,
                `Rate limited. Too many failed attempts.`
            );

            return new Response(JSON.stringify({
                success: false,
                error: 'Too many failed login attempts. Please try again later.',
                retryAfter: rateLimit.retryAfter
            }), {
                status: 429,
                headers: {
                    'Content-Type': 'application/json',
                    'Retry-After': String(rateLimit.retryAfter || 1800)
                }
            });
        }

        // Get all users from storage
        const users = await getUsersData();

        if (users.length === 0) {
            return new Response(JSON.stringify({
                success: false,
                error: 'No admin accounts configured. Please set DEFAULT_ADMIN_USERNAME and DEFAULT_ADMIN_PASSWORD environment variables.'
            }), {
                status: 503,
                headers: { 'Content-Type': 'application/json' }
            });
        }

        // Find matching user (case-insensitive username)
        const user = users.find(u =>
            u.username.toLowerCase() === username.toLowerCase()
        );

        if (!user) {
            // Log failed login attempt
            await logLogin(
                { username },
                false,
                'Invalid credentials'
            );

            // Record failed attempt
            const failResult = await recordFailedAttempt(rateLimitKey);
            await recordGlobalIpFailedAttempt(request);

            const response: any = {
                success: false,
                error: 'Invalid credentials'
            };

            if (failResult.locked) {
                response.error = 'Account temporarily locked due to too many failed attempts. Please try again later.';
                response.retryAfter = Math.ceil((failResult.lockoutDuration || 1800000) / 1000);
            }

            return new Response(JSON.stringify(response), {
                status: 401,
                headers: { 'Content-Type': 'application/json' }
            });
        }

        // Verify password using secure comparison
        const passwordValid = await verifyPassword(password, user.password);

        if (!passwordValid) {
            // Log failed login attempt
            await logLogin(
                { username },
                false,
                'Invalid credentials'
            );

            // Record failed attempt
            const failResult = await recordFailedAttempt(rateLimitKey);
            await recordGlobalIpFailedAttempt(request);

            const response: any = {
                success: false,
                error: 'Invalid credentials'
            };

            if (failResult.locked) {
                response.error = 'Account temporarily locked due to too many failed attempts. Please try again later.';
                response.retryAfter = Math.ceil((failResult.lockoutDuration || 1800000) / 1000);
            }

            return new Response(JSON.stringify(response), {
                status: 401,
                headers: { 'Content-Type': 'application/json' }
            });
        }

        // Password is valid - check if we need to rehash
        if (needsRehash(user.password)) {
            // Rehash with current parameters
            const newHash = await hashPassword(password);
            await updateUserPasswordIfNeeded(user.id, newHash);
        }

        // Clear rate limit on successful login
        await clearRateLimit(rateLimitKey);

        // Log successful login
        await logLogin(
            {
                id: user.id,
                username: user.username,
                displayName: user.displayName,
                role: user.role
            },
            true
        );

        // Create secure server-side session with HTTP-only cookie
        const sessionUser: AdminUser = {
            id: user.id,
            username: user.username,
            displayName: user.displayName,
            role: user.role,
            permissions: user.permissions
        };
        const { cookie } = await createSession(sessionUser);

        // Return success response with secure session cookie
        return new Response(JSON.stringify({
            success: true,
            message: 'Login successful',
            user: sessionUser
        }), {
            status: 200,
            headers: {
                'Content-Type': 'application/json',
                'Set-Cookie': cookie
            }
        });
    } catch (error) {
        console.error('Login error:', error);

        // Check for specific configuration errors
        if (error instanceof SessionSecretMissingError) {
            return new Response(JSON.stringify({
                success: false,
                error: 'Server configuration error: Session management is not properly configured. Please contact the administrator.'
            }), {
                status: 503,
                headers: { 'Content-Type': 'application/json' }
            });
        }

        return new Response(JSON.stringify({
            success: false,
            error: 'An error occurred'
        }), {
            status: 500,
            headers: { 'Content-Type': 'application/json' }
        });
    }
};
