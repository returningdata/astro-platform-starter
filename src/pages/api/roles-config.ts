import type { APIRoute } from 'astro';
import { getStore } from '@netlify/blobs';
import { extractUserFromSession, checkPermission } from '../../utils/discord-webhook';

export const prerender = false;

// Available actions for page-level permissions
export type PermissionAction = 'view' | 'create' | 'edit' | 'delete' | 'manage';

// Page-level permission configuration
export interface PagePermission {
    pageId: string;
    actions: PermissionAction[];
    restrictions?: {
        // Field-level restrictions (e.g., can only edit certain fields)
        allowedFields?: string[];
        // Conditional restrictions (e.g., can only edit own items)
        conditions?: PermissionCondition[];
    };
}

export interface PermissionCondition {
    type: 'own_items_only' | 'max_per_day' | 'requires_approval' | 'time_restricted';
    value?: string | number | boolean;
    description?: string;
}

// Types for role configuration
export interface DiscordRoleMapping {
    id: string;
    discordRoleId: string;
    roleName: string;
    internalRole: 'super_admin' | 'subdivision_overseer' | 'custom';
    permissions: string[]; // Legacy simple permissions for backward compatibility
    pagePermissions?: PagePermission[]; // New advanced page-level permissions
    priority: number; // Higher priority roles are checked first
    description?: string;
    isActive?: boolean; // Can disable a role mapping without deleting
    createdAt?: number;
    updatedAt?: number;
}

export interface RolesConfig {
    discordRoleMappings: DiscordRoleMapping[];
    availablePermissions: PermissionDefinition[];
    pageDefinitions: PageDefinition[]; // Defines all manageable pages
}

export interface PermissionDefinition {
    id: string;
    name: string;
    description: string;
    category: 'content' | 'webhook' | 'admin' | 'other';
}

// Page definition for the permission system
export interface PageDefinition {
    id: string;
    name: string;
    description: string;
    path: string;
    category: 'content' | 'webhook' | 'admin' | 'system';
    availableActions: PermissionAction[];
    // Fields that can be individually restricted
    restrictableFields?: {
        id: string;
        name: string;
        description: string;
    }[];
    // Available conditions for this page
    availableConditions?: PermissionCondition['type'][];
}

// Default available permissions (legacy - kept for backward compatibility)
export const DEFAULT_PERMISSIONS: PermissionDefinition[] = [
    { id: 'warehouse', name: 'Warehouse', description: 'Manage inventory & images', category: 'content' },
    { id: 'events', name: 'Events', description: 'Manage community events', category: 'content' },
    { id: 'resources', name: 'Resources', description: 'Manage department resources', category: 'content' },
    { id: 'uniforms', name: 'Uniforms', description: 'Manage uniform inventory', category: 'content' },
    { id: 'theme-settings', name: 'Theme Settings', description: 'Seasonal themes & effects', category: 'content' },
    { id: 'department-data', name: 'Department Data', description: 'Awards & Chain of Command', category: 'content' },
    { id: 'department-data-subdivisions', name: 'Subdivision Data Only', description: 'Only subdivision leadership in department data', category: 'content' },
    { id: 'subdivisions', name: 'Subdivisions', description: 'Manage division availability', category: 'content' },
    { id: 'footer', name: 'Footer Settings', description: 'Customize site footer', category: 'content' },
    { id: 'user-management', name: 'User Management', description: 'Manage admin accounts', category: 'admin' },
    { id: 'roles-management', name: 'Roles Management', description: 'Manage Discord roles and permissions', category: 'admin' },
    { id: 'webhook-settings', name: 'Webhook Settings', description: 'Discord webhook configuration', category: 'webhook' },
    { id: 'chain-of-command-webhook', name: 'Chain of Command Webhook', description: 'Discord CoC auto-poster', category: 'webhook' },
    { id: 'subdivision-leadership-webhook', name: 'Subdivision Leadership Webhook', description: 'Discord subdivision poster', category: 'webhook' },
    { id: 'arrest-reports', name: 'Arrest Reports', description: 'Manage case statuses', category: 'content' },
];

