import type { APIRoute } from 'astro';
import { getStore } from '@netlify/blobs';
import { logArrayDataChange, extractUserFromHeaders } from '../../utils/discord-webhook';

export const prerender = false;

export interface WarehouseItem {
    name: string;
    status: 'available' | 'limited' | 'out';
}

export interface VehicleFlag {
    name: string;
    color: string; // Tailwind color class like 'blue', 'red', 'green', etc.
}

// Available vehicle groups for sorting/categorization
// Groups are now dynamic and stored in Blobs
export type VehicleGroup = string;

// Default group order (used as fallback for new installations)
export const DEFAULT_VEHICLE_GROUPS: string[] = [
    'Training',
    'Patrol',
    'Heat',
    'Air-1/Air-Tac',
    'Transport',
    'Supervisor/Command',
    'S.W.A.T.',
    'Other'
];

// For backwards compatibility
export const VEHICLE_GROUPS = DEFAULT_VEHICLE_GROUPS;

export interface WarehouseCategory {
    id: string;
    name: string;
    icon: string;
    group?: VehicleGroup; // Vehicle group for sorting/categorization
    description?: string; // Short description of the vehicle
    spawnCode?: string; // Spawn code for the vehicle
    spawnByModel?: string; // Spawn by model code
    flags?: VehicleFlag[]; // Special permission flags (up to 10)
    items: WarehouseItem[];
    imageUrls?: string[]; // Array of image URLs (Discord CDN or Imgur links)
}

// Helper to get the warehouse store
function getWarehouseStore() {
    return getStore({ name: 'warehouse', consistency: 'strong' });
}

// Get the group order from store or return default
// Groups are now fully dynamic - no auto-adding of defaults
async function getGroupOrder(): Promise<string[]> {
    try {
        const store = getWarehouseStore();
        const data = await store.get('groupOrder', { type: 'json' });
        if (data && Array.isArray(data) && data.length > 0) {
            return data as string[];
        }
        return [...DEFAULT_VEHICLE_GROUPS];
    } catch (error) {
        console.error('Error fetching group order:', error);
        return [...DEFAULT_VEHICLE_GROUPS];
    }
}

