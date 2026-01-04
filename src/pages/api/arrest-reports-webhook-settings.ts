import type { APIRoute } from 'astro';
import { getStore } from '@netlify/blobs';
import { extractUserFromSession, checkPermission } from '../../utils/discord-webhook';

export const prerender = false;

export interface ArrestReportsWebhookSettings {
    discordWebhookUrl: string;
    enabled: boolean;
}

const WEBHOOK_STORE_NAME = 'arrest-reports-webhook-settings';

function getWebhookStore() {
    return getStore({ name: WEBHOOK_STORE_NAME, consistency: 'strong' });
}

export async function getArrestReportsWebhookSettings(): Promise<ArrestReportsWebhookSettings> {
    try {
        const store = getWebhookStore();
        const data = await store.get('settings', { type: 'json' });
        if (data) {
            return data as ArrestReportsWebhookSettings;
        }
        // Return defaults (with the legacy hardcoded URL for backward compatibility)
        return {
            discordWebhookUrl: 'https://discord.com/api/webhooks/1363111869274919052/B6yYvryNHl9pCRBqX5JkHe0YHxMfU2fNkeeRWtuThNJBxtig0VJUTaJpQBF3BCQAYK-e',
            enabled: true
        };
    } catch (error) {
        console.error('Error fetching arrest reports webhook settings:', error);
        return {
            discordWebhookUrl: 'https://discord.com/api/webhooks/1363111869274919052/B6yYvryNHl9pCRBqX5JkHe0YHxMfU2fNkeeRWtuThNJBxtig0VJUTaJpQBF3BCQAYK-e',
            enabled: true
        };
    }
}

async function saveWebhookSettings(settings: ArrestReportsWebhookSettings): Promise<void> {
    const store = getWebhookStore();
    await store.setJSON('settings', settings);
}

// Verify user has arrest-reports permission
async function verifyPermission(request: Request): Promise<{ valid: boolean; error?: string; user?: any }> {
    try {
        const user = await extractUserFromSession(request);
        if (!user) {
            return { valid: false, error: 'Not authenticated' };
        }
        if (!checkPermission(user, 'arrest-reports')) {
            return { valid: false, error: 'Arrest reports permission required' };
        }
        return { valid: true, user };
    } catch {
        return { valid: false, error: 'Session validation failed' };
    }
}

export const GET: APIRoute = async ({ request }) => {
    const auth = await verifyPermission(request);
    if (!auth.valid) {
        return new Response(JSON.stringify({ success: false, error: auth.error }), {
            status: 403,
            headers: { 'Content-Type': 'application/json' }
        });
    }

    const settings = await getArrestReportsWebhookSettings();
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
    const auth = await verifyPermission(request);
    if (!auth.valid) {
        return new Response(JSON.stringify({ success: false, error: auth.error }), {
            status: 403,
            headers: { 'Content-Type': 'application/json' }
        });
    }

    try {
        const data = await request.json();
        const currentSettings = await getArrestReportsWebhookSettings();

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
                discordWebhookUrl: newUrl
            });

            return new Response(JSON.stringify({
                success: true,
                message: 'Webhook URL updated'
            }), {
                status: 200,
                headers: { 'Content-Type': 'application/json' }
            });
        }

        if (data.action === 'test') {
            // Send a test message to the webhook
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

            try {
                const testPayload = {
                    content: '🔔 **Arrest Reports Webhook Test**',
                    embeds: [{
                        title: '✅ Webhook Connection Successful',
                        description: 'This is a test message from the Del Perro Police Department Officer Hub. Your arrest reports webhook is configured correctly.',
                        color: 0x00FF00,
                        timestamp: new Date().toISOString(),
                        footer: { text: 'Arrest Reports Webhook Test' }
                    }]
                };

                const response = await fetch(webhookUrl, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(testPayload)
                });

                if (!response.ok) {
                    const errorText = await response.text();
                    throw new Error(`Discord API error: ${response.status} - ${errorText}`);
                }

                return new Response(JSON.stringify({
                    success: true,
                    message: 'Test message sent successfully'
                }), {
                    status: 200,
                    headers: { 'Content-Type': 'application/json' }
                });
            } catch (error) {
                return new Response(JSON.stringify({
                    success: false,
                    error: `Failed to send test message: ${error}`
                }), {
                    status: 500,
                    headers: { 'Content-Type': 'application/json' }
                });
            }
        }

        return new Response(JSON.stringify({
            success: false,
            error: 'Unknown action'
        }), {
            status: 400,
            headers: { 'Content-Type': 'application/json' }
        });
    } catch (error) {
        console.error('Error in arrest reports webhook settings:', error);
        return new Response(JSON.stringify({
            success: false,
            error: 'Failed to process request'
        }), {
            status: 500,
            headers: { 'Content-Type': 'application/json' }
        });
    }
};
