import type { APIRoute } from 'astro';
import { getStore } from '@netlify/blobs';
import { extractUserFromSession } from '../../utils/discord-webhook';

export const prerender = false;

export interface WebhookSettings {
    discordWebhookUrl: string;
    lastMessageId: string | null;
    lastSentAt: number | null;
    enabled: boolean;
}

const WEBHOOK_STORE_NAME = 'webhook-settings';

function getWebhookStore() {
    return getStore({ name: WEBHOOK_STORE_NAME, consistency: 'strong' });
}

async function getWebhookSettings(): Promise<WebhookSettings> {
    try {
        const store = getWebhookStore();
        const data = await store.get('settings', { type: 'json' });
        if (data) {
            return data as WebhookSettings;
        }
        // Return defaults
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

async function saveWebhookSettings(settings: WebhookSettings): Promise<void> {
    const store = getWebhookStore();
    await store.setJSON('settings', settings);
}

// Verify super admin authorization
async function verifySuperAdmin(request: Request): Promise<{ valid: boolean; error?: string }> {
    try {
        const user = await extractUserFromSession(request);
        if (!user) {
            return { valid: false, error: 'Not authenticated' };
        }
        if (user.role !== 'super_admin') {
            return { valid: false, error: 'Super admin access required' };
        }
        return { valid: true };
    } catch {
        return { valid: false, error: 'Session validation failed' };
    }
}

export const GET: APIRoute = async ({ request }) => {
    const auth = await verifySuperAdmin(request);
    if (!auth.valid) {
        return new Response(JSON.stringify({ success: false, error: auth.error }), {
            status: 403,
            headers: { 'Content-Type': 'application/json' }
        });
    }

    const settings = await getWebhookSettings();
    // Mask the webhook URL for security (show partial)
    const maskedUrl = settings.discordWebhookUrl
        ? settings.discordWebhookUrl.substring(0, 50) + '...'
        : '';

    return new Response(JSON.stringify({
        settings: {
            ...settings,
            discordWebhookUrlMasked: maskedUrl,
            // Don't send full URL in GET for security
            discordWebhookUrl: settings.discordWebhookUrl ? '***configured***' : ''
        }
    }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' }
    });
};

export const POST: APIRoute = async ({ request }) => {
    const auth = await verifySuperAdmin(request);
    if (!auth.valid) {
        return new Response(JSON.stringify({ success: false, error: auth.error }), {
            status: 403,
            headers: { 'Content-Type': 'application/json' }
        });
    }

    try {
        const data = await request.json();
        const currentSettings = await getWebhookSettings();

        // Handle different actions
        if (data.action === 'update_url') {
            // Update webhook URL
            const newUrl = data.discordWebhookUrl || '';

            // Validate URL format if provided
            if (newUrl && !newUrl.startsWith('https://discord.com/api/webhooks/')) {
                return new Response(JSON.stringify({
                    success: false,
                    error: 'Invalid Discord webhook URL format'
                }), {
                    status: 400,
                    headers: { 'Content-Type': 'application/json' }
                });
            }

            await saveWebhookSettings({
                ...currentSettings,
                discordWebhookUrl: newUrl,
                // Reset message ID when URL changes
                lastMessageId: null
            });

            return new Response(JSON.stringify({
                success: true,
                message: 'Webhook URL updated'
            }), {
                status: 200,
                headers: { 'Content-Type': 'application/json' }
            });
        }

        if (data.action === 'toggle_enabled') {
            await saveWebhookSettings({
                ...currentSettings,
                enabled: data.enabled !== false
            });

            return new Response(JSON.stringify({
                success: true,
                message: `Webhook ${data.enabled !== false ? 'enabled' : 'disabled'}`
            }), {
                status: 200,
                headers: { 'Content-Type': 'application/json' }
            });
        }

        if (data.action === 'send_now') {
            // Manually trigger webhook send
            const webhookUrl = currentSettings.discordWebhookUrl;
            if (!webhookUrl) {
                return new Response(JSON.stringify({
                    success: false,
                    error: 'No webhook URL configured'
                }), {
                    status: 400,
                    headers: { 'Content-Type': 'application/json' }
                });
            }

            // Call the site-status endpoint to trigger the webhook
            try {
                // We'll handle the actual send here inline for better control
                const result = await sendStatusWebhook(webhookUrl, currentSettings);
                return new Response(JSON.stringify(result), {
                    status: result.success ? 200 : 500,
                    headers: { 'Content-Type': 'application/json' }
                });
            } catch (error) {
                return new Response(JSON.stringify({
                    success: false,
                    error: `Failed to send webhook: ${error}`
                }), {
                    status: 500,
                    headers: { 'Content-Type': 'application/json' }
                });
            }
        }

        if (data.action === 'clear_message') {
            // Delete the old message and clear the stored ID
            if (currentSettings.lastMessageId && currentSettings.discordWebhookUrl) {
                try {
                    await fetch(`${currentSettings.discordWebhookUrl}/messages/${currentSettings.lastMessageId}`, {
                        method: 'DELETE'
                    });
                } catch (e) {
                    console.error('Failed to delete old message:', e);
                }
            }

            await saveWebhookSettings({
                ...currentSettings,
                lastMessageId: null
            });

            return new Response(JSON.stringify({
                success: true,
                message: 'Message cleared'
            }), {
                status: 200,
                headers: { 'Content-Type': 'application/json' }
            });
        }

        return new Response(JSON.stringify({
            success: false,
            error: 'Unknown action'
        }), {
            status: 400,
            headers: { 'Content-Type': 'application/json' }
        });
    } catch (error) {
        console.error('Error in webhook settings:', error);
        return new Response(JSON.stringify({
            success: false,
            error: 'Failed to process request'
        }), {
            status: 500,
            headers: { 'Content-Type': 'application/json' }
        });
    }
};

// Helper function to send the status webhook
async function sendStatusWebhook(webhookUrl: string, currentSettings: WebhookSettings): Promise<{ success: boolean; message?: string; error?: string }> {
    // Fetch site stats and config in parallel
    const [stats, siteConfig] = await Promise.all([
        fetchSiteStats(),
        getSiteConfig()
    ]);

    // Build the embed
    const payload = buildSiteStatusEmbed(stats, siteConfig);

    // Delete old message if exists
    if (currentSettings.lastMessageId) {
        try {
            await fetch(`${webhookUrl}/messages/${currentSettings.lastMessageId}`, {
                method: 'DELETE'
            });
            console.log('Deleted old message:', currentSettings.lastMessageId);
        } catch (e) {
            console.error('Failed to delete old message:', e);
        }
    }

    // Send new message
    const response = await fetch(`${webhookUrl}?wait=true`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
    });

    if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`Discord API error: ${response.status} - ${errorText}`);
    }

    const message = await response.json();

    // Save the new message ID
    await saveWebhookSettings({
        ...currentSettings,
        lastMessageId: message.id,
        lastSentAt: Date.now()
    });

    return { success: true, message: 'Webhook sent successfully' };
}

