import type { APIRoute } from 'astro';
import { getStore } from '@netlify/blobs';
import { getIntelSession, hasRequiredClearance, CLEARANCE_DISPLAY_NAMES, type ClearanceLevel } from '../../../utils/google-oauth';
import type { IntelThread } from './threads';
import type { IntelPost } from './posts';
import type { IntelPerson } from './people';
import type { IntelLocation } from './locations';
import type { IntelVehicle } from './vehicles';

export const prerender = false;

const INTEL_THREADS_STORE = 'intel-threads';
const INTEL_POSTS_STORE = 'intel-posts';
const INTEL_PEOPLE_STORE = 'intel-people';
const INTEL_LOCATIONS_STORE = 'intel-locations';
const INTEL_VEHICLES_STORE = 'intel-vehicles';

interface GangRecord {
    thread: IntelThread;
    posts: IntelPost[];
    people: IntelPerson[];
    locations: IntelLocation[];
    vehicles: IntelVehicle[];
    totalMembers: number;
    totalLocations: number;
    totalVehicles: number;
    totalPosts: number;
    statusCounts: {
        active: number;
        inactive: number;
        incarcerated: number;
        deceased: number;
        unknown: number;
    };
}

/**
 * GET - Search for gangs/organizations by name
 * Query parameters:
 *   - q: search query (gang/organization name)
 */
export const GET: APIRoute = async ({ request }) => {
    try {
        const session = await getIntelSession(request);
        if (!session) {
            return new Response(JSON.stringify({ error: 'Unauthorized' }), {
                status: 401,
                headers: { 'Content-Type': 'application/json' }
            });
        }

        const user = session.user;

        // Check if user has clearance
        if (user.clearanceLevel === 'pending' || user.clearanceLevel === 'denied') {
            return new Response(JSON.stringify({
                error: 'Access pending',
                clearanceLevel: user.clearanceLevel,
                message: user.clearanceLevel === 'pending'
                    ? 'Your access is pending approval. Please wait for an administrator to grant clearance.'
                    : 'Your access has been denied. Please contact an administrator.',
            }), {
                status: 403,
                headers: { 'Content-Type': 'application/json' }
            });
        }

        const url = new URL(request.url);
        const query = url.searchParams.get('q')?.trim().toLowerCase();

        if (!query) {
            return new Response(JSON.stringify({
                success: false,
                error: 'Search query is required. Please provide a gang or organization name.'
            }), {
                status: 400,
                headers: { 'Content-Type': 'application/json' }
            });
        }

        // Get all threads
        const threadsStore = getStore({ name: INTEL_THREADS_STORE, consistency: 'strong' });
        const { blobs } = await threadsStore.list();

        const matchingGangs: GangRecord[] = [];

        for (const blob of blobs) {
            const thread = await threadsStore.get(blob.key, { type: 'json' }) as IntelThread;
            if (!thread) continue;

            // Check if user has clearance for this thread
            if (!hasRequiredClearance(user.clearanceLevel, thread.requiredClearance)) {
                continue;
            }

            // Check if thread title matches search query
            const titleMatch = thread.title?.toLowerCase().includes(query);
            const descriptionMatch = thread.description?.toLowerCase().includes(query);
            const categoryMatch = thread.category?.toLowerCase().includes(query);

            if (!titleMatch && !descriptionMatch && !categoryMatch) {
                continue;
            }

            // Get all related data
            const postsStore = getStore({ name: INTEL_POSTS_STORE, consistency: 'strong' });
            const { blobs: postBlobs } = await postsStore.list({ prefix: `${thread.id}-` });
            const posts: IntelPost[] = [];
            for (const postBlob of postBlobs) {
                const post = await postsStore.get(postBlob.key, { type: 'json' }) as IntelPost;
                if (post) posts.push(post);
            }
            posts.sort((a, b) => b.createdAt - a.createdAt);

            const peopleStore = getStore({ name: INTEL_PEOPLE_STORE, consistency: 'strong' });
            const { blobs: peopleBlobs } = await peopleStore.list({ prefix: `${thread.id}-` });
            const people: IntelPerson[] = [];
            for (const personBlob of peopleBlobs) {
                const person = await peopleStore.get(personBlob.key, { type: 'json' }) as IntelPerson;
                if (person) people.push(person);
            }
            people.sort((a, b) => b.createdAt - a.createdAt);

            const locationsStore = getStore({ name: INTEL_LOCATIONS_STORE, consistency: 'strong' });
            const { blobs: locationBlobs } = await locationsStore.list({ prefix: `${thread.id}-` });
            const locations: IntelLocation[] = [];
            for (const locationBlob of locationBlobs) {
                const location = await locationsStore.get(locationBlob.key, { type: 'json' }) as IntelLocation;
                if (location) locations.push(location);
            }
            locations.sort((a, b) => b.createdAt - a.createdAt);

            const vehiclesStore = getStore({ name: INTEL_VEHICLES_STORE, consistency: 'strong' });
            const { blobs: vehicleBlobs } = await vehiclesStore.list({ prefix: `${thread.id}-` });
            const vehicles: IntelVehicle[] = [];
            for (const vehicleBlob of vehicleBlobs) {
                const vehicle = await vehiclesStore.get(vehicleBlob.key, { type: 'json' }) as IntelVehicle;
                if (vehicle) vehicles.push(vehicle);
            }
            vehicles.sort((a, b) => b.createdAt - a.createdAt);

            // Calculate status counts
            const statusCounts = {
                active: 0,
                inactive: 0,
                incarcerated: 0,
                deceased: 0,
                unknown: 0,
            };

            for (const person of people) {
                const status = person.status || 'unknown';
                if (status in statusCounts) {
                    statusCounts[status as keyof typeof statusCounts]++;
                }
            }

            matchingGangs.push({
                thread,
                posts,
                people,
                locations,
                vehicles,
                totalMembers: people.length,
                totalLocations: locations.length,
                totalVehicles: vehicles.length,
                totalPosts: posts.length,
                statusCounts,
            });
        }

        if (matchingGangs.length === 0) {
            return new Response(JSON.stringify({
                success: true,
                gangs: [],
                message: 'No organizations found matching your search criteria.'
            }), {
                status: 200,
                headers: { 'Content-Type': 'application/json' }
            });
        }

        // Sort by total members (most first)
        matchingGangs.sort((a, b) => b.totalMembers - a.totalMembers);

        return new Response(JSON.stringify({
            success: true,
            gangs: matchingGangs,
            totalResults: matchingGangs.length,
            user: {
                id: user.id,
                name: user.name,
                email: user.email,
                picture: user.picture,
                clearanceLevel: user.clearanceLevel,
                officerName: user.officerName,
                callsign: user.callsign,
            }
        }), {
            status: 200,
            headers: { 'Content-Type': 'application/json' }
        });
    } catch (error) {
        console.error('Error searching gang database:', error);
        return new Response(JSON.stringify({
            success: false,
            error: String(error)
        }), {
            status: 500,
            headers: { 'Content-Type': 'application/json' }
        });
    }
};
