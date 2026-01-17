import type { APIRoute } from 'astro';
import { getStore } from '@netlify/blobs';
import { extractUserFromSession, checkPermission } from '../../utils/discord-webhook';

export const prerender = false;

// Types for webhook configuration
export interface ChainOfCommandConfig {
    webhookUrl: string;
    logoUrl: string;
    headerTitle: string;
    headerDescription: string;
    footerTitle: string;
    footerDescription: string;
    footerText: string;
    protocolTitle: string;
    protocolMessage: string;
    colors: {
        departmentLiaisons: number;
        highCommand: number;
        trialHighCommand: number;
        lowCommand: number;
        trialLowCommand: number;
        supervisors: number;
        trialSupervisor: number;
        officers: number;
        reserves: number;
        cadets: number;
        warning: number;
        footer: number;
    };
}

export interface SubdivisionLeadershipConfig {
    webhookUrl: string;
    logoUrl: string;
    overseerTitle: string;
    leadershipTitle: string;
    assistantHeadTitle: string;
    footerTitle: string;
    footerDescription: string;
    footerText: string;
    colors: {
        overseer: number;
        subdivision: number;
        assistantHead: number;
        footer: number;
    };
}

export interface WebhookConfig {
    chainOfCommand: ChainOfCommandConfig;
    subdivisionLeadership: SubdivisionLeadershipConfig;
}

// Default configuration
export const DEFAULT_WEBHOOK_CONFIG: WebhookConfig = {
    chainOfCommand: {
        webhookUrl: '',
        logoUrl: 'https://delperro.netlify.app/images/DPPD_Seal_3.png',
        headerTitle: 'DPPD Chain of Command',
        headerDescription: 'Official Chain of Command for the Del Perro Police Department',
        footerTitle: 'Del Perro Police Department',
        footerDescription: '*Protecting and serving the citizens of Del Perro*',
        footerText: 'DPPD Chain of Command | Manual Updates',
        protocolTitle: 'Chain of Command Protocol',
        protocolMessage: `**At no time should the order of the chain of command be skipped in any shape or form, unless you have spoken to all options.**

**Examples of this would be:**

A probationary officer going to an of the higher officers to learn, then going to supervisors, then low command then high

**Never should you ever skip this chain of command unless it is an urgent emergency.**

*DPPD | High Command Team*`,
        colors: {
            departmentLiaisons: 0xf43f5e,  // Rose/pink color
            highCommand: 0x0d9488,
            trialHighCommand: 0x06b6d4,
            lowCommand: 0x3b82f6,
            trialLowCommand: 0x6366f1,
            supervisors: 0xa855f7,
            trialSupervisor: 0x8b5cf6,
            officers: 0xf59e0b,
            reserves: 0x84cc16,
            cadets: 0x22c55e,
            warning: 0xfbbf24,
            footer: 0x14b8a6,
        }
    },
    subdivisionLeadership: {
        webhookUrl: '',
        logoUrl: 'https://delperro.netlify.app/images/DPPD_Seal_3.png',
        overseerTitle: 'Subdivision Overseer',
        leadershipTitle: 'Subdivision Leadership',
        assistantHeadTitle: 'Assistant Head of Subdivisions',
        footerTitle: 'Del Perro Police Department',
        footerDescription: '*Subdivision Leadership*',
        footerText: 'DPPD Subdivision Leadership | Manual Updates',
        colors: {
            overseer: 0x0d9488,
            subdivision: 0x3b82f6,
            assistantHead: 0x06b6d4,
            footer: 0x14b8a6,
        }
    }
};

/**
 * Get webhook configuration from blob store
 */
async function getWebhookConfig(): Promise<WebhookConfig> {
    try {
        const store = getStore({ name: 'webhook-config', consistency: 'strong' });
        const data = await store.get('config', { type: 'json' }) as WebhookConfig | null;
        if (data) {
            // Merge with defaults to ensure all fields exist
            return {
                chainOfCommand: { ...DEFAULT_WEBHOOK_CONFIG.chainOfCommand, ...data.chainOfCommand },
                subdivisionLeadership: { ...DEFAULT_WEBHOOK_CONFIG.subdivisionLeadership, ...data.subdivisionLeadership }
            };
        }
        return DEFAULT_WEBHOOK_CONFIG;
    } catch (error) {
        console.error('Error fetching webhook config:', error);
        return DEFAULT_WEBHOOK_CONFIG;
    }
}

/**
 * Save webhook configuration to blob store
 */
async function saveWebhookConfig(config: WebhookConfig): Promise<void> {
    const store = getStore({ name: 'webhook-config', consistency: 'strong' });
    await store.setJSON('config', config);
}

