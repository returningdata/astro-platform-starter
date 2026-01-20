import type { APIRoute } from 'astro';
import { extractUserFromSession, checkPermission } from '../../utils/discord-webhook';

export const prerender = false;

// Google Spreadsheet export URL
const SPREADSHEET_ID = '1iUCnkFyPlNd5jorr3g2ZH2PLhwuQOcFXvx_DlbKdnI0';
// Main sheet with personnel data - callsign, badge, name, discord, rank, status, strikes, suspension
const MAIN_SHEET_GID = '1963323163';
// Rank sheet - contains rank data in column E
const RANK_SHEET_GID = '1853319408';

interface RosterEntry {
    callSign: string;
    badge: string;
    name: string;
    discordId: string;
    rank: string;
    hireDate: string;
    movDate: string;
    status: string;
    jobTitle?: string; // Column K - Job Title from roster
    // Additional columns that may exist in spreadsheet
    strikes?: number;
    activityStatus?: string;
    isSuspended?: boolean;
    suspensionReason?: string;
}

interface ParsedRoster {
    highCommand: RosterEntry[];
    lowCommand: RosterEntry[];
    supervisors: RosterEntry[];
    seniorPatrolOfficers: RosterEntry[];
    patrolOfficers: RosterEntry[];
    probationaryOfficers: RosterEntry[];
    cadets: RosterEntry[];
}

// Normalize rank names to match the site's rank structure
function normalizeRank(rank: string): string {
    const rankLower = rank.toLowerCase().trim();

    // IMPORTANT: Check for "Trial High Command" prefix FIRST, before other rank keywords
    // "Trial High Command - Chief of Police" should map to Commander, not Chief of Police
    if (rankLower.includes('trial high command') || rankLower.startsWith('thc -') || rankLower.startsWith('thc-')) {
        return 'Commander';
    }

    // High Command
    if (rankLower.includes('chief of police') && !rankLower.includes('deputy') && !rankLower.includes('assistant')) {
        return 'Chief of Police';
    }
    if (rankLower.includes('deputy chief')) return 'Deputy Chief of Police';
    if (rankLower.includes('assistant chief')) return 'Assistant Chief of Police';
    if (rankLower.startsWith('colonel') && !rankLower.includes('lieutenant')) return 'Colonel';
    if (rankLower.startsWith('lieutenant colonel')) return 'Lieutenant Colonel';

    // Commander (including Trial High Command)
    if (rankLower.includes('commander')) return 'Commander';

    // Low Command (use startsWith to handle suffixes like "(THC)" for Trial High Command)
    if (rankLower.startsWith('major')) return 'Major';
    if (rankLower.startsWith('captain')) return 'Captain';
    if (rankLower.startsWith('1st lieutenant')) return '1st Lieutenant';
    if (rankLower.startsWith('2nd lieutenant')) return '2nd Lieutenant';

    // Trial Low Command (use startsWith to handle suffixes)
    if (rankLower.startsWith('master sergeant')) return 'Master Sergeant';

    // Supervisors (use startsWith to handle suffixes)
    if (rankLower.startsWith('sergeant first class')) return 'Sergeant First Class';
    if (rankLower.startsWith('staff sergeant')) return 'Staff Sergeant';
    if (rankLower.startsWith('sergeant') && !rankLower.includes('first') && !rankLower.includes('staff') && !rankLower.includes('master')) return 'Sergeant';

    // Trial Supervisor (use startsWith to handle suffixes)
    if (rankLower.startsWith('corporal')) return 'Corporal';

    // Officers (use startsWith to handle suffixes)
    if (rankLower.startsWith('officer iii') || rankLower.startsWith('officer 3')) return 'Officer III';
    if (rankLower.startsWith('officer ii') || rankLower.startsWith('officer 2')) return 'Officer II';
    if (rankLower.startsWith('officer i') || rankLower.startsWith('officer 1')) return 'Officer I';
    if (rankLower.includes('probationary')) return 'Probationary Officer';

    // Reserves
    if (rankLower.includes('reserve')) return 'Reserve Officer';

    // Training (use startsWith to handle suffixes)
    if (rankLower.startsWith('cadet')) return 'Cadet';

    return rank; // Return original if no match
}

