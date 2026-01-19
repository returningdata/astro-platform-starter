/**
 * Roster Sync Scheduled Function
 *
 * Automatically syncs roster data from Google Sheets to the Chain of Command.
 * Runs every minute without requiring anyone to be on the site.
 *
 * This function:
 * 1. Fetches personnel data from the DPPD Master Roster Google Spreadsheet
 * 2. Parses and normalizes the data
 * 3. Updates the department data stored in Netlify Blobs
 */

import type { Config } from "@netlify/functions";
import { getStore } from "@netlify/blobs";

// Google Spreadsheet export URLs
const SPREADSHEET_ID = '1iUCnkFyPlNd5jorr3g2ZH2PLhwuQOcFXvx_DlbKdnI0';
const MAIN_SHEET_GID = '1963323163';
const RANK_SHEET_GID = '1853319408';
// Note: Department Liaisons sheet (GID 2123893270) is no longer synced - managed manually

interface RosterEntry {
    callSign: string;
    badge: string;
    name: string;
    discordId: string;
    rank: string;
    hireDate: string;
    movDate: string;
    status: string;
    strikes?: number;
    activityStatus?: 'active' | 'inactive' | 'semi_active' | 'warning' | 'probation';
    isSuspended?: boolean;
    suspensionReason?: string;
}

interface CommandPosition {
    rank: string;
    name: string;
    callSign: string;
    jobTitle: string;
    isLOA?: boolean;
    discordId?: string;
    strikes?: number;
    activityStatus?: 'active' | 'inactive' | 'semi_active' | 'warning' | 'probation';
    isSuspended?: boolean;
    suspensionReason?: string;
}

interface RankMember {
    name: string;
    callSign: string;
    jobTitle: string;
    isLOA?: boolean;
    discordId?: string;
    strikes?: number;
    activityStatus?: 'active' | 'inactive' | 'semi_active' | 'warning' | 'probation';
    isSuspended?: boolean;
    suspensionReason?: string;
}

interface RankPositions {
    rank: string;
    members: RankMember[];
    discordRoleId?: string;
}

interface DepartmentData {
    awardRecipients: any[];
    commandPositions: CommandPosition[];
    tierPositions: any[];
    rankPositions: RankPositions[];
    subdivisionLeadership: SubdivisionLeader[];
}

interface SubdivisionLeader {
    division: string;
    name: string;
    callSign: string;
    jobTitle: string;
    subdivisionId?: string;
    isLOA?: boolean;
    discordId?: string;
    positionType?: 'department_liaison' | 'overseer' | 'assistant_head' | 'leader';
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

    return rank;
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

// Parse CSV data from Google Sheets main sheet
function parseMainCSV(csvText: string): Map<string, Partial<RosterEntry>> {
    const lines = csvText.split('\n');
    const entries = new Map<string, Partial<RosterEntry>>();

    for (let i = 0; i < lines.length; i++) {
        const line = lines[i].trim();
        if (!line) continue;

        const fields = parseCSVLine(line);

        if (fields.length >= 6 && /^\d+R-\d+/.test(fields[0]) && fields[2] && fields[2].trim()) {
            const callSign = fields[0].trim();

            let strikes: number = 0;
            if (fields.length > 11 && fields[11]) {
                const strike1 = fields[11].trim().toUpperCase();
                if (strike1 === 'TRUE') strikes++;
            }
            if (fields.length > 12 && fields[12]) {
                const strike2 = fields[12].trim().toUpperCase();
                if (strike2 === 'TRUE') strikes++;
            }

            let isSuspended: boolean = false;
            if (fields.length > 13 && fields[13]) {
                const suspendedValue = fields[13].trim().toUpperCase();
                isSuspended = suspendedValue === 'TRUE' || suspendedValue === 'YES' || suspendedValue === 'SUSPENDED';
            }

            const statusValue = fields[5]?.trim().toLowerCase() || 'active';
            let activityStatus: 'active' | 'inactive' | 'semi_active' | 'warning' | 'probation' | undefined = undefined;
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
                callSign: callSign,
                badge: fields[1].trim(),
                name: fields[2].trim(),
                discordId: fields[3]?.trim() || '',
                rank: fields[4]?.trim() || '',
                hireDate: fields[7]?.trim() || '',
                movDate: fields[8]?.trim() || '',
                status: fields[5]?.trim() || 'Active',
                strikes: strikes,
                activityStatus,
                isSuspended: isSuspended,
                suspensionReason: undefined
            });
        }
    }

    return entries;
}

