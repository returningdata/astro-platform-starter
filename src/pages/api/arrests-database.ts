import type { APIRoute } from 'astro';
import { getStore } from '@netlify/blobs';
import type { ArrestReport } from './arrest-reports';

export const prerender = false;

/**
 * Get arrest reports store
 */
function getArrestReportsStore() {
    return getStore({ name: 'arrest-reports', consistency: 'strong' });
}

/**
 * Get all arrest reports
 */
async function getArrestReports(): Promise<ArrestReport[]> {
    try {
        const store = getArrestReportsStore();
        const reports = await store.get('reports', { type: 'json' }) as ArrestReport[] | null;
        return reports || [];
    } catch (error) {
        console.error('Error fetching arrest reports:', error);
        return [];
    }
}

/**
 * Search suspect by name or CIV ID
 * Returns aggregated data for suspects matching the search criteria
 */
interface SuspectRecord {
    suspectName: string;
    suspectDob: string;
    suspectCid: string;
    suspectGender: string;
    suspectImage: string;
    arrests: ArrestReport[];
    totalArrests: number;
    allCharges: string[];
    caseStatuses: {
        open: number;
        closed: number;
        unresolved: number;
    };
}

/**
 * GET - Search for suspects by name or CIV ID
 * Query parameters:
 *   - q: search query (name or CIV ID)
 */
export const GET: APIRoute = async ({ request }) => {
    try {
        const url = new URL(request.url);
        const query = url.searchParams.get('q')?.trim().toLowerCase();

        if (!query) {
            return new Response(JSON.stringify({
                success: false,
                error: 'Search query is required. Please provide a name or CIV ID.'
            }), {
                status: 400,
                headers: { 'Content-Type': 'application/json' }
            });
        }

        const reports = await getArrestReports();

        // Search by name or CIV ID
        const matchingReports = reports.filter(report => {
            const nameMatch = report.suspectName?.toLowerCase().includes(query);
            const cidMatch = report.suspectCid?.toLowerCase().includes(query);
            return nameMatch || cidMatch;
        });

        if (matchingReports.length === 0) {
            return new Response(JSON.stringify({
                success: true,
                suspects: [],
                message: 'No suspects found matching your search criteria.'
            }), {
                status: 200,
                headers: { 'Content-Type': 'application/json' }
            });
        }

        // Group reports by suspect (using CIV ID as primary key, fall back to name)
        const suspectMap = new Map<string, SuspectRecord>();

        for (const report of matchingReports) {
            // Use CIV ID as key if available, otherwise use normalized name
            const key = report.suspectCid?.trim().toLowerCase() || report.suspectName?.trim().toLowerCase() || 'unknown';

            if (!suspectMap.has(key)) {
                suspectMap.set(key, {
                    suspectName: report.suspectName || 'Unknown',
                    suspectDob: report.suspectDob || 'Unknown',
                    suspectCid: report.suspectCid || 'Unknown',
                    suspectGender: report.suspectGender || 'Unknown',
                    suspectImage: report.suspectImage || '',
                    arrests: [],
                    totalArrests: 0,
                    allCharges: [],
                    caseStatuses: {
                        open: 0,
                        closed: 0,
                        unresolved: 0
                    }
                });
            }

            const suspect = suspectMap.get(key)!;
            suspect.arrests.push(report);
            suspect.totalArrests++;

            // Track charges
            if (report.charges) {
                // Split charges by common delimiters and add unique ones
                const charges = report.charges.split(/[,;\n]/).map(c => c.trim()).filter(c => c.length > 0);
                for (const charge of charges) {
                    if (!suspect.allCharges.includes(charge)) {
                        suspect.allCharges.push(charge);
                    }
                }
            }

            // Track case statuses
            if (report.caseStatus === 'open') suspect.caseStatuses.open++;
            else if (report.caseStatus === 'closed') suspect.caseStatuses.closed++;
            else if (report.caseStatus === 'unresolved') suspect.caseStatuses.unresolved++;

            // Update suspect image if current report has one and existing doesn't
            if (report.suspectImage && !suspect.suspectImage) {
                suspect.suspectImage = report.suspectImage;
            }

            // Use the most recent image if available
            if (report.suspectImage) {
                const existingArrestDates = suspect.arrests.filter(a => a.id !== report.id).map(a => new Date(a.createdAt).getTime());
                const currentArrestDate = new Date(report.createdAt).getTime();
                if (existingArrestDates.length === 0 || currentArrestDate > Math.max(...existingArrestDates)) {
                    suspect.suspectImage = report.suspectImage;
                }
            }
        }

        // Sort arrests by date (newest first) for each suspect
        for (const suspect of suspectMap.values()) {
            suspect.arrests.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
        }

        // Convert map to array and sort by total arrests (most first)
        const suspects = Array.from(suspectMap.values()).sort((a, b) => b.totalArrests - a.totalArrests);

        return new Response(JSON.stringify({
            success: true,
            suspects,
            totalResults: suspects.length
        }), {
            status: 200,
            headers: { 'Content-Type': 'application/json' }
        });
    } catch (error) {
        console.error('Error searching arrests database:', error);
        return new Response(JSON.stringify({
            success: false,
            error: String(error)
        }), {
            status: 500,
            headers: { 'Content-Type': 'application/json' }
        });
    }
};
