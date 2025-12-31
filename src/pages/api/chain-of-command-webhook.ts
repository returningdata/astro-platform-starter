import type { APIRoute } from 'astro';
import { getStore } from '@netlify/blobs';

export const prerender = false;

// Webhook URL for chain of command
const WEBHOOK_URL = 'https://discord.com/api/webhooks/1416682696645541998/43pD9FZHnnWcCvdj35NdhxYAOAjS8agn4KbBDImDYDnA6kSfglmQ3im0otqr3gKkff1H';

// DPPD Logo URL
const DPPD_LOGO_URL = 'https://delperro.netlify.app/images/DPPD_Seal_3.png';

// Color scheme for embeds
const COLORS = {
    primary: 0x1e40af,       // Professional blue
    highCommand: 0x0d9488,   // Teal
    trialHighCommand: 0x06b6d4, // Cyan
    lowCommand: 0x3b82f6,    // Blue
    trialLowCommand: 0x6366f1, // Indigo
    supervisors: 0xa855f7,   // Purple
    trialSupervisor: 0x8b5cf6, // Violet
    officers: 0xf59e0b,      // Amber
    reserves: 0x84cc16,      // Lime
    cadets: 0x22c55e,        // Green
    warning: 0xfbbf24,       // Amber/Yellow for warning
    footer: 0x14b8a6,        // Teal for footer
};

interface WebhookState {
    lastMessageIds: string[];
    lastSentAt: number | null;
}

interface CommandPosition {
    rank: string;
    name: string;
    callSign: string;
    jobTitle: string;
    isLOA?: boolean;
    discordId?: string;
}

interface RankMember {
    name: string;
    callSign: string;
    jobTitle: string;
    isLOA?: boolean;
    discordId?: string;
}

interface RankPositions {
    rank: string;
    members: RankMember[];
    discordRoleId?: string;  // Discord role ID for role mentions in webhook
}

interface DepartmentData {
    commandPositions: CommandPosition[];
    rankPositions: RankPositions[];
}

/**
 * Get webhook state from blob store
 */
async function getWebhookState(): Promise<WebhookState> {
    try {
        const store = getStore({ name: 'chain-of-command-webhook', consistency: 'strong' });
        const data = await store.get('state', { type: 'json' }) as WebhookState | null;
        if (data) {
            return data;
        }
        return {
            lastMessageIds: [],
            lastSentAt: null
        };
    } catch (error) {
        console.error('Error fetching webhook state:', error);
        return {
            lastMessageIds: [],
            lastSentAt: null
        };
    }
}

/**
 * Save webhook state to blob store
 */
async function saveWebhookState(state: WebhookState): Promise<void> {
    try {
        const store = getStore({ name: 'chain-of-command-webhook', consistency: 'strong' });
        await store.setJSON('state', state);
    } catch (error) {
        console.error('Error saving webhook state:', error);
    }
}

/**
 * Get department data from blob store
 */
async function getDepartmentData(): Promise<DepartmentData | null> {
    try {
        const store = getStore({ name: 'department-data', consistency: 'strong' });
        const data = await store.get('department-data', { type: 'json' }) as DepartmentData | null;
        return data;
    } catch (error) {
        console.error('Error fetching department data:', error);
        return null;
    }
}

/**
 * Format a member for Discord display with mention
 */
function formatMember(name: string, callSign: string, jobTitle: string, discordId?: string, isLOA?: boolean): string {
    if (!name && !callSign) return '';

    const parts: string[] = [];

    // Add Discord mention if available
    if (discordId) {
        parts.push(`<@${discordId}>`);
    } else if (name) {
        parts.push(`**${name}**`);
    }

    if (callSign) {
        parts.push(`(${callSign})`);
    }

    if (jobTitle) {
        parts.push(`- *${jobTitle}*`);
    }

    if (isLOA) {
        parts.push('`[LOA]`');
    }

    return parts.join(' ');
}

/**
 * Format rank header with optional role mention
 */
function formatRankHeader(rank: string, discordRoleId?: string): string {
    if (discordRoleId) {
        return `**${rank}** <@&${discordRoleId}>`;
    }
    return `**${rank}**`;
}

