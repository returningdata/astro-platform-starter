import type { APIRoute } from 'astro';
import { getStore } from '@netlify/blobs';
import { validateSession } from '../../../utils/session';
import type { IntelThread } from './threads';

export const prerender = false;

const INTEL_VEHICLES_STORE = 'intel-vehicles';
const INTEL_THREADS_STORE = 'intel-threads';

export interface IntelVehicle {
    id: string;
    threadId: string;
    // Basic info
    make?: string;
    model?: string;
    year?: string;
    color?: string;
    licensePlate?: string;
    // Additional details
    vin?: string;
    type?: 'car' | 'truck' | 'motorcycle' | 'suv' | 'van' | 'boat' | 'aircraft' | 'other';
    status?: 'active' | 'impounded' | 'stolen' | 'destroyed' | 'unknown';
    registeredOwner?: string;
    associatedPerson?: string;
    photo?: string;
    description?: string;
    notes?: string;
    lastSeenLocation?: string;
    lastSeenDate?: string;
    // Metadata
    createdBy: string;
    createdAt: number;
    updatedAt: number;
}

// GET - List all vehicles for a thread
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

        const store = getStore({ name: INTEL_VEHICLES_STORE, consistency: 'strong' });

        if (threadId) {
            // List vehicles for a specific thread
            const { blobs } = await store.list({ prefix: `${threadId}-` });

            const vehicles: IntelVehicle[] = [];
            for (const blob of blobs) {
                const vehicle = await store.get(blob.key, { type: 'json' }) as IntelVehicle;
                if (vehicle) {
                    vehicles.push(vehicle);
                }
            }

            // Sort by creation date (newest first)
            vehicles.sort((a, b) => b.createdAt - a.createdAt);

            return new Response(JSON.stringify({ vehicles }), {
                status: 200,
                headers: { 'Content-Type': 'application/json' }
            });
        } else {
            // List all vehicles
            const { blobs } = await store.list();

            const vehicles: IntelVehicle[] = [];
            for (const blob of blobs) {
                const vehicle = await store.get(blob.key, { type: 'json' }) as IntelVehicle;
                if (vehicle) {
                    vehicles.push(vehicle);
                }
            }

            vehicles.sort((a, b) => b.createdAt - a.createdAt);

            return new Response(JSON.stringify({ vehicles }), {
                status: 200,
                headers: { 'Content-Type': 'application/json' }
            });
        }
    } catch (error) {
        console.error('Error fetching vehicles:', error);
        return new Response(JSON.stringify({ error: 'Failed to fetch vehicles' }), {
            status: 500,
            headers: { 'Content-Type': 'application/json' }
        });
    }
};

// POST - Create new vehicle (admin only)
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
        const {
            threadId,
            make,
            model,
            year,
            color,
            licensePlate,
            vin,
            type,
            status,
            registeredOwner,
            associatedPerson,
            photo,
            description,
            notes,
            lastSeenLocation,
            lastSeenDate
        } = body;

        if (!threadId) {
            return new Response(JSON.stringify({ error: 'Missing required field: threadId' }), {
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

        const store = getStore({ name: INTEL_VEHICLES_STORE, consistency: 'strong' });

        const vehicleId = `${threadId}-vehicle-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;
        const now = Date.now();

        const vehicle: IntelVehicle = {
            id: vehicleId,
            threadId,
            make: make || '',
            model: model || '',
            year: year || '',
            color: color || '',
            licensePlate: licensePlate || '',
            vin: vin || '',
            type: type || 'car',
            status: status || 'unknown',
            registeredOwner: registeredOwner || '',
            associatedPerson: associatedPerson || '',
            photo: photo || '',
            description: description || '',
            notes: notes || '',
            lastSeenLocation: lastSeenLocation || '',
            lastSeenDate: lastSeenDate || '',
            createdBy: user.displayName,
            createdAt: now,
            updatedAt: now,
        };

        await store.setJSON(vehicleId, vehicle);

        return new Response(JSON.stringify({ success: true, vehicle }), {
            status: 201,
            headers: { 'Content-Type': 'application/json' }
        });
    } catch (error) {
        console.error('Error creating vehicle:', error);
        return new Response(JSON.stringify({ error: 'Failed to create vehicle' }), {
            status: 500,
            headers: { 'Content-Type': 'application/json' }
        });
    }
};

// PUT - Update vehicle (admin only)
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
        const {
            id,
            make,
            model,
            year,
            color,
            licensePlate,
            vin,
            type,
            status,
            registeredOwner,
            associatedPerson,
            photo,
            description,
            notes,
            lastSeenLocation,
            lastSeenDate
        } = body;

        if (!id) {
            return new Response(JSON.stringify({ error: 'Vehicle ID required' }), {
                status: 400,
                headers: { 'Content-Type': 'application/json' }
            });
        }

        const store = getStore({ name: INTEL_VEHICLES_STORE, consistency: 'strong' });
        const existingVehicle = await store.get(id, { type: 'json' }) as IntelVehicle | null;

        if (!existingVehicle) {
            return new Response(JSON.stringify({ error: 'Vehicle not found' }), {
                status: 404,
                headers: { 'Content-Type': 'application/json' }
            });
        }

        const updatedVehicle: IntelVehicle = {
            ...existingVehicle,
            make: make ?? existingVehicle.make,
            model: model ?? existingVehicle.model,
            year: year ?? existingVehicle.year,
            color: color ?? existingVehicle.color,
            licensePlate: licensePlate ?? existingVehicle.licensePlate,
            vin: vin ?? existingVehicle.vin,
            type: type ?? existingVehicle.type,
            status: status ?? existingVehicle.status,
            registeredOwner: registeredOwner ?? existingVehicle.registeredOwner,
            associatedPerson: associatedPerson ?? existingVehicle.associatedPerson,
            photo: photo ?? existingVehicle.photo,
            description: description ?? existingVehicle.description,
            notes: notes ?? existingVehicle.notes,
            lastSeenLocation: lastSeenLocation ?? existingVehicle.lastSeenLocation,
            lastSeenDate: lastSeenDate ?? existingVehicle.lastSeenDate,
            updatedAt: Date.now(),
        };

        await store.setJSON(id, updatedVehicle);

        return new Response(JSON.stringify({ success: true, vehicle: updatedVehicle }), {
            status: 200,
            headers: { 'Content-Type': 'application/json' }
        });
    } catch (error) {
        console.error('Error updating vehicle:', error);
        return new Response(JSON.stringify({ error: 'Failed to update vehicle' }), {
            status: 500,
            headers: { 'Content-Type': 'application/json' }
        });
    }
};

// DELETE - Delete vehicle (admin only)
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
            return new Response(JSON.stringify({ error: 'Vehicle ID required' }), {
                status: 400,
                headers: { 'Content-Type': 'application/json' }
            });
        }

        const store = getStore({ name: INTEL_VEHICLES_STORE, consistency: 'strong' });
        await store.delete(id);

        return new Response(JSON.stringify({ success: true }), {
            status: 200,
            headers: { 'Content-Type': 'application/json' }
        });
    } catch (error) {
        console.error('Error deleting vehicle:', error);
        return new Response(JSON.stringify({ error: 'Failed to delete vehicle' }), {
            status: 500,
            headers: { 'Content-Type': 'application/json' }
        });
    }
};
