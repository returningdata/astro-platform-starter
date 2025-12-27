import type { APIRoute } from 'astro';
import { getStore } from '@netlify/blobs';

export const prerender = false;

export interface AwardRecipient {
    awardName: string;
    recipientName: string;
}

export interface CommandPosition {
    rank: string;
    name: string;
    callSign: string;
    jobTitle: string;
}

export interface RankMember {
    name: string;
    callSign: string;
    jobTitle: string;
}

export interface RankPositions {
    rank: string;
    members: RankMember[];
}

export interface TierMember {
    name: string;
    jobTitle: string;
}

export interface TierPositions {
    tierName: string;
    members: TierMember[];
}

export interface DepartmentData {
    awardRecipients: AwardRecipient[];
    commandPositions: CommandPosition[];
    tierPositions: TierPositions[];
    rankPositions: RankPositions[];
}

const defaultDepartmentData: DepartmentData = {
    awardRecipients: [
        { awardName: 'Medal of Valor', recipientName: '' },
        { awardName: 'Distinguished Service Medal', recipientName: '' },
        { awardName: 'Service Medal', recipientName: '' },
        { awardName: 'Gold Medal of Excellence', recipientName: '' },
        { awardName: 'Meritorious Medal', recipientName: '' },
        { awardName: 'Academy Officer Service Medal', recipientName: '' },
        { awardName: 'Supervisor of the Month', recipientName: '' },
        { awardName: 'Supervisor of the Week', recipientName: '' },
        { awardName: 'Officer of the Month', recipientName: '' },
        { awardName: 'Officer of the Week', recipientName: '' },
        { awardName: 'Training Officer of the Week', recipientName: '' },
        { awardName: 'Photo of the Week', recipientName: '' }
    ],
    commandPositions: [
        { rank: 'Chief of Police', name: '', callSign: '1R-01', jobTitle: '' },
        { rank: 'Deputy Chief of Police', name: '', callSign: '1R-02', jobTitle: '' },
        { rank: 'Assistant Chief of Police', name: '', callSign: '1R-03', jobTitle: '' },
        { rank: 'Colonel', name: '', callSign: '1R-04', jobTitle: '' },
        { rank: 'Lieutenant Colonel', name: '', callSign: '1R-05', jobTitle: '' },
        { rank: 'Commander', name: '', callSign: '1R-06', jobTitle: '' }
    ],
    tierPositions: [
        {
            tierName: 'Low Command',
            members: [
                { name: '', jobTitle: '' },
                { name: '', jobTitle: '' },
                { name: '', jobTitle: '' },
                { name: '', jobTitle: '' },
                { name: '', jobTitle: '' },
                { name: '', jobTitle: '' }
            ]
        },
        {
            tierName: 'Trial Low Command',
            members: [
                { name: '', jobTitle: '' },
                { name: '', jobTitle: '' },
                { name: '', jobTitle: '' },
                { name: '', jobTitle: '' },
                { name: '', jobTitle: '' },
                { name: '', jobTitle: '' }
            ]
        }
    ],
    rankPositions: [
        {
            rank: 'Major',
            members: [
                { name: '', callSign: '', jobTitle: '' },
                { name: '', callSign: '', jobTitle: '' },
                { name: '', callSign: '', jobTitle: '' },
                { name: '', callSign: '', jobTitle: '' },
                { name: '', callSign: '', jobTitle: '' },
                { name: '', callSign: '', jobTitle: '' }
            ]
        },
        {
            rank: 'Captain',
            members: [
                { name: '', callSign: '', jobTitle: '' },
                { name: '', callSign: '', jobTitle: '' },
                { name: '', callSign: '', jobTitle: '' },
                { name: '', callSign: '', jobTitle: '' },
                { name: '', callSign: '', jobTitle: '' },
                { name: '', callSign: '', jobTitle: '' }
            ]
        },
        {
            rank: '1st Lieutenant',
            members: [
                { name: '', callSign: '', jobTitle: '' },
                { name: '', callSign: '', jobTitle: '' },
                { name: '', callSign: '', jobTitle: '' },
                { name: '', callSign: '', jobTitle: '' },
                { name: '', callSign: '', jobTitle: '' },
                { name: '', callSign: '', jobTitle: '' }
            ]
        },
        {
            rank: '2nd Lieutenant',
            members: [
                { name: '', callSign: '', jobTitle: '' },
                { name: '', callSign: '', jobTitle: '' },
                { name: '', callSign: '', jobTitle: '' },
                { name: '', callSign: '', jobTitle: '' },
                { name: '', callSign: '', jobTitle: '' },
                { name: '', callSign: '', jobTitle: '' }
            ]
        },
        {
            rank: 'Master Sergeant',
            members: [
                { name: '', callSign: '', jobTitle: '' },
                { name: '', callSign: '', jobTitle: '' },
                { name: '', callSign: '', jobTitle: '' },
                { name: '', callSign: '', jobTitle: '' },
                { name: '', callSign: '', jobTitle: '' },
                { name: '', callSign: '', jobTitle: '' }
            ]
        }
    ]
};

async function getDepartmentData(): Promise<DepartmentData> {
    try {
        const store = getStore({ name: 'department-data', consistency: 'strong' });
        const data = await store.get('department-data', { type: 'json' });
        if (data && typeof data === 'object') {
            return data as DepartmentData;
        }
        return defaultDepartmentData;
    } catch (error) {
        console.error('Error fetching department data:', error);
        return defaultDepartmentData;
    }
}

export const GET: APIRoute = async () => {
    const departmentData = await getDepartmentData();
    return new Response(JSON.stringify(departmentData), {
        status: 200,
        headers: {
            'Content-Type': 'application/json'
        }
    });
};

export const POST: APIRoute = async ({ request }) => {
    try {
        const data = await request.json();
        const store = getStore({ name: 'department-data', consistency: 'strong' });
        await store.setJSON('department-data', data);
        return new Response(JSON.stringify({ success: true }), {
            status: 200,
            headers: {
                'Content-Type': 'application/json'
            }
        });
    } catch (error) {
        console.error('Error saving department data:', error);
        return new Response(JSON.stringify({ success: false, error: 'Failed to save department data' }), {
            status: 500,
            headers: {
                'Content-Type': 'application/json'
            }
        });
    }
};
