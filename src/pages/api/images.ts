import type { APIRoute } from 'astro';
import { getStore } from '@netlify/blobs';

export const prerender = false;

export interface HostedImage {
    id: string;
    customName: string;
    originalName: string;
    mimeType: string;
    size: number;
    uploadedAt: string;
}

// Helper to get the images store
function getImagesStore() {
    return getStore({ name: 'hosted-images', consistency: 'strong' });
}

// Helper to get the images metadata store
function getImagesMetadataStore() {
    return getStore({ name: 'hosted-images-metadata', consistency: 'strong' });
}

// Generate a unique ID for images
function generateImageId(): string {
    const chars = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
    let result = '';
    for (let i = 0; i < 8; i++) {
        result += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    return result;
}

// Sanitize custom name for URL use
function sanitizeCustomName(name: string): string {
    return name
        .toLowerCase()
        .replace(/[^a-z0-9-_]/g, '-')
        .replace(/-+/g, '-')
        .replace(/(^-|-$)/g, '')
        .slice(0, 50);
}

// GET - List all images or get a specific image metadata
export const GET: APIRoute = async ({ url }) => {
    try {
        const imageId = url.searchParams.get('id');
        const customName = url.searchParams.get('name');

        const metadataStore = getImagesMetadataStore();

        if (imageId) {
            // Get specific image metadata by ID
            const metadata = await metadataStore.get(`id:${imageId}`, { type: 'json' });
            if (!metadata) {
                return new Response(JSON.stringify({ error: 'Image not found' }), {
                    status: 404,
                    headers: { 'Content-Type': 'application/json' }
                });
            }
            return new Response(JSON.stringify(metadata), {
                status: 200,
                headers: { 'Content-Type': 'application/json' }
            });
        }

        if (customName) {
            // Get specific image metadata by custom name
            const imageIdFromName = await metadataStore.get(`name:${customName}`, { type: 'text' });
            if (!imageIdFromName) {
                return new Response(JSON.stringify({ error: 'Image not found' }), {
                    status: 404,
                    headers: { 'Content-Type': 'application/json' }
                });
            }
            const metadata = await metadataStore.get(`id:${imageIdFromName}`, { type: 'json' });
            return new Response(JSON.stringify(metadata), {
                status: 200,
                headers: { 'Content-Type': 'application/json' }
            });
        }

        // List all images
        const { blobs } = await metadataStore.list({ prefix: 'id:' });
        const images: HostedImage[] = [];

        for (const blob of blobs) {
            const metadata = await metadataStore.get(blob.key, { type: 'json' });
            if (metadata) {
                images.push(metadata as HostedImage);
            }
        }

        // Sort by upload date, newest first
        images.sort((a, b) => new Date(b.uploadedAt).getTime() - new Date(a.uploadedAt).getTime());

        return new Response(JSON.stringify({ images }), {
            status: 200,
            headers: { 'Content-Type': 'application/json' }
        });
    } catch (error) {
        console.error('Error fetching images:', error);
        return new Response(JSON.stringify({ error: 'Failed to fetch images' }), {
            status: 500,
            headers: { 'Content-Type': 'application/json' }
        });
    }
};

// POST - Upload a new image
export const POST: APIRoute = async ({ request }) => {
    try {
        const formData = await request.formData();
        const file = formData.get('file') as File | null;
        const customNameInput = formData.get('customName') as string | null;

        if (!file) {
            return new Response(JSON.stringify({ error: 'No file provided' }), {
                status: 400,
                headers: { 'Content-Type': 'application/json' }
            });
        }

        // Validate file type
        const allowedTypes = ['image/jpeg', 'image/png', 'image/gif', 'image/webp', 'image/svg+xml'];
        if (!allowedTypes.includes(file.type)) {
            return new Response(JSON.stringify({ error: 'Invalid file type. Allowed: JPEG, PNG, GIF, WebP, SVG' }), {
                status: 400,
                headers: { 'Content-Type': 'application/json' }
            });
        }

        // Validate file size (max 10MB)
        const maxSize = 10 * 1024 * 1024;
        if (file.size > maxSize) {
            return new Response(JSON.stringify({ error: 'File too large. Maximum size is 10MB' }), {
                status: 400,
                headers: { 'Content-Type': 'application/json' }
            });
        }

        const imageStore = getImagesStore();
        const metadataStore = getImagesMetadataStore();

        // Generate unique ID
        let imageId = generateImageId();
        // Ensure ID is unique
        let existingImage = await metadataStore.get(`id:${imageId}`);
        while (existingImage) {
            imageId = generateImageId();
            existingImage = await metadataStore.get(`id:${imageId}`);
        }

        // Process custom name
        let customName = customNameInput ? sanitizeCustomName(customNameInput) : imageId;

        // Check if custom name is already taken
        const existingName = await metadataStore.get(`name:${customName}`);
        if (existingName) {
            // Append a number to make it unique
            let counter = 1;
            let newName = `${customName}-${counter}`;
            while (await metadataStore.get(`name:${newName}`)) {
                counter++;
                newName = `${customName}-${counter}`;
            }
            customName = newName;
        }

        // Get file extension from MIME type
        const extMap: Record<string, string> = {
            'image/jpeg': 'jpg',
            'image/png': 'png',
            'image/gif': 'gif',
            'image/webp': 'webp',
            'image/svg+xml': 'svg'
        };
        const extension = extMap[file.type] || 'bin';

        // Store the image data
        const imageData = await file.arrayBuffer();
        await imageStore.set(imageId, imageData);

        // Create metadata
        const metadata: HostedImage = {
            id: imageId,
            customName: customName,
            originalName: file.name,
            mimeType: file.type,
            size: file.size,
            uploadedAt: new Date().toISOString()
        };

        // Store metadata
        await metadataStore.setJSON(`id:${imageId}`, metadata);
        await metadataStore.set(`name:${customName}`, imageId);

        return new Response(JSON.stringify({
            success: true,
            image: metadata,
            urls: {
                view: `/images/${customName}`,
                raw: `/api/images/raw/${imageId}`,
                rawByName: `/api/images/raw/name/${customName}`
            }
        }), {
            status: 200,
            headers: { 'Content-Type': 'application/json' }
        });
    } catch (error) {
        console.error('Error uploading image:', error);
        return new Response(JSON.stringify({ error: 'Failed to upload image' }), {
            status: 500,
            headers: { 'Content-Type': 'application/json' }
        });
    }
};

// DELETE - Delete an image
export const DELETE: APIRoute = async ({ request }) => {
    try {
        const { id } = await request.json();

        if (!id) {
            return new Response(JSON.stringify({ error: 'No image ID provided' }), {
                status: 400,
                headers: { 'Content-Type': 'application/json' }
            });
        }

        const imageStore = getImagesStore();
        const metadataStore = getImagesMetadataStore();

        // Get metadata to find the custom name
        const metadata = await metadataStore.get(`id:${id}`, { type: 'json' }) as HostedImage | null;

        if (!metadata) {
            return new Response(JSON.stringify({ error: 'Image not found' }), {
                status: 404,
                headers: { 'Content-Type': 'application/json' }
            });
        }

        // Delete image data
        await imageStore.delete(id);

        // Delete metadata
        await metadataStore.delete(`id:${id}`);
        await metadataStore.delete(`name:${metadata.customName}`);

        return new Response(JSON.stringify({ success: true }), {
            status: 200,
            headers: { 'Content-Type': 'application/json' }
        });
    } catch (error) {
        console.error('Error deleting image:', error);
        return new Response(JSON.stringify({ error: 'Failed to delete image' }), {
            status: 500,
            headers: { 'Content-Type': 'application/json' }
        });
    }
};
