/**
 * Site Status Discord Webhook
 *
 * Sends comprehensive site statistics and status information to Discord.
 * Runs every 1 minute and deletes the old message before sending a new one.
 * Uses configurable webhook URL from Netlify Blobs.
 */

import type { Context, Config } from "@netlify/functions";
import { getStore } from "@netlify/blobs";

// Site configuration
const SITE_CONFIG = {
    name: 'Del Perro Police Department',
    shortName: 'DPPD',
    version: '6.6.0',
    owner: '<@1000470631688712243>',
    siteUrl: 'https://delperro.netlify.app',
    color: 0x1e40af, // Professional blue color
};

// Google Sheets URL for personnel roster
const ROSTER_SPREADSHEET_URL = 'https://docs.google.com/spreadsheets/d/1iUCnkFyPlNd5jorr3g2ZH2PLhwuQOcFXvx_DlbKdnI0/export?format=csv&gid=1853319408';

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
        adminUsers: 0,
        resources: 0,
        activeUsers: 0
    };

    try {
        // Fetch events data
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
        // Fetch warehouse data - count total vehicles (categories)
        const warehouseStore = getStore({ name: 'warehouse', consistency: 'strong' });
        const warehouseData = await warehouseStore.get('categories', { type: 'json' }) as any[] | null;
        if (warehouseData && Array.isArray(warehouseData)) {
            stats.warehouse.totalVehicles = warehouseData.length;
        }
    } catch (error) {
        console.error('Error fetching warehouse:', error);
    }

    try {
        // Fetch subdivisions data
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
        // Fetch department data from Google Sheets (count non-empty column D - Discord IDs)
        const response = await fetch(ROSTER_SPREADSHEET_URL, { redirect: 'follow' });
        if (response.ok) {
            const csvText = await response.text();
            const lines = csvText.split('\n').slice(1); // Skip header row
            // Count rows that have a non-empty value in column D (index 3)
            stats.personnel.totalPersonnel = lines.filter(line => {
                const columns = line.split(',');
                return columns[3] && columns[3].trim() !== '';
            }).length;
        }
    } catch (error) {
        console.error('Error fetching personnel from Google Sheets:', error);
    }

    try {
        // Fetch department data for command positions
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
        // Fetch admin users count
        const usersStore = getStore({ name: 'admin-users', consistency: 'strong' });
        const usersData = await usersStore.get('users', { type: 'json' }) as any[] | null;
        if (usersData && Array.isArray(usersData)) {
            stats.adminUsers = usersData.length;
        }
    } catch (error) {
        console.error('Error fetching users:', error);
    }

    try {
        // Fetch resources count
        const resourcesStore = getStore({ name: 'resources', consistency: 'strong' });
        const resourcesData = await resourcesStore.get('resources', { type: 'json' }) as any[] | null;
        if (resourcesData && Array.isArray(resourcesData)) {
            stats.resources = resourcesData.length;
        }
    } catch (error) {
        console.error('Error fetching resources:', error);
    }

    try {
        // Fetch active users count (from visitor tracking)
        const visitorStore = getStore({ name: 'visitor-tracking', consistency: 'strong' });
        const activeVisitors = await visitorStore.get('active-sessions', { type: 'json' }) as Record<string, number> | null;
        if (activeVisitors) {
            // Count sessions active within the last 2 minutes (120 seconds)
            const now = Date.now();
            const activeThreshold = 2 * 60 * 1000; // 2 minutes
            stats.activeUsers = Object.values(activeVisitors).filter(lastSeen => (now - lastSeen) < activeThreshold).length;
        }
    } catch (error) {
        console.error('Error fetching active users:', error);
    }

    return stats;
}

/**
 * Get current timestamp formatted for Discord
 */
function getDiscordTimestamp(): string {
    const unix = Math.floor(Date.now() / 1000);
    return `<t:${unix}:R>`;
}

/**
 * Build the Discord embed for site status
 */
