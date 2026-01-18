import type { APIRoute } from 'astro';
import { getStore } from '@netlify/blobs';
import { logDataSave, extractUserFromSession, checkPermission } from '../../utils/discord-webhook';

export const prerender = false;

export interface SiteInfo {
    name: string;
    shortName: string;
    version: string;
    owner: string;
    siteUrl: string;
    color: number;
}

// Default site configuration
const defaultSiteInfo: SiteInfo = {
    name: 'Del Perro Police Department',
    shortName: 'DPPD',
    version: '7.32.3',
    owner: '<@1000470631688712243>',
    siteUrl: 'https://delperro.netlify.app',
    color: 0x1e40af,
};

const STORE_NAME = 'site-info';

async function getSiteInfo(): Promise<SiteInfo> {
    try {
        const store = getStore({ name: STORE_NAME, consistency: 'strong' });
        const data = await store.get('settings', { type: 'json' });
        if (data && typeof data === 'object') {
            return { ...defaultSiteInfo, ...data as Partial<SiteInfo> };
        }
        return defaultSiteInfo;
    } catch (error) {
        console.error('Error fetching site info:', error);
        return defaultSiteInfo;
    }
}

export const GET: APIRoute = async ({ request }) => {
    // Check if this is an internal request (from other API endpoints)
    const internalRequest = request.headers.get('X-Internal-Request') === 'true';

    if (internalRequest) {
        // Internal requests can access site info without authentication
        const siteInfo = await getSiteInfo();
        return new Response(JSON.stringify({ siteInfo }), {
            status: 200,
            headers: { 'Content-Type': 'application/json' }
        });
    }

    // For external requests, require authentication
    const user = await extractUserFromSession(request);

    if (!user) {
        return new Response(JSON.stringify({ error: 'Unauthorized' }), {
            status: 401,
            headers: { 'Content-Type': 'application/json' }
        });
    }

    // Check if user has site-info permission (super_admin only)
    if (!checkPermission(user, 'site-info')) {
        return new Response(JSON.stringify({ error: 'Forbidden' }), {
            status: 403,
            headers: { 'Content-Type': 'application/json' }
        });
    }

    const siteInfo = await getSiteInfo();
    return new Response(JSON.stringify({ siteInfo }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' }
    });
};

export const POST: APIRoute = async ({ request }) => {
    // Validate session server-side
    const user = await extractUserFromSession(request);

    if (!user) {
        return new Response(JSON.stringify({ error: 'Unauthorized' }), {
            status: 401,
            headers: { 'Content-Type': 'application/json' }
        });
    }

    // Check if user has site-info permission (super_admin only)
    if (!checkPermission(user, 'site-info')) {
        return new Response(JSON.stringify({ error: 'Forbidden' }), {
            status: 403,
            headers: { 'Content-Type': 'application/json' }
        });
    }

    try {
        // Get current data for comparison
        const oldData = await getSiteInfo();

        const data = await request.json();
        const store = getStore({ name: STORE_NAME, consistency: 'strong' });

        // Merge with defaults to ensure all fields exist
        const newSiteInfo: SiteInfo = {
            ...defaultSiteInfo,
            ...data.siteInfo
        };

        await store.setJSON('settings', newSiteInfo);

        // Log the change to Discord
        await logDataSave(
            'SITE_INFO',
            user,
            oldData,
            newSiteInfo,
            true
        );

        return new Response(JSON.stringify({ success: true }), {
            status: 200,
            headers: { 'Content-Type': 'application/json' }
        });
    } catch (error) {
        console.error('Error saving site info:', error);

        // Log the failed attempt
        await logDataSave(
            'SITE_INFO',
            user,
            {},
            {},
            false,
            'Failed to save site info'
        );

        return new Response(JSON.stringify({ success: false, error: 'Failed to save site info' }), {
            status: 500,
            headers: { 'Content-Type': 'application/json' }
        });
    }
};

// Export a helper function for other API endpoints to use
export async function getSiteConfig(): Promise<SiteInfo> {
    return await getSiteInfo();
}