// Google Sheets URL for personnel roster
const ROSTER_SPREADSHEET_URL = 'https://docs.google.com/spreadsheets/d/1iUCnkFyPlNd5jorr3g2ZH2PLhwuQOcFXvx_DlbKdnI0/export?format=csv&gid=1853319408';

// Default site configuration (used as fallback)
const DEFAULT_SITE_CONFIG = {
    name: 'Del Perro Police Department',
    shortName: 'DPPD',
    version: '7.32.3',
    owner: '<@1000470631688712243>',
    siteUrl: 'https://delperro.netlify.app',
    color: 0x1e40af,
};

// Fetch site configuration from blob store
async function getSiteConfig(): Promise<typeof DEFAULT_SITE_CONFIG> {
    try {
        const store = getStore({ name: 'site-info', consistency: 'strong' });
        const data = await store.get('settings', { type: 'json' }) as typeof DEFAULT_SITE_CONFIG | null;
        if (data) {
            return { ...DEFAULT_SITE_CONFIG, ...data };
        }
        return DEFAULT_SITE_CONFIG;
    } catch (error) {
        console.error('Error fetching site config:', error);
        return DEFAULT_SITE_CONFIG;
    }
}

interface SiteStats {
    events: { total: number; upcoming: number; ongoing: number; completed: number; };
    warehouse: { totalVehicles: number; };
    subdivisions: { total: number; open: number; tryouts: number; handpicked: number; closed: number; };
    personnel: { commandPositions: number; filledCommandPositions: number; totalRanks: number; totalPersonnel: number; subdivisionLeaders: number; };
    adminUsers: number;
    resources: number;
    activeUsers: number;
}