// Parse rank data from the rank sheet
function parseRankCSV(csvText: string): Map<string, string> {
    const lines = csvText.split('\n');
    const rankMap = new Map<string, string>();

    for (let i = 0; i < lines.length; i++) {
        const line = lines[i].trim();
        if (!line) continue;

        const fields = parseCSVLine(line);

        if (fields.length >= 5 && /^\d+R-\d+/.test(fields[0])) {
            const callSign = fields[0].trim();
            const rank = fields[4]?.trim() || '';
            if (rank) {
                rankMap.set(callSign, rank);
            }
        }
    }

    return rankMap;
}

// Note: Department Liaisons are now managed manually in the admin panel
// The automatic sync from Google Sheets has been removed per user request

// Fetch roster data from Google Sheets
async function fetchRosterData(): Promise<RosterEntry[]> {
    const mainExportUrl = `https://docs.google.com/spreadsheets/d/${SPREADSHEET_ID}/export?format=csv&gid=${MAIN_SHEET_GID}`;
    const rankExportUrl = `https://docs.google.com/spreadsheets/d/${SPREADSHEET_ID}/export?format=csv&gid=${RANK_SHEET_GID}`;

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 15000); // 15 second timeout

    try {
        const [mainResponse, rankResponse] = await Promise.all([
            fetch(mainExportUrl, { redirect: 'follow', signal: controller.signal }),
            fetch(rankExportUrl, { redirect: 'follow', signal: controller.signal })
        ]);
        clearTimeout(timeoutId);

        if (!mainResponse.ok) {
            throw new Error(`Failed to fetch main spreadsheet: ${mainResponse.status}`);
        }
        if (!rankResponse.ok) {
            throw new Error(`Failed to fetch rank spreadsheet: ${rankResponse.status}`);
        }

        const mainCsvText = await mainResponse.text();
        const rankCsvText = await rankResponse.text();

        const mainEntries = parseMainCSV(mainCsvText);
        const rankMap = parseRankCSV(rankCsvText);

        const result: RosterEntry[] = [];
        for (const [callSign, entry] of Array.from(mainEntries.entries())) {
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
                status: entry.status || 'Active'
            } as RosterEntry);
        }

        return result;
    } catch (error) {
        clearTimeout(timeoutId);
        throw error;
    }
}

// Default empty rank positions for initialization
const defaultRankPositions: RankPositions[] = multiMemberRanks.map(rank => ({
    rank,
    members: [
        { name: '', callSign: '', jobTitle: '', discordId: '', isLOA: false },
        { name: '', callSign: '', jobTitle: '', discordId: '', isLOA: false },
        { name: '', callSign: '', jobTitle: '', discordId: '', isLOA: false },
        { name: '', callSign: '', jobTitle: '', discordId: '', isLOA: false },
        { name: '', callSign: '', jobTitle: '', discordId: '', isLOA: false },
        { name: '', callSign: '', jobTitle: '', discordId: '', isLOA: false }
    ]
}));

// Get current department data from blob store
async function getDepartmentData(): Promise<DepartmentData | null> {
    try {
        const store = getStore({ name: 'department-data', consistency: 'strong' });
        const data = await store.get('department-data', { type: 'json' });
        if (data && typeof data === 'object') {
            const result = data as DepartmentData;

            // Ensure all default rank positions exist in stored data
            // This fixes sync issues where ranks like 'Major' might be missing from blob storage
            if (result.rankPositions) {
                const existingRanks = new Set(result.rankPositions.map(rp => rp.rank));
                for (const defaultRank of defaultRankPositions) {
                    if (!existingRanks.has(defaultRank.rank)) {
                        // Find the correct position to insert the missing rank
                        const defaultIndex = defaultRankPositions.findIndex(rp => rp.rank === defaultRank.rank);
                        result.rankPositions.splice(defaultIndex, 0, {
                            rank: defaultRank.rank,
                            members: defaultRank.members.map(m => ({ ...m }))
                        });
                        console.log(`Added missing rank position: ${defaultRank.rank}`);
                    }
                }
            } else {
                result.rankPositions = defaultRankPositions.map(rp => ({
                    rank: rp.rank,
                    members: rp.members.map(m => ({ ...m }))
                }));
            }

            return result;
        }
        return null;
    } catch (error) {
        console.error('Error fetching department data:', error);
        return null;
    }
}

// Save updated department data to blob store
async function saveDepartmentData(data: DepartmentData): Promise<void> {
    const store = getStore({ name: 'department-data', consistency: 'strong' });
    await store.setJSON('department-data', data);
}