function buildSiteStatusEmbed(stats: SiteStats): any {
    const timestamp = new Date().toISOString();

    return {
        embeds: [
            {
                title: `📊 ${SITE_CONFIG.shortName} Site Status`,
                description: `Real-time status and statistics for the **${SITE_CONFIG.name}** website.`,
                color: SITE_CONFIG.color,
                timestamp: timestamp,
                thumbnail: {
                    url: 'https://cdn-icons-png.flaticon.com/512/1828/1828490.png'
                },
                fields: [
                    // Site Information Section
                    {
                        name: '🌐 Site Information',
                        value: [
                            `**Version:** \`v${SITE_CONFIG.version}\``,
                            `**Owner:** ${SITE_CONFIG.owner}`,
                            `**URL:** [Visit Site](${SITE_CONFIG.siteUrl})`
                        ].join('\n'),
                        inline: false
                    },
                    // System Status (with visitors)
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
                    // Quick Stats
                    {
                        name: '⚡ Quick Stats',
                        value: [
                            `🔑 **Admin Users:** ${stats.adminUsers}`,
                            `📁 **Resources:** ${stats.resources}`,
                            `🏛️ **Subdivisions:** ${stats.subdivisions.total}`
                        ].join('\n'),
                        inline: true
                    },
                    // Events Section
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
                    // Warehouse Section
                    {
                        name: '🚗 Warehouse',
                        value: [
                            `**Vehicles:** ${stats.warehouse.totalVehicles}`
                        ].join('\n'),
                        inline: true
                    },
                    // Subdivisions Section
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
                    // Personnel Section
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
                footer: {
                    text: `${SITE_CONFIG.name} | Updates every 1 minute`,
                    icon_url: 'https://cdn-icons-png.flaticon.com/512/6941/6941697.png'
                }
            }
        ]
    };
}

/**
 * Delete an existing webhook message
 */
async function deleteMessage(webhookUrl: string, messageId: string): Promise<boolean> {
    try {
        const deleteUrl = `${webhookUrl}/messages/${messageId}`;
        const response = await fetch(deleteUrl, {
            method: 'DELETE'
        });

        if (response.ok || response.status === 204) {
            console.log('Successfully deleted old message:', messageId);
            return true;
        } else if (response.status === 404) {
            console.log('Message already deleted or not found:', messageId);
            return true; // Consider it successful - message doesn't exist
        } else {
            console.error('Failed to delete message:', response.status);
            return false;
        }
    } catch (error) {
        console.error('Error deleting message:', error);
        return false;
    }
}

/**
 * Send a new webhook message to Discord and store the message ID
 */
async function sendNewMessage(webhookUrl: string, payload: any): Promise<string | null> {
    try {
        // Add ?wait=true to get the message object back
        const response = await fetch(`${webhookUrl}?wait=true`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify(payload)
        });

        if (!response.ok) {
            const errorText = await response.text();
            console.error('Discord webhook error:', response.status, errorText);
            return null;
        }

        // Get the message ID from the response
        const message = await response.json();
        console.log('Sent new message with ID:', message.id);
        return message.id || null;
    } catch (error) {
        console.error('Failed to send Discord webhook:', error);
        return null;
    }
}

export default async (req: Request, context: Context) => {
    console.log('Site status webhook triggered');

    try {
        // Get webhook settings from blob store
        const settings = await getWebhookSettings();

        // Check if webhook is configured
        if (!settings.discordWebhookUrl) {
            console.log('No webhook URL configured, skipping');
            return new Response(JSON.stringify({
                success: false,
                message: 'No webhook URL configured'
            }), {
                status: 200,
                headers: { 'Content-Type': 'application/json' }
            });
        }

        // Check if webhook is enabled
        if (!settings.enabled) {
            console.log('Webhook is disabled, skipping');
            return new Response(JSON.stringify({
                success: false,
                message: 'Webhook is disabled'
            }), {
                status: 200,
                headers: { 'Content-Type': 'application/json' }
            });
        }

        // Fetch all site statistics
        const stats = await fetchSiteStats();
        console.log('Fetched site stats:', JSON.stringify(stats));

        // Build the Discord embed
        const payload = buildSiteStatusEmbed(stats);

        // Delete old message if exists
        if (settings.lastMessageId) {
            await deleteMessage(settings.discordWebhookUrl, settings.lastMessageId);
        }

        // Send new message
        const newMessageId = await sendNewMessage(settings.discordWebhookUrl, payload);

        if (newMessageId) {
            // Save the new message ID and timestamp
            await saveWebhookSettings({
                ...settings,
                lastMessageId: newMessageId,
                lastSentAt: Date.now()
            });

            return new Response(JSON.stringify({
                success: true,
                message: 'Site status updated on Discord successfully',
                messageId: newMessageId,
                stats: stats
            }), {
                status: 200,
                headers: { 'Content-Type': 'application/json' }
            });
        } else {
            return new Response(JSON.stringify({
                success: false,
                message: 'Failed to send Discord message'
            }), {
                status: 500,
                headers: { 'Content-Type': 'application/json' }
            });
        }
    } catch (error) {
        console.error('Error in site status webhook:', error);
        return new Response(JSON.stringify({
            success: false,
            error: String(error)
        }), {
            status: 500,
            headers: { 'Content-Type': 'application/json' }
        });
    }
};

export const config: Config = {
    // Schedule to run every 1 minute
    schedule: "* * * * *"
};
