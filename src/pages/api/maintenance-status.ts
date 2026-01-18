import type { APIRoute } from 'astro';
import { getStore } from '@netlify/blobs';
import { extractUserFromSession } from '../../utils/discord-webhook';

export const prerender = false;

interface SiteInfo {
    name: string;
    shortName: string;
    version: string;
    owner: string;
    siteUrl: string;
    color: number;
    maintenanceMode?: boolean;
}

// Get maintenance mode status from site info
async function getMaintenanceStatus(): Promise<{ maintenanceMode: boolean; siteName: string }> {
    try {
        const store = getStore({ name: 'site-info', consistency: 'strong' });
        const data = await store.get('settings', { type: 'json' }) as SiteInfo | null;
        if (data) {
            return {
                maintenanceMode: data.maintenanceMode || false,
                siteName: data.name || 'Del Perro Police Department'
            };
        }
        return { maintenanceMode: false, siteName: 'Del Perro Police Department' };
    } catch (error) {
        console.error('Error fetching maintenance status:', error);
        return { maintenanceMode: false, siteName: 'Del Perro Police Department' };
    }
}

export const GET: APIRoute = async ({ request }) => {
    const status = await getMaintenanceStatus();

    // Check if user is authenticated (admin)
    let isAdmin = false;
    try {
        const user = await extractUserFromSession(request);
        isAdmin = !!user;
    } catch {
        isAdmin = false;
    }

    return new Response(JSON.stringify({
        maintenanceMode: status.maintenanceMode,
        siteName: status.siteName,
        isAdmin,
        // If not in maintenance mode, allow access
        // If in maintenance mode and not admin, block access
        allowAccess: !status.maintenanceMode || isAdmin
    }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' }
    });
};
