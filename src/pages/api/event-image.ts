import type { APIRoute } from 'astro';
import { getStore } from '@netlify/blobs';

export const prerender = false;

const ALLOWED_TYPES = ['image/jpeg', 'image/png', 'image/gif', 'image/webp'];
const MAX_SIZE = 5 * 1024 * 1024; // 5MB

export const POST: APIRoute = async ({ request }) => {
    try {
        const formData = await request.formData();
        const file = formData.get('image') as File | null;
        const eventId = formData.get('eventId') as string | null;

        if (!file || !eventId) {
            return new Response(JSON.stringify({ success: false, error: 'Missing image or event ID' }), {
                status: 400,
                headers: { 'Content-Type': 'application/json' }
            });
        }

        if (!ALLOWED_TYPES.includes(file.type)) {
            return new Response(JSON.stringify({ success: false, error: 'Invalid file type. Allowed: JPEG, PNG, GIF, WebP' }), {
                status: 400,
                headers: { 'Content-Type': 'application/json' }
            });
        }

        if (file.size > MAX_SIZE) {
            return new Response(JSON.stringify({ success: false, error: 'File too large. Maximum size: 5MB' }), {
                status: 400,
                headers: { 'Content-Type': 'application/json' }
            });
        }

        const store = getStore({ name: 'event-images', consistency: 'strong' });
        const imageKey = `event-${eventId}`;

        const arrayBuffer = await file.arrayBuffer();
        await store.set(imageKey, new Blob([arrayBuffer], { type: file.type }), {
            metadata: { contentType: file.type, originalName: file.name }
        });

        return new Response(JSON.stringify({
            success: true,
            imageKey: imageKey
        }), {
            status: 200,
            headers: { 'Content-Type': 'application/json' }
        });
    } catch (error) {
        console.error('Error uploading image:', error);
        return new Response(JSON.stringify({ success: false, error: 'Failed to upload image' }), {
            status: 500,
            headers: { 'Content-Type': 'application/json' }
        });
    }
};

export const GET: APIRoute = async ({ url }) => {
    try {
        const imageKey = url.searchParams.get('key');

        if (!imageKey) {
            return new Response(JSON.stringify({ error: 'Missing image key' }), {
                status: 400,
                headers: { 'Content-Type': 'application/json' }
            });
        }

        const store = getStore({ name: 'event-images', consistency: 'strong' });
        const result = await store.getWithMetadata(imageKey, { type: 'blob' });

        if (!result || !result.data) {
            return new Response(JSON.stringify({ error: 'Image not found' }), {
                status: 404,
                headers: { 'Content-Type': 'application/json' }
            });
        }

        const contentType = result.metadata?.contentType || 'image/jpeg';
        const blob = result.data as Blob;

        return new Response(blob, {
            status: 200,
            headers: {
                'Content-Type': contentType,
                'Cache-Control': 'public, max-age=31536000'
            }
        });
    } catch (error) {
        console.error('Error retrieving image:', error);
        return new Response(JSON.stringify({ error: 'Failed to retrieve image' }), {
            status: 500,
            headers: { 'Content-Type': 'application/json' }
        });
    }
};

export const DELETE: APIRoute = async ({ request }) => {
    try {
        const { imageKey } = await request.json();

        if (!imageKey) {
            return new Response(JSON.stringify({ success: false, error: 'Missing image key' }), {
                status: 400,
                headers: { 'Content-Type': 'application/json' }
            });
        }

        const store = getStore({ name: 'event-images', consistency: 'strong' });
        await store.delete(imageKey);

        return new Response(JSON.stringify({ success: true }), {
            status: 200,
            headers: { 'Content-Type': 'application/json' }
        });
    } catch (error) {
        console.error('Error deleting image:', error);
        return new Response(JSON.stringify({ success: false, error: 'Failed to delete image' }), {
            status: 500,
            headers: { 'Content-Type': 'application/json' }
        });
    }
};