// Default page definitions with granular actions
export const DEFAULT_PAGE_DEFINITIONS: PageDefinition[] = [
    {
        id: 'garage',
        name: 'Garage',
        description: 'Vehicle and image management',
        path: '/admin/garage',
        category: 'content',
        availableActions: ['view', 'create', 'edit', 'delete'],
        restrictableFields: [
            { id: 'categories', name: 'Categories', description: 'Manage vehicle categories' },
            { id: 'vehicles', name: 'Vehicles', description: 'Manage individual vehicles' },
            { id: 'images', name: 'Images', description: 'Upload and manage images' },
        ],
        availableConditions: ['own_items_only', 'max_per_day'],
    },
    {
        id: 'events',
        name: 'Events',
        description: 'Community events management',
        path: '/admin/events',
        category: 'content',
        availableActions: ['view', 'create', 'edit', 'delete'],
        restrictableFields: [
            { id: 'event_details', name: 'Event Details', description: 'Basic event information' },
            { id: 'event_status', name: 'Event Status', description: 'Change event status' },
            { id: 'event_dates', name: 'Event Dates', description: 'Modify event dates' },
        ],
        availableConditions: ['own_items_only', 'requires_approval'],
    },
    {
        id: 'resources',
        name: 'Resources',
        description: 'Department resources and documents',
        path: '/admin/resources',
        category: 'content',
        availableActions: ['view', 'create', 'edit', 'delete'],
        availableConditions: ['own_items_only'],
    },
    {
        id: 'uniforms',
        name: 'Uniforms',
        description: 'Uniform inventory management',
        path: '/admin/uniforms',
        category: 'content',
        availableActions: ['view', 'create', 'edit', 'delete'],
        restrictableFields: [
            { id: 'categories', name: 'Categories', description: 'Manage uniform categories' },
            { id: 'items', name: 'Items', description: 'Manage uniform items' },
            { id: 'availability', name: 'Availability', description: 'Change availability status' },
        ],
        availableConditions: ['own_items_only'],
    },
    {
        id: 'theme-settings',
        name: 'Theme Settings',
        description: 'Site theme and seasonal settings',
        path: '/admin/theme-settings',
        category: 'content',
        availableActions: ['view', 'edit'],
        restrictableFields: [
            { id: 'theme', name: 'Theme Selection', description: 'Change site theme' },
            { id: 'effects', name: 'Visual Effects', description: 'Configure visual effects' },
            { id: 'music', name: 'Music Settings', description: 'Configure background music' },
        ],
    },
    {
        id: 'department-data',
        name: 'Department Data',
        description: 'Awards and Chain of Command',
        path: '/admin/department-data',
        category: 'content',
        availableActions: ['view', 'create', 'edit', 'delete'],
        restrictableFields: [
            { id: 'awards', name: 'Awards', description: 'Manage awards and recipients' },
            { id: 'chain_of_command', name: 'Chain of Command', description: 'Manage command structure' },
            { id: 'subdivision_leadership', name: 'Subdivision Leadership', description: 'Manage subdivision leaders' },
        ],
        availableConditions: ['requires_approval'],
    },
    {
        id: 'subdivisions',
        name: 'Subdivisions',
        description: 'Division availability management',
        path: '/admin/subdivisions',
        category: 'content',
        availableActions: ['view', 'edit'],
        restrictableFields: [
            { id: 'availability', name: 'Availability Status', description: 'Change subdivision availability' },
            { id: 'details', name: 'Subdivision Details', description: 'Edit subdivision information' },
        ],
    },
    {
        id: 'footer',
        name: 'Footer Settings',
        description: 'Site footer customization',
        path: '/admin/footer',
        category: 'content',
        availableActions: ['view', 'edit'],
        restrictableFields: [
            { id: 'contact_info', name: 'Contact Information', description: 'Emergency and contact numbers' },
            { id: 'links', name: 'Quick Links', description: 'Footer navigation links' },
            { id: 'copyright', name: 'Copyright Text', description: 'Copyright and legal text' },
        ],
    },
    {
        id: 'user-management',
        name: 'User Management',
        description: 'Admin user accounts',
        path: '/admin/users',
        category: 'admin',
        availableActions: ['view', 'create', 'edit', 'delete', 'manage'],
        restrictableFields: [
            { id: 'basic_info', name: 'Basic Info', description: 'Username and display name' },
            { id: 'password', name: 'Password', description: 'Reset user passwords' },
            { id: 'role', name: 'Role Assignment', description: 'Assign user roles' },
            { id: 'permissions', name: 'Permissions', description: 'Assign individual permissions' },
        ],
        availableConditions: ['requires_approval'],
    },
    {
        id: 'roles-management',
        name: 'Roles & Permissions',
        description: 'Role configuration and permission management',
        path: '/admin/roles',
        category: 'admin',
        availableActions: ['view', 'create', 'edit', 'delete', 'manage'],
    },
    {
        id: 'webhook-settings',
        name: 'Webhook Settings',
        description: 'Discord webhook configuration',
        path: '/admin/webhook-settings',
        category: 'webhook',
        availableActions: ['view', 'edit'],
        restrictableFields: [
            { id: 'webhook_url', name: 'Webhook URL', description: 'Configure webhook endpoint' },
            { id: 'send_messages', name: 'Send Messages', description: 'Trigger webhook messages' },
        ],
    },
    {
        id: 'chain-of-command-webhook',
        name: 'Chain of Command Webhook',
        description: 'Automated CoC Discord posting',
        path: '/admin/chain-of-command-webhook',
        category: 'webhook',
        availableActions: ['view', 'edit', 'manage'],
        restrictableFields: [
            { id: 'webhook_config', name: 'Webhook Configuration', description: 'Configure webhook settings' },
            { id: 'manual_post', name: 'Manual Post', description: 'Trigger manual webhook post' },
        ],
    },
    {
        id: 'subdivision-leadership-webhook',
        name: 'Subdivision Leadership Webhook',
        description: 'Subdivision leadership Discord posting',
        path: '/admin/subdivision-leadership-webhook',
        category: 'webhook',
        availableActions: ['view', 'edit', 'manage'],
    },
    {
        id: 'form-builder',
        name: 'Form Builder',
        description: 'Custom form creation and management',
        path: '/admin/form-builder',
        category: 'content',
        availableActions: ['view', 'create', 'edit', 'delete'],
        restrictableFields: [
            { id: 'forms', name: 'Forms', description: 'Create and edit forms' },
            { id: 'submissions', name: 'Submissions', description: 'View form submissions' },
            { id: 'webhooks', name: 'Form Webhooks', description: 'Configure form webhooks' },
        ],
        availableConditions: ['own_items_only'],
    },
    {
        id: 'arrest-reports',
        name: 'Arrest Reports',
        description: 'Case status management',
        path: '/admin/arrest-reports',
        category: 'content',
        availableActions: ['view', 'edit'],
        restrictableFields: [
            { id: 'case_status', name: 'Case Status', description: 'Update case statuses' },
            { id: 'case_notes', name: 'Case Notes', description: 'Add notes to cases' },
        ],
        availableConditions: ['own_items_only'],
    },
    {
        id: 'arrests-database',
        name: 'Arrests Database',
        description: 'Suspect records search',
        path: '/admin/arrests-database',
        category: 'content',
        availableActions: ['view'],
    },
    {
        id: 'images',
        name: 'Image Host',
        description: 'Image hosting management',
        path: '/admin/images',
        category: 'content',
        availableActions: ['view', 'create', 'delete'],
        availableConditions: ['own_items_only', 'max_per_day'],
    },
];