// Parse CSV data from Google Sheets
// Main sheet (gid=1963323163) columns:
// A(0): Callsign, B(1): Badge Number, C(2): Name, D(3): Discord ID,
// E(4): Rank, F(5): Status, G(6): Timezone, H(7): Hired Date, I(8): Mov. Date,
// J(9): Time in Rank, K(10): Job Title, L(11): Strike 1, M(12): Strike 2, N(13): Suspended
function parseMainCSV(csvText: string): Map<string, Partial<RosterEntry>> {
    const lines = csvText.split('\n');
    const entries = new Map<string, Partial<RosterEntry>>();

    // Skip header rows and process data rows
    for (let i = 0; i < lines.length; i++) {
        const line = lines[i].trim();
        if (!line) continue;

        // Parse CSV properly handling quoted fields
        const fields = parseCSVLine(line);

        // Look for actual data: Callsign is in column A (index 0) - starts with pattern like 1R-01, 2R-15, etc.
        // Also require a name (column C, index 2) to be present - skip empty placeholder rows
        if (fields.length >= 6 && /^\d+R-\d+/.test(fields[0]) && fields[2] && fields[2].trim()) {
            const callSign = fields[0].trim();

            // Count strikes from Strike 1 and Strike 2 columns (columns L-M, indices 11-12)
            // TRUE/FALSE checkbox values - count how many are TRUE
            let strikes: number = 0;
            if (fields.length > 11 && fields[11]) {
                const strike1 = fields[11].trim().toUpperCase();
                if (strike1 === 'TRUE') strikes++;
            }
            if (fields.length > 12 && fields[12]) {
                const strike2 = fields[12].trim().toUpperCase();
                if (strike2 === 'TRUE') strikes++;
            }

            // Parse job title from column K (index 10)
            const jobTitle = fields.length > 10 ? fields[10]?.trim() || '' : '';

            // Parse suspension status (column N, index 13)
            let isSuspended: boolean = false;
            if (fields.length > 13 && fields[13]) {
                const suspendedValue = fields[13].trim().toUpperCase();
                isSuspended = suspendedValue === 'TRUE' || suspendedValue === 'YES' || suspendedValue === 'SUSPENDED';
            }

            // Determine activity status from Status column (column F, index 5)
            const statusValue = fields[5]?.trim().toLowerCase() || 'active';
            let activityStatus: 'active' | 'inactive' | 'semi_active' | 'warning' | 'probation' | undefined = undefined;
            // Map status values to activity status
            if (statusValue === 'inactive') {
                activityStatus = 'inactive';
            } else if (statusValue === 'semi active' || statusValue === 'semi-active' || statusValue === 'semiactive') {
                activityStatus = 'semi_active';
            } else if (statusValue === 'warning' || statusValue === 'activity warning') {
                activityStatus = 'warning';
            } else if (statusValue === 'probation') {
                activityStatus = 'probation';
            } else if (statusValue === 'active' || statusValue === 'loa') {
                activityStatus = 'active';
            }

            entries.set(callSign, {
                callSign: callSign,                   // Column A
                badge: fields[1].trim(),              // Column B
                name: fields[2].trim(),               // Column C
                discordId: fields[3]?.trim() || '',   // Column D
                rank: fields[4]?.trim() || '',        // Column E - Rank (also read from main sheet)
                hireDate: fields[7]?.trim() || '',    // Column H - Hire Date
                movDate: fields[8]?.trim() || '',     // Column I - Movement Date
                status: fields[5]?.trim() || 'Active', // Column F
                jobTitle: jobTitle,                   // Column K - Job Title
                strikes: strikes,                     // Always include strikes (0, 1, or 2) so it can clear
                activityStatus,
                isSuspended: isSuspended,             // Always include isSuspended (true or false) so it can clear
                suspensionReason: undefined
            });
        }
    }

    return entries;
}

// Parse rank data from the rank sheet
// Rank sheet (gid=1853319408) columns:
// A(0): Callsign, B(1): Badge Number, C(2): Name, D(3): Discord ID, E(4): Rank,
// F(5): Hire Date, G(6): Mov. Date, H(7): Status, I(8): Strike 1, J(9): Strike 2, K(10): Suspended
function parseRankCSV(csvText: string): Map<string, string> {
    const lines = csvText.split('\n');
    const rankMap = new Map<string, string>();

    for (let i = 0; i < lines.length; i++) {
        const line = lines[i].trim();
        if (!line) continue;

        const fields = parseCSVLine(line);

        // Look for callsign pattern in column A (index 0)
        if (fields.length >= 5 && /^\d+R-\d+/.test(fields[0])) {
            const callSign = fields[0].trim();
            const rank = fields[4]?.trim() || ''; // Column E (index 4) is Rank
            if (rank) {
                rankMap.set(callSign, rank);
            }
        }
    }

    return rankMap;
}

// Parse a single CSV line handling quoted fields
function parseCSVLine(line: string): string[] {
    const fields: string[] = [];
    let current = '';
    let inQuotes = false;

    for (let i = 0; i < line.length; i++) {
        const char = line[i];

        if (char === '"') {
            if (inQuotes && line[i + 1] === '"') {
                current += '"';
                i++;
            } else {
                inQuotes = !inQuotes;
            }
        } else if (char === ',' && !inQuotes) {
            fields.push(current);
            current = '';
        } else {
            current += char;
        }
    }
    fields.push(current);

    return fields;
}