/**
 * Format rank with role mention only (no individual names)
 * Used for lower ranks (Cadet through Sergeant First Class)
 */
function formatRankRoleOnly(rank: string, discordRoleId?: string): string {
    if (discordRoleId) {
        return `**${rank}** <@&${discordRoleId}>`;
    }
    return `**${rank}**`;
}

/**
 * Build embeds for chain of command
 */
function buildChainOfCommandEmbeds(data: DepartmentData): any[] {
    const embeds: any[] = [];
    const timestamp = new Date().toISOString();

    // High Command (Chief of Police through Lieutenant Colonel)
    const highCommandRanks = ['Chief of Police', 'Deputy Chief of Police', 'Assistant Chief of Police', 'Colonel', 'Lieutenant Colonel'];
    const highCommandMembers = data.commandPositions
        .filter(p => highCommandRanks.includes(p.rank))
        .map(p => {
            const formatted = formatMember(p.name, p.callSign, p.jobTitle, p.discordId, p.isLOA);
            return formatted ? `**${p.rank}**\n${formatted}` : `**${p.rank}**\n*Vacant*`;
        });

    if (highCommandMembers.length > 0) {
        embeds.push({
            title: 'High Command',
            description: highCommandMembers.join('\n\n'),
            color: COLORS.highCommand,
            timestamp: timestamp
        });
    }

    // Trial High Command (Commander)
    const trialHighCommandRanks = ['Commander'];
    const trialHighCommandMembers = data.commandPositions
        .filter(p => trialHighCommandRanks.includes(p.rank))
        .map(p => {
            const formatted = formatMember(p.name, p.callSign, p.jobTitle, p.discordId, p.isLOA);
            return formatted ? `**${p.rank}**\n${formatted}` : `**${p.rank}**\n*Vacant*`;
        });

    if (trialHighCommandMembers.length > 0) {
        embeds.push({
            title: 'Trial High Command',
            description: trialHighCommandMembers.join('\n\n'),
            color: COLORS.trialHighCommand,
            timestamp: timestamp
        });
    }

    // Low Command (Major, Captain, 1st Lieutenant, 2nd Lieutenant)
    const lowCommandRanks = ['Major', 'Captain', '1st Lieutenant', '2nd Lieutenant'];
    const lowCommandSections: string[] = [];

    for (const rank of lowCommandRanks) {
        const rankPos = data.rankPositions.find(rp => rp.rank === rank);
        if (rankPos && rankPos.members) {
            const filledMembers = rankPos.members.filter(m => m.name || m.callSign);
            if (filledMembers.length > 0) {
                const memberLines = filledMembers.map(m =>
                    formatMember(m.name, m.callSign, m.jobTitle, m.discordId, m.isLOA)
                ).filter(Boolean);
                if (memberLines.length > 0) {
                    lowCommandSections.push(`${formatRankHeader(rank, rankPos.discordRoleId)}\n${memberLines.join('\n')}`);
                }
            }
        }
    }

    if (lowCommandSections.length > 0) {
        embeds.push({
            title: 'Low Command',
            description: lowCommandSections.join('\n\n'),
            color: COLORS.lowCommand,
            timestamp: timestamp
        });
    }

    // Trial Low Command (Master Sergeant)
    const trialLowCommandRanks = ['Master Sergeant'];
    const trialLowCommandSections: string[] = [];

    for (const rank of trialLowCommandRanks) {
        const rankPos = data.rankPositions.find(rp => rp.rank === rank);
        if (rankPos && rankPos.members) {
            const filledMembers = rankPos.members.filter(m => m.name || m.callSign);
            if (filledMembers.length > 0) {
                const memberLines = filledMembers.map(m =>
                    formatMember(m.name, m.callSign, m.jobTitle, m.discordId, m.isLOA)
                ).filter(Boolean);
                if (memberLines.length > 0) {
                    trialLowCommandSections.push(`${formatRankHeader(rank, rankPos.discordRoleId)}\n${memberLines.join('\n')}`);
                }
            }
        }
    }

    if (trialLowCommandSections.length > 0) {
        embeds.push({
            title: 'Trial Low Command',
            description: trialLowCommandSections.join('\n\n'),
            color: COLORS.trialLowCommand,
            timestamp: timestamp
        });
    }

    // Supervisors (Sergeant First Class, Staff Sergeant, Sergeant)
    // These ranks show only the role mention, not individual member names
    const supervisorRanks = ['Sergeant First Class', 'Staff Sergeant', 'Sergeant'];
    const supervisorSections: string[] = [];

    for (const rank of supervisorRanks) {
        const rankPos = data.rankPositions.find(rp => rp.rank === rank);
        if (rankPos) {
            // Only show rank name and role mention (no individual names)
            supervisorSections.push(formatRankRoleOnly(rank, rankPos.discordRoleId));
        }
    }

    if (supervisorSections.length > 0) {
        embeds.push({
            title: 'Supervisors',
            description: supervisorSections.join('\n\n'),
            color: COLORS.supervisors,
            timestamp: timestamp
        });
    }

    // Trial Supervisor (Corporal)
    // These ranks show only the role mention, not individual member names
    const trialSupervisorRanks = ['Corporal'];
    const trialSupervisorSections: string[] = [];

    for (const rank of trialSupervisorRanks) {
        const rankPos = data.rankPositions.find(rp => rp.rank === rank);
        if (rankPos) {
            // Only show rank name and role mention (no individual names)
            trialSupervisorSections.push(formatRankRoleOnly(rank, rankPos.discordRoleId));
        }
    }

    if (trialSupervisorSections.length > 0) {
        embeds.push({
            title: 'Trial Supervisor',
            description: trialSupervisorSections.join('\n\n'),
            color: COLORS.trialSupervisor,
            timestamp: timestamp
        });
    }

    // Officers (Officer III, Officer II, Officer I, Probationary Officer)
    // These ranks show only the role mention, not individual member names
    const officerRanks = ['Officer III', 'Officer II', 'Officer I', 'Probationary Officer'];
    const officerSections: string[] = [];

    for (const rank of officerRanks) {
        const rankPos = data.rankPositions.find(rp => rp.rank === rank);
        if (rankPos) {
            // Only show rank name and role mention (no individual names)
            officerSections.push(formatRankRoleOnly(rank, rankPos.discordRoleId));
        }
    }

    if (officerSections.length > 0) {
        embeds.push({
            title: 'Officers',
            description: officerSections.join('\n\n'),
            color: COLORS.officers,
            timestamp: timestamp
        });
    }

    // Reserves (Reserve Officer)
    // These ranks show only the role mention, not individual member names
    const reserveRanks = ['Reserve Officer'];
    const reserveSections: string[] = [];

    for (const rank of reserveRanks) {
        const rankPos = data.rankPositions.find(rp => rp.rank === rank);
        if (rankPos) {
            // Only show rank name and role mention (no individual names)
            reserveSections.push(formatRankRoleOnly(rank, rankPos.discordRoleId));
        }
    }

    if (reserveSections.length > 0) {
        embeds.push({
            title: 'Reserves',
            description: reserveSections.join('\n\n'),
            color: COLORS.reserves,
            timestamp: timestamp
        });
    }

    // Cadets (Cadet)
    // These ranks show only the role mention, not individual member names
    const cadetRanks = ['Cadet'];
    const cadetSections: string[] = [];

    for (const rank of cadetRanks) {
        const rankPos = data.rankPositions.find(rp => rp.rank === rank);
        if (rankPos) {
            // Only show rank name and role mention (no individual names)
            cadetSections.push(formatRankRoleOnly(rank, rankPos.discordRoleId));
        }
    }

    if (cadetSections.length > 0) {
        embeds.push({
            title: 'Cadets',
            description: cadetSections.join('\n\n'),
            color: COLORS.cadets,
            timestamp: timestamp
        });
    }

    // Important Notice/Warning about skipping chain of command
    embeds.push({
        title: 'Chain of Command Protocol',
        description: [
            '**At no time should the order of the chain of command be skipped in any shape or form, unless you have spoken to all options.**',
            '',
            '**Examples of this would be:**',
            '',
            'A probationary officer going to an of the higher officers to learn, then going to supervisors, then low command then high',
            '',
            '**Never should you ever skip this chain of command unless it is an urgent emergency.**',
            '',
            '*DPPD | High Command Team*'
        ].join('\n'),
        color: COLORS.warning,
        timestamp: timestamp
    });

    // Footer with DPPD Logo
    embeds.push({
        title: 'Del Perro Police Department',
        description: '*Protecting and serving the citizens of Del Perro*',
        color: COLORS.footer,
        image: {
            url: DPPD_LOGO_URL
        },
        footer: {
            text: 'DPPD Chain of Command | Updates every 6 hours',
            icon_url: DPPD_LOGO_URL
        },
        timestamp: timestamp
    });

    return embeds;
}