// Default role configuration
const DEFAULT_ROLES_CONFIG: RolesConfig = {
    discordRoleMappings: [],
    availablePermissions: DEFAULT_PERMISSIONS,
    pageDefinitions: DEFAULT_PAGE_DEFINITIONS,
};

/**
 * Get roles configuration from blob store
 */
async function getRolesConfig(): Promise<RolesConfig> {
    try {
        const store = getStore({ name: 'roles-config', consistency: 'strong' });
        const data = await store.get('config', { type: 'json' }) as RolesConfig | null;
        if (data) {
            // Ensure all default permissions are included
            const existingPermIds = new Set(data.availablePermissions?.map(p => p.id) || []);
            const missingPerms = DEFAULT_PERMISSIONS.filter(p => !existingPermIds.has(p.id));

            // Ensure all default page definitions are included
            const existingPageIds = new Set(data.pageDefinitions?.map(p => p.id) || []);
            const missingPages = DEFAULT_PAGE_DEFINITIONS.filter(p => !existingPageIds.has(p.id));

            return {
                discordRoleMappings: data.discordRoleMappings || [],
                availablePermissions: [...(data.availablePermissions || []), ...missingPerms],
                pageDefinitions: [...(data.pageDefinitions || []), ...missingPages],
            };
        }
        return DEFAULT_ROLES_CONFIG;
    } catch (error) {
        console.error('Error fetching roles config:', error);
        return DEFAULT_ROLES_CONFIG;
    }
}

