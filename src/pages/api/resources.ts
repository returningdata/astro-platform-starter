import type { APIRoute } from 'astro';
import { getStore } from '@netlify/blobs';
import { logArrayDataChange, extractUserFromSession, checkPermission } from '../../utils/discord-webhook';

export const prerender = false;

export interface Resource {
    id: string;
    title: string;
    description: string;
    url: string;
    icon: 'document' | 'spreadsheet' | 'link' | 'video' | 'other';
    category: 'official' | 'training' | 'reference' | 'subdivision' | 'other';
}

const defaultResourcesData: Resource[] = [
    {
        id: 'sop',
        title: 'Standard Operating Procedures',
        description: 'Complete department SOPs covering all operational procedures, protocols, and policies that govern daily operations and officer conduct.',
        url: 'https://docs.google.com/document/d/1naWiUk1CixV2CgWKiBMs9LPjydhFvQHRy64B4w4fnn0/edit?usp=sharing',
        icon: 'document',
        category: 'official'
    },
    {
        id: 'promotion-guidelines',
        title: 'Promotion Guidelines',
        description: 'Detailed guidelines for officer advancement including requirements, criteria, evaluation processes, and procedures for each rank within the department.',
        url: 'https://docs.google.com/document/d/1JMyHjIpFPRX96DSTiTqZU-4drZDTDrmm1PXwHAwUW4o/edit?usp=sharing',
        icon: 'document',
        category: 'official'
    },
    {
        id: 'authority-matrix',
        title: 'Authority Matrix',
        description: 'Comprehensive matrix defining roles, permissions, and authorization levels for all ranks and positions within the Del Perro Police Department.',
        url: 'https://docs.google.com/spreadsheets/d/19vZ4puhiDMPX8v73aYogaZgVeZAg4DBGO8sfZFit__M/edit?usp=sharing',
        icon: 'spreadsheet',
        category: 'official'
    },
    {
        id: 'master-roster',
        title: 'Master Roster',
        description: 'Complete department roster showing all officers, ranks, badge numbers, and current assignments. View the full chain of command.',
        url: 'https://docs.google.com/spreadsheets/d/1iUCnkFyPlNd5jorr3g2ZH2PLhwuQOcFXvx_DlbKdnI0/edit?gid=2123893270#gid=2123893270',
        icon: 'spreadsheet',
        category: 'official'
    }
];

async function getResourcesData(): Promise<Resource[]> {
    try {
        const store = getStore({ name: 'resources', consistency: 'strong' });
        const data = await store.get('resources', { type: 'json' });
        if (data && Array.isArray(data)) {
            return data;
        }
        return defaultResourcesData;
    } catch (error) {
        console.error('Error fetching resources data:', error);
        return defaultResourcesData;
    }
}

export const GET: APIRoute = async () => {
    const resourcesData = await getResourcesData();
    return new Response(JSON.stringify({ resources: resourcesData }), {
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

    // Check if user has resources permission
    if (!checkPermission(user, 'resources')) {
        return new Response(JSON.stringify({ error: 'Forbidden' }), {
            status: 403,
            headers: { 'Content-Type': 'application/json' }
        });
    }

    try {
        // Get current data for comparison
        const oldData = await getResourcesData();

        const data = await request.json();
        const store = getStore({ name: 'resources', consistency: 'strong' });
        await store.setJSON('resources', data.resources);

        // Log the change to Discord
        await logArrayDataChange(
            'RESOURCES',
            user,
            oldData,
            data.resources,
            'id',
            'title',
            true
        );

        return new Response(JSON.stringify({ success: true }), {
            status: 200,
            headers: {
                'Content-Type': 'application/json'
            }
        });
    } catch (error) {
        console.error('Error saving resources data:', error);

        // Log the failed attempt
        await logArrayDataChange(
            'RESOURCES',
            user,
            [],
            [],
            'id',
            'title',
            false,
            'Failed to save resources data'
        );

        return new Response(JSON.stringify({ success: false, error: 'Failed to save resources data' }), {
            status: 500,
            headers: {
                'Content-Type': 'application/json'
            }
        });
    }
};
