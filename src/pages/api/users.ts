import type { APIRoute } from 'astro';
import { getStore } from '@netlify/blobs';
import { logUserManagement, extractUserFromSession, checkPermission } from '../../utils/discord-webhook';
import { hashPassword, verifyPassword, validatePasswordComplexity } from '../../utils/password';

export const prerender = false;

export interface AdminUser {
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
export const ALL_PERMISSIONS = [
    'warehouse',
    'events',
    'resources',
    'uniforms',
    'theme-settings',
    'department-data',
    'subdivisions',
    'user-management'
] as const;

// Default permissions for roles
export const ROLE_PERMISSIONS: Record<string, string[]> = {
    'super_admin': [...ALL_PERMISSIONS],
    'subdivision_overseer': ['department-data-subdivisions', 'subdivisions'],
    'custom': []
};

/**
 * Get default admin credentials from environment variables
 */
async function getDefaultUsers(): Promise<AdminUser[]> {
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
    if (!adminUsername || !adminPassword) {
        return [];
    }

    const users: AdminUser[] = [
        {
            id: 'admin-default',
            username: adminUsername,
            password: await hashPassword(adminPassword),
            displayName: 'DPPD Admin',
            role: 'super_admin',
            permissions: [...ALL_PERMISSIONS],
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString()
        }
    ];

    if (overseerUsername && overseerPassword) {
        users.push({
            id: 'subdivision-overseer-default',
            username: overseerUsername,
            password: await hashPassword(overseerPassword),
            displayName: 'Subdivision Overseer',
            role: 'subdivision_overseer',
            permissions: ['department-data-subdivisions', 'subdivisions'],
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString()
        });
    }

    return users;
}

async function getUsersData(): Promise<AdminUser[]> {
    try {
        const store = getStore({ name: 'admin-users', consistency: 'strong' });
        const data = await store.get('users', { type: 'json' });
        if (data && Array.isArray(data) && data.length > 0) {
            return data;
        }
        // Initialize with default users if no users exist
        const defaultUsers = await getDefaultUsers();
        if (defaultUsers.length > 0) {
            await store.setJSON('users', defaultUsers);
            return defaultUsers;
        }
        return [];
    } catch (error) {
        console.error('Error fetching users data:', error);
        return await getDefaultUsers();
    }
}

export const GET: APIRoute = async ({ request }) => {
    // Validate session server-side (not just check for header presence)
    const user = await extractUserFromSession(request);

    if (!user) {
        return new Response(JSON.stringify({ success: false, error: 'Unauthorized' }), {
            status: 401,
            headers: { 'Content-Type': 'application/json' }
        });
    }

    // Check if user has user-management permission
    if (!checkPermission(user, 'user-management')) {
        return new Response(JSON.stringify({ success: false, error: 'Forbidden' }), {
            status: 403,
            headers: { 'Content-Type': 'application/json' }
        });
    }

    try {
        const users = await getUsersData();
        // Return users without passwords for security
        const safeUsers = users.map(({ password, ...user }) => user);
        return new Response(JSON.stringify({ users: safeUsers }), {
            status: 200,
            headers: { 'Content-Type': 'application/json' }
        });
    } catch (error) {
        console.error('Error in GET /api/users:', error);
        return new Response(JSON.stringify({ success: false, error: 'Failed to fetch users' }), {
            status: 500,
            headers: { 'Content-Type': 'application/json' }
        });
    }
};

export const POST: APIRoute = async ({ request }) => {
    // Validate session server-side
    const performedBy = await extractUserFromSession(request);

    if (!performedBy) {
        return new Response(JSON.stringify({ error: 'Unauthorized' }), {
            status: 401,
            headers: { 'Content-Type': 'application/json' }
        });
    }

    // Check if user has user-management permission
    if (!checkPermission(performedBy, 'user-management')) {
        return new Response(JSON.stringify({ error: 'Forbidden' }), {
            status: 403,
            headers: { 'Content-Type': 'application/json' }
        });
    }

    try {
        const body = await request.json();
        const { action, user, userId } = body;

        const store = getStore({ name: 'admin-users', consistency: 'strong' });
        let users = await getUsersData();

        if (action === 'create') {
            // Validate required fields
            if (!user.username || !user.password || !user.displayName) {
                return new Response(JSON.stringify({
                    success: false,
                    error: 'Username, password, and display name are required'
                }), {
                    status: 400,
                    headers: { 'Content-Type': 'application/json' }
                });
            }

            // Validate username format
            if (!/^[a-zA-Z0-9_-]{3,50}$/.test(user.username)) {
                return new Response(JSON.stringify({
                    success: false,
                    error: 'Username must be 3-50 characters and contain only letters, numbers, underscores, and hyphens'
                }), {
                    status: 400,
                    headers: { 'Content-Type': 'application/json' }
                });
            }

            // Validate password complexity
            const passwordErrors = validatePasswordComplexity(user.password);
            if (passwordErrors.length > 0) {
                return new Response(JSON.stringify({
                    success: false,
                    error: 'Password does not meet complexity requirements',
                    details: passwordErrors
                }), {
                    status: 400,
                    headers: { 'Content-Type': 'application/json' }
                });
            }

            // Check for duplicate username
            if (users.some(u => u.username.toLowerCase() === user.username.toLowerCase())) {
                return new Response(JSON.stringify({
                    success: false,
                    error: 'Username already exists'
                }), {
                    status: 400,
                    headers: { 'Content-Type': 'application/json' }
                });
            }

            // Hash the password before storing
            const hashedPassword = await hashPassword(user.password);

            const newUser: AdminUser = {
                id: `user-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`,
                username: user.username,
                password: hashedPassword,
                displayName: user.displayName,
                role: user.role || 'custom',
                permissions: user.permissions || [],
                createdAt: new Date().toISOString(),
                updatedAt: new Date().toISOString()
            };

            users.push(newUser);
            await store.setJSON('users', users);

            // Log the user creation to Discord
            await logUserManagement(
                'CREATE',
                performedBy,
                { id: newUser.id, username: newUser.username, displayName: newUser.displayName, role: newUser.role },
                undefined,
                newUser,
                true
            );

            return new Response(JSON.stringify({
                success: true,
                user: { ...newUser, password: undefined }
            }), {
                status: 200,
                headers: { 'Content-Type': 'application/json' }
            });
        }

        if (action === 'update') {
            const index = users.findIndex(u => u.id === userId);
            if (index === -1) {
                return new Response(JSON.stringify({
                    success: false,
                    error: 'User not found'
                }), {
                    status: 404,
                    headers: { 'Content-Type': 'application/json' }
                });
            }

            // Don't allow changing super_admin role of the default admin
            if (users[index].id === 'admin-default' && user.role !== 'super_admin') {
                return new Response(JSON.stringify({
                    success: false,
                    error: 'Cannot change role of the primary admin account'
                }), {
                    status: 400,
                    headers: { 'Content-Type': 'application/json' }
                });
            }

            // Validate username format if changing
            if (user.username && !/^[a-zA-Z0-9_-]{3,50}$/.test(user.username)) {
                return new Response(JSON.stringify({
                    success: false,
                    error: 'Username must be 3-50 characters and contain only letters, numbers, underscores, and hyphens'
                }), {
                    status: 400,
                    headers: { 'Content-Type': 'application/json' }
                });
            }

            // Check for duplicate username (excluding current user)
            if (user.username && users.some(u =>
                u.id !== userId &&
                u.username.toLowerCase() === user.username.toLowerCase()
            )) {
                return new Response(JSON.stringify({
                    success: false,
                    error: 'Username already exists'
                }), {
                    status: 400,
                    headers: { 'Content-Type': 'application/json' }
                });
            }

            // If password is being changed, validate and hash it
            let newPasswordHash = users[index].password;
            if (user.password) {
                const passwordErrors = validatePasswordComplexity(user.password);
                if (passwordErrors.length > 0) {
                    return new Response(JSON.stringify({
                        success: false,
                        error: 'Password does not meet complexity requirements',
                        details: passwordErrors
                    }), {
                        status: 400,
                        headers: { 'Content-Type': 'application/json' }
                    });
                }
                newPasswordHash = await hashPassword(user.password);
            }

            // Save old data for comparison
            const oldUserData = { ...users[index] };

            users[index] = {
                ...users[index],
                ...user,
                id: users[index].id, // Prevent ID change
                password: newPasswordHash,
                updatedAt: new Date().toISOString()
            };

            await store.setJSON('users', users);

            // Log the user update to Discord
            await logUserManagement(
                'UPDATE',
                performedBy,
                { id: users[index].id, username: users[index].username, displayName: users[index].displayName, role: users[index].role },
                oldUserData,
                users[index],
                true
            );

            return new Response(JSON.stringify({
                success: true,
                user: { ...users[index], password: undefined }
            }), {
                status: 200,
                headers: { 'Content-Type': 'application/json' }
            });
        }

        if (action === 'delete') {
            // Don't allow deleting the default admin
            if (userId === 'admin-default') {
                return new Response(JSON.stringify({
                    success: false,
                    error: 'Cannot delete the primary admin account'
                }), {
                    status: 400,
                    headers: { 'Content-Type': 'application/json' }
                });
            }

            const index = users.findIndex(u => u.id === userId);
            if (index === -1) {
                return new Response(JSON.stringify({
                    success: false,
                    error: 'User not found'
                }), {
                    status: 404,
                    headers: { 'Content-Type': 'application/json' }
                });
            }

            // Save deleted user data for logging
            const deletedUser = users[index];

            users.splice(index, 1);
            await store.setJSON('users', users);

            // Log the user deletion to Discord
            await logUserManagement(
                'DELETE',
                performedBy,
                { id: deletedUser.id, username: deletedUser.username, displayName: deletedUser.displayName, role: deletedUser.role },
                deletedUser,
                undefined,
                true
            );

            return new Response(JSON.stringify({ success: true }), {
                status: 200,
                headers: { 'Content-Type': 'application/json' }
            });
        }

        return new Response(JSON.stringify({
            success: false,
            error: 'Invalid action'
        }), {
            status: 400,
            headers: { 'Content-Type': 'application/json' }
        });

    } catch (error) {
        console.error('Error in POST /api/users:', error);
        return new Response(JSON.stringify({
            success: false,
            error: 'An error occurred'
        }), {
            status: 500,
            headers: { 'Content-Type': 'application/json' }
        });
    }
};
