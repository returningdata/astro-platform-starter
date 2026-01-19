import { getStore } from "@netlify/blobs";
import type { Config } from "@netlify/functions";

const INTEL_THREADS_STORE = 'intel-threads';
const INTEL_POSTS_STORE = 'intel-posts';
const INTEL_PEOPLE_STORE = 'intel-people';
const INTEL_LOCATIONS_STORE = 'intel-locations';
const INTEL_VEHICLES_STORE = 'intel-vehicles';

// Discord webhook URL for gang intel updates
const GANG_INTEL_WEBHOOK_URL = 'https://discord.com/api/webhooks/1462895967203360944/1b0zPhxAgLEnBTc3D6ryNcCDH-ZAobBcyKJ0veCqTB5Zi5JcLxKkj2y77vSc_J6qKo3K';

// Categories to include in the webhook (all gang-related categories)
const INCLUDED_CATEGORIES = ['gang', 'militia', 'cartel', 'crime_family', 'motorcycle_club'];

interface IntelThread {
    id: string;
    title: string;
    description: string;
    category: string;
    requiredClearance: string;
    createdBy: string;
    createdAt: number;
    updatedAt: number;
    isPinned: boolean;
    isLocked: boolean;
    postCount: number;
    image?: string;
}

interface IntelPerson {
    id: string;
    threadId: string;
    name: string;
    aliases: string[];
    photo?: string;
    description?: string;
    role?: string;
    affiliation?: string;
    status: string;
    lastKnownLocation?: string;
    notes?: string;
    createdAt: number;
    updatedAt: number;
    createdBy: string;
}

interface IntelLocation {
    id: string;
    threadId: string;
    name: string;
    address?: string;
    coordinates?: { lat: number; lng: number };
    photo?: string;
    type: string;
    description?: string;
    status: string;
    notes?: string;
    createdAt: number;
    updatedAt: number;
    createdBy: string;
}

interface IntelVehicle {
    id: string;
    threadId: string;
    make?: string;
    model?: string;
    year?: string;
    color?: string;
    licensePlate?: string;
    vin?: string;
    type: string;
    status: string;
    registeredOwner?: string;
    associatedPerson?: string;
    photo?: string;
    lastSeenLocation?: string;
    notes?: string;
    createdAt: number;
    updatedAt: number;
    createdBy: string;
}

interface IntelPost {
    id: string;
    threadId: string;
    content: string;
    author: string;
    authorRole?: string;
    createdAt: number;
    updatedAt: number;
    attachments: string[];
}

interface GangData {
    thread: IntelThread;
    people: IntelPerson[];
    locations: IntelLocation[];
    vehicles: IntelVehicle[];
    posts: IntelPost[];
}

const categoryDisplayNames: Record<string, string> = {
    gang: 'Gang',
    cartel: 'Cartel',
    militia: 'Militia',
    crime_family: 'Crime Family',
    motorcycle_club: 'Motorcycle Club',
    other: 'Other'
};

const categoryColors: Record<string, number> = {
    gang: 0xFF4444,       // Red
    cartel: 0xFF8800,     // Orange
    militia: 0xFFCC00,    // Yellow
    crime_family: 0xAA44FF, // Purple
    motorcycle_club: 0x4488FF, // Blue
    other: 0x888888       // Gray
};

/**
 * Creates a Discord embed for a gang/organization with all intel data
 */
