import { getStore } from "@netlify/blobs";
import type { Config } from "@netlify/functions";

const INTEL_USERS_STORE = 'intel-users';
const PENDING_APPROVALS_STORE = 'pending-approvals-webhook';

// The Discord webhook URL for pending approvals notifications
const PENDING_APPROVALS_WEBHOOK_URL = 'https://discord.com/api/webhooks/1462559557342593094/4kPnCBS9kEf-QqxHg_oetaemL7fl0vzBz2d3SxltgovJiBVhYlWLomawGQKRKuC5hSkl';

interface IntelUser {
    id: string;
    email: string;
    name: string;
    picture?: string;
    clearanceLevel: string;
    createdAt: number;
    lastLogin: number;
    discordUsername?: string;
    discordId?: string;
    officerName?: string;
    callsign?: string;
    badgeNumber?: string;
}

interface WebhookSettings {
    lastNotifiedUsers: string[];
    lastCheckedAt: number | null;
}

export default async function handler() {
    try {
        // Get the settings store
        const settingsStore = getStore({ name: PENDING_APPROVALS_STORE, consistency: 'strong' });
        let settings = await settingsStore.get('settings', { type: 'json' }) as WebhookSettings | null;

        if (!settings) {
            settings = {
                lastNotifiedUsers: [],
                lastCheckedAt: null
            };
        }

        // Get all intel users
        const usersStore = getStore({ name: INTEL_USERS_STORE, consistency: 'strong' });
        const { blobs } = await usersStore.list();

        const pendingUsers: IntelUser[] = [];

        for (const blob of blobs) {
            const user = await usersStore.get(blob.key, { type: 'json' }) as IntelUser | null;
            if (user && user.clearanceLevel === 'pending') {
                pendingUsers.push(user);
            }
        }

        // Find newly pending users (not previously notified)
        const newPendingUsers = pendingUsers.filter(user =>
            !settings!.lastNotifiedUsers.includes(user.id)
        );

        if (newPendingUsers.length > 0) {
            // Build the Discord embed
            const embed = {
                title: "New Pending Clearance Approvals",
                description: `There ${newPendingUsers.length === 1 ? 'is' : 'are'} **${newPendingUsers.length}** new user${newPendingUsers.length === 1 ? '' : 's'} awaiting clearance approval.`,
                color: 0xFFAA00, // Orange/amber color for pending
                fields: newPendingUsers.slice(0, 25).map(user => ({
                    name: user.callsign && user.officerName
                        ? `${user.callsign} | ${user.officerName}`
                        : user.name || user.email,
                    value: [
                        `**Email:** ${user.email}`,
                        user.discordId ? `**Discord:** ${user.discordUsername || 'N/A'} (${user.discordId})` : '',
                        user.badgeNumber ? `**Badge:** ${user.badgeNumber}` : '',
                        `**Registered:** <t:${Math.floor(user.createdAt / 1000)}:R>`
                    ].filter(Boolean).join('\n'),
                    inline: true
                })),
                footer: {
                    text: `Total pending: ${pendingUsers.length} user${pendingUsers.length === 1 ? '' : 's'}`
                },
                timestamp: new Date().toISOString()
            };

            // Send to Discord webhook
            const response = await fetch(PENDING_APPROVALS_WEBHOOK_URL, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({
                    embeds: [embed]
                })
            });

            if (!response.ok) {
                console.error('Failed to send Discord webhook:', await response.text());
            } else {
                console.log(`Notified about ${newPendingUsers.length} new pending users`);
            }
        }

        // Update the settings with all current pending user IDs
        settings.lastNotifiedUsers = pendingUsers.map(u => u.id);
        settings.lastCheckedAt = Date.now();
        await settingsStore.setJSON('settings', settings);

        return new Response(JSON.stringify({
            success: true,
            pendingCount: pendingUsers.length,
            newNotifications: newPendingUsers.length
        }), {
            status: 200,
            headers: { 'Content-Type': 'application/json' }
        });
    } catch (error) {
        console.error('Error in pending approvals webhook:', error);
        return new Response(JSON.stringify({ error: 'Failed to check pending approvals' }), {
            status: 500,
            headers: { 'Content-Type': 'application/json' }
        });
    }
}

// Run every 5 minutes to check for new pending users
export const config: Config = {
    schedule: "*/5 * * * *"
};
