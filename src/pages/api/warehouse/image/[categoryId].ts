import type { APIRoute } from 'astro';
import { getStore } from '@netlify/blobs';

export const prerender = false;

export const GET: APIRoute = async ({ params }) => {
    try {
        const { categoryId } = params;

        if (!categoryId) {
            return new Response('Category ID required', { status: 400 });
        }

        const store = getStore({ name: 'warehouse-images', consistency: 'strong' });

        // List blobs with the category prefix to find the image
        const { blobs } = await store.list({ prefix: categoryId });

        if (blobs.length === 0) {
            return new Response('Image not found', { status: 404 });
        }

        // Get the first matching image
        const imageKey = blobs[0].key;
        const result = await store.getWithMetadata(imageKey, { type: 'arrayBuffer' });

        if (!result || !result.data) {
            return new Response('Image not found', { status: 404 });
        }

        const contentType = result.metadata?.contentType || 'image/jpeg';

        return new Response(result.data, {
            status: 200,
            headers: {
                'Content-Type': contentType,
                'Cache-Control': 'public, max-age=3600'
            }
        });
    } catch (error) {
        console.error('Error fetching image:', error);
        return new Response('Failed to fetch image', { status: 500 });
    }
};