// GET - Get current webhook configuration
export const GET: APIRoute = async ({ request }) => {
    // Validate session server-side
    const user = await extractUserFromSession(request);

    if (!user) {
        return new Response(JSON.stringify({ success: false, error: 'Unauthorized' }), {
            status: 401,
            headers: { 'Content-Type': 'application/json' }
        });
    }

    // Check if user has relevant permissions
    const hasAccess = checkPermission(user, 'chain-of-command-webhook') ||
                      checkPermission(user, 'subdivision-leadership-webhook') ||
                      checkPermission(user, 'subdivisions') ||
                      user.role === 'super_admin';

    if (!hasAccess) {
        return new Response(JSON.stringify({ success: false, error: 'Forbidden' }), {
            status: 403,
            headers: { 'Content-Type': 'application/json' }
        });
    }

    try {
        const config = await getWebhookConfig();

        // Mask webhook URLs for non-super admins (show only last 8 chars)
        const safeConfig = { ...config };
        if (user.role !== 'super_admin') {
            if (safeConfig.chainOfCommand.webhookUrl) {
                safeConfig.chainOfCommand.webhookUrl = '***' + safeConfig.chainOfCommand.webhookUrl.slice(-8);
            }
            if (safeConfig.subdivisionLeadership.webhookUrl) {
                safeConfig.subdivisionLeadership.webhookUrl = '***' + safeConfig.subdivisionLeadership.webhookUrl.slice(-8);
            }
        }

        return new Response(JSON.stringify({
            success: true,
            config: safeConfig
        }), {
            status: 200,
            headers: { 'Content-Type': 'application/json' }
        });
    } catch (error) {
        console.error('Error getting webhook config:', error);
        return new Response(JSON.stringify({
            success: false,
            error: 'Failed to get webhook configuration'
        }), {
            status: 500,
            headers: { 'Content-Type': 'application/json' }
        });
    }
};

// POST - Update webhook configuration
export const POST: APIRoute = async ({ request }) => {
    // Validate session server-side
    const user = await extractUserFromSession(request);

    if (!user) {
        return new Response(JSON.stringify({ success: false, error: 'Unauthorized' }), {
            status: 401,
            headers: { 'Content-Type': 'application/json' }
        });
    }

    // Only super admins can update webhook configuration
    if (user.role !== 'super_admin') {
        return new Response(JSON.stringify({ success: false, error: 'Forbidden - Super Admin access required' }), {
            status: 403,
            headers: { 'Content-Type': 'application/json' }
        });
    }

    try {
        const body = await request.json();
        const { type, config: newConfig } = body;

        if (!type || !newConfig) {
            return new Response(JSON.stringify({
                success: false,
                error: 'Type and config are required'
            }), {
                status: 400,
                headers: { 'Content-Type': 'application/json' }
            });
        }

        const currentConfig = await getWebhookConfig();

        if (type === 'chainOfCommand') {
            // Validate webhook URL format if provided
            if (newConfig.webhookUrl && !newConfig.webhookUrl.startsWith('https://discord.com/api/webhooks/')) {
                return new Response(JSON.stringify({
                    success: false,
                    error: 'Invalid webhook URL format'
                }), {
                    status: 400,
                    headers: { 'Content-Type': 'application/json' }
                });
            }

            currentConfig.chainOfCommand = {
                ...currentConfig.chainOfCommand,
                ...newConfig
            };
        } else if (type === 'subdivisionLeadership') {
            // Validate webhook URL format if provided
            if (newConfig.webhookUrl && !newConfig.webhookUrl.startsWith('https://discord.com/api/webhooks/')) {
                return new Response(JSON.stringify({
                    success: false,
                    error: 'Invalid webhook URL format'
                }), {
                    status: 400,
                    headers: { 'Content-Type': 'application/json' }
                });
            }

            currentConfig.subdivisionLeadership = {
                ...currentConfig.subdivisionLeadership,
                ...newConfig
            };
        } else {
            return new Response(JSON.stringify({
                success: false,
                error: 'Invalid type. Must be "chainOfCommand" or "subdivisionLeadership"'
            }), {
                status: 400,
                headers: { 'Content-Type': 'application/json' }
            });
        }

        await saveWebhookConfig(currentConfig);

        return new Response(JSON.stringify({
            success: true,
            message: 'Webhook configuration updated successfully'
        }), {
            status: 200,
            headers: { 'Content-Type': 'application/json' }
        });
    } catch (error) {
        console.error('Error updating webhook config:', error);
        return new Response(JSON.stringify({
            success: false,
            error: 'Failed to update webhook configuration'
        }), {
            status: 500,
            headers: { 'Content-Type': 'application/json' }
        });
    }
};