/**
 * Save roles configuration to blob store
 */
async function saveRolesConfig(config: RolesConfig): Promise<void> {
    const store = getStore({ name: 'roles-config', consistency: 'strong' });
    await store.setJSON('config', config);
}

// GET - Get current roles configuration
export const GET: APIRoute = async ({ request }) => {
    // Validate session server-side
    const user = await extractUserFromSession(request);

    if (!user) {
        return new Response(JSON.stringify({ success: false, error: 'Unauthorized' }), {
            status: 401,
            headers: { 'Content-Type': 'application/json' }
        });
    }

    // Only super admins can view roles configuration
    if (user.role !== 'super_admin') {
        return new Response(JSON.stringify({ success: false, error: 'Forbidden - Super Admin access required' }), {
            status: 403,
            headers: { 'Content-Type': 'application/json' }
        });
    }

    try {
        const config = await getRolesConfig();

        // Mask Discord role IDs for display (show only last 8 chars)
        const safeConfig = {
            ...config,
            discordRoleMappings: config.discordRoleMappings.map(mapping => ({
                ...mapping,
                discordRoleIdMasked: mapping.discordRoleId ? '***' + mapping.discordRoleId.slice(-8) : ''
            }))
        };

        return new Response(JSON.stringify({
            success: true,
            config: safeConfig
        }), {
            status: 200,
            headers: { 'Content-Type': 'application/json' }
        });
    } catch (error) {
        console.error('Error getting roles config:', error);
        return new Response(JSON.stringify({
            success: false,
            error: 'Failed to get roles configuration'
        }), {
            status: 500,
            headers: { 'Content-Type': 'application/json' }
        });
    }
};

