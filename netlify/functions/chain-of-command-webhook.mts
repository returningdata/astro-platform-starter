/**
 * Chain of Command Discord Webhook
 *
 * Posts professional embeds explaining the Chain of Command to Discord.
 * Runs every 6 hours, deletes the old message, and reposts with fresh embeds.
 */

import type { Config } from "@netlify/functions";
import { getStore } from "@netlify/blobs";

// Webhook configuration
const DISCORD_WEBHOOK_URL = 'https://discord.com/api/webhooks/1416682696645541998/43pD9FZHnnWcCvdj35NdhxYAOAjS8agn4KbBDImDYDnA6kSfglmQ3im0otqr3gKkff1H';
const BLOB_STORE_NAME = 'chain-of-command-webhook';
const BLOB_KEY = 'message-id';

// DPPD branding
const DPPD_LOGO_URL = 'https://delperro.netlify.app/images/DPPD_Seal_3.png';
const DPPD_COLOR = 0x1e40af; // Professional blue color

interface StoredData {
    messageId: string | null;
    lastUpdated: number | null;
}

/**
 * Get stored message data from blob store
 */
async function getStoredData(): Promise<StoredData> {
    try {
        const store = getStore({ name: BLOB_STORE_NAME, consistency: 'strong' });
        const data = await store.get(BLOB_KEY, { type: 'json' }) as StoredData | null;
        return data || { messageId: null, lastUpdated: null };
    } catch (error) {
        console.error('Error fetching stored data:', error);
        return { messageId: null, lastUpdated: null };
    }
}

/**
 * Save message data to blob store
 */
async function saveStoredData(data: StoredData): Promise<void> {
    try {
        const store = getStore({ name: BLOB_STORE_NAME, consistency: 'strong' });
        await store.setJSON(BLOB_KEY, data);
    } catch (error) {
        console.error('Error saving stored data:', error);
    }
}

/**
 * Delete an existing webhook message
 */
