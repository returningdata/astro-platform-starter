import type { APIRoute } from 'astro';
import { getStore } from '@netlify/blobs';
import { logArrayDataChange, extractUserFromHeaders } from '../../utils/discord-webhook';

export const prerender = false;

export interface CommunityEvent {
    id: string;
    title: string;
    date: string;
    time: string;
    location: string;
    description: string;
    category: 'patrol' | 'community' | 'training' | 'ceremony' | 'other';
    status: 'upcoming' | 'ongoing' | 'completed';
    image?: string; // Optional image URL or blob key
}

const defaultEventsData: CommunityEvent[] = [
    {
        id: '1',
        title: 'Community Safety Forum',
        date: '2025-12-01',
        time: '6:00 PM - 8:00 PM',
        location: 'Del Perro Community Center',
        description: 'Join DPPD leadership for an open forum discussing community safety initiatives, crime prevention strategies, and Q&A session with residents.',
        category: 'community',
        status: 'upcoming'
    },
    {
        id: '2',
        title: 'Citizens Police Academy - Session 1',
        date: '2025-12-05',
        time: '7:00 PM - 9:00 PM',
        location: 'DPPD Training Facility',
        description: 'First session of our 8-week Citizens Police Academy program. Learn about police operations, meet officers, and gain insight into law enforcement.',
        category: 'training',
        status: 'upcoming'
    },
    {
        id: '3',
        title: 'National Night Out',
        date: '2025-12-10',
        time: '5:00 PM - 9:00 PM',
        location: 'Del Perro Park',
        description: 'Annual National Night Out celebration featuring police demonstrations, K-9 units, equipment displays, food trucks, and family activities.',
        category: 'community',
        status: 'upcoming'
    },
    {
        id: '4',
        title: 'Holiday Toy Drive',
        date: '2025-12-15',
        time: 'All Day',
        location: 'DPPD Headquarters',
        description: 'Drop off new, unwrapped toys for local children in need. DPPD will distribute toys to families throughout the community.',
        category: 'community',
        status: 'upcoming'
    },
    {
        id: '5',
        title: 'Coffee with a Cop',
        date: '2025-12-18',
        time: '8:00 AM - 10:00 AM',
        location: 'Bean Machine Coffee - Del Perro',
        description: 'Informal meet and greet with DPPD officers. Come chat, ask questions, and get to know your local police over coffee.',
        category: 'community',
        status: 'upcoming'
    }
];

async function getEventsData(): Promise<CommunityEvent[]> {
    try {
        const store = getStore({ name: 'events', consistency: 'strong' });
        const data = await store.get('events', { type: 'json' });
        if (data && Array.isArray(data)) {
            return data;
        }
        return defaultEventsData;
    } catch (error) {
        console.error('Error fetching events data:', error);
        return defaultEventsData;
    }
}

export const GET: APIRoute = async () => {
    const eventsData = await getEventsData();
    return new Response(JSON.stringify({ events: eventsData }), {
        status: 200,
        headers: {
            'Content-Type': 'application/json'
        }
    });
};

export const POST: APIRoute = async ({ request }) => {
    const user = extractUserFromHeaders(request);

    try {
        // Get current data for comparison
        const oldData = await getEventsData();

        const data = await request.json();
        const store = getStore({ name: 'events', consistency: 'strong' });
        await store.setJSON('events', data.events);

        // Log the change to Discord
        await logArrayDataChange(
            'EVENTS',
            user,
            oldData,
            data.events,
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
        console.error('Error saving events data:', error);

        // Log the failed attempt
        await logArrayDataChange(
            'EVENTS',
            user,
            [],
            [],
            'id',
            'title',
            false,
            'Failed to save events data'
        );

        return new Response(JSON.stringify({ success: false, error: 'Failed to save events data' }), {
            status: 500,
            headers: {
                'Content-Type': 'application/json'
            }
        });
    }
};