// Sorted by category: Training - Patrol - Heat - Air-1/Air-Tac - Transport - Supervisor/Command
const defaultWarehouseData: WarehouseCategory[] = [
    // TRAINING
    {
        id: "2010-trainee-vehicle",
        name: "2010 Trainee Vehicle",
        icon: "vehicle",
        group: "Training",
        items: [
            { name: "11cvpitrain", status: "available" },
            { name: "Spawn Code: 6653", status: "available" }
        ]
    },
    // PATROL
    {
        id: "2013-crown-victoria",
        name: "2013 Crown Victoria",
        icon: "vehicle",
        group: "Patrol",
        items: [
            { name: "legstanier", status: "available" },
            { name: "Spawn Code: 6643", status: "available" }
        ]
    },
    {
        id: "2016-dodge-charger",
        name: "2016 Dodge Charger",
        icon: "vehicle",
        group: "Patrol",
        items: [
            { name: "legbuffalo", status: "available" },
            { name: "Spawn Code: 6644", status: "available" }
        ]
    },
    {
        id: "2016-ford-explorer",
        name: "2016 Ford Explorer",
        icon: "vehicle",
        group: "Patrol",
        items: [
            { name: "legscout", status: "available" },
            { name: "Spawn Code: 6645", status: "available" }
        ]
    },
    {
        id: "2017-f150",
        name: "2017 F150",
        icon: "vehicle",
        group: "Patrol",
        items: [
            { name: "legcaracar", status: "available" },
            { name: "Spawn Code: 6647", status: "available" }
        ]
    },
    {
        id: "2023-ram-1500",
        name: "2023 Ram 1500",
        icon: "vehicle",
        group: "Patrol",
        items: [
            { name: "taz_23silverbi", status: "available" },
            { name: "Spawn Code: 6650", status: "available" }
        ]
    },
    // HEAT
    {
        id: "2018-dodge-charger",
        name: "2018 Dodge Charger",
        icon: "vehicle",
        group: "Heat",
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
        group: "Heat",
        items: [
            { name: "taz_lcdom", status: "available" },
            { name: "Spawn Code: 6649", status: "available" },
            { name: "Bulletproof", status: "available" },
            { name: "Nitrous", status: "available" }
        ]
    },
    {
        id: "2019-corvette-c7",
        name: "2019 Corvette C7",
        icon: "vehicle",
        group: "Heat",
        items: [
            { name: "polcoquette", status: "available" },
            { name: "Spawn Code: 6655", status: "available" }
        ]
    },
    {
        id: "2023-srt-hellfire",
        name: "2023 SRT Hellfire",
        icon: "protection",
        group: "Heat",
        items: [
            { name: "leghellfire", status: "available" },
            { name: "Spawn Code: 6646", status: "available" }
        ]
    },
    // AIR-1/AIR-TAC
    {
        id: "aw139",
        name: "AW139",
        icon: "firearm",
        group: "Air-1/Air-Tac",
        items: [
            { name: "AW139", status: "available" },
            { name: "Spawn Code: 6656", status: "available" }
        ]
    },
    {
        id: "md-500",
        name: "MD 500",
        icon: "communication",
        group: "Air-1/Air-Tac",
        items: [
            { name: "buzzard2", status: "available" },
            { name: "Spawn Code: 6659", status: "available" }
        ]
    },
    // TRANSPORT
    {
        id: "blue-bird",
        name: "Blue Bird",
        icon: "investigation",
        group: "Transport",
        items: [
            { name: "pbus", status: "available" },
            { name: "Spawn Code: 6670", status: "available" }
        ]
    },
    // SUPERVISOR/COMMAND
    {
        id: "inkas-sentry",
        name: "INKAS Sentry",
        icon: "communication",
        group: "Supervisor/Command",
        items: [
            { name: "gurka", status: "available" },
            { name: "Spawn Code: 6660", status: "available" }
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
    // Return warehouse data and group order
    try {
        const [warehouseData, groupOrder] = await Promise.all([
            getWarehouseData(),
            getGroupOrder()
        ]);
        return new Response(JSON.stringify({ warehouse: warehouseData, groupOrder }), {
            status: 200,
            headers: { 'Content-Type': 'application/json' }
        });
    } catch (error) {
        console.error('Error fetching warehouse data:', error);
        return new Response(JSON.stringify({ warehouse: defaultWarehouseData, groupOrder: DEFAULT_VEHICLE_GROUPS }), {
            status: 200,
            headers: { 'Content-Type': 'application/json' }
        });
    }
};

export const POST: APIRoute = async ({ request }) => {
    const user = extractUserFromHeaders(request);

    try {
        const data = await request.json();
        const warehouseStore = getWarehouseStore();

        // Get current data for comparison
        const oldData = await getWarehouseData();

        // Handle group order update if provided
        // Groups are now fully dynamic - allow any string values
        if (data.groupOrder && Array.isArray(data.groupOrder)) {
            // Filter to only include non-empty strings
            const validGroupOrder = data.groupOrder
                .filter((group: any) => group && typeof group === 'string' && group.trim() !== '')
                .map((group: string) => group.trim());

            // Only save if there's at least one group
            if (validGroupOrder.length > 0) {
                await warehouseStore.setJSON('groupOrder', validGroupOrder);
            }
        }

        // Process each category - now using image URLs instead of blob storage
        const categoriesToSave: WarehouseCategory[] = [];

        for (const category of data.warehouse) {
            const categoryToSave: WarehouseCategory = {
                id: category.id,
                name: category.name,
                icon: category.icon,
                items: category.items
            };

            // Handle group - now accepts any non-empty string
            if (category.group && typeof category.group === 'string' && category.group.trim() !== '') {
                categoryToSave.group = category.group.trim();
            }

            // Handle optional description
            if (category.description && typeof category.description === 'string') {
                categoryToSave.description = category.description.trim();
            }

            // Handle spawn codes
            if (category.spawnCode && typeof category.spawnCode === 'string') {
                categoryToSave.spawnCode = category.spawnCode.trim();
            }
            if (category.spawnByModel && typeof category.spawnByModel === 'string') {
                categoryToSave.spawnByModel = category.spawnByModel.trim();
            }

            // Handle flags (up to 10)
            if (category.flags && Array.isArray(category.flags)) {
                const validFlags = category.flags
                    .filter((flag: any) => flag && flag.name && typeof flag.name === 'string')
                    .slice(0, 10) // Max 10 flags
                    .map((flag: any) => ({
                        name: flag.name.trim(),
                        color: flag.color || 'blue'
                    }));
                if (validFlags.length > 0) {
                    categoryToSave.flags = validFlags;
                }
            }

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

        // Log the change to Discord
        await logArrayDataChange(
            'WAREHOUSE',
            user,
            oldData,
            categoriesToSave,
            'id',
            'name',
            true
        );

        return new Response(JSON.stringify({ success: true }), {
            status: 200,
            headers: { 'Content-Type': 'application/json' }
        });
    } catch (error) {
        console.error('Error saving warehouse data:', error);

        // Log the failed attempt
        await logArrayDataChange(
            'WAREHOUSE',
            user,
            [],
            [],
            'id',
            'name',
            false,
            'Failed to save warehouse data'
        );

        return new Response(JSON.stringify({ success: false, error: 'Failed to save warehouse data' }), {
            status: 500,
            headers: { 'Content-Type': 'application/json' }
        });
    }
};
