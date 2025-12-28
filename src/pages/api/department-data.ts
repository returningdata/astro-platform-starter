import type { APIRoute } from 'astro';
import { getStore } from '@netlify/blobs';
import { logDepartmentDataChange } from '../../utils/discord-webhook';

export const prerender = false;

export interface AwardRecipient {
    awardName: string;
    recipientName: string;
    imageUrl?: string;  // Used for Photo of the Week
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

export interface SubdivisionLeader {
    division: string;
    name: string;
    callSign: string;
    jobTitle: string;
    subdivisionId?: string;  // Links to subdivision ID for reliable matching
}

export interface DepartmentData {
    awardRecipients: AwardRecipient[];
    commandPositions: CommandPosition[];
    tierPositions: TierPositions[];
    rankPositions: RankPositions[];
    subdivisionLeadership: SubdivisionLeader[];
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
    ],
    subdivisionLeadership: [
        { division: 'Subdivision Overseer', name: '', callSign: '', jobTitle: '' },
        { division: 'Field Training Division', name: '', callSign: '', jobTitle: '' },
        { division: 'Special Weapons and Tactics', name: '', callSign: '', jobTitle: '' },
        { division: 'Traffic Enforcement Unit', name: '', callSign: '', jobTitle: '' },
        { division: 'Criminal Investigations Unit', name: '', callSign: '', jobTitle: '' },
        { division: 'K9 Division', name: '', callSign: '', jobTitle: '' }
    ]
};

async function getDepartmentData(): Promise<DepartmentData> {
    try {
        const store = getStore({ name: 'department-data', consistency: 'strong' });
        const data = await store.get('department-data', { type: 'json' });
        if (data && typeof data === 'object') {
            const result = data as DepartmentData;

            // Ensure all default subdivisions exist in stored data
            if (result.subdivisionLeadership) {
                const existingDivisions = new Set(result.subdivisionLeadership.map(s => s.division));
                for (const defaultSub of defaultDepartmentData.subdivisionLeadership) {
                    if (!existingDivisions.has(defaultSub.division)) {
                        // Find the correct position to insert the missing subdivision
                        const defaultIndex = defaultDepartmentData.subdivisionLeadership.findIndex(s => s.division === defaultSub.division);
                        result.subdivisionLeadership.splice(defaultIndex, 0, { ...defaultSub });
                    }
                }
            } else {
                result.subdivisionLeadership = defaultDepartmentData.subdivisionLeadership;
            }

            return result;
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

        // Log to Discord
        await logDepartmentDataChange('Department hierarchy and command structure updated');

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
