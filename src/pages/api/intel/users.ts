import type { APIRoute } from 'astro';
import { validateSession } from '../../../utils/session';
import {
    getAllIntelUsers,
    updateIntelUserClearance,
    getIntelLoginLogs,
    deleteIntelUser,
    type IntelUser,
    type ClearanceLevel,
    CLEARANCE_HIERARCHY,
    CLEARANCE_DISPLAY_NAMES,
    CLEARANCE_SHORT_CODES
} from '../../../utils/google-oauth';

export const prerender = false;

// GET - List all intel users and their clearance levels (admin only)
export const GET: APIRoute = async ({ request }) => {
    try {
        const user = await validateSession(request);
        if (!user) {
            return new Response(JSON.stringify({ error: 'Unauthorized' }), {
                status: 401,
                headers: { 'Content-Type': 'application/json' }
            });
        }

        // Check permission - super_admin or intel-management
        if (user.role !== 'super_admin' && !user.permissions.includes('intel-management')) {
            return new Response(JSON.stringify({ error: 'Forbidden' }), {
                status: 403,
                headers: { 'Content-Type': 'application/json' }
            });
        }

        const url = new URL(request.url);
        const includeLogs = url.searchParams.get('logs') === 'true';

        const users = await getAllIntelUsers();

        let logs = [];
        if (includeLogs) {
            logs = await getIntelLoginLogs(50);
        }

        return new Response(JSON.stringify({
            users,
            logs,
            clearanceLevels: CLEARANCE_HIERARCHY.filter(l => l !== 'denied' && l !== 'pending'),
            clearanceDisplayNames: CLEARANCE_DISPLAY_NAMES,
            clearanceShortCodes: CLEARANCE_SHORT_CODES
        }), {
            status: 200,
            headers: { 'Content-Type': 'application/json' }
        });
    } catch (error) {
        console.error('Error fetching intel users:', error);
        return new Response(JSON.stringify({ error: 'Failed to fetch intel users' }), {
            status: 500,
            headers: { 'Content-Type': 'application/json' }
        });
    }
};

// PUT - Update user clearance level (admin only)
export const PUT: APIRoute = async ({ request }) => {
    try {
        const adminUser = await validateSession(request);
        if (!adminUser) {
            return new Response(JSON.stringify({ error: 'Unauthorized' }), {
                status: 401,
                headers: { 'Content-Type': 'application/json' }
            });
        }

        // Check permission
        if (adminUser.role !== 'super_admin' && !adminUser.permissions.includes('intel-management')) {
            return new Response(JSON.stringify({ error: 'Forbidden' }), {
                status: 403,
                headers: { 'Content-Type': 'application/json' }
            });
        }

        const body = await request.json();
        const { userId, clearanceLevel } = body;

        if (!userId || !clearanceLevel) {
            return new Response(JSON.stringify({ error: 'Missing required fields' }), {
                status: 400,
                headers: { 'Content-Type': 'application/json' }
            });
        }

        // Validate with new clearance levels
        const validLevels: ClearanceLevel[] = ['pending', 'public_trust', 'confidential', 'secret', 'top_secret', 'top_secret_sci', 'special_access', 'denied'];
        if (!validLevels.includes(clearanceLevel)) {
            return new Response(JSON.stringify({ error: 'Invalid clearance level' }), {
                status: 400,
                headers: { 'Content-Type': 'application/json' }
            });
        }

        const updatedUser = await updateIntelUserClearance(userId, clearanceLevel);

        if (!updatedUser) {
            return new Response(JSON.stringify({ error: 'User not found' }), {
                status: 404,
                headers: { 'Content-Type': 'application/json' }
            });
        }

        return new Response(JSON.stringify({ success: true, user: updatedUser }), {
            status: 200,
            headers: { 'Content-Type': 'application/json' }
        });
    } catch (error) {
        console.error('Error updating clearance:', error);
        return new Response(JSON.stringify({ error: 'Failed to update clearance' }), {
            status: 500,
            headers: { 'Content-Type': 'application/json' }
        });
    }
};

// DELETE - Delete intel user (admin only)
export const DELETE: APIRoute = async ({ request }) => {
    try {
        const adminUser = await validateSession(request);
        if (!adminUser) {
            return new Response(JSON.stringify({ error: 'Unauthorized' }), {
                status: 401,
                headers: { 'Content-Type': 'application/json' }
            });
        }

        // Check permission - only super_admin can delete users
        if (adminUser.role !== 'super_admin') {
            return new Response(JSON.stringify({ error: 'Forbidden - only super admins can delete users' }), {
                status: 403,
                headers: { 'Content-Type': 'application/json' }
            });
        }

        const url = new URL(request.url);
        const userId = url.searchParams.get('userId');

        if (!userId) {
            return new Response(JSON.stringify({ error: 'Missing userId parameter' }), {
                status: 400,
                headers: { 'Content-Type': 'application/json' }
            });
        }

        const deleted = await deleteIntelUser(userId);

        if (!deleted) {
            return new Response(JSON.stringify({ error: 'User not found' }), {
                status: 404,
                headers: { 'Content-Type': 'application/json' }
            });
        }

        return new Response(JSON.stringify({ success: true }), {
            status: 200,
            headers: { 'Content-Type': 'application/json' }
        });
    } catch (error) {
        console.error('Error deleting intel user:', error);
        return new Response(JSON.stringify({ error: 'Failed to delete intel user' }), {
            status: 500,
            headers: { 'Content-Type': 'application/json' }
        });
    }
};
