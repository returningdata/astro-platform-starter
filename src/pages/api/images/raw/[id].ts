import type { APIRoute } from 'astro';
import { getStore } from '@netlify/blobs';

export const prerender = false;

// Helper to get the images store
function getImagesStore() {
    return getStore({ name: 'hosted-images', consistency: 'strong' });
}

// Helper to get the images metadata store
function getImagesMetadataStore() {
    return getStore({ name: 'hosted-images-metadata', consistency: 'strong' });
}

// GET - Serve raw image by ID
export const GET: APIRoute = async ({ params }) => {
    try {
        const imageId = params.id;

        if (!imageId) {
            return new Response('Image ID required', { status: 400 });
        }

        const imageStore = getImagesStore();
        const metadataStore = getImagesMetadataStore();

        // Get metadata first to check if image exists and get MIME type
        const metadata = await metadataStore.get(`id:${imageId}`, { type: 'json' }) as { mimeType: string; originalName: string } | null;

        if (!metadata) {
            return new Response('Image not found', { status: 404 });
        }

        // Get the actual image data
        const imageData = await imageStore.get(imageId, { type: 'arrayBuffer' });

        if (!imageData) {
            return new Response('Image data not found', { status: 404 });
        }

        return new Response(imageData, {
            status: 200,
            headers: {
                'Content-Type': metadata.mimeType,
                'Cache-Control': 'public, max-age=31536000, immutable',
                'Content-Disposition': `inline; filename="${metadata.originalName}"`
            }
        });
    } catch (error) {
        console.error('Error serving image:', error);
        return new Response('Failed to serve image', { status: 500 });
    }
};