async function deleteMessage(messageId: string): Promise<boolean> {
    try {
        const deleteUrl = `${DISCORD_WEBHOOK_URL}/messages/${messageId}`;
        const response = await fetch(deleteUrl, {
            method: 'DELETE'
        });

        if (response.ok || response.status === 204) {
            console.log('Successfully deleted old message:', messageId);
            return true;
        } else if (response.status === 404) {
            console.log('Message already deleted or not found:', messageId);
            return true;
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
 * Send webhook message to Discord
 */
async function sendMessage(payload: any): Promise<string | null> {
    try {
        const response = await fetch(`${DISCORD_WEBHOOK_URL}?wait=true`, {
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

        const message = await response.json();
        console.log('Sent new message with ID:', message.id);
        return message.id || null;
    } catch (error) {
        console.error('Failed to send Discord webhook:', error);
        return null;
    }
}

/**
 * Build all the Chain of Command embeds
 */
function buildChainOfCommandEmbeds(): any {
    const timestamp = new Date().toISOString();

    return {
        embeds: [
            // Embed 1: Header / Title
            {
                title: '⛓️ CHAIN OF COMMAND',
                description: 'Understanding and respecting the proper Chain of Command is essential for maintaining organizational structure, efficiency, and professionalism within the Del Perro Police Department.',
                color: DPPD_COLOR,
                thumbnail: {
                    url: DPPD_LOGO_URL
                },
                timestamp: timestamp
            },
            // Embed 2: Core Principle
            {
                title: '📋 Core Principle',
                description: '> **At no time should the order of the Chain of Command be skipped in any shape or form, unless you have spoken to all options.**',
                color: 0xfbbf24, // Amber/warning color
                fields: [
                    {
                        name: '⚠️ Important Notice',
                        value: 'The Chain of Command exists to ensure proper communication flow, accountability, and efficient resolution of issues. Always follow the established hierarchy.',
                        inline: false
                    }
                ]
            },
            // Embed 3: Proper Order
            {
                title: '📊 Proper Order of Contact',
                description: 'When seeking assistance, guidance, or raising concerns, follow this order:',
                color: 0x22c55e, // Green color
                fields: [
                    {
                        name: '1️⃣ Higher Officers',
                        value: 'Start by reaching out to officers of higher rank within your immediate area for learning and guidance.',
                        inline: false
                    },
                    {
                        name: '2️⃣ Supervisors',
                        value: 'If your concern cannot be addressed by higher officers, escalate to your direct supervisors.',
                        inline: false
                    },
                    {
                        name: '3️⃣ Low Command',
                        value: 'For matters requiring additional authority, approach members of Low Command.',
                        inline: false
                    },
                    {
                        name: '4️⃣ High Command',
                        value: 'Only after exhausting all previous options should matters be brought to High Command.',
                        inline: false
                    }
                ]
            },
            // Embed 4: Example Scenario
            {
                title: '📝 Example Scenario',
                description: 'Here is an example of properly following the Chain of Command:',
                color: 0x3b82f6, // Blue color
                fields: [
                    {
                        name: '🔹 Scenario',
                        value: 'A **Probationary Officer** needs guidance or has a concern.',
                        inline: false
                    },
                    {
                        name: '✅ Correct Approach',
                        value: '```\n1. Speak with Higher Officers to learn\n2. Escalate to Supervisors if needed\n3. Proceed to Low Command if unresolved\n4. Finally, approach High Command\n```',
                        inline: false
                    }
                ]
            },
            // Embed 5: Emergency Exception
            {
                title: '🚨 Emergency Exception',
                description: '> **Never should you ever skip this Chain of Command unless it is an urgent emergency.**',
                color: 0xef4444, // Red color
                fields: [
                    {
                        name: '❗ Urgent Emergencies Only',
                        value: 'In cases of genuine emergencies where immediate High Command intervention is required, the Chain of Command may be bypassed. However, this should be rare and reserved only for critical situations.',
                        inline: false
                    },
                    {
                        name: '📌 Remember',
                        value: 'Document and report any emergency escalations afterward to maintain transparency and accountability.',
                        inline: false
                    }
                ]
            },
            // Embed 6: Final - With DPPD Logo
            {
                title: 'DPPD | High Command Team',
                description: 'Issued by the High Command of the Del Perro Police Department.\n\n*Respect the Chain of Command. Maintain professionalism. Uphold the standards.*',
                color: DPPD_COLOR,
                image: {
                    url: DPPD_LOGO_URL
                },
                footer: {
                    text: 'Del Perro Police Department | Chain of Command',
                    icon_url: DPPD_LOGO_URL
                },
                timestamp: timestamp
            }
        ]
    };
}

export default async (req: Request) => {
    console.log('Chain of Command webhook triggered');

    try {
        // Get stored message data
        const storedData = await getStoredData();

        // Delete old message if exists
        if (storedData.messageId) {
            await deleteMessage(storedData.messageId);
        }

        // Build the embeds
        const payload = buildChainOfCommandEmbeds();

        // Send new message
        const newMessageId = await sendMessage(payload);

        if (newMessageId) {
            // Save the new message ID
            await saveStoredData({
                messageId: newMessageId,
                lastUpdated: Date.now()
            });

            console.log('Chain of Command webhook completed successfully');
            return new Response(JSON.stringify({
                success: true,
                message: 'Chain of Command posted successfully',
                messageId: newMessageId
            }), {
                status: 200,
                headers: { 'Content-Type': 'application/json' }
            });
        } else {
            console.error('Failed to send Chain of Command message');
            return new Response(JSON.stringify({
                success: false,
                message: 'Failed to send Discord message'
            }), {
                status: 500,
                headers: { 'Content-Type': 'application/json' }
            });
        }
    } catch (error) {
        console.error('Error in Chain of Command webhook:', error);
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
    // Schedule to run every 6 hours (at minute 0 of hours 0, 6, 12, 18)
    schedule: "0 */6 * * *"
};
