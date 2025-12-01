import type { APIRoute } from 'astro';
import { getStore } from '@netlify/blobs';

export const prerender = false;

export const POST: APIRoute = async ({ request }) => {
    try {
        const formData = await request.formData();
        const file = formData.get('image') as File;
        const categoryId = formData.get('categoryId') as string;

        if (!file || !categoryId) {
            return new Response(JSON.stringify({ success: false, error: 'Missing image or category ID' }), {
                status: 400,
                headers: { 'Content-Type': 'application/json' }
            });
        }

        // Validate file type
        const validTypes = ['image/jpeg', 'image/png', 'image/webp', 'image/gif'];
        if (!validTypes.includes(file.type)) {
            return new Response(JSON.stringify({ success: false, error: 'Invalid file type. Please upload a JPEG, PNG, WebP, or GIF image.' }), {
                status: 400,
                headers: { 'Content-Type': 'application/json' }
            });
        }

        // Validate file size (max 5MB)
        const maxSize = 5 * 1024 * 1024;
        if (file.size > maxSize) {
            return new Response(JSON.stringify({ success: false, error: 'File too large. Maximum size is 5MB.' }), {
                status: 400,
                headers: { 'Content-Type': 'application/json' }
            });
        }

        const store = getStore({ name: 'warehouse-images', consistency: 'strong' });

        // Get file extension from mime type
        const extension = file.type.split('/')[1];
        const imageKey = `${categoryId}.${extension}`;

        // Convert file to ArrayBuffer
        const arrayBuffer = await file.arrayBuffer();

        // Store the image with metadata
        await store.set(imageKey, arrayBuffer, {
            metadata: {
                contentType: file.type,
                originalName: file.name,
                categoryId,
                uploadedAt: new Date().toISOString()
            }
        });

        // Return the URL to access the image
        const imageUrl = `/api/warehouse/image/${categoryId}`;

        return new Response(JSON.stringify({
            success: true,
            imageUrl,
            imageKey
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
