import type { APIRoute } from 'astro';
import { getStore } from '@netlify/blobs';

export const prerender = false;

export interface Subdivision {
    id: string;
    name: string;
    abbreviation: string;
    description: string;
    availability: 'tryouts' | 'open' | 'handpicked' | 'closed';
}

// Helper to get the subdivisions store
function getSubdivisionsStore() {
    return getStore({ name: 'subdivisions', consistency: 'strong' });
}

const defaultSubdivisionsData: Subdivision[] = [
    {
        id: "swat",
        name: "Special Weapons & Tactics",
        abbreviation: "SWAT",
        description: "Specialized tactical unit for high-risk operations",
        availability: "tryouts"
    },
    {
        id: "k9",
        name: "Canine Unit",
        abbreviation: "K9",
        description: "K-9 handlers and police dogs",
        availability: "tryouts"
    },
    {
        id: "teu",
        name: "Tactical Enforcement",
        abbreviation: "TEU",
        description: "Tactical enforcement operations",
        availability: "tryouts"
    },
    {
        id: "ciu",
        name: "Criminal Investigations",
        abbreviation: "CIU",
        description: "Detective work and investigations",
        availability: "handpicked"
    },
    {
        id: "ia",
        name: "Internal Affairs",
        abbreviation: "IA",
        description: "Internal investigations and oversight",
        availability: "handpicked"
    },
    {
        id: "ftd",
        name: "Field Training Division",
        abbreviation: "FTD",
        description: "Training new officers",
        availability: "handpicked"
    }
];

async function getSubdivisionsData(): Promise<Subdivision[]> {
    try {
        const store = getSubdivisionsStore();
        const data = await store.get('data', { type: 'json' });
        if (data && Array.isArray(data)) {
            return data;
        }
        return defaultSubdivisionsData;
    } catch (error) {
        console.error('Error fetching subdivisions data:', error);
        return defaultSubdivisionsData;
    }
}

export const GET: APIRoute = async () => {
    const subdivisionsData = await getSubdivisionsData();
    return new Response(JSON.stringify({ subdivisions: subdivisionsData }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' }
    });
};

export const POST: APIRoute = async ({ request }) => {
    try {
        const data = await request.json();
        const store = getSubdivisionsStore();

        await store.setJSON('data', data.subdivisions);

        return new Response(JSON.stringify({ success: true }), {
            status: 200,
            headers: { 'Content-Type': 'application/json' }
        });
    } catch (error) {
        console.error('Error saving subdivisions data:', error);
        return new Response(JSON.stringify({ success: false, error: 'Failed to save subdivisions data' }), {
            status: 500,
            headers: { 'Content-Type': 'application/json' }
        });
    }
};