// POST - Update roles configuration
export const POST: APIRoute = async ({ request }) => {
    // Validate session server-side
    const user = await extractUserFromSession(request);

    if (!user) {
        return new Response(JSON.stringify({ success: false, error: 'Unauthorized' }), {
            status: 401,
            headers: { 'Content-Type': 'application/json' }
        });
    }

    // Only super admins can update roles configuration
    if (user.role !== 'super_admin') {
        return new Response(JSON.stringify({ success: false, error: 'Forbidden - Super Admin access required' }), {
            status: 403,
            headers: { 'Content-Type': 'application/json' }
        });
    }

    try {
        const body = await request.json();
        const { action, roleMapping, permissionDefinition, roleMappingId, permissionId } = body;

        const currentConfig = await getRolesConfig();

        switch (action) {
            case 'addRoleMapping': {
                if (!roleMapping || !roleMapping.discordRoleId || !roleMapping.roleName) {
                    return new Response(JSON.stringify({
                        success: false,
                        error: 'Discord Role ID and Role Name are required'
                    }), {
                        status: 400,
                        headers: { 'Content-Type': 'application/json' }
                    });
                }

                // Validate Discord Role ID format (should be a numeric string)
                if (!/^\d{17,19}$/.test(roleMapping.discordRoleId)) {
                    return new Response(JSON.stringify({
                        success: false,
                        error: 'Invalid Discord Role ID format. Should be a 17-19 digit number.'
                    }), {
                        status: 400,
                        headers: { 'Content-Type': 'application/json' }
                    });
                }

                // Check for duplicate Discord Role ID
                if (currentConfig.discordRoleMappings.some(m => m.discordRoleId === roleMapping.discordRoleId)) {
                    return new Response(JSON.stringify({
                        success: false,
                        error: 'A mapping for this Discord Role ID already exists'
                    }), {
                        status: 400,
                        headers: { 'Content-Type': 'application/json' }
                    });
                }

                const newMapping: DiscordRoleMapping = {
                    id: `role-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`,
                    discordRoleId: roleMapping.discordRoleId,
                    roleName: roleMapping.roleName,
                    internalRole: roleMapping.internalRole || 'custom',
                    permissions: roleMapping.permissions || [],
                    pagePermissions: roleMapping.pagePermissions || [],
                    priority: roleMapping.priority || currentConfig.discordRoleMappings.length,
                    description: roleMapping.description || '',
                    isActive: roleMapping.isActive !== false,
                    createdAt: Date.now(),
                    updatedAt: Date.now(),
                };

                currentConfig.discordRoleMappings.push(newMapping);
                // Sort by priority (higher first)
                currentConfig.discordRoleMappings.sort((a, b) => b.priority - a.priority);

                await saveRolesConfig(currentConfig);

                return new Response(JSON.stringify({
                    success: true,
                    message: 'Role mapping added successfully',
                    roleMapping: newMapping
                }), {
                    status: 200,
                    headers: { 'Content-Type': 'application/json' }
                });
            }

            case 'updateRoleMapping': {
                if (!roleMappingId || !roleMapping) {
                    return new Response(JSON.stringify({
                        success: false,
                        error: 'Role mapping ID and data are required'
                    }), {
                        status: 400,
                        headers: { 'Content-Type': 'application/json' }
                    });
                }

                const index = currentConfig.discordRoleMappings.findIndex(m => m.id === roleMappingId);
                if (index === -1) {
                    return new Response(JSON.stringify({
                        success: false,
                        error: 'Role mapping not found'
                    }), {
                        status: 404,
                        headers: { 'Content-Type': 'application/json' }
                    });
                }

                // Validate Discord Role ID format if being changed
                if (roleMapping.discordRoleId && !/^\d{17,19}$/.test(roleMapping.discordRoleId)) {
                    return new Response(JSON.stringify({
                        success: false,
                        error: 'Invalid Discord Role ID format. Should be a 17-19 digit number.'
                    }), {
                        status: 400,
                        headers: { 'Content-Type': 'application/json' }
                    });
                }

                // Check for duplicate Discord Role ID (excluding current)
                if (roleMapping.discordRoleId &&
                    currentConfig.discordRoleMappings.some(m =>
                        m.id !== roleMappingId && m.discordRoleId === roleMapping.discordRoleId
                    )) {
                    return new Response(JSON.stringify({
                        success: false,
                        error: 'A mapping for this Discord Role ID already exists'
                    }), {
                        status: 400,
                        headers: { 'Content-Type': 'application/json' }
                    });
                }

                currentConfig.discordRoleMappings[index] = {
                    ...currentConfig.discordRoleMappings[index],
                    ...roleMapping,
                    id: roleMappingId, // Preserve the ID
                    createdAt: currentConfig.discordRoleMappings[index].createdAt, // Preserve creation time
                    updatedAt: Date.now(),
                };

                // Sort by priority (higher first)
                currentConfig.discordRoleMappings.sort((a, b) => b.priority - a.priority);

                await saveRolesConfig(currentConfig);

                return new Response(JSON.stringify({
                    success: true,
                    message: 'Role mapping updated successfully'
                }), {
                    status: 200,
                    headers: { 'Content-Type': 'application/json' }
                });
            }

            case 'deleteRoleMapping': {
                if (!roleMappingId) {
                    return new Response(JSON.stringify({
                        success: false,
                        error: 'Role mapping ID is required'
                    }), {
                        status: 400,
                        headers: { 'Content-Type': 'application/json' }
                    });
                }

                const index = currentConfig.discordRoleMappings.findIndex(m => m.id === roleMappingId);
                if (index === -1) {
                    return new Response(JSON.stringify({
                        success: false,
                        error: 'Role mapping not found'
                    }), {
                        status: 404,
                        headers: { 'Content-Type': 'application/json' }
                    });
                }

                currentConfig.discordRoleMappings.splice(index, 1);
                await saveRolesConfig(currentConfig);

                return new Response(JSON.stringify({
                    success: true,
                    message: 'Role mapping deleted successfully'
                }), {
                    status: 200,
                    headers: { 'Content-Type': 'application/json' }
                });
            }

            case 'addPermission': {
                if (!permissionDefinition || !permissionDefinition.id || !permissionDefinition.name) {
                    return new Response(JSON.stringify({
                        success: false,
                        error: 'Permission ID and Name are required'
                    }), {
                        status: 400,
                        headers: { 'Content-Type': 'application/json' }
                    });
                }

                // Validate permission ID format
                if (!/^[a-z0-9-]+$/.test(permissionDefinition.id)) {
                    return new Response(JSON.stringify({
                        success: false,
                        error: 'Permission ID must contain only lowercase letters, numbers, and hyphens'
                    }), {
                        status: 400,
                        headers: { 'Content-Type': 'application/json' }
                    });
                }

                // Check for duplicate permission ID
                if (currentConfig.availablePermissions.some(p => p.id === permissionDefinition.id)) {
                    return new Response(JSON.stringify({
                        success: false,
                        error: 'A permission with this ID already exists'
                    }), {
                        status: 400,
                        headers: { 'Content-Type': 'application/json' }
                    });
                }

                const newPermission: PermissionDefinition = {
                    id: permissionDefinition.id,
                    name: permissionDefinition.name,
                    description: permissionDefinition.description || '',
                    category: permissionDefinition.category || 'other'
                };

                currentConfig.availablePermissions.push(newPermission);
                await saveRolesConfig(currentConfig);

                return new Response(JSON.stringify({
                    success: true,
                    message: 'Permission added successfully',
                    permission: newPermission
                }), {
                    status: 200,
                    headers: { 'Content-Type': 'application/json' }
                });
            }

            case 'deletePermission': {
                if (!permissionId) {
                    return new Response(JSON.stringify({
                        success: false,
                        error: 'Permission ID is required'
                    }), {
                        status: 400,
                        headers: { 'Content-Type': 'application/json' }
                    });
                }

                // Prevent deleting default permissions
                if (DEFAULT_PERMISSIONS.some(p => p.id === permissionId)) {
                    return new Response(JSON.stringify({
                        success: false,
                        error: 'Cannot delete built-in permissions'
                    }), {
                        status: 400,
                        headers: { 'Content-Type': 'application/json' }
                    });
                }

                const index = currentConfig.availablePermissions.findIndex(p => p.id === permissionId);
                if (index === -1) {
                    return new Response(JSON.stringify({
                        success: false,
                        error: 'Permission not found'
                    }), {
                        status: 404,
                        headers: { 'Content-Type': 'application/json' }
                    });
                }

                // Remove permission from all role mappings
                currentConfig.discordRoleMappings.forEach(mapping => {
                    mapping.permissions = mapping.permissions.filter(p => p !== permissionId);
                });

                currentConfig.availablePermissions.splice(index, 1);
                await saveRolesConfig(currentConfig);

                return new Response(JSON.stringify({
                    success: true,
                    message: 'Permission deleted successfully'
                }), {
                    status: 200,
                    headers: { 'Content-Type': 'application/json' }
                });
            }

            default:
                return new Response(JSON.stringify({
                    success: false,
                    error: 'Invalid action'
                }), {
                    status: 400,
                    headers: { 'Content-Type': 'application/json' }
                });
        }
    } catch (error) {
        console.error('Error updating roles config:', error);
        return new Response(JSON.stringify({
            success: false,
            error: 'Failed to update roles configuration'
        }), {
            status: 500,
            headers: { 'Content-Type': 'application/json' }
        });
    }
};