// Main sync function
async function syncRoster(): Promise<{ success: boolean; message: string; updated: number }> {
    console.log('Starting scheduled roster sync...');

    // Fetch roster data from Google Sheets
    const rosterEntries = await fetchRosterData();
    console.log(`Fetched ${rosterEntries.length} roster entries from Google Sheets`);

    // Get current department data
    const currentData = await getDepartmentData();
    if (!currentData) {
        return { success: false, message: 'No existing department data found', updated: 0 };
    }

    let updatedCount = 0;

    // Build command positions from roster data
    const importedCommandPositions = highCommandRanks.map(rank => {
        const officer = rosterEntries.find(e => normalizeRank(e.rank) === rank);
        return {
            rank,
            name: officer?.name || '',
            callSign: officer?.callSign || '',
            jobTitle: officer?.rank || '',
            discordId: officer?.discordId || '',
            isLOA: officer?.status.toLowerCase() === 'loa',
            strikes: officer?.strikes,
            activityStatus: officer?.activityStatus,
            isSuspended: officer?.isSuspended,
            suspensionReason: officer?.suspensionReason
        };
    });

    // Build rank positions from roster data
    const importedRankPositions = multiMemberRanks.map(rank => {
        const officers = rosterEntries.filter(e => normalizeRank(e.rank) === rank);
        const members: RankMember[] = officers.map(o => ({
            name: o.name,
            callSign: o.callSign,
            jobTitle: o.rank,
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
            members: members.slice(0, 6)
        };
    });

    // Update command positions
    for (const importedPos of importedCommandPositions) {
        const existingPos = currentData.commandPositions.find(p => p.rank === importedPos.rank);
        if (existingPos && importedPos.name) {
            existingPos.name = importedPos.name;
            existingPos.callSign = importedPos.callSign;
            existingPos.discordId = importedPos.discordId;
            existingPos.isLOA = importedPos.isLOA;
            existingPos.strikes = importedPos.strikes;
            existingPos.activityStatus = importedPos.activityStatus;
            existingPos.isSuspended = importedPos.isSuspended;
            existingPos.suspensionReason = importedPos.suspensionReason;
            // Only update job title if imported value is different from rank
            if (importedPos.jobTitle && importedPos.jobTitle !== importedPos.rank) {
                existingPos.jobTitle = importedPos.jobTitle;
            }
            updatedCount++;
        } else if (existingPos) {
            // Still update status fields even if no name
            existingPos.strikes = importedPos.strikes;
            existingPos.activityStatus = importedPos.activityStatus;
            existingPos.isSuspended = importedPos.isSuspended;
            existingPos.suspensionReason = importedPos.suspensionReason;
        }
    }

    // Update rank positions
    for (const importedRank of importedRankPositions) {
        const existingRank = currentData.rankPositions.find(r => r.rank === importedRank.rank);
        if (existingRank) {
            // Preserve discord role ID
            const discordRoleId = existingRank.discordRoleId;

            // Replace members with imported data
            for (let i = 0; i < importedRank.members.length && i < existingRank.members.length; i++) {
                const importedMember = importedRank.members[i];
                if (importedMember.name) {
                    existingRank.members[i] = {
                        ...importedMember,
                        jobTitle: (importedMember.jobTitle && importedMember.jobTitle !== importedRank.rank)
                            ? importedMember.jobTitle
                            : existingRank.members[i].jobTitle || ''
                    };
                    updatedCount++;
                } else {
                    // Clear member if no name in imported data
                    existingRank.members[i] = { name: '', callSign: '', jobTitle: '', discordId: '', isLOA: false };
                }
            }

            // Restore discord role ID
            if (discordRoleId) {
                existingRank.discordRoleId = discordRoleId;
            }
        }
    }

    // Note: Department Liaisons are now managed manually in the admin panel
    // The automatic sync from Google Sheets has been removed per user request

    // Save updated data
    await saveDepartmentData(currentData);
    console.log(`Roster sync complete. Updated ${updatedCount} positions.`);

    return { success: true, message: 'Roster synced successfully', updated: updatedCount };
}

export default async (req: Request) => {
    console.log('Roster sync scheduled function triggered');

    try {
        const result = await syncRoster();

        return new Response(JSON.stringify({
            success: result.success,
            message: result.message,
            updated: result.updated,
            timestamp: new Date().toISOString()
        }), {
            status: result.success ? 200 : 500,
            headers: { 'Content-Type': 'application/json' }
        });
    } catch (error) {
        console.error('Error in roster sync:', error);
        return new Response(JSON.stringify({
            success: false,
            error: String(error),
            timestamp: new Date().toISOString()
        }), {
            status: 500,
            headers: { 'Content-Type': 'application/json' }
        });
    }
};

export const config: Config = {
    // Schedule to run every minute
    schedule: "* * * * *"
};
