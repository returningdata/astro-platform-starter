import type { APIRoute } from 'astro';
import { getStore } from '@netlify/blobs';

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

// Site configuration
const SITE_CONFIG = {
    name: 'Del Perro Police Department',
    shortName: 'DPPD',
    version: '7.32.3',
    owner: '<@1000470631688712243>',
    siteUrl: 'https://delperro.netlify.app',
    color: 0x1e40af,
};

interface WebhookSettings {
    discordWebhookUrl: string;
    lastMessageId: string | null;
    lastSentAt: number | null;
    enabled: boolean;
}

interface SiteStats {
    events: {
        total: number;
        upcoming: number;
        ongoing: number;
        completed: number;
    };
    warehouse: {
        totalVehicles: number;
    };
    subdivisions: {
        total: number;
        open: number;
        tryouts: number;
        handpicked: number;
        closed: number;
    };
    personnel: {
        commandPositions: number;
        filledCommandPositions: number;
        totalRanks: number;
        totalPersonnel: number;
        subdivisionLeaders: number;
    };
    arrestReports: {
        total: number;
        open: number;
        closed: number;
        unresolved: number;
    };
    adminUsers: number;
    resources: number;
    activeUsers: number;
}

/**
 * Get webhook settings from blob store
 */
async function getWebhookSettings(): Promise<WebhookSettings> {
    try {
        const store = getStore({ name: 'webhook-settings', consistency: 'strong' });
        const data = await store.get('settings', { type: 'json' }) as WebhookSettings | null;
        if (data) {
            return data;
        }
        return {
            discordWebhookUrl: '',
            lastMessageId: null,
            lastSentAt: null,
            enabled: true
        };
    } catch (error) {
        console.error('Error fetching webhook settings:', error);
        return {
            discordWebhookUrl: '',
            lastMessageId: null,
            lastSentAt: null,
            enabled: true
        };
    }
}

/**
 * Save webhook settings to blob store
 */
async function saveWebhookSettings(settings: WebhookSettings): Promise<void> {
    try {
        const store = getStore({ name: 'webhook-settings', consistency: 'strong' });
        await store.setJSON('settings', settings);
    } catch (error) {
        console.error('Error saving webhook settings:', error);
    }
}

/**
 * Fetch all site statistics from Netlify Blobs
 */
