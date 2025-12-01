import type { APIRoute } from 'astro';
import { getStore } from '@netlify/blobs';

export const prerender = false;

export interface WarehouseItem {
    name: string;
    status: 'available' | 'limited' | 'out';
}

export interface WarehouseCategory {
    id: string;
    name: string;
    icon: string;
    items: WarehouseItem[];
    imageKey?: string; // Reference to image stored in blobs
}

// Helper to get the warehouse store
function getWarehouseStore() {
    return getStore({ name: 'warehouse', consistency: 'strong' });
}

// Helper to get the images store
function getImagesStore() {
    return getStore({ name: 'warehouse-images', consistency: 'strong' });
}

const defaultWarehouseData: WarehouseCategory[] = [
    {
        id: "2010-trainee-vehicle",
        name: "2010 Trainee Vehicle",
        icon: "vehicle",
        items: [
            { name: "11cvpitrain", status: "available" },
            { name: "Spawn Code: 6653", status: "available" }
        ]
    },
    {
        id: "2013-crown-victoria",
        name: "2013 Crown Victoria",
        icon: "vehicle",
        items: [
            { name: "legstanier", status: "available" },
            { name: "Spawn Code: 6643", status: "available" }
        ]
    },
    {
        id: "2016-dodge-charger",
        name: "2016 Dodge Charger",
        icon: "vehicle",
        items: [
            { name: "legbuffalo", status: "available" },
            { name: "Spawn Code: 6644", status: "available" }
        ]
    },
    {
        id: "2016-ford-explorer",
        name: "2016 Ford Explorer",
        icon: "vehicle",
        items: [
            { name: "legscout", status: "available" },
            { name: "Spawn Code: 6645", status: "available" }
        ]
    },
    {
        id: "2017-f150",
        name: "2017 F150",
        icon: "vehicle",
        items: [
            { name: "legcaracar", status: "available" },
            { name: "Spawn Code: 6647", status: "available" }
        ]
    },
    {
        id: "2018-dodge-charger",
        name: "2018 Dodge Charger",
        icon: "vehicle",
        items: [
            { name: "keith_bravadobuffpd", status: "available" },
            { name: "Spawn Code: 6654", status: "available" },
            { name: "Bulletproof", status: "available" }
        ]
    },
    {
        id: "2022-ford-mustang-shelby-gt500",
        name: "2022 Ford Mustang Shelby GT500",
        icon: "vehicle",
        items: [
            { name: "taz_lcdom", status: "available" },
            { name: "Spawn Code: 6649", status: "available" },
            { name: "Bulletproof", status: "available" },
            { name: "Nitrous", status: "available" }
        ]
    },
    {
        id: "2023-ram-1500",
        name: "2023 Ram 1500",
        icon: "vehicle",
        items: [
            { name: "taz_23silverbi", status: "available" },
            { name: "Spawn Code: 6650", status: "available" }
        ]
    },
    {
        id: "2019-corvette-c7",
        name: "2019 Corvette C7",
        icon: "vehicle",
        items: [
            { name: "polcoquette", status: "available" },
            { name: "Spawn Code: 6655", status: "available" }
        ]
    },
    {
        id: "aw139",
        name: "AW139",
        icon: "firearm",
        items: [
            { name: "AW139", status: "available" },
            { name: "Spawn Code: 6656", status: "available" }
        ]
    },
    {
        id: "md-500",
        name: "MD 500",
        icon: "communication",
        items: [
            { name: "buzzard2", status: "available" },
            { name: "Spawn Code: 6659", status: "available" }
        ]
    },
    {
        id: "inkas-sentry",
        name: "INKAS Sentry",
        icon: "communication",
        items: [
            { name: "gurka", status: "available" },
            { name: "Spawn Code: 6660", status: "available" }
        ]
    },
    {
        id: "2023-srt-hellfire",
        name: "2023 SRT Hellfire",
        icon: "protection",
        items: [
            { name: "leghellfire", status: "available" },
            { name: "Spawn Code: 6646", status: "available" }
        ]
    },
    {
        id: "blue-bird",
        name: "Blue Bird",
        icon: "investigation",
        items: [
            { name: "pbus", status: "available" },
            { name: "Spawn Code: 6670", status: "available" }
        ]
    }
];

async function getWarehouseData(): Promise<WarehouseCategory[]> {
    try {
        const store = getWarehouseStore();
        const data = await store.get('categories', { type: 'json' });
        if (data && Array.isArray(data)) {
            return data;
        }
        return defaultWarehouseData;
    } catch (error) {
        console.error('Error fetching warehouse data:', error);
        return defaultWarehouseData;
    }
}

export const GET: APIRoute = async ({ url }) => {
    // Check if requesting a specific image
    const imageKey = url.searchParams.get('image');
    if (imageKey) {
        try {
            const imagesStore = getImagesStore();
            const imageData = await imagesStore.get(imageKey);
            if (imageData) {
                return new Response(JSON.stringify({ image: imageData }), {
                    status: 200,
                    headers: { 'Content-Type': 'application/json' }
                });
            }
            return new Response(JSON.stringify({ image: null }), {
                status: 404,
                headers: { 'Content-Type': 'application/json' }
            });
        } catch (error) {
            console.error('Error fetching image:', error);
            return new Response(JSON.stringify({ image: null, error: 'Failed to load image' }), {
                status: 500,
                headers: { 'Content-Type': 'application/json' }
            });
        }
    }

    // Return warehouse data
    const warehouseData = await getWarehouseData();
    return new Response(JSON.stringify({ warehouse: warehouseData }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' }
    });
};

export const POST: APIRoute = async ({ request }) => {
    try {
        const data = await request.json();
        const warehouseStore = getWarehouseStore();
        const imagesStore = getImagesStore();

        // Process each category and handle images separately
        const categoriesToSave: WarehouseCategory[] = [];

        for (const category of data.warehouse) {
            const categoryToSave: WarehouseCategory = {
                id: category.id,
                name: category.name,
                icon: category.icon,
                items: category.items
            };

            // If there's a new image (base64), save it to the images store
            if (category.image && category.image.startsWith('data:')) {
                const imageKey = `category-${category.id}-${Date.now()}`;
                await imagesStore.set(imageKey, category.image);
                categoryToSave.imageKey = imageKey;

                // Delete old image if there was one
                if (category.imageKey && category.imageKey !== imageKey) {
                    try {
                        await imagesStore.delete(category.imageKey);
                    } catch (e) {
                        console.error('Failed to delete old image:', e);
                    }
                }
            } else if (category.imageKey) {
                // Keep existing image reference
                categoryToSave.imageKey = category.imageKey;
            }
            // If image was removed (no image and no imageKey), don't set imageKey

            // Handle image deletion
            if (category._deleteImage && category.imageKey) {
                try {
                    await imagesStore.delete(category.imageKey);
                } catch (e) {
                    console.error('Failed to delete image:', e);
                }
            }

            categoriesToSave.push(categoryToSave);
        }

        await warehouseStore.setJSON('categories', categoriesToSave);

        return new Response(JSON.stringify({ success: true }), {
            status: 200,
            headers: { 'Content-Type': 'application/json' }
        });
    } catch (error) {
        console.error('Error saving warehouse data:', error);
        return new Response(JSON.stringify({ success: false, error: 'Failed to save warehouse data' }), {
            status: 500,
            headers: { 'Content-Type': 'application/json' }
        });
    }
};