/**
 * Delete existing webhook messages
 */
async function deleteMessages(messageIds: string[]): Promise<void> {
    for (const messageId of messageIds) {
        try {
            const deleteUrl = `${WEBHOOK_URL}/messages/${messageId}`;
            const response = await fetch(deleteUrl, {
                method: 'DELETE'
            });

            if (response.ok || response.status === 204) {
                console.log('Successfully deleted message:', messageId);
            } else if (response.status === 404) {
                console.log('Message already deleted or not found:', messageId);
            } else {
                console.error('Failed to delete message:', messageId, response.status);
            }
        } catch (error) {
            console.error('Error deleting message:', messageId, error);
        }
    }
}

/**
 * Send embeds to Discord and return message IDs
 */
async function sendEmbeds(embeds: any[]): Promise<string[]> {
    const messageIds: string[] = [];

    for (const embed of embeds) {
        try {
            const response = await fetch(`${WEBHOOK_URL}?wait=true`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({ embeds: [embed] })
            });

            if (!response.ok) {
                const errorText = await response.text();
                console.error('Discord webhook error:', response.status, errorText);
                continue;
            }

            const message = await response.json();
            if (message.id) {
                messageIds.push(message.id);
                console.log('Sent embed with message ID:', message.id);
            }

            // Small delay between messages to avoid rate limiting
            await new Promise(resolve => setTimeout(resolve, 500));
        } catch (error) {
            console.error('Failed to send embed:', error);
        }
    }

    return messageIds;
}

