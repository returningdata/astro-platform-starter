import type { APIRoute } from 'astro';
import { getStore } from '@netlify/blobs';

export const prerender = false;

export interface ChangelogEntry {
    id: string;
    date: string;
    title: string;
    description: string;
    category: 'update' | 'feature' | 'fix' | 'announcement';
}

export interface ChangelogData {
    entries: ChangelogEntry[];
}

const defaultChangelogData: ChangelogData = {
    entries: []
};

async function getChangelogData(): Promise<ChangelogData> {
    try {
        const store = getStore({ name: 'changelog', consistency: 'strong' });
        const data = await store.get('changelog', { type: 'json' });
        if (data && typeof data === 'object') {
            return data as ChangelogData;
        }
        return defaultChangelogData;
    } catch (error) {
        console.error('Error fetching changelog data:', error);
        return defaultChangelogData;
    }
}

export const GET: APIRoute = async () => {
    const changelogData = await getChangelogData();
    return new Response(JSON.stringify(changelogData), {
        status: 200,
        headers: {
            'Content-Type': 'application/json'
        }
    });
};

export const POST: APIRoute = async ({ request }) => {
    try {
        const data = await request.json();
        const store = getStore({ name: 'changelog', consistency: 'strong' });
        await store.setJSON('changelog', data);
        return new Response(JSON.stringify({ success: true }), {
            status: 200,
            headers: {
                'Content-Type': 'application/json'
            }
        });
    } catch (error) {
        console.error('Error saving changelog data:', error);
        return new Response(JSON.stringify({ success: false, error: 'Failed to save changelog data' }), {
            status: 500,
            headers: {
                'Content-Type': 'application/json'
            }
        });
    }
};
