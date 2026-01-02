import type { APIRoute } from 'astro';
import { getStore } from '@netlify/blobs';

export const prerender = false;

// Webhook URL for subdivision leadership
const WEBHOOK_URL = 'https://discord.com/api/webhooks/1417131683144274011/yaZZquFoq962gjs2oFS_rNt13r12kz3o0zxO6v2GZLJbASZioQPgowx4aDIiUrRMGdcv';

// DPPD Logo URL
const DPPD_LOGO_URL = 'https://delperro.netlify.app/images/DPPD_Seal_3.png';

// Color scheme for embeds
const COLORS = {
    primary: 0x1e40af,       // Professional blue
    overseer: 0x0d9488,      // Teal for overseer
    subdivision: 0x3b82f6,   // Blue for subdivisions
    footer: 0x14b8a6,        // Teal for footer
};

interface WebhookState {
    lastMessageIds: string[];
    lastSentAt: number | null;
}

interface SubdivisionLeader {
    division: string;
    name: string;
    callSign: string;
    jobTitle: string;
    subdivisionId?: string;
    isLOA?: boolean;
    discordId?: string;
}

interface Subdivision {
    id: string;
    name: string;
    abbreviation: string;
    description: string;
    availability: 'tryouts' | 'open' | 'handpicked' | 'closed' | 'tryouts-handpicked';
    owner?: string;
    ownerCallSign?: string;
    imageUrls?: string[];
}

interface DepartmentData {
    subdivisionLeadership: SubdivisionLeader[];
}

/**
 * Get webhook state from blob store
 */