// Fetch and parse the Google Spreadsheet from both sheets
async function fetchRosterData(): Promise<RosterEntry[]> {
    // Fetch main sheet (personnel data, status, strikes, suspension)
    const mainExportUrl = `https://docs.google.com/spreadsheets/d/${SPREADSHEET_ID}/export?format=csv&gid=${MAIN_SHEET_GID}`;
    // Fetch rank sheet (rank data)
    const rankExportUrl = `https://docs.google.com/spreadsheets/d/${SPREADSHEET_ID}/export?format=csv&gid=${RANK_SHEET_GID}`;

    const [mainResponse, rankResponse] = await Promise.all([
        fetch(mainExportUrl, { redirect: 'follow' }),
        fetch(rankExportUrl, { redirect: 'follow' })
    ]);

    if (!mainResponse.ok) {
        throw new Error(`Failed to fetch main spreadsheet: ${mainResponse.status}`);
    }
    if (!rankResponse.ok) {
        throw new Error(`Failed to fetch rank spreadsheet: ${rankResponse.status}`);
    }

    const mainCsvText = await mainResponse.text();
    const rankCsvText = await rankResponse.text();

    // Parse both sheets
    const mainEntries = parseMainCSV(mainCsvText);
    const rankMap = parseRankCSV(rankCsvText);

    // Merge rank data into main entries
    // Prefer rank from rank sheet, but fall back to rank from main sheet
    const result: RosterEntry[] = [];
    for (const [callSign, entry] of mainEntries) {
        const rankFromRankSheet = rankMap.get(callSign) || '';
        const finalRank = rankFromRankSheet || entry.rank || '';
        result.push({
            ...entry,
            rank: finalRank,
            callSign: entry.callSign || callSign,
            badge: entry.badge || '',
            name: entry.name || '',
            discordId: entry.discordId || '',
            hireDate: entry.hireDate || '',
            movDate: entry.movDate || '',
            status: entry.status || 'Active',
            jobTitle: entry.jobTitle || ''
        } as RosterEntry);
    }

    return result;
}

// High command ranks (single positions)
const highCommandRanks = [
    'Chief of Police',
    'Deputy Chief of Police',
    'Assistant Chief of Police',
    'Colonel',
    'Lieutenant Colonel',
    'Commander'
];

// Multi-member ranks
const multiMemberRanks = [
    'Major',
    'Captain',
    '1st Lieutenant',
    '2nd Lieutenant',
    'Master Sergeant',
    'Sergeant First Class',
    'Staff Sergeant',
    'Sergeant',
    'Corporal',
    'Officer III',
    'Officer II',
    'Officer I',
    'Probationary Officer',
    'Reserve Officer',
    'Cadet'
];

export const GET: APIRoute = async ({ request }) => {
    // Validate session server-side
    const user = await extractUserFromSession(request);

    if (!user) {
        return new Response(JSON.stringify({ error: 'Unauthorized' }), {
            status: 401,
            headers: { 'Content-Type': 'application/json' }
        });
    }

    // Check if user has department-data permission
    if (!checkPermission(user, 'department-data')) {
        return new Response(JSON.stringify({ error: 'Forbidden' }), {
            status: 403,
            headers: { 'Content-Type': 'application/json' }
        });
    }

    try {
        const rosterEntries = await fetchRosterData();

        // Include all entries (including inactive members for display with activity coloring)
        const activeEntries = rosterEntries;

        // Build command positions (single officers for high command)
        const commandPositions = highCommandRanks.map(rank => {
            const officer = activeEntries.find(e => normalizeRank(e.rank) === rank);
            return {
                rank,
                name: officer?.name || '',
                callSign: officer?.callSign || '',
                jobTitle: officer?.jobTitle || officer?.rank || '', // Use jobTitle from roster (column K), fallback to rank
                discordId: officer?.discordId || '',
                isLOA: officer?.status.toLowerCase() === 'loa',
                strikes: officer?.strikes,
                activityStatus: officer?.activityStatus,
                isSuspended: officer?.isSuspended,
                suspensionReason: officer?.suspensionReason
            };
        });

        // Build rank positions (multi-member ranks)
        const rankPositions = multiMemberRanks.map(rank => {
            const officers = activeEntries.filter(e => normalizeRank(e.rank) === rank);
            const members = officers.map(o => ({
                name: o.name,
                callSign: o.callSign,
                jobTitle: o.jobTitle || o.rank, // Use jobTitle from roster (column K), fallback to rank
                discordId: o.discordId,
                isLOA: o.status.toLowerCase() === 'loa',
                strikes: o.strikes,
                activityStatus: o.activityStatus,
                isSuspended: o.isSuspended,
                suspensionReason: o.suspensionReason
            }));

            // Pad with empty slots up to 6
            while (members.length < 6) {
                members.push({ name: '', callSign: '', jobTitle: '', discordId: '', isLOA: false });
            }

            return {
                rank,
                members: members.slice(0, 6) // Max 6 members
            };
        });

        return new Response(JSON.stringify({
            success: true,
            data: {
                commandPositions,
                rankPositions,
                totalActive: activeEntries.length,
                lastUpdated: new Date().toISOString()
            },
            rawEntries: activeEntries // Include raw data for debugging
        }), {
            status: 200,
            headers: { 'Content-Type': 'application/json' }
        });
    } catch (error) {
        console.error('Error fetching roster:', error);
        return new Response(JSON.stringify({
            success: false,
            error: error instanceof Error ? error.message : 'Failed to fetch roster data'
        }), {
            status: 500,
            headers: { 'Content-Type': 'application/json' }
        });
    }
};