// GET - Get current webhook state
export const GET: APIRoute = async () => {
    try {
        const state = await getWebhookState();
        return new Response(JSON.stringify({
            success: true,
            ...state,
            lastSentFormatted: state.lastSentAt ? new Date(state.lastSentAt).toISOString() : null
        }), {
            status: 200,
            headers: { 'Content-Type': 'application/json' }
        });
    } catch (error) {
        console.error('Error getting webhook state:', error);
        return new Response(JSON.stringify({
            success: false,
            error: 'Failed to get webhook state'
        }), {
            status: 500,
            headers: { 'Content-Type': 'application/json' }
        });
    }
};

// POST - Force update (manual trigger)
export const POST: APIRoute = async () => {
    try {
        // Get current state
        const state = await getWebhookState();

        // Get department data
        const departmentData = await getDepartmentData();
        if (!departmentData) {
            return new Response(JSON.stringify({
                success: false,
                message: 'No department data found'
            }), {
                status: 400,
                headers: { 'Content-Type': 'application/json' }
            });
        }

        // Build embeds
        const embeds = buildChainOfCommandEmbeds(departmentData);

        // Delete old messages
        if (state.lastMessageIds && state.lastMessageIds.length > 0) {
            await deleteMessages(state.lastMessageIds);
        }

        // Send new messages
        const newMessageIds = await sendEmbeds(embeds);

        if (newMessageIds.length > 0) {
            // Save new state
            await saveWebhookState({
                lastMessageIds: newMessageIds,
                lastSentAt: Date.now()
            });

            return new Response(JSON.stringify({
                success: true,
                message: 'Chain of command updated on Discord successfully',
                messageCount: newMessageIds.length,
                lastSentAt: Date.now()
            }), {
                status: 200,
                headers: { 'Content-Type': 'application/json' }
            });
        } else {
            return new Response(JSON.stringify({
                success: false,
                message: 'Failed to send Discord messages'
            }), {
                status: 500,
                headers: { 'Content-Type': 'application/json' }
            });
        }
    } catch (error) {
        console.error('Error in force update:', error);
        return new Response(JSON.stringify({
            success: false,
            error: String(error)
        }), {
            status: 500,
            headers: { 'Content-Type': 'application/json' }
        });
    }
};
