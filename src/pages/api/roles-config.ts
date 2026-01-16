import type { APIRoute } from 'astro';
import { getStore } from '@netlify/blobs';
import { extractUserFromSession, checkPermission } from '../../utils/discord-webhook';

export const prerender = false;

// Types for role configuration
export interface DiscordRoleMapping {
    id: string;
    discordRoleId: string;
    roleName: string;
    internalRole: 'super_admin' | 'subdivision_overseer' | 'custom';
    permissions: string[];
    priority: number; // Higher priority roles are checked first
    description?: string;
}

export interface RolesConfig {
    discordRoleMappings: DiscordRoleMapping[];
    availablePermissions: PermissionDefinition[];
}

export interface PermissionDefinition {
    id: string;
    name: string;
    description: string;
    category: 'content' | 'webhook' | 'admin' | 'other';
}

// Default available permissions
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

// Default role configuration
const DEFAULT_ROLES_CONFIG: RolesConfig = {
    discordRoleMappings: [],
    availablePermissions: DEFAULT_PERMISSIONS
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

            return {
                discordRoleMappings: data.discordRoleMappings || [],
                availablePermissions: [...(data.availablePermissions || []), ...missingPerms]
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
                    priority: roleMapping.priority || currentConfig.discordRoleMappings.length,
                    description: roleMapping.description || ''
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
                    id: roleMappingId // Preserve the ID
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
