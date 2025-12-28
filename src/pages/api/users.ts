import type { APIRoute } from 'astro';
import { getStore } from '@netlify/blobs';
import { logUserManagement } from '../../utils/discord-webhook';

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

// Default users - will be created if no users exist
const defaultUsers: AdminUser[] = [
    {
        id: 'admin-default',
        username: 'DPPD_ADMIN',
        password: 'DPPD_High_Command2025!@',
        displayName: 'DPPD Admin',
        role: 'super_admin',
        permissions: [...ALL_PERMISSIONS],
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString()
    },
    {
        id: 'subdivision-overseer-default',
        username: 'DPPD_SUBDIVISION_OVERSEER',
        password: 'DPPD_Subdivision_Overseer_20252026!@',
        displayName: 'Subdivision Overseer',
        role: 'subdivision_overseer',
        permissions: ['department-data-subdivisions', 'subdivisions'],
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString()
    }
];

async function getUsersData(): Promise<AdminUser[]> {
    try {
        const store = getStore({ name: 'admin-users', consistency: 'strong' });
        const data = await store.get('users', { type: 'json' });
        if (data && Array.isArray(data) && data.length > 0) {
            return data;
        }
        // Initialize with default users if no users exist
        await store.setJSON('users', defaultUsers);
        return defaultUsers;
    } catch (error) {
        console.error('Error fetching users data:', error);
        return defaultUsers;
    }
}

export const GET: APIRoute = async ({ request }) => {
    // Check for authorization (should be super_admin)
    const authHeader = request.headers.get('Authorization');
    if (!authHeader) {
        return new Response(JSON.stringify({ success: false, error: 'Unauthorized' }), {
            status: 401,
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

            const newUser: AdminUser = {
                id: `user-${Date.now()}`,
                username: user.username,
                password: user.password,
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
                'create',
                newUser.displayName,
                undefined,
                `New user created: ${newUser.username} (${newUser.role})`
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

            users[index] = {
                ...users[index],
                ...user,
                id: users[index].id, // Prevent ID change
                password: user.password || users[index].password, // Keep old password if not provided
                updatedAt: new Date().toISOString()
            };

            await store.setJSON('users', users);

            // Log the user update to Discord
            await logUserManagement(
                'update',
                users[index].displayName,
                undefined,
                `User updated: ${users[index].username}`
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

            const deletedUser = users[index];
            users.splice(index, 1);
            await store.setJSON('users', users);

            // Log the user deletion to Discord
            await logUserManagement(
                'delete',
                deletedUser.displayName,
                undefined,
                `User deleted: ${deletedUser.username}`
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