async function getWebhookState(): Promise<WebhookState> {
    try {
        const store = getStore({ name: 'subdivision-leadership-webhook', consistency: 'strong' });
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
        const store = getStore({ name: 'subdivision-leadership-webhook', consistency: 'strong' });
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
 * Get subdivisions data from blob store
 */
async function getSubdivisionsData(): Promise<Subdivision[]> {
    try {
        const store = getStore({ name: 'subdivisions', consistency: 'strong' });
        const data = await store.get('data', { type: 'json' }) as Subdivision[] | null;
        return data || [];
    } catch (error) {
        console.error('Error fetching subdivisions data:', error);
        return [];
    }
}

/**
 * Format a leader for Discord display with mention
 */
function formatLeader(name: string, callSign: string, subdivisionName: string, discordId?: string, isLOA?: boolean): string {
    if (!name && !callSign) return '*Vacant*';

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

    if (subdivisionName) {
        parts.push(`- *${subdivisionName}*`);
    }

    if (isLOA) {
        parts.push('`[LOA]`');
    }

    return parts.join(' ');
}

/**
 * Find the matching subdivision for a leader
 */
function findSubdivisionForLeader(leader: SubdivisionLeader, subdivisions: Subdivision[]): Subdivision | null {
    // First try to match by subdivisionId
    if (leader.subdivisionId) {
        const subdivision = subdivisions.find(s => s.id === leader.subdivisionId);
        if (subdivision) {
            return subdivision;
        }
    }

    // Fallback: match by name/abbreviation
    const normalizedDivision = leader.division.toLowerCase();

    for (const subdivision of subdivisions) {
        const normalizedSubName = subdivision.name.toLowerCase();
        const normalizedAbbrev = subdivision.abbreviation.toLowerCase();

        const abbreviationMatch = normalizedDivision.includes(normalizedAbbrev) ||
                                  normalizedAbbrev.includes(normalizedDivision.replace(' division', '').trim());
        const nameMatch = normalizedDivision.includes(normalizedSubName) ||
                         normalizedSubName.includes(normalizedDivision);
        const wordMatch = normalizedSubName.split(' ').some(word =>
            word.length > 2 && normalizedDivision.includes(word)
        );

        if (abbreviationMatch || nameMatch || wordMatch) {
            return subdivision;
        }
    }

    return null;
}

/**
 * Build embeds for subdivision leadership
 */
function buildSubdivisionLeadershipEmbeds(departmentData: DepartmentData, subdivisions: Subdivision[]): any[] {
    const embeds: any[] = [];
    const timestamp = new Date().toISOString();
    const leadership = departmentData.subdivisionLeadership || [];

    // Find the Subdivision Overseer (should be first entry)
    const overseer = leadership.find(l =>
        l.division.toLowerCase().includes('overseer') ||
        l.division.toLowerCase() === 'subdivision overseer'
    );

    // Subdivision Overseer embed
    if (overseer) {
        const overseerLine = formatLeader(
            overseer.name,
            overseer.callSign,
            'Subdivision Overseer',
            overseer.discordId,
            overseer.isLOA
        );

        embeds.push({
            title: 'Subdivision Overseer',
            description: overseerLine,
            color: COLORS.overseer,
            timestamp: timestamp
        });
    }

    // Subdivision Leaders
    const subdivisionLeaders = leadership.filter(l => {
        const normalizedDiv = l.division.toLowerCase();
        return !normalizedDiv.includes('overseer') || normalizedDiv !== 'subdivision overseer';
    });

    if (subdivisionLeaders.length > 0) {
        const leaderLines: string[] = [];

        for (const leader of subdivisionLeaders) {
            // Find the matching subdivision to get the proper name
            const subdivision = findSubdivisionForLeader(leader, subdivisions);
            const subdivisionDisplayName = subdivision
                ? (subdivision.abbreviation ? `${subdivision.name} (${subdivision.abbreviation})` : subdivision.name)
                : leader.division;

            const leaderLine = formatLeader(
                leader.name,
                leader.callSign,
                subdivisionDisplayName,
                leader.discordId,
                leader.isLOA
            );

            leaderLines.push(`**${subdivisionDisplayName}**\n${leaderLine}`);
        }

        if (leaderLines.length > 0) {
            embeds.push({
                title: 'Subdivision Leadership',
                description: leaderLines.join('\n\n'),
                color: COLORS.subdivision,
                timestamp: timestamp
            });
        }
    }

    // Footer with DPPD Logo
    embeds.push({
        title: 'Del Perro Police Department',
        description: '*Subdivision Leadership*',
        color: COLORS.footer,
        image: {
            url: DPPD_LOGO_URL
        },
        footer: {
            text: 'DPPD Subdivision Leadership | Manual Updates',
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
 * Uses strict sequential execution with retry logic to ensure correct order
 */
async function sendEmbeds(embeds: any[]): Promise<string[]> {
    const messageIds: string[] = [];

    // Send embeds one at a time in strict order
    // Each embed must be confirmed sent before the next one starts
    for (let i = 0; i < embeds.length; i++) {
        const embed = embeds[i];
        let success = false;
        let retries = 0;
        const maxRetries = 3;

        while (!success && retries < maxRetries) {
            try {
                // Wait before sending (longer delay to ensure Discord processes in order)
                // Skip delay for first message
                if (i > 0 || retries > 0) {
                    await new Promise(resolve => setTimeout(resolve, 1000));
                }

                const response = await fetch(`${WEBHOOK_URL}?wait=true`, {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json'
                    },
                    body: JSON.stringify({ embeds: [embed] })
                });

                // Handle rate limiting
                if (response.status === 429) {
                    const rateLimitData = await response.json();
                    const retryAfter = (rateLimitData.retry_after || 1) * 1000;
                    console.log(`Rate limited, waiting ${retryAfter}ms before retry`);
                    await new Promise(resolve => setTimeout(resolve, retryAfter));
                    retries++;
                    continue;
                }

                if (!response.ok) {
                    const errorText = await response.text();
                    console.error('Discord webhook error:', response.status, errorText);
                    retries++;
                    continue;
                }

                const message = await response.json();
                if (message.id) {
                    messageIds.push(message.id);
                    console.log(`Sent embed ${i + 1}/${embeds.length} with message ID:`, message.id);
                    success = true;
                } else {
                    console.error('No message ID returned from Discord');
                    retries++;
                }
            } catch (error) {
                console.error(`Failed to send embed ${i + 1}:`, error);
                retries++;
            }
        }

        // If we couldn't send this embed after retries, log but continue
        if (!success) {
            console.error(`Failed to send embed ${i + 1} after ${maxRetries} retries`);
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

        // Get subdivisions data
        const subdivisionsData = await getSubdivisionsData();

        // Build embeds
        const embeds = buildSubdivisionLeadershipEmbeds(departmentData, subdivisionsData);

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
                message: 'Subdivision leadership updated on Discord successfully',
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
