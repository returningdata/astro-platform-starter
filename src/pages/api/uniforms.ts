import type { APIRoute } from 'astro';
import { getStore } from '@netlify/blobs';

export const prerender = false;

export interface UniformItem {
    name: string;
    status: 'available' | 'limited' | 'out';
}

export interface UniformCategory {
    id: string;
    name: string;
    icon: string;
    items: UniformItem[];
}

const defaultUniformsData: UniformCategory[] = [
    {
        id: "patrol-uniforms",
        name: "Patrol Uniforms",
        icon: "tactical",
        items: [
            { name: "Cadet: 76861", status: "available" },
            { name: "Officer 1: 76859", status: "available" },
            { name: "Officer 2-Corporal: 76860", status: "available" },
            { name: "Supervisors: 76863", status: "available" },
            { name: "Master SGT: 76865", status: "available" }
        ]
    },
    {
        id: "formal-attire",
        name: "Formal Attire",
        icon: "tactical",
        items: [
            { name: "Patrol Officer Formals: 76847", status: "available" },
            { name: "Command Team Formals: 76847", status: "available" }
        ]
    },
    {
        id: "detective-attire",
        name: "Detective Attire",
        icon: "tactical",
        items: [
            { name: "Detective: 76870", status: "available" }
        ]
    },
    {
        id: "air-unit",
        name: "Air Unit",
        icon: "tactical",
        items: [
            { name: "Air-1: 76978", status: "available" },
            { name: "Air Tac: 76978", status: "available" }
        ]
    },
    {
        id: "mbu-unit",
        name: "MBU Unit",
        icon: "tactical",
        items: [
            { name: "MBU: 76877", status: "available" }
        ]
    }
];

async function getUniformsData(): Promise<UniformCategory[]> {
    try {
        const store = getStore({ name: 'uniforms', consistency: 'strong' });
        const data = await store.get('categories', { type: 'json' });
        if (data && Array.isArray(data)) {
            return data;
        }
        return defaultUniformsData;
    } catch (error) {
        console.error('Error fetching uniforms data:', error);
        return defaultUniformsData;
    }
}

export const GET: APIRoute = async () => {
    const uniformsData = await getUniformsData();
    return new Response(JSON.stringify({ uniforms: uniformsData }), {
        status: 200,
        headers: {
            'Content-Type': 'application/json'
        }
    });
};

export const POST: APIRoute = async ({ request }) => {
    try {
        const data = await request.json();
        const store = getStore({ name: 'uniforms', consistency: 'strong' });
        await store.setJSON('categories', data.uniforms);

        return new Response(JSON.stringify({ success: true }), {
            status: 200,
            headers: {
                'Content-Type': 'application/json'
            }
        });
    } catch (error) {
        console.error('Error saving uniforms data:', error);
        return new Response(JSON.stringify({ success: false, error: 'Failed to save uniforms data' }), {
            status: 500,
            headers: {
                'Content-Type': 'application/json'
            }
        });
    }
};