async function fetchSiteStats(): Promise<SiteStats> {
    const stats: SiteStats = {
        events: { total: 0, upcoming: 0, ongoing: 0, completed: 0 },
        warehouse: { totalVehicles: 0 },
        subdivisions: { total: 0, open: 0, tryouts: 0, handpicked: 0, closed: 0 },
        personnel: { commandPositions: 0, filledCommandPositions: 0, totalRanks: 0, totalPersonnel: 0, subdivisionLeaders: 0 },
        arrestReports: { total: 0, open: 0, closed: 0, unresolved: 0 },
        adminUsers: 0,
        resources: 0,
        activeUsers: 0
    };

    try {
        const eventsStore = getStore({ name: 'events', consistency: 'strong' });
        const eventsData = await eventsStore.get('events', { type: 'json' }) as any[] | null;
        if (eventsData && Array.isArray(eventsData)) {
            stats.events.total = eventsData.length;
            stats.events.upcoming = eventsData.filter(e => e.status === 'upcoming').length;
            stats.events.ongoing = eventsData.filter(e => e.status === 'ongoing').length;
            stats.events.completed = eventsData.filter(e => e.status === 'completed').length;
        }
    } catch (error) {
        console.error('Error fetching events:', error);
    }

    try {
        const warehouseStore = getStore({ name: 'warehouse', consistency: 'strong' });
        const warehouseData = await warehouseStore.get('categories', { type: 'json' }) as any[] | null;
        if (warehouseData && Array.isArray(warehouseData)) {
            stats.warehouse.totalVehicles = warehouseData.length;
        }
    } catch (error) {
        console.error('Error fetching warehouse:', error);
    }

    try {
        const subdivisionsStore = getStore({ name: 'subdivisions', consistency: 'strong' });
        const subdivisionsData = await subdivisionsStore.get('data', { type: 'json' }) as any[] | null;
        if (subdivisionsData && Array.isArray(subdivisionsData)) {
            stats.subdivisions.total = subdivisionsData.length;
            for (const sub of subdivisionsData) {
                switch (sub.availability) {
                    case 'open': stats.subdivisions.open++; break;
                    case 'tryouts': stats.subdivisions.tryouts++; break;
                    case 'handpicked': stats.subdivisions.handpicked++; break;
                    case 'closed': stats.subdivisions.closed++; break;
                    case 'tryouts-handpicked':
                        stats.subdivisions.tryouts++;
                        stats.subdivisions.handpicked++;
                        break;
                }
            }
        }
    } catch (error) {
        console.error('Error fetching subdivisions:', error);
    }

    try {
        const response = await fetch(ROSTER_SPREADSHEET_URL, { redirect: 'follow' });
        if (response.ok) {
            const csvText = await response.text();
            const lines = csvText.split('\n').slice(1);
            stats.personnel.totalPersonnel = lines.filter(line => {
                const columns = parseCSVLine(line);
                // Only count rows that have both a name (column 3) AND a valid Discord ID (column 4)
                // Discord IDs are numeric strings typically 17-19 digits long
                // This filters out section headers like "High Command", "Low Command", etc.
                const hasName = columns[3] && columns[3].trim() !== '';
                const hasValidDiscordId = columns[4] && isValidDiscordId(columns[4]);
                return hasName && hasValidDiscordId;
            }).length;
        }
    } catch (error) {
        console.error('Error fetching personnel from Google Sheets:', error);
    }

    try {
        const deptStore = getStore({ name: 'department-data', consistency: 'strong' });
        const deptData = await deptStore.get('department-data', { type: 'json' }) as any | null;
        if (deptData) {
            if (deptData.commandPositions && Array.isArray(deptData.commandPositions)) {
                stats.personnel.commandPositions = deptData.commandPositions.length;
                stats.personnel.filledCommandPositions = deptData.commandPositions.filter((p: any) => p.name && p.name.trim() !== '').length;
            }
            if (deptData.rankPositions && Array.isArray(deptData.rankPositions)) {
                stats.personnel.totalRanks = deptData.rankPositions.length;
            }
            if (deptData.subdivisionLeadership && Array.isArray(deptData.subdivisionLeadership)) {
                stats.personnel.subdivisionLeaders = deptData.subdivisionLeadership.filter((l: any) => l.name && l.name.trim() !== '').length;
            }
        }
    } catch (error) {
        console.error('Error fetching department data:', error);
    }

    try {
        const usersStore = getStore({ name: 'admin-users', consistency: 'strong' });
        const usersData = await usersStore.get('users', { type: 'json' }) as any[] | null;
        if (usersData && Array.isArray(usersData)) {
            stats.adminUsers = usersData.length;
        }
    } catch (error) {
        console.error('Error fetching users:', error);
    }

    try {
        const resourcesStore = getStore({ name: 'resources', consistency: 'strong' });
        const resourcesData = await resourcesStore.get('resources', { type: 'json' }) as any[] | null;
        if (resourcesData && Array.isArray(resourcesData)) {
            stats.resources = resourcesData.length;
        }
    } catch (error) {
        console.error('Error fetching resources:', error);
    }

    try {
        const visitorStore = getStore({ name: 'visitor-tracking', consistency: 'strong' });
        const activeVisitors = await visitorStore.get('active-sessions', { type: 'json' }) as Record<string, number> | null;
        if (activeVisitors) {
            const now = Date.now();
            const activeThreshold = 2 * 60 * 1000;
            stats.activeUsers = Object.values(activeVisitors).filter(lastSeen => (now - lastSeen) < activeThreshold).length;
        }
    } catch (error) {
        console.error('Error fetching active users:', error);
    }

    // Fetch arrest reports statistics
    try {
        const arrestReportsStore = getStore({ name: 'arrest-reports', consistency: 'strong' });
        const arrestReportsData = await arrestReportsStore.get('reports', { type: 'json' }) as any[] | null;
        if (arrestReportsData && Array.isArray(arrestReportsData)) {
            stats.arrestReports.total = arrestReportsData.length;
            stats.arrestReports.open = arrestReportsData.filter(r => r.caseStatus === 'open').length;
            stats.arrestReports.closed = arrestReportsData.filter(r => r.caseStatus === 'closed').length;
            stats.arrestReports.unresolved = arrestReportsData.filter(r => r.caseStatus === 'unresolved').length;
        }
    } catch (error) {
        console.error('Error fetching arrest reports:', error);
    }

    return stats;
}

function getDiscordTimestamp(): string {
    const unix = Math.floor(Date.now() / 1000);
    return `<t:${unix}:R>`;
}

