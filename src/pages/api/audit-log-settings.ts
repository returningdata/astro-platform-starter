import type { APIRoute } from 'astro';
import { extractUserFromSession, saveAuditLogSettings, getAuditLogSettingsForApi } from '../../utils/discord-webhook';

export const prerender = false;

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

    const settings = await getAuditLogSettingsForApi();
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
        const currentSettings = await getAuditLogSettingsForApi();

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

            await saveAuditLogSettings({
                ...currentSettings,
                discordWebhookUrl: newUrl
            });

            return new Response(JSON.stringify({
                success: true,
                message: 'Audit log webhook URL updated'
            }), {
                status: 200,
                headers: { 'Content-Type': 'application/json' }
            });
        }

        if (data.action === 'toggle_enabled') {
            await saveAuditLogSettings({
                ...currentSettings,
                enabled: data.enabled !== false
            });

            return new Response(JSON.stringify({
                success: true,
                message: `Audit logging ${data.enabled !== false ? 'enabled' : 'disabled'}`
            }), {
                status: 200,
                headers: { 'Content-Type': 'application/json' }
            });
        }

        if (data.action === 'test') {
            // Test the webhook by sending a test message
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
                    embeds: [{
                        title: '🧪 Audit Log Test',
                        description: 'This is a test message from the DPPD Admin Panel audit logging system.',
                        color: 0x00FF00,
                        timestamp: new Date().toISOString(),
                        footer: {
                            text: 'DPPD Admin Panel | Audit Log Test'
                        }
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
        console.error('Error in audit log settings:', error);
        return new Response(JSON.stringify({
            success: false,
            error: 'Failed to process request'
        }), {
            status: 500,
            headers: { 'Content-Type': 'application/json' }
        });
    }
};
