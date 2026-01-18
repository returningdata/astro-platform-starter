import type { APIRoute } from 'astro';
import { getStore } from '@netlify/blobs';
import { validateSession } from '../../../utils/session';
import type { IntelThread } from './threads';

export const prerender = false;

const INTEL_PEOPLE_STORE = 'intel-people';
const INTEL_THREADS_STORE = 'intel-threads';

export interface IntelPerson {
    id: string;
    threadId: string;
    name: string;
    aliases?: string[];
    photo?: string;
    description?: string;
    role?: string;
    affiliation?: string;
    status?: 'active' | 'inactive' | 'deceased' | 'incarcerated' | 'unknown';
    lastKnownLocation?: string;
    notes?: string;
    createdBy: string;
    createdAt: number;
    updatedAt: number;
}

// GET - List all people for a thread
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

        const store = getStore({ name: INTEL_PEOPLE_STORE, consistency: 'strong' });

        if (threadId) {
            // List people for a specific thread
            const { blobs } = await store.list({ prefix: `${threadId}-` });

            const people: IntelPerson[] = [];
            for (const blob of blobs) {
                const person = await store.get(blob.key, { type: 'json' }) as IntelPerson;
                if (person) {
                    people.push(person);
                }
            }

            // Sort by creation date (newest first)
            people.sort((a, b) => b.createdAt - a.createdAt);

            return new Response(JSON.stringify({ people }), {
                status: 200,
                headers: { 'Content-Type': 'application/json' }
            });
        } else {
            // List all people
            const { blobs } = await store.list();

            const people: IntelPerson[] = [];
            for (const blob of blobs) {
                const person = await store.get(blob.key, { type: 'json' }) as IntelPerson;
                if (person) {
                    people.push(person);
                }
            }

            people.sort((a, b) => b.createdAt - a.createdAt);

            return new Response(JSON.stringify({ people }), {
                status: 200,
                headers: { 'Content-Type': 'application/json' }
            });
        }
    } catch (error) {
        console.error('Error fetching people:', error);
        return new Response(JSON.stringify({ error: 'Failed to fetch people' }), {
            status: 500,
            headers: { 'Content-Type': 'application/json' }
        });
    }
};

// POST - Create new person (admin only)
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
        const { threadId, name, aliases, photo, description, role, affiliation, status, lastKnownLocation, notes } = body;

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

        const store = getStore({ name: INTEL_PEOPLE_STORE, consistency: 'strong' });

        const personId = `${threadId}-person-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;
        const now = Date.now();

        const person: IntelPerson = {
            id: personId,
            threadId,
            name,
            aliases: aliases || [],
            photo: photo || '',
            description: description || '',
            role: role || '',
            affiliation: affiliation || thread.title,
            status: status || 'unknown',
            lastKnownLocation: lastKnownLocation || '',
            notes: notes || '',
            createdBy: user.displayName,
            createdAt: now,
            updatedAt: now,
        };

        await store.setJSON(personId, person);

        return new Response(JSON.stringify({ success: true, person }), {
            status: 201,
            headers: { 'Content-Type': 'application/json' }
        });
    } catch (error) {
        console.error('Error creating person:', error);
        return new Response(JSON.stringify({ error: 'Failed to create person' }), {
            status: 500,
            headers: { 'Content-Type': 'application/json' }
        });
    }
};

// PUT - Update person (admin only)
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
        const { id, name, aliases, photo, description, role, affiliation, status, lastKnownLocation, notes } = body;

        if (!id) {
            return new Response(JSON.stringify({ error: 'Person ID required' }), {
                status: 400,
                headers: { 'Content-Type': 'application/json' }
            });
        }

        const store = getStore({ name: INTEL_PEOPLE_STORE, consistency: 'strong' });
        const existingPerson = await store.get(id, { type: 'json' }) as IntelPerson | null;

        if (!existingPerson) {
            return new Response(JSON.stringify({ error: 'Person not found' }), {
                status: 404,
                headers: { 'Content-Type': 'application/json' }
            });
        }

        const updatedPerson: IntelPerson = {
            ...existingPerson,
            name: name ?? existingPerson.name,
            aliases: aliases ?? existingPerson.aliases,
            photo: photo ?? existingPerson.photo,
            description: description ?? existingPerson.description,
            role: role ?? existingPerson.role,
            affiliation: affiliation ?? existingPerson.affiliation,
            status: status ?? existingPerson.status,
            lastKnownLocation: lastKnownLocation ?? existingPerson.lastKnownLocation,
            notes: notes ?? existingPerson.notes,
            updatedAt: Date.now(),
        };

        await store.setJSON(id, updatedPerson);

        return new Response(JSON.stringify({ success: true, person: updatedPerson }), {
            status: 200,
            headers: { 'Content-Type': 'application/json' }
        });
    } catch (error) {
        console.error('Error updating person:', error);
        return new Response(JSON.stringify({ error: 'Failed to update person' }), {
            status: 500,
            headers: { 'Content-Type': 'application/json' }
        });
    }
};

// DELETE - Delete person (admin only)
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
            return new Response(JSON.stringify({ error: 'Person ID required' }), {
                status: 400,
                headers: { 'Content-Type': 'application/json' }
            });
        }

        const store = getStore({ name: INTEL_PEOPLE_STORE, consistency: 'strong' });
        await store.delete(id);

        return new Response(JSON.stringify({ success: true }), {
            status: 200,
            headers: { 'Content-Type': 'application/json' }
        });
    } catch (error) {
        console.error('Error deleting person:', error);
        return new Response(JSON.stringify({ error: 'Failed to delete person' }), {
            status: 500,
            headers: { 'Content-Type': 'application/json' }
        });
    }
};
