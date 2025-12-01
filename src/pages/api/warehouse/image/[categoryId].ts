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

export const DELETE: APIRoute = async ({ params }) => {
    try {
        const { categoryId } = params;

        if (!categoryId) {
            return new Response(JSON.stringify({ success: false, error: 'Category ID required' }), {
                status: 400,
                headers: { 'Content-Type': 'application/json' }
            });
        }

        const store = getStore({ name: 'warehouse-images', consistency: 'strong' });

        // List blobs with the category prefix to find all images for this category
        const { blobs } = await store.list({ prefix: categoryId });

        if (blobs.length === 0) {
            return new Response(JSON.stringify({ success: true, message: 'No image to delete' }), {
                status: 200,
                headers: { 'Content-Type': 'application/json' }
            });
        }

        // Delete all matching images for this category
        for (const blob of blobs) {
            await store.delete(blob.key);
        }

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
