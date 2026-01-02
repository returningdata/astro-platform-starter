import type { APIRoute } from 'astro';

export const prerender = false;

// Google Sheets URL for personnel roster
const ROSTER_SPREADSHEET_URL = 'https://docs.google.com/spreadsheets/d/1iUCnkFyPlNd5jorr3g2ZH2PLhwuQOcFXvx_DlbKdnI0/export?format=csv&gid=1853319408';

// Parse CSV line properly handling quoted fields
function parseCSVLine(line: string): string[] {
    const result: string[] = [];
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
            result.push(current.trim());
            current = '';
        } else {
            current += char;
        }
    }
    result.push(current.trim());
    return result;
}

// Check if a value looks like a valid Discord ID (numeric string, typically 17-19 digits)
function isValidDiscordId(value: string): boolean {
    const trimmed = value.trim();
    return trimmed.length >= 17 && /^\d+$/.test(trimmed);
}

export const GET: APIRoute = async () => {
    try {
        const response = await fetch(ROSTER_SPREADSHEET_URL, { redirect: 'follow' });
        if (response.ok) {
            const csvText = await response.text();
            const lines = csvText.split('\n').slice(1);
            const totalPersonnel = lines.filter(line => {
                const columns = parseCSVLine(line);
                // Only count rows that have both a name (column 3) AND a valid Discord ID (column 4)
                // Discord IDs are numeric strings typically 17-19 digits long
                // This filters out section headers like "High Command", "Low Command", etc.
                const hasName = columns[3] && columns[3].trim() !== '';
                const hasValidDiscordId = columns[4] && isValidDiscordId(columns[4]);
                return hasName && hasValidDiscordId;
            }).length;

            return new Response(JSON.stringify({ count: totalPersonnel }), {
                status: 200,
                headers: {
                    'Content-Type': 'application/json',
                    'Cache-Control': 'public, max-age=60'
                }
            });
        }

        return new Response(JSON.stringify({ count: 0, error: 'Failed to fetch roster' }), {
            status: 500,
            headers: { 'Content-Type': 'application/json' }
        });
    } catch (error) {
        console.error('Error fetching personnel count:', error);
        return new Response(JSON.stringify({ count: 0, error: 'Failed to fetch personnel count' }), {
            status: 500,
            headers: { 'Content-Type': 'application/json' }
        });
    }
};