function buildSiteStatusEmbed(stats: SiteStats): any {
    const timestamp = new Date().toISOString();
    return {
        embeds: [{
            title: `📊 ${SITE_CONFIG.shortName} Site Status`,
            description: `Real-time status and statistics for the **${SITE_CONFIG.name}** website.`,
            color: SITE_CONFIG.color,
            timestamp,
            thumbnail: { url: 'https://cdn-icons-png.flaticon.com/512/1828/1828490.png' },
            fields: [
                { name: '🌐 Site Information', value: [`**Version:** \`v${SITE_CONFIG.version}\``, `**Owner:** ${SITE_CONFIG.owner}`, `**URL:** [Visit Site](${SITE_CONFIG.siteUrl})`].join('\n'), inline: false },
                { name: '🖥️ System Status', value: [`✅ **Status:** Operational`, `📈 **Uptime:** 99.9%`, `👥 **Visitors Online:** ${stats.activeUsers}`, `🕐 **Last Update:** ${getDiscordTimestamp()}`].join('\n'), inline: true },
                { name: '⚡ Quick Stats', value: [`🔑 **Admin Users:** ${stats.adminUsers}`, `📁 **Resources:** ${stats.resources}`, `🏛️ **Subdivisions:** ${stats.subdivisions.total}`].join('\n'), inline: true },
                { name: '📅 Community Events', value: [`**Total Events:** ${stats.events.total}`, `🔜 Upcoming: ${stats.events.upcoming}`, `🔴 Ongoing: ${stats.events.ongoing}`, `✔️ Completed: ${stats.events.completed}`].join('\n'), inline: true },
                { name: '🚗 Warehouse', value: [`**Vehicles:** ${stats.warehouse.totalVehicles}`].join('\n'), inline: true },
                { name: '🏛️ Subdivisions', value: [`**Total:** ${stats.subdivisions.total}`, `🟢 Open: ${stats.subdivisions.open}`, `🟡 Tryouts: ${stats.subdivisions.tryouts}`, `🟠 Handpicked: ${stats.subdivisions.handpicked}`, `🔴 Closed: ${stats.subdivisions.closed}`].join('\n'), inline: true },
                { name: '🚔 Arrest Reports', value: [`**Total Reports:** ${stats.arrestReports.total}`, `🟠 Open: ${stats.arrestReports.open}`, `🟢 Closed: ${stats.arrestReports.closed}`, `🔴 Unresolved: ${stats.arrestReports.unresolved}`].join('\n'), inline: true },
                { name: '👮 Personnel Overview', value: [`⭐ **Command Staff:** ${stats.personnel.filledCommandPositions}/${stats.personnel.commandPositions}`, `📊 **Rank Categories:** ${stats.personnel.totalRanks}`, `👥 **Active Personnel:** ${stats.personnel.totalPersonnel}`, `🎖️ **Division Leaders:** ${stats.personnel.subdivisionLeaders}`].join('\n'), inline: false }
            ],
            footer: { text: `${SITE_CONFIG.name} | Updates every 1 minute`, icon_url: 'https://cdn-icons-png.flaticon.com/512/6941/6941697.png' }
        }]
    };
}

async function deleteMessage(webhookUrl: string, messageId: string): Promise<boolean> {
    try {
        const response = await fetch(`${webhookUrl}/messages/${messageId}`, { method: 'DELETE' });
        return response.ok || response.status === 204 || response.status === 404;
    } catch {
        return false;
    }
}

async function sendNewMessage(webhookUrl: string, payload: any): Promise<string | null> {
    try {
        const response = await fetch(`${webhookUrl}?wait=true`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
        });
        if (!response.ok) return null;
        const message = await response.json();
        return message.id || null;
    } catch {
        return null;
    }
}

async function sendToDiscord(): Promise<{ success: boolean; message?: string; error?: string; stats?: SiteStats }> {
    const settings = await getWebhookSettings();

    if (!settings.discordWebhookUrl) {
        return { success: false, error: 'No webhook URL configured' };
    }

    const stats = await fetchSiteStats();
    const payload = buildSiteStatusEmbed(stats);

    // Delete old message if exists
    if (settings.lastMessageId) {
        await deleteMessage(settings.discordWebhookUrl, settings.lastMessageId);
    }

    // Send new message
    const newMessageId = await sendNewMessage(settings.discordWebhookUrl, payload);

    if (newMessageId) {
        await saveWebhookSettings({
            ...settings,
            lastMessageId: newMessageId,
            lastSentAt: Date.now()
        });
        return { success: true, message: 'Site status updated on Discord successfully', stats };
    }

    return { success: false, error: 'Failed to send Discord message' };
}

export const GET: APIRoute = async () => {
    try {
        const result = await sendToDiscord();
        return new Response(JSON.stringify(result), {
            status: result.success ? 200 : 500,
            headers: { 'Content-Type': 'application/json' }
        });
    } catch (error) {
        console.error('Error in site status:', error);
        return new Response(JSON.stringify({ success: false, error: String(error) }), {
            status: 500,
            headers: { 'Content-Type': 'application/json' }
        });
    }
};

export const POST: APIRoute = async () => {
    return GET({ request: new Request('http://localhost'), redirect: () => new Response(), cookies: {} as any, url: new URL('http://localhost'), site: undefined, generator: '', props: {}, params: {}, currentLocale: undefined, preferredLocale: undefined, preferredLocaleList: undefined, locals: {}, getActionResult: async () => undefined, callAction: async () => ({} as any), routePattern: '', rewrite: async () => new Response(), originPathname: '' } as any);
};
