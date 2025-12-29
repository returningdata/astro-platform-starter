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
    imageUrls?: string[]; // Array of image URLs (Discord CDN or Imgur links)
}

// Helper to get the warehouse store
function getWarehouseStore() {
    return getStore({ name: 'warehouse', consistency: 'strong' });
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
    // Return warehouse data
    try {
        const warehouseData = await getWarehouseData();
        return new Response(JSON.stringify({ warehouse: warehouseData }), {
            status: 200,
            headers: { 'Content-Type': 'application/json' }
        });
    } catch (error) {
        console.error('Error fetching warehouse data:', error);
        return new Response(JSON.stringify({ warehouse: defaultWarehouseData }), {
            status: 200,
            headers: { 'Content-Type': 'application/json' }
        });
    }
};

export const POST: APIRoute = async ({ request }) => {
    try {
        const data = await request.json();
        const warehouseStore = getWarehouseStore();

        // Process each category - now using image URLs instead of blob storage
        const categoriesToSave: WarehouseCategory[] = [];

        for (const category of data.warehouse) {
            const categoryToSave: WarehouseCategory = {
                id: category.id,
                name: category.name,
                icon: category.icon,
                items: category.items
            };

            // Handle image URLs (Discord CDN or Imgur links)
            if (category.imageUrls && Array.isArray(category.imageUrls)) {
                // Filter to only include valid URLs
                const validUrls = category.imageUrls.filter((url: string) =>
                    url && typeof url === 'string' && url.trim() !== ''
                );
                if (validUrls.length > 0) {
                    categoryToSave.imageUrls = validUrls;
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