function createGangEmbed(gang: GangData): object {
    const { thread, people, locations, vehicles, posts } = gang;

    // Build people summary
    const activeMembers = people.filter(p => p.status === 'active').length;
    const incarceratedMembers = people.filter(p => p.status === 'incarcerated').length;
    const deceasedMembers = people.filter(p => p.status === 'deceased').length;

    // Build fields for the embed
    const fields: { name: string; value: string; inline?: boolean }[] = [];

    // Stats field
    fields.push({
        name: 'Statistics',
        value: [
            `**Members:** ${people.length} total (${activeMembers} active, ${incarceratedMembers} incarcerated, ${deceasedMembers} deceased)`,
            `**Locations:** ${locations.length}`,
            `**Vehicles:** ${vehicles.length}`,
            `**Intel Reports:** ${posts.length}`
        ].join('\n'),
        inline: false
    });

    // People field (if any)
    if (people.length > 0) {
        const personList = people.slice(0, 10).map(p => {
            const statusEmoji = p.status === 'active' ? '🟢' :
                               p.status === 'incarcerated' ? '🟠' :
                               p.status === 'deceased' ? '🔴' : '⚪';
            return `${statusEmoji} **${p.name}**${p.role ? ` (${p.role})` : ''}`;
        }).join('\n');

        fields.push({
            name: `Known Members (${people.length})`,
            value: personList + (people.length > 10 ? `\n...and ${people.length - 10} more` : ''),
            inline: false
        });
    }

    // Locations field (if any)
    if (locations.length > 0) {
        const locationList = locations.slice(0, 5).map(l => {
            const typeLabel = l.type !== 'other' ? ` [${l.type}]` : '';
            return `📍 **${l.name}**${typeLabel}${l.address ? ` - ${l.address}` : ''}`;
        }).join('\n');

        fields.push({
            name: `Known Locations (${locations.length})`,
            value: locationList + (locations.length > 5 ? `\n...and ${locations.length - 5} more` : ''),
            inline: false
        });
    }

    // Vehicles field (if any)
    if (vehicles.length > 0) {
        const vehicleList = vehicles.slice(0, 5).map(v => {
            const name = [v.year, v.make, v.model].filter(Boolean).join(' ') || 'Unknown Vehicle';
            const plate = v.licensePlate ? ` (${v.licensePlate})` : '';
            const color = v.color ? ` - ${v.color}` : '';
            return `🚗 **${name}**${color}${plate}`;
        }).join('\n');

        fields.push({
            name: `Known Vehicles (${vehicles.length})`,
            value: vehicleList + (vehicles.length > 5 ? `\n...and ${vehicles.length - 5} more` : ''),
            inline: false
        });
    }

    // Recent Intel field (if any)
    if (posts.length > 0) {
        const recentPosts = posts.slice(0, 3).map(p => {
            const date = new Date(p.createdAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
            const content = p.content.length > 100 ? p.content.substring(0, 100) + '...' : p.content;
            const attachmentCount = p.attachments?.length ? ` [${p.attachments.length} 📷]` : '';
            return `**${date}** by ${p.author}: ${content}${attachmentCount}`;
        }).join('\n\n');

        fields.push({
            name: `Recent Intel (${posts.length} total)`,
            value: recentPosts,
            inline: false
        });
    }

    // Create the embed
    const embed: Record<string, unknown> = {
        title: thread.title,
        description: thread.description?.substring(0, 300) + (thread.description && thread.description.length > 300 ? '...' : ''),
        color: categoryColors[thread.category] || categoryColors.other,
        fields: fields,
        footer: {
            text: `Category: ${categoryDisplayNames[thread.category] || 'Organization'} | Last Updated`
        },
        timestamp: new Date(thread.updatedAt).toISOString()
    };

    // Add thumbnail if available
    if (thread.image) {
        embed.thumbnail = { url: thread.image };
    }

    return embed;
}

/**
 * Scheduled function that runs every 6 hours to send gang intel to Discord
 */
export default async function handler() {
    try {
        console.log('Starting gang intel webhook job...');

        // Get all threads
        const threadsStore = getStore({ name: INTEL_THREADS_STORE, consistency: 'strong' });
        const { blobs: threadBlobs } = await threadsStore.list();

        const gangsToSend: GangData[] = [];

        for (const blob of threadBlobs) {
            const thread = await threadsStore.get(blob.key, { type: 'json' }) as IntelThread | null;
            if (!thread) continue;

            // Only include gang-related categories
            if (!INCLUDED_CATEGORIES.includes(thread.category)) continue;

            // Get all related data for this gang
            const postsStore = getStore({ name: INTEL_POSTS_STORE, consistency: 'strong' });
            const { blobs: postBlobs } = await postsStore.list({ prefix: `${thread.id}-` });
            const posts: IntelPost[] = [];
            for (const postBlob of postBlobs) {
                const post = await postsStore.get(postBlob.key, { type: 'json' }) as IntelPost | null;
                if (post) posts.push(post);
            }
            posts.sort((a, b) => b.createdAt - a.createdAt);

            const peopleStore = getStore({ name: INTEL_PEOPLE_STORE, consistency: 'strong' });
            const { blobs: peopleBlobs } = await peopleStore.list({ prefix: `${thread.id}-` });
            const people: IntelPerson[] = [];
            for (const personBlob of peopleBlobs) {
                const person = await peopleStore.get(personBlob.key, { type: 'json' }) as IntelPerson | null;
                if (person) people.push(person);
            }
            people.sort((a, b) => b.createdAt - a.createdAt);

            const locationsStore = getStore({ name: INTEL_LOCATIONS_STORE, consistency: 'strong' });
            const { blobs: locationBlobs } = await locationsStore.list({ prefix: `${thread.id}-` });
            const locations: IntelLocation[] = [];
            for (const locationBlob of locationBlobs) {
                const location = await locationsStore.get(locationBlob.key, { type: 'json' }) as IntelLocation | null;
                if (location) locations.push(location);
            }
            locations.sort((a, b) => b.createdAt - a.createdAt);

            const vehiclesStore = getStore({ name: INTEL_VEHICLES_STORE, consistency: 'strong' });
            const { blobs: vehicleBlobs } = await vehiclesStore.list({ prefix: `${thread.id}-` });
            const vehicles: IntelVehicle[] = [];
            for (const vehicleBlob of vehicleBlobs) {
                const vehicle = await vehiclesStore.get(vehicleBlob.key, { type: 'json' }) as IntelVehicle | null;
                if (vehicle) vehicles.push(vehicle);
            }
            vehicles.sort((a, b) => b.createdAt - a.createdAt);

            gangsToSend.push({
                thread,
                people,
                locations,
                vehicles,
                posts
            });
        }

        if (gangsToSend.length === 0) {
            console.log('No gang intel to send');
            return new Response(JSON.stringify({ success: true, message: 'No gang intel to send' }), {
                status: 200,
                headers: { 'Content-Type': 'application/json' }
            });
        }

        // Sort gangs by member count (most members first)
        gangsToSend.sort((a, b) => b.people.length - a.people.length);

        // Discord allows max 10 embeds per message
        // Send in batches of 10
        const batchSize = 10;
        let totalSent = 0;

        for (let i = 0; i < gangsToSend.length; i += batchSize) {
            const batch = gangsToSend.slice(i, i + batchSize);
            const embeds = batch.map(gang => createGangEmbed(gang));

            // Add a header embed for the first batch
            const messagePayload: Record<string, unknown> = {
                embeds: embeds
            };

            if (i === 0) {
                // Add content text for the first message
                messagePayload.content = `📊 **Gang Intel Database Report** - ${new Date().toLocaleDateString('en-US', {
                    weekday: 'long',
                    year: 'numeric',
                    month: 'long',
                    day: 'numeric',
                    hour: '2-digit',
                    minute: '2-digit',
                    timeZoneName: 'short'
                })}\n\n**Total Organizations:** ${gangsToSend.length}`;
            }

            const response = await fetch(GANG_INTEL_WEBHOOK_URL, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify(messagePayload)
            });

            if (!response.ok) {
                const errorText = await response.text();
                console.error(`Failed to send Discord webhook batch ${i / batchSize + 1}:`, errorText);
            } else {
                totalSent += batch.length;
                console.log(`Successfully sent batch ${i / batchSize + 1} with ${batch.length} gangs`);
            }

            // Rate limiting - wait 1 second between batches to avoid Discord rate limits
            if (i + batchSize < gangsToSend.length) {
                await new Promise(resolve => setTimeout(resolve, 1000));
            }
        }

        console.log(`Gang intel webhook completed. Sent ${totalSent} organizations.`);

        return new Response(JSON.stringify({
            success: true,
            totalOrganizations: gangsToSend.length,
            sentCount: totalSent
        }), {
            status: 200,
            headers: { 'Content-Type': 'application/json' }
        });
    } catch (error) {
        console.error('Error in gang intel webhook:', error);
        return new Response(JSON.stringify({ error: 'Failed to send gang intel' }), {
            status: 500,
            headers: { 'Content-Type': 'application/json' }
        });
    }
}

// Run every 6 hours (at 00:00, 06:00, 12:00, 18:00 UTC)
export const config: Config = {
    schedule: "0 */6 * * *"
};
