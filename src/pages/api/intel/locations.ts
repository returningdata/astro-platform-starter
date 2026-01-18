import type { APIRoute } from 'astro';
import { getStore } from '@netlify/blobs';
import { validateSession } from '../../../utils/session';
import type { IntelThread } from './threads';

export const prerender = false;

const INTEL_LOCATIONS_STORE = 'intel-locations';
const INTEL_THREADS_STORE = 'intel-threads';

export interface IntelLocation {
    id: string;
    threadId: string;
    name: string;
    type?: 'headquarters' | 'safehouse' | 'meetup' | 'stash' | 'business' | 'residence' | 'territory' | 'other';
    address?: string;
    coordinates?: {
        lat: number;
        lng: number;
    };
    photo?: string;
    description?: string;
    status?: 'active' | 'inactive' | 'under_surveillance' | 'raided' | 'unknown';
    notes?: string;
    createdBy: string;
    createdAt: number;
    updatedAt: number;
}

// GET - List all locations for a thread
export const GET: APIRoute = async ({ request }) => {
    try {
        const user = await validateSession(request);
        if (!user) {
            return new Response(JSON.stringify({ error: 'Unauthorized' }), {
                status: 401,
                headers: { 'Content-Type': 'application/json' }
            });
        }

        // Check permission
        if (user.role !== 'super_admin' && !user.permissions.includes('intel-management')) {
            return new Response(JSON.stringify({ error: 'Forbidden' }), {
                status: 403,
                headers: { 'Content-Type': 'application/json' }
            });
        }

        const url = new URL(request.url);
        const threadId = url.searchParams.get('threadId');

        const store = getStore({ name: INTEL_LOCATIONS_STORE, consistency: 'strong' });

        if (threadId) {
            // List locations for a specific thread
            const { blobs } = await store.list({ prefix: `${threadId}-` });

            const locations: IntelLocation[] = [];
            for (const blob of blobs) {
                const location = await store.get(blob.key, { type: 'json' }) as IntelLocation;
                if (location) {
                    locations.push(location);
                }
            }

            // Sort by creation date (newest first)
            locations.sort((a, b) => b.createdAt - a.createdAt);

            return new Response(JSON.stringify({ locations }), {
                status: 200,
                headers: { 'Content-Type': 'application/json' }
            });
        } else {
            // List all locations
            const { blobs } = await store.list();

            const locations: IntelLocation[] = [];
            for (const blob of blobs) {
                const location = await store.get(blob.key, { type: 'json' }) as IntelLocation;
                if (location) {
                    locations.push(location);
                }
            }

            locations.sort((a, b) => b.createdAt - a.createdAt);

            return new Response(JSON.stringify({ locations }), {
                status: 200,
                headers: { 'Content-Type': 'application/json' }
            });
        }
    } catch (error) {
        console.error('Error fetching locations:', error);
        return new Response(JSON.stringify({ error: 'Failed to fetch locations' }), {
            status: 500,
            headers: { 'Content-Type': 'application/json' }
        });
    }
};

