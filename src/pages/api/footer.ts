import type { APIRoute } from 'astro';
import { getStore } from '@netlify/blobs';
import { logDataSave, extractUserFromSession, checkPermission, type EntityType } from '../../utils/discord-webhook';

export const prerender = false;

export interface FooterLink {
    label: string;
    url: string;
}

export interface FooterData {
    departmentName: string;
    departmentDescription: string;
    quickLinks: FooterLink[];
    emergencyNumber: string;
    nonEmergencyNumber: string;
    dispatchNumber: string;
    copyrightText: string;
}

const defaultFooterData: FooterData = {
    departmentName: 'Del Perro Police Department',
    departmentDescription: 'Serving and protecting the Del Perro community with integrity and dedication.',
    quickLinks: [
        { label: 'About DPPD', url: '/about' },
        { label: 'Resources', url: '/resources' },
        { label: 'Chain of Command', url: '/chain-of-command' },
        { label: 'Community Events', url: '/community-events' }
    ],
    emergencyNumber: '911',
    nonEmergencyNumber: '(555) 123-4567',
    dispatchNumber: '(555) 123-4568',
    copyrightText: 'Del Perro Police Department. All rights reserved.'
};

async function getFooterData(): Promise<FooterData> {
    try {
        const store = getStore({ name: 'footer', consistency: 'strong' });
        const data = await store.get('footer', { type: 'json' });
        if (data && typeof data === 'object') {
            return data as FooterData;
        }
        return defaultFooterData;
    } catch (error) {
        console.error('Error fetching footer data:', error);
        return defaultFooterData;
    }
}

export const GET: APIRoute = async () => {
    const footerData = await getFooterData();
    return new Response(JSON.stringify({ footer: footerData }), {
        status: 200,
        headers: {
            'Content-Type': 'application/json'
        }
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

    // Check if user has footer permission (super_admin only)
    if (!checkPermission(user, 'footer')) {
        return new Response(JSON.stringify({ error: 'Forbidden' }), {
            status: 403,
            headers: { 'Content-Type': 'application/json' }
        });
    }

    try {
        // Get current data for comparison
        const oldData = await getFooterData();

        const data = await request.json();
        const store = getStore({ name: 'footer', consistency: 'strong' });
        await store.setJSON('footer', data.footer);

        // Log the change to Discord
        await logDataSave(
            'FOOTER',
            user,
            oldData,
            data.footer,
            true
        );

        return new Response(JSON.stringify({ success: true }), {
            status: 200,
            headers: {
                'Content-Type': 'application/json'
            }
        });
    } catch (error) {
        console.error('Error saving footer data:', error);

        // Log the failed attempt
        await logDataSave(
            'FOOTER',
            user,
            {},
            {},
            false,
            'Failed to save footer data'
        );

        return new Response(JSON.stringify({ success: false, error: 'Failed to save footer data' }), {
            status: 500,
            headers: {
                'Content-Type': 'application/json'
            }
        });
    }
};
