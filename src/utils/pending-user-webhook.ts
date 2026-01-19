/**
 * Pending User Webhook Notification Utility
 *
 * Sends Discord notifications when new users register and are pending approval.
 * This utility can be called from both:
 * - Immediately when a new user registers (via google-oauth.ts)
 * - The scheduled function as a fallback (via pending-approvals-webhook.mts)
 */

import { getStore } from '@netlify/blobs';

const PENDING_APPROVALS_STORE = 'pending-approvals-webhook';

// The Discord webhook URL for pending approvals notifications
const PENDING_APPROVALS_WEBHOOK_URL = 'https://discord.com/api/webhooks/1462559557342593094/4kPnCBS9kEf-QqxHg_oetaemL7fl0vzBz2d3SxltgovJiBVhYlWLomawGQKRKuC5hSkl';

export interface PendingUser {
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

/**
 * Get current webhook settings from blob store
 */
export async function getWebhookSettings(): Promise<WebhookSettings> {
    const settingsStore = getStore({ name: PENDING_APPROVALS_STORE, consistency: 'strong' });
    let settings = await settingsStore.get('settings', { type: 'json' }) as WebhookSettings | null;

    if (!settings) {
        settings = {
            lastNotifiedUsers: [],
            lastCheckedAt: null
        };
    }

    return settings;
}

/**
 * Save webhook settings to blob store
 */
export async function saveWebhookSettings(settings: WebhookSettings): Promise<void> {
    const settingsStore = getStore({ name: PENDING_APPROVALS_STORE, consistency: 'strong' });
    await settingsStore.setJSON('settings', settings);
}

/**
 * Add a user ID to the list of notified users
 */
export async function markUserAsNotified(userId: string): Promise<void> {
    const settings = await getWebhookSettings();
    if (!settings.lastNotifiedUsers.includes(userId)) {
        settings.lastNotifiedUsers.push(userId);
        settings.lastCheckedAt = Date.now();
        await saveWebhookSettings(settings);
    }
}

/**
 * Check if a user has already been notified
 */
export async function hasBeenNotified(userId: string): Promise<boolean> {
    const settings = await getWebhookSettings();
    return settings.lastNotifiedUsers.includes(userId);
}

/**
 * Get the base URL for the site
 */
function getSiteUrl(): string {
    // Try environment variables first
    if (typeof process !== 'undefined' && process.env?.URL) {
        return process.env.URL;
    }
    if (typeof process !== 'undefined' && process.env?.DEPLOY_PRIME_URL) {
        return process.env.DEPLOY_PRIME_URL;
    }
    // Fall back to production URL
    return 'https://delperro.netlify.app';
}

/**
 * Send a Discord notification for a new pending user
 * This is called immediately when a new user registers
 */
export async function notifyNewPendingUser(user: PendingUser): Promise<boolean> {
    try {
        // Check if already notified (to prevent duplicate notifications)
        const alreadyNotified = await hasBeenNotified(user.id);
        if (alreadyNotified) {
            console.log(`User ${user.id} has already been notified`);
            return true;
        }

        // Generate approval link
        const siteUrl = getSiteUrl();
        const approvalLink = `${siteUrl}/api/intel/user-approve?id=${encodeURIComponent(user.id)}`;

        // Build the Discord embed for a single user
        const embed = {
            title: "New User Awaiting Clearance Approval",
            description: "A new user has registered and is pending clearance approval.\n\n**[Click here to approve or deny](" + approvalLink + ")**",
            color: 0xFFAA00, // Orange/amber color for pending
            fields: [
                {
                    name: user.callsign && user.officerName
                        ? `${user.callsign} | ${user.officerName}`
                        : user.name || user.email,
                    value: [
                        `**Email:** ${user.email}`,
                        user.discordId ? `**Discord:** ${user.discordUsername || 'N/A'} (${user.discordId})` : '',
                        user.badgeNumber ? `**Badge:** ${user.badgeNumber}` : '',
                        `**Registered:** <t:${Math.floor(user.createdAt / 1000)}:R>`
                    ].filter(Boolean).join('\n'),
                    inline: false
                }
            ],
            thumbnail: user.picture ? { url: user.picture } : undefined,
            footer: {
                text: "Intel System - Pending Approval Notification"
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
            return false;
        }

        // Mark user as notified
        await markUserAsNotified(user.id);
        console.log(`Successfully notified about new pending user: ${user.email}`);
        return true;

    } catch (error) {
        console.error('Error sending pending user notification:', error);
        return false;
    }
}

/**
 * Send a Discord notification for multiple pending users
 * This is used by the scheduled function for batch notifications
 */
export async function notifyMultiplePendingUsers(users: PendingUser[], totalPending: number): Promise<boolean> {
    if (users.length === 0) {
        return true;
    }

    try {
        const siteUrl = getSiteUrl();

        // Build the Discord embed
        const embed = {
            title: "New Pending Clearance Approvals",
            description: `There ${users.length === 1 ? 'is' : 'are'} **${users.length}** new user${users.length === 1 ? '' : 's'} awaiting clearance approval.\n\nClick on a user's name to approve or deny their access.`,
            color: 0xFFAA00, // Orange/amber color for pending
            fields: users.slice(0, 25).map(user => {
                const approvalLink = `${siteUrl}/api/intel/user-approve?id=${encodeURIComponent(user.id)}`;
                const userName = user.callsign && user.officerName
                    ? `${user.callsign} | ${user.officerName}`
                    : user.name || user.email;
                return {
                    name: `[${userName}](${approvalLink})`,
                    value: [
                        `**Email:** ${user.email}`,
                        user.discordId ? `**Discord:** ${user.discordUsername || 'N/A'} (${user.discordId})` : '',
                        user.badgeNumber ? `**Badge:** ${user.badgeNumber}` : '',
                        `**Registered:** <t:${Math.floor(user.createdAt / 1000)}:R>`
                    ].filter(Boolean).join('\n'),
                    inline: true
                };
            }),
            footer: {
                text: `Total pending: ${totalPending} user${totalPending === 1 ? '' : 's'}`
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
            return false;
        }

        console.log(`Notified about ${users.length} new pending users`);
        return true;

    } catch (error) {
        console.error('Error sending pending users notification:', error);
        return false;
    }
}

/**
 * Send an updated Discord notification when a pending user completes their profile
 * This notifies approvers with the user's Discord info so they can identify them
 */
export async function updatePendingUserNotification(user: PendingUser): Promise<boolean> {
    try {
        // Generate approval link
        const siteUrl = getSiteUrl();
        const approvalLink = `${siteUrl}/api/intel/user-approve?id=${encodeURIComponent(user.id)}`;

        // Build the Discord embed for profile update
        const embed = {
            title: "Pending User Profile Updated",
            description: "A pending user has completed their profile information.\n\n**[Click here to approve or deny](" + approvalLink + ")**",
            color: 0x00AAFF, // Blue color for profile update
            fields: [
                {
                    name: user.callsign && user.officerName
                        ? `${user.callsign} | ${user.officerName}`
                        : user.name || user.email,
                    value: [
                        `**Email:** ${user.email}`,
                        user.discordId ? `**Discord:** ${user.discordUsername || 'N/A'} (<@${user.discordId}>)` : '',
                        user.badgeNumber ? `**Badge:** ${user.badgeNumber}` : '',
                        `**Registered:** <t:${Math.floor(user.createdAt / 1000)}:R>`
                    ].filter(Boolean).join('\n'),
                    inline: false
                }
            ],
            thumbnail: user.picture ? { url: user.picture } : undefined,
            footer: {
                text: "Intel System - Profile Update Notification"
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
            console.error('Failed to send Discord webhook for profile update:', await response.text());
            return false;
        }

        console.log(`Successfully notified about pending user profile update: ${user.email}`);
        return true;

    } catch (error) {
        console.error('Error sending profile update notification:', error);
        return false;
    }
}