// POST - Create new location (admin only)
export const POST: APIRoute = async ({ request }) => {
    try {
        const user = await validateSession(request);
        if (!user) {
            return new Response(JSON.stringify({ error: 'Unauthorized' }), {
                status: 401,
                headers: { 'Content-Type': 'application/json' }
            });
        }

        // Check permission
        if (user.role !== 'super_admin' && !user.permissions.includes('intel-management')) {
            return new Response(JSON.stringify({ error: 'Forbidden' }), {
                status: 403,
                headers: { 'Content-Type': 'application/json' }
            });
        }

        const body = await request.json();
        const { threadId, name, type, address, coordinates, photo, description, status, notes } = body;

        if (!threadId || !name) {
            return new Response(JSON.stringify({ error: 'Missing required fields (threadId, name)' }), {
                status: 400,
                headers: { 'Content-Type': 'application/json' }
            });
        }

        // Verify thread exists
        const threadsStore = getStore({ name: INTEL_THREADS_STORE, consistency: 'strong' });
        const thread = await threadsStore.get(threadId, { type: 'json' }) as IntelThread | null;

        if (!thread) {
            return new Response(JSON.stringify({ error: 'Thread not found' }), {
                status: 404,
                headers: { 'Content-Type': 'application/json' }
            });
        }

        const store = getStore({ name: INTEL_LOCATIONS_STORE, consistency: 'strong' });

        const locationId = `${threadId}-location-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;
        const now = Date.now();

        const location: IntelLocation = {
            id: locationId,
            threadId,
            name,
            type: type || 'other',
            address: address || '',
            coordinates: coordinates || undefined,
            photo: photo || '',
            description: description || '',
            status: status || 'unknown',
            notes: notes || '',
            createdBy: user.displayName,
            createdAt: now,
            updatedAt: now,
        };

        await store.setJSON(locationId, location);

        return new Response(JSON.stringify({ success: true, location }), {
            status: 201,
            headers: { 'Content-Type': 'application/json' }
        });
    } catch (error) {
        console.error('Error creating location:', error);
        return new Response(JSON.stringify({ error: 'Failed to create location' }), {
            status: 500,
            headers: { 'Content-Type': 'application/json' }
        });
    }
};

// PUT - Update location (admin only)
export const PUT: APIRoute = async ({ request }) => {
    try {
        const user = await validateSession(request);
        if (!user) {
            return new Response(JSON.stringify({ error: 'Unauthorized' }), {
                status: 401,
                headers: { 'Content-Type': 'application/json' }
            });
        }

        // Check permission
        if (user.role !== 'super_admin' && !user.permissions.includes('intel-management')) {
            return new Response(JSON.stringify({ error: 'Forbidden' }), {
                status: 403,
                headers: { 'Content-Type': 'application/json' }
            });
        }

        const body = await request.json();
        const { id, name, type, address, coordinates, photo, description, status, notes } = body;

        if (!id) {
            return new Response(JSON.stringify({ error: 'Location ID required' }), {
                status: 400,
                headers: { 'Content-Type': 'application/json' }
            });
        }

        const store = getStore({ name: INTEL_LOCATIONS_STORE, consistency: 'strong' });
        const existingLocation = await store.get(id, { type: 'json' }) as IntelLocation | null;

        if (!existingLocation) {
            return new Response(JSON.stringify({ error: 'Location not found' }), {
                status: 404,
                headers: { 'Content-Type': 'application/json' }
            });
        }

        const updatedLocation: IntelLocation = {
            ...existingLocation,
            name: name ?? existingLocation.name,
            type: type ?? existingLocation.type,
            address: address ?? existingLocation.address,
            coordinates: coordinates ?? existingLocation.coordinates,
            photo: photo ?? existingLocation.photo,
            description: description ?? existingLocation.description,
            status: status ?? existingLocation.status,
            notes: notes ?? existingLocation.notes,
            updatedAt: Date.now(),
        };

        await store.setJSON(id, updatedLocation);

        return new Response(JSON.stringify({ success: true, location: updatedLocation }), {
            status: 200,
            headers: { 'Content-Type': 'application/json' }
        });
    } catch (error) {
        console.error('Error updating location:', error);
        return new Response(JSON.stringify({ error: 'Failed to update location' }), {
            status: 500,
            headers: { 'Content-Type': 'application/json' }
        });
    }
};

// DELETE - Delete location (admin only)
export const DELETE: APIRoute = async ({ request }) => {
    try {
        const user = await validateSession(request);
        if (!user) {
            return new Response(JSON.stringify({ error: 'Unauthorized' }), {
                status: 401,
                headers: { 'Content-Type': 'application/json' }
            });
        }

        // Check permission
        if (user.role !== 'super_admin' && !user.permissions.includes('intel-management')) {
            return new Response(JSON.stringify({ error: 'Forbidden' }), {
                status: 403,
                headers: { 'Content-Type': 'application/json' }
            });
        }

        const url = new URL(request.url);
        const id = url.searchParams.get('id');

        if (!id) {
            return new Response(JSON.stringify({ error: 'Location ID required' }), {
                status: 400,
                headers: { 'Content-Type': 'application/json' }
            });
        }

        const store = getStore({ name: INTEL_LOCATIONS_STORE, consistency: 'strong' });
        await store.delete(id);

        return new Response(JSON.stringify({ success: true }), {
            status: 200,
            headers: { 'Content-Type': 'application/json' }
        });
    } catch (error) {
        console.error('Error deleting location:', error);
        return new Response(JSON.stringify({ error: 'Failed to delete location' }), {
            status: 500,
            headers: { 'Content-Type': 'application/json' }
        });
    }
};
