import type { APIRoute } from 'astro';
import { getStore } from '@netlify/blobs';
import { getIntelSession, hasRequiredClearance, CLEARANCE_DISPLAY_NAMES, CLEARANCE_SHORT_CODES, type ClearanceLevel } from '../../../utils/google-oauth';
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

// GET - List threads visible to the user based on their clearance
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
        const threadId = url.searchParams.get('threadId');

        // If threadId provided, return thread details with posts
        if (threadId) {
            const threadsStore = getStore({ name: INTEL_THREADS_STORE, consistency: 'strong' });
            const thread = await threadsStore.get(threadId, { type: 'json' }) as IntelThread | null;

            if (!thread) {
                return new Response(JSON.stringify({ error: 'Thread not found' }), {
                    status: 404,
                    headers: { 'Content-Type': 'application/json' }
                });
            }

            // Check clearance using new system
            if (!hasRequiredClearance(user.clearanceLevel, thread.requiredClearance)) {
                return new Response(JSON.stringify({
                    error: 'Insufficient clearance',
                    message: `This thread requires ${CLEARANCE_DISPLAY_NAMES[thread.requiredClearance]} clearance.`,
                }), {
                    status: 403,
                    headers: { 'Content-Type': 'application/json' }
                });
            }

            // Get posts for this thread
            const postsStore = getStore({ name: INTEL_POSTS_STORE, consistency: 'strong' });
            const { blobs } = await postsStore.list({ prefix: `${threadId}-` });

            const posts: IntelPost[] = [];
            for (const blob of blobs) {
                const post = await postsStore.get(blob.key, { type: 'json' }) as IntelPost;
                if (post) {
                    posts.push(post);
                }
            }

            // Sort by creation date (oldest first)
            posts.sort((a, b) => a.createdAt - b.createdAt);

            // Get people for this thread
            const peopleStore = getStore({ name: INTEL_PEOPLE_STORE, consistency: 'strong' });
            const { blobs: peopleBlobs } = await peopleStore.list({ prefix: `${threadId}-` });

            const people: IntelPerson[] = [];
            for (const blob of peopleBlobs) {
                const person = await peopleStore.get(blob.key, { type: 'json' }) as IntelPerson;
                if (person) {
                    people.push(person);
                }
            }

            // Sort people by creation date (newest first)
            people.sort((a, b) => b.createdAt - a.createdAt);

            // Get locations for this thread
            const locationsStore = getStore({ name: INTEL_LOCATIONS_STORE, consistency: 'strong' });
            const { blobs: locationsBlobs } = await locationsStore.list({ prefix: `${threadId}-` });

            const locations: IntelLocation[] = [];
            for (const blob of locationsBlobs) {
                const location = await locationsStore.get(blob.key, { type: 'json' }) as IntelLocation;
                if (location) {
                    locations.push(location);
                }
            }

            // Sort locations by creation date (newest first)
            locations.sort((a, b) => b.createdAt - a.createdAt);

            // Get vehicles for this thread
            const vehiclesStore = getStore({ name: INTEL_VEHICLES_STORE, consistency: 'strong' });
            const { blobs: vehiclesBlobs } = await vehiclesStore.list({ prefix: `${threadId}-` });

            const vehicles: IntelVehicle[] = [];
            for (const blob of vehiclesBlobs) {
                const vehicle = await vehiclesStore.get(blob.key, { type: 'json' }) as IntelVehicle;
                if (vehicle) {
                    vehicles.push(vehicle);
                }
            }

            // Sort vehicles by creation date (newest first)
            vehicles.sort((a, b) => b.createdAt - a.createdAt);

            return new Response(JSON.stringify({ thread, posts, people, locations, vehicles }), {
                status: 200,
                headers: { 'Content-Type': 'application/json' }
            });
        }

        // Return list of threads user can access
        const store = getStore({ name: INTEL_THREADS_STORE, consistency: 'strong' });
        const { blobs } = await store.list();

        const threads: IntelThread[] = [];

        for (const blob of blobs) {
            const thread = await store.get(blob.key, { type: 'json' }) as IntelThread;
            if (thread) {
                if (hasRequiredClearance(user.clearanceLevel, thread.requiredClearance)) {
                    threads.push(thread);
                }
            }
        }

        // Sort by pinned first, then by updatedAt
        threads.sort((a, b) => {
            if (a.isPinned !== b.isPinned) return a.isPinned ? -1 : 1;
            return b.updatedAt - a.updatedAt;
        });

        return new Response(JSON.stringify({
            threads,
            user: {
                id: user.id,
                name: user.name,
                email: user.email,
                picture: user.picture,
                clearanceLevel: user.clearanceLevel,
                clearanceDisplay: CLEARANCE_DISPLAY_NAMES[user.clearanceLevel],
                clearanceCode: CLEARANCE_SHORT_CODES[user.clearanceLevel],
                discordUsername: user.discordUsername,
                discordId: user.discordId,
                officerName: user.officerName,
                callsign: user.callsign,
                badgeNumber: user.badgeNumber,
                profileComplete: user.profileComplete,
            }
        }), {
            status: 200,
            headers: { 'Content-Type': 'application/json' }
        });
    } catch (error) {
        console.error('Error fetching intel view:', error);
        return new Response(JSON.stringify({ error: 'Failed to fetch intel' }), {
            status: 500,
            headers: { 'Content-Type': 'application/json' }
        });
    }
};