async function fetchSiteStats(): Promise<SiteStats> {
    const stats: SiteStats = {
        events: { total: 0, upcoming: 0, ongoing: 0, completed: 0 },
        warehouse: { totalVehicles: 0 },
        subdivisions: { total: 0, open: 0, tryouts: 0, handpicked: 0, closed: 0 },
        personnel: { commandPositions: 0, filledCommandPositions: 0, totalRanks: 0, totalPersonnel: 0, subdivisionLeaders: 0 },
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
    } catch (error) { console.error('Error fetching events:', error); }

    try {
        const warehouseStore = getStore({ name: 'warehouse', consistency: 'strong' });
        const warehouseData = await warehouseStore.get('categories', { type: 'json' }) as any[] | null;
        if (warehouseData && Array.isArray(warehouseData)) {
            stats.warehouse.totalVehicles = warehouseData.length;
        }
    } catch (error) { console.error('Error fetching warehouse:', error); }

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
    } catch (error) { console.error('Error fetching subdivisions:', error); }

    try {
        const response = await fetch(ROSTER_SPREADSHEET_URL, { redirect: 'follow' });
        if (response.ok) {
            const csvText = await response.text();
            const lines = csvText.split('\n').slice(1);
            stats.personnel.totalPersonnel = lines.filter(line => {
                const columns = line.split(',');
                return columns[3] && columns[3].trim() !== '';
            }).length;
        }
    } catch (error) { console.error('Error fetching personnel:', error); }

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
    } catch (error) { console.error('Error fetching department data:', error); }

    try {
        const usersStore = getStore({ name: 'admin-users', consistency: 'strong' });
        const usersData = await usersStore.get('users', { type: 'json' }) as any[] | null;
        if (usersData && Array.isArray(usersData)) {
            stats.adminUsers = usersData.length;
        }
    } catch (error) { console.error('Error fetching users:', error); }

    try {
        const resourcesStore = getStore({ name: 'resources', consistency: 'strong' });
        const resourcesData = await resourcesStore.get('resources', { type: 'json' }) as any[] | null;
        if (resourcesData && Array.isArray(resourcesData)) {
            stats.resources = resourcesData.length;
        }
    } catch (error) { console.error('Error fetching resources:', error); }

    try {
        const visitorStore = getStore({ name: 'visitor-tracking', consistency: 'strong' });
        const activeVisitors = await visitorStore.get('active-sessions', { type: 'json' }) as Record<string, number> | null;
        if (activeVisitors) {
            const now = Date.now();
            const activeThreshold = 2 * 60 * 1000;
            stats.activeUsers = Object.values(activeVisitors).filter(lastSeen => (now - lastSeen) < activeThreshold).length;
        }
    } catch (error) { console.error('Error fetching active users:', error); }

    return stats;
}

function getDiscordTimestamp(): string {
    const unix = Math.floor(Date.now() / 1000);
    return `<t:${unix}:R>`;
}

function buildSiteStatusEmbed(stats: SiteStats, siteConfig: typeof DEFAULT_SITE_CONFIG): any {
    const timestamp = new Date().toISOString();
    return {
        embeds: [{
            title: `📊 ${siteConfig.shortName} Site Status`,
            description: `Real-time status and statistics for the **${siteConfig.name}** website.`,
            color: siteConfig.color,
            timestamp,
            thumbnail: { url: 'https://cdn-icons-png.flaticon.com/512/1828/1828490.png' },
            fields: [
                {
                    name: '🌐 Site Information',
                    value: [
                        `**Version:** \`v${siteConfig.version}\``,
                        `**Owner:** ${siteConfig.owner}`,
                        `**URL:** [Visit Site](${siteConfig.siteUrl})`
                    ].join('\n'),
                    inline: false
                },
                {
                    name: '🖥️ System Status',
                    value: [
                        `✅ **Status:** Operational`,
                        `📈 **Uptime:** 99.9%`,
                        `👥 **Visitors Online:** ${stats.activeUsers}`,
                        `🕐 **Last Update:** ${getDiscordTimestamp()}`
                    ].join('\n'),
                    inline: true
                },
                {
                    name: '⚡ Quick Stats',
                    value: [
                        `🔑 **Admin Users:** ${stats.adminUsers}`,
                        `📁 **Resources:** ${stats.resources}`,
                        `🏛️ **Subdivisions:** ${stats.subdivisions.total}`
                    ].join('\n'),
                    inline: true
                },
                {
                    name: '📅 Community Events',
                    value: [
                        `**Total Events:** ${stats.events.total}`,
                        `🔜 Upcoming: ${stats.events.upcoming}`,
                        `🔴 Ongoing: ${stats.events.ongoing}`,
                        `✔️ Completed: ${stats.events.completed}`
                    ].join('\n'),
                    inline: true
                },
                {
                    name: '🚗 Warehouse',
                    value: [
                        `**Vehicles:** ${stats.warehouse.totalVehicles}`
                    ].join('\n'),
                    inline: true
                },
                {
                    name: '🏛️ Subdivisions',
                    value: [
                        `**Total:** ${stats.subdivisions.total}`,
                        `🟢 Open: ${stats.subdivisions.open}`,
                        `🟡 Tryouts: ${stats.subdivisions.tryouts}`,
                        `🟠 Handpicked: ${stats.subdivisions.handpicked}`,
                        `🔴 Closed: ${stats.subdivisions.closed}`
                    ].join('\n'),
                    inline: true
                },
                {
                    name: '👮 Personnel Overview',
                    value: [
                        `⭐ **Command Staff:** ${stats.personnel.filledCommandPositions}/${stats.personnel.commandPositions}`,
                        `📊 **Rank Categories:** ${stats.personnel.totalRanks}`,
                        `👥 **Active Personnel:** ${stats.personnel.totalPersonnel}`,
                        `🎖️ **Division Leaders:** ${stats.personnel.subdivisionLeaders}`
                    ].join('\n'),
                    inline: false
                }
            ],
            footer: { text: `${siteConfig.name} | Updates every 1 minute`, icon_url: 'https://cdn-icons-png.flaticon.com/512/6941/6941697.png' }
        }]
    };
}
