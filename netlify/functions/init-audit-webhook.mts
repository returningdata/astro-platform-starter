/**
 * Audit Log Webhook Initialization
 *
 * This serverless function initializes the audit log webhook URL in the blob store.
 * It should be called once during deployment or setup to configure the webhook.
 */

import type { Context } from "@netlify/functions";
import { getStore } from "@netlify/blobs";

const AUDIT_LOG_STORE_NAME = 'audit-log-settings';

interface AuditLogSettings {
    discordWebhookUrl: string;
    enabled: boolean;
}

export default async (req: Request, context: Context) => {
    // Only allow POST requests
    if (req.method !== 'POST') {
        return new Response(JSON.stringify({
            success: false,
            error: 'Method not allowed'
        }), {
            status: 405,
            headers: { 'Content-Type': 'application/json' }
        });
    }

    try {
        const data = await req.json();
        const webhookUrl = data.webhookUrl;

        // Validate webhook URL
        if (!webhookUrl || !webhookUrl.startsWith('https://discord.com/api/webhooks/')) {
            return new Response(JSON.stringify({
                success: false,
                error: 'Invalid Discord webhook URL format'
            }), {
                status: 400,
                headers: { 'Content-Type': 'application/json' }
            });
        }

        // Get current settings
        const store = getStore({ name: AUDIT_LOG_STORE_NAME, consistency: 'strong' });
        let currentSettings: AuditLogSettings;

        try {
            const existing = await store.get('settings', { type: 'json' }) as AuditLogSettings | null;
            currentSettings = existing || { discordWebhookUrl: '', enabled: true };
        } catch {
            currentSettings = { discordWebhookUrl: '', enabled: true };
        }

        // Update settings
        const newSettings: AuditLogSettings = {
            ...currentSettings,
            discordWebhookUrl: webhookUrl,
            enabled: true
        };

        await store.setJSON('settings', newSettings);

        // Send a test message to verify
        try {
            const testPayload = {
                embeds: [{
                    title: '✅ Audit Log Webhook Configured',
                    description: 'The audit logging webhook has been successfully configured for the DPPD Admin Panel.',
                    color: 0x00FF00,
                    timestamp: new Date().toISOString(),
                    fields: [
                        {
                            name: '📋 Status',
                            value: 'Audit logging is now active',
                            inline: true
                        },
                        {
                            name: '🔔 Events Logged',
                            value: 'Login attempts, user management, data changes',
                            inline: true
                        }
                    ],
                    footer: {
                        text: 'DPPD Admin Panel | Audit Logging System'
                    }
                }]
            };

            const response = await fetch(webhookUrl, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(testPayload)
            });

            if (!response.ok) {
                console.error('Test message failed:', response.status);
            }
        } catch (error) {
            console.error('Failed to send test message:', error);
        }

        return new Response(JSON.stringify({
            success: true,
            message: 'Audit log webhook configured successfully'
        }), {
            status: 200,
            headers: { 'Content-Type': 'application/json' }
        });
    } catch (error) {
        console.error('Error initializing audit log webhook:', error);
        return new Response(JSON.stringify({
            success: false,
            error: String(error)
        }), {
            status: 500,
            headers: { 'Content-Type': 'application/json' }
        });
    }
};
