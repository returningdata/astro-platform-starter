import type { APIRoute } from 'astro';
import { getStore } from '@netlify/blobs';
import { logArrayDataChange, extractUserFromSession, checkPermission } from '../../utils/discord-webhook';

export const prerender = false;

export interface Subdivision {
    id: string;
    name: string;
    abbreviation: string;
    description: string;
    availability: 'tryouts' | 'open' | 'handpicked' | 'closed' | 'tryouts-handpicked';
    owner?: string;
    ownerCallSign?: string;
    imageUrls?: string[]; // Array of image URLs (Discord CDN or Imgur links) - max 3
}

// Helper to get the subdivisions store
function getSubdivisionsStore() {
    return getStore({ name: 'subdivisions', consistency: 'strong' });
}

// Helper to get department data store
function getDepartmentDataStore() {
    return getStore({ name: 'department-data', consistency: 'strong' });
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

// Get subdivision leadership data from department-data store
async function getSubdivisionLeadership(): Promise<Array<{division: string, name: string, callSign: string, jobTitle: string}>> {
    try {
        const store = getDepartmentDataStore();
        const data = await store.get('department-data', { type: 'json' });
        if (data && typeof data === 'object' && 'subdivisionLeadership' in data) {
            return (data as any).subdivisionLeadership || [];
        }
        return [];
    } catch (error) {
        console.error('Error fetching subdivision leadership:', error);
        return [];
    }
}

// Match subdivision to leadership by subdivisionId (primary) or fallback to name/abbreviation matching
function findLeaderForSubdivision(subdivision: Subdivision, leadership: Array<{division: string, name: string, callSign: string, jobTitle: string, subdivisionId?: string}>): {name: string, callSign: string} | null {
    // First, try to match by subdivisionId (most reliable)
    for (const leader of leadership) {
        if (leader.subdivisionId && leader.subdivisionId === subdivision.id) {
            if (leader.name) {
                return { name: leader.name, callSign: leader.callSign || '' };
            }
        }
    }

    // Fallback: match by abbreviation or name for backwards compatibility
    const normalizedSubName = subdivision.name.toLowerCase();
    const normalizedAbbrev = subdivision.abbreviation.toLowerCase();

    for (const leader of leadership) {
        const normalizedDivision = leader.division.toLowerCase();

        // Check for matches:
        // 1. Abbreviation in division name (e.g., "K9" in "K9 Division")
        // 2. Division contains subdivision name
        // 3. Subdivision name contains division name
        // 4. Word-by-word matching for partial matches
        const abbreviationMatch = normalizedDivision.includes(normalizedAbbrev) || normalizedAbbrev.includes(normalizedDivision.replace(' division', '').trim());
        const nameMatch = normalizedDivision.includes(normalizedSubName) || normalizedSubName.includes(normalizedDivision);
        const wordMatch = normalizedSubName.split(' ').some(word => word.length > 2 && normalizedDivision.includes(word)) ||
                         normalizedDivision.split(' ').some(word => word.length > 2 && word !== 'division' && normalizedSubName.includes(word));

        if (abbreviationMatch || nameMatch || wordMatch) {
            if (leader.name) {
                return { name: leader.name, callSign: leader.callSign || '' };
            }
        }
    }
    return null;
}

export const GET: APIRoute = async () => {
    try {
        const subdivisionsData = await getSubdivisionsData();
        const leadershipData = await getSubdivisionLeadership();

        // Merge owner information from leadership data
        const subdivisionsWithOwners = subdivisionsData.map(sub => {
            const leader = findLeaderForSubdivision(sub, leadershipData);
            return {
                ...sub,
                owner: leader?.name || sub.owner || '',
                ownerCallSign: leader?.callSign || sub.ownerCallSign || ''
            };
        });

        return new Response(JSON.stringify({ subdivisions: subdivisionsWithOwners }), {
            status: 200,
            headers: { 'Content-Type': 'application/json' }
        });
    } catch (error) {
        console.error('Error fetching subdivisions:', error);
        return new Response(JSON.stringify({ subdivisions: defaultSubdivisionsData }), {
            status: 200,
            headers: { 'Content-Type': 'application/json' }
        });
    }
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

    // Check if user has subdivisions permission
    if (!checkPermission(user, 'subdivisions')) {
        return new Response(JSON.stringify({ error: 'Forbidden' }), {
            status: 403,
            headers: { 'Content-Type': 'application/json' }
        });
    }

    try {
        // Get current data for comparison
        const oldData = await getSubdivisionsData();

        const data = await request.json();
        const store = getSubdivisionsStore();
        const departmentStore = getDepartmentDataStore();

        const newSubdivisions = data.subdivisions as Subdivision[];

        // Process subdivisions
        const subdivisionsToSave: Subdivision[] = newSubdivisions.map(subdivision => {
            const subToSave: Subdivision = {
                id: subdivision.id,
                name: subdivision.name,
                abbreviation: subdivision.abbreviation,
                description: subdivision.description,
                availability: subdivision.availability
            };

            // Handle image URLs (Discord CDN or Imgur links) - max 3
            if (subdivision.imageUrls && Array.isArray(subdivision.imageUrls)) {
                const validUrls = subdivision.imageUrls
                    .filter((url: string) => url && typeof url === 'string' && url.trim() !== '')
                    .slice(0, 3); // Limit to 3 images
                if (validUrls.length > 0) {
                    subToSave.imageUrls = validUrls;
                }
            }

            return subToSave;
        });

        // Save the subdivisions data
        await store.setJSON('data', subdivisionsToSave);

        // Sync subdivisions to department-data's subdivisionLeadership
        try {
            const departmentData = await departmentStore.get('department-data', { type: 'json' }) as any || {};
            const existingLeadership = departmentData.subdivisionLeadership || [];

            let updated = false;

            // First pass: Update existing leadership entries to link by subdivisionId
            for (const leader of existingLeadership) {
                if (!leader.subdivisionId) {
                    // Try to find a matching subdivision and add the subdivisionId
                    const normalizedDivision = leader.division.toLowerCase();

                    for (const subdivision of subdivisionsToSave) {
                        const normalizedSubName = subdivision.name.toLowerCase();
                        const normalizedAbbrev = subdivision.abbreviation.toLowerCase();

                        const abbreviationMatch = normalizedDivision.includes(normalizedAbbrev) ||
                                                  normalizedAbbrev.includes(normalizedDivision.replace(' division', '').trim());
                        const nameMatch = normalizedDivision.includes(normalizedSubName) ||
                                         normalizedSubName.includes(normalizedDivision.replace(' division', '').trim());
                        const wordMatch = normalizedSubName.split(' ').some(word =>
                            word.length > 2 && normalizedDivision.includes(word)
                        );

                        if (abbreviationMatch || nameMatch || wordMatch) {
                            leader.subdivisionId = subdivision.id;
                            updated = true;
                            break;
                        }
                    }
                }
            }

            // Second pass: Check for new subdivisions that need leadership entries
            for (const subdivision of subdivisionsToSave) {
                // Check if this subdivision already has a leadership entry (by subdivisionId)
                const hasLeadershipById = existingLeadership.some((leader: any) =>
                    leader.subdivisionId === subdivision.id
                );

                if (!hasLeadershipById) {
                    // Fallback: check by name/abbreviation matching for backwards compatibility
                    const hasLeadershipByName = existingLeadership.some((leader: any) => {
                        const leaderDiv = leader.division.toLowerCase();
                        const normalizedAbbrev = subdivision.abbreviation.toLowerCase();
                        const normalizedSubName = subdivision.name.toLowerCase();

                        return leaderDiv.includes(normalizedAbbrev) ||
                               leaderDiv.includes(normalizedSubName) ||
                               normalizedSubName.includes(leaderDiv.replace(' division', '').trim());
                    });

                    if (!hasLeadershipByName) {
                        // Add new subdivision to leadership with subdivisionId for reliable linking
                        const divisionName = subdivision.abbreviation
                            ? `${subdivision.abbreviation} Division`
                            : subdivision.name;
                        existingLeadership.push({
                            division: divisionName,
                            name: '',
                            callSign: '',
                            jobTitle: '',
                            subdivisionId: subdivision.id
                        });
                        updated = true;
                    }
                }
            }

            // Save updated leadership data if changes were made
            if (updated) {
                departmentData.subdivisionLeadership = existingLeadership;
                await departmentStore.setJSON('department-data', departmentData);
            }
        } catch (syncError) {
            console.error('Error syncing subdivision leadership:', syncError);
            // Don't fail the main operation if sync fails
        }

        // Log the change to Discord
        await logArrayDataChange(
            'SUBDIVISIONS',
            user,
            oldData,
            subdivisionsToSave,
            'id',
            'name',
            true
        );

        return new Response(JSON.stringify({ success: true }), {
            status: 200,
            headers: { 'Content-Type': 'application/json' }
        });
    } catch (error) {
        console.error('Error saving subdivisions data:', error);

        // Log the failed attempt
        await logArrayDataChange(
            'SUBDIVISIONS',
            user,
            [],
            [],
            'id',
            'name',
            false,
            'Failed to save subdivisions data'
        );

        return new Response(JSON.stringify({ success: false, error: 'Failed to save subdivisions data' }), {
            status: 500,
            headers: { 'Content-Type': 'application/json' }
        });
    }
};
