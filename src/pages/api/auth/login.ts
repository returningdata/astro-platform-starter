import type { APIRoute } from 'astro';
import { getStore } from '@netlify/blobs';

export const prerender = false;

interface AdminUser {
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

// Default users if no users exist in storage
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

export const POST: APIRoute = async ({ request }) => {
    try {
        const body = await request.json();
        const { username, password } = body;

        if (!username || !password) {
            return new Response(JSON.stringify({
                success: false,
                error: 'Username and password are required'
            }), {
                status: 400,
                headers: { 'Content-Type': 'application/json' }
            });
        }

        // Get all users from storage
        const users = await getUsersData();

        // Find matching user (case-insensitive username)
        const user = users.find(u =>
            u.username.toLowerCase() === username.toLowerCase() &&
            u.password === password
        );

        if (user) {
            // Return user info (without password) for client-side storage
            return new Response(JSON.stringify({
                success: true,
                message: 'Login successful',
                user: {
                    id: user.id,
                    username: user.username,
                    displayName: user.displayName,
                    role: user.role,
                    permissions: user.permissions
                }
            }), {
                status: 200,
                headers: { 'Content-Type': 'application/json' }
            });
        }

        return new Response(JSON.stringify({
            success: false,
            error: 'Invalid credentials'
        }), {
            status: 401,
            headers: { 'Content-Type': 'application/json' }
        });
    } catch (error) {
        console.error('Login error:', error);
        return new Response(JSON.stringify({
            success: false,
            error: 'An error occurred'
        }), {
            status: 500,
            headers: { 'Content-Type': 'application/json' }
        });
    }
};
