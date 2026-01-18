import type { APIRoute } from 'astro';
import { getStore } from '@netlify/blobs';
import { extractUserFromSession, checkPermission } from '../../utils/discord-webhook';

export const prerender = false;

// Available actions for page-level permissions
export type PermissionAction = 'view' | 'create' | 'edit' | 'delete' | 'manage' | 'export' | 'import' | 'bulk_edit' | 'archive' | 'restore';

// Sub-action definitions for granular control
export type SubAction =
    // View sub-actions
    | 'view_list' | 'view_details' | 'view_history' | 'view_analytics' | 'view_sensitive'
    // Create sub-actions
    | 'create_draft' | 'create_publish' | 'create_template'
    // Edit sub-actions
    | 'edit_content' | 'edit_metadata' | 'edit_status' | 'edit_permissions' | 'edit_settings'
    // Delete sub-actions
    | 'delete_soft' | 'delete_permanent' | 'delete_bulk'
    // Manage sub-actions
    | 'manage_users' | 'manage_settings' | 'manage_integrations' | 'manage_webhooks';

// Page-level permission configuration
export interface PagePermission {
    pageId: string;
    actions: PermissionAction[];
    // New: Sub-actions for granular control within each action
    subActions?: SubAction[];
    restrictions?: {
        // Field-level restrictions (e.g., can only edit certain fields)
        allowedFields?: string[];
        // Blocked fields (inverse of allowedFields)
        blockedFields?: string[];
        // Conditional restrictions (e.g., can only edit own items)
        conditions?: PermissionCondition[];
        // Time-based restrictions
        timeRestrictions?: TimeRestriction;
        // Quantity limits
        limits?: QuantityLimit[];
    };
}

// Time-based access restrictions
export interface TimeRestriction {
    // Days of week allowed (0 = Sunday, 6 = Saturday)
    allowedDays?: number[];
    // Time windows (24-hour format, e.g., "09:00-17:00")
    allowedHours?: { start: string; end: string }[];
    // Timezone for time calculations
    timezone?: string;
}

// Quantity/rate limits
export interface QuantityLimit {
    type: 'per_hour' | 'per_day' | 'per_week' | 'per_month' | 'total';
    action: PermissionAction;
    limit: number;
}

export interface PermissionCondition {
    type: 'own_items_only' | 'max_per_day' | 'requires_approval' | 'time_restricted' | 'requires_2fa' | 'ip_whitelist' | 'subdivision_only';
    value?: string | number | boolean;
    description?: string;
    // For ip_whitelist condition
    allowedIps?: string[];
    // For subdivision_only condition
    subdivisionIds?: string[];
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
    // Sub-actions available for this page
    availableSubActions?: SubAction[];
    // Fields that can be individually restricted
    restrictableFields?: {
        id: string;
        name: string;
        description: string;
        // Which actions this field applies to
        forActions?: PermissionAction[];
        // Whether this field contains sensitive data
        sensitive?: boolean;
    }[];
    // Available conditions for this page
    availableConditions?: PermissionCondition['type'][];
    // Whether this page supports time-based restrictions
    supportsTimeRestrictions?: boolean;
    // Whether this page supports quantity limits
    supportsLimits?: boolean;
    // Custom permission notes for this page
    notes?: string;
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
        availableActions: ['view', 'create', 'edit', 'delete', 'export', 'import', 'bulk_edit'],
        availableSubActions: ['view_list', 'view_details', 'view_history', 'create_draft', 'create_publish', 'edit_content', 'edit_metadata', 'edit_status', 'delete_soft', 'delete_permanent', 'delete_bulk'],
        restrictableFields: [
            { id: 'categories', name: 'Categories', description: 'Manage vehicle categories', forActions: ['create', 'edit', 'delete'] },
            { id: 'vehicles', name: 'Vehicles', description: 'Manage individual vehicles', forActions: ['create', 'edit', 'delete'] },
            { id: 'images', name: 'Images', description: 'Upload and manage images', forActions: ['create', 'edit', 'delete'] },
            { id: 'pricing', name: 'Pricing Info', description: 'Vehicle pricing details', forActions: ['view', 'edit'], sensitive: true },
        ],
        availableConditions: ['own_items_only', 'max_per_day', 'requires_approval', 'subdivision_only'],
        supportsTimeRestrictions: true,
        supportsLimits: true,
    },
    {
        id: 'events',
        name: 'Events',
        description: 'Community events management',
        path: '/admin/events',
        category: 'content',
        availableActions: ['view', 'create', 'edit', 'delete', 'archive', 'restore'],
        availableSubActions: ['view_list', 'view_details', 'view_analytics', 'create_draft', 'create_publish', 'edit_content', 'edit_status', 'edit_metadata', 'delete_soft', 'delete_permanent'],
        restrictableFields: [
            { id: 'event_details', name: 'Event Details', description: 'Basic event information', forActions: ['create', 'edit'] },
            { id: 'event_status', name: 'Event Status', description: 'Change event status', forActions: ['edit'] },
            { id: 'event_dates', name: 'Event Dates', description: 'Modify event dates', forActions: ['create', 'edit'] },
            { id: 'event_capacity', name: 'Event Capacity', description: 'Attendee limits', forActions: ['create', 'edit'] },
            { id: 'event_location', name: 'Event Location', description: 'Location details', forActions: ['create', 'edit'] },
        ],
        availableConditions: ['own_items_only', 'requires_approval', 'time_restricted'],
        supportsTimeRestrictions: true,
        supportsLimits: true,
    },
    {
        id: 'resources',
        name: 'Resources',
        description: 'Department resources and documents',
        path: '/admin/resources',
        category: 'content',
        availableActions: ['view', 'create', 'edit', 'delete', 'export'],
        availableSubActions: ['view_list', 'view_details', 'view_sensitive', 'create_draft', 'create_publish', 'edit_content', 'edit_metadata', 'delete_soft', 'delete_permanent'],
        restrictableFields: [
            { id: 'public_resources', name: 'Public Resources', description: 'Publicly accessible resources', forActions: ['create', 'edit', 'delete'] },
            { id: 'restricted_resources', name: 'Restricted Resources', description: 'Internal-only resources', forActions: ['view', 'create', 'edit', 'delete'], sensitive: true },
            { id: 'categories', name: 'Resource Categories', description: 'Organize resources', forActions: ['create', 'edit', 'delete'] },
        ],
        availableConditions: ['own_items_only', 'subdivision_only'],
        supportsLimits: true,
    },
    {
        id: 'uniforms',
        name: 'Uniforms',
        description: 'Uniform inventory management',
        path: '/admin/uniforms',
        category: 'content',
        availableActions: ['view', 'create', 'edit', 'delete', 'bulk_edit', 'export', 'import'],
        availableSubActions: ['view_list', 'view_details', 'create_draft', 'create_publish', 'edit_content', 'edit_status', 'edit_metadata', 'delete_soft', 'delete_bulk'],
        restrictableFields: [
            { id: 'categories', name: 'Categories', description: 'Manage uniform categories', forActions: ['create', 'edit', 'delete'] },
            { id: 'items', name: 'Items', description: 'Manage uniform items', forActions: ['create', 'edit', 'delete'] },
            { id: 'availability', name: 'Availability', description: 'Change availability status', forActions: ['edit'] },
            { id: 'inventory_count', name: 'Inventory Count', description: 'Stock quantities', forActions: ['view', 'edit'], sensitive: true },
        ],
        availableConditions: ['own_items_only', 'requires_approval'],
        supportsLimits: true,
    },
    {
        id: 'theme-settings',
        name: 'Theme Settings',
        description: 'Site theme and seasonal settings',
        path: '/admin/theme-settings',
        category: 'content',
        availableActions: ['view', 'edit'],
        availableSubActions: ['view_details', 'edit_settings'],
        restrictableFields: [
            { id: 'theme', name: 'Theme Selection', description: 'Change site theme', forActions: ['edit'] },
            { id: 'effects', name: 'Visual Effects', description: 'Configure visual effects', forActions: ['edit'] },
            { id: 'music', name: 'Music Settings', description: 'Configure background music', forActions: ['edit'] },
            { id: 'colors', name: 'Color Scheme', description: 'Custom color settings', forActions: ['edit'] },
        ],
        availableConditions: ['requires_approval'],
        notes: 'Theme changes affect all site visitors immediately',
    },
    {
        id: 'department-data',
        name: 'Department Data',
        description: 'Awards and Chain of Command',
        path: '/admin/department-data',
        category: 'content',
        availableActions: ['view', 'create', 'edit', 'delete', 'export'],
        availableSubActions: ['view_list', 'view_details', 'view_history', 'create_draft', 'create_publish', 'edit_content', 'edit_status', 'edit_metadata', 'delete_soft', 'delete_permanent'],
        restrictableFields: [
            { id: 'awards', name: 'Awards', description: 'Manage awards and recipients', forActions: ['create', 'edit', 'delete'] },
            { id: 'chain_of_command', name: 'Chain of Command', description: 'Manage command structure', forActions: ['create', 'edit', 'delete'] },
            { id: 'subdivision_leadership', name: 'Subdivision Leadership', description: 'Manage subdivision leaders', forActions: ['create', 'edit', 'delete'] },
            { id: 'personnel_records', name: 'Personnel Records', description: 'Officer personnel data', forActions: ['view', 'edit'], sensitive: true },
            { id: 'rank_structure', name: 'Rank Structure', description: 'Department rank hierarchy', forActions: ['view', 'edit'] },
        ],
        availableConditions: ['requires_approval', 'subdivision_only'],
        supportsTimeRestrictions: true,
    },
    {
        id: 'subdivisions',
        name: 'Subdivisions',
        description: 'Division availability management',
        path: '/admin/subdivisions',
        category: 'content',
        availableActions: ['view', 'edit'],
        availableSubActions: ['view_list', 'view_details', 'view_analytics', 'edit_content', 'edit_status', 'edit_settings'],
        restrictableFields: [
            { id: 'availability', name: 'Availability Status', description: 'Change subdivision availability', forActions: ['edit'] },
            { id: 'details', name: 'Subdivision Details', description: 'Edit subdivision information', forActions: ['edit'] },
            { id: 'roster', name: 'Subdivision Roster', description: 'Member assignments', forActions: ['view', 'edit'] },
            { id: 'requirements', name: 'Requirements', description: 'Joining requirements', forActions: ['view', 'edit'] },
        ],
        availableConditions: ['subdivision_only', 'requires_approval'],
    },
    {
        id: 'footer',
        name: 'Footer Settings',
        description: 'Site footer customization',
        path: '/admin/footer',
        category: 'content',
        availableActions: ['view', 'edit'],
        availableSubActions: ['view_details', 'edit_content', 'edit_settings'],
        restrictableFields: [
            { id: 'contact_info', name: 'Contact Information', description: 'Emergency and contact numbers', forActions: ['edit'] },
            { id: 'links', name: 'Quick Links', description: 'Footer navigation links', forActions: ['edit'] },
            { id: 'copyright', name: 'Copyright Text', description: 'Copyright and legal text', forActions: ['edit'] },
            { id: 'social_media', name: 'Social Media', description: 'Social media links', forActions: ['edit'] },
        ],
        availableConditions: ['requires_approval'],
    },
    {
        id: 'user-management',
        name: 'User Management',
        description: 'Admin user accounts',
        path: '/admin/users',
        category: 'admin',
        availableActions: ['view', 'create', 'edit', 'delete', 'manage'],
        availableSubActions: ['view_list', 'view_details', 'view_history', 'view_sensitive', 'create_publish', 'edit_content', 'edit_permissions', 'edit_status', 'delete_soft', 'delete_permanent', 'manage_users'],
        restrictableFields: [
            { id: 'basic_info', name: 'Basic Info', description: 'Username and display name', forActions: ['create', 'edit'] },
            { id: 'password', name: 'Password', description: 'Reset user passwords', forActions: ['edit'], sensitive: true },
            { id: 'role', name: 'Role Assignment', description: 'Assign user roles', forActions: ['create', 'edit'] },
            { id: 'permissions', name: 'Permissions', description: 'Assign individual permissions', forActions: ['create', 'edit'] },
            { id: 'page_permissions', name: 'Page Permissions', description: 'Granular page access', forActions: ['create', 'edit'] },
            { id: 'activity_log', name: 'Activity Log', description: 'User activity history', forActions: ['view'], sensitive: true },
        ],
        availableConditions: ['requires_approval', 'requires_2fa'],
        supportsLimits: true,
        notes: 'Changes to user permissions take effect immediately',
    },
    {
        id: 'roles-management',
        name: 'Roles & Permissions',
        description: 'Role configuration and permission management',
        path: '/admin/roles',
        category: 'admin',
        availableActions: ['view', 'create', 'edit', 'delete', 'manage', 'export', 'import'],
        availableSubActions: ['view_list', 'view_details', 'view_history', 'create_publish', 'create_template', 'edit_content', 'edit_permissions', 'edit_settings', 'delete_permanent', 'manage_settings'],
        restrictableFields: [
            { id: 'role_mappings', name: 'Role Mappings', description: 'Discord to internal role mappings', forActions: ['create', 'edit', 'delete'] },
            { id: 'page_definitions', name: 'Page Definitions', description: 'Available pages and actions', forActions: ['view', 'edit'] },
            { id: 'permission_templates', name: 'Permission Templates', description: 'Saved permission configurations', forActions: ['create', 'edit', 'delete'] },
        ],
        availableConditions: ['requires_2fa'],
        notes: 'Super Admin only - Changes affect all role assignments',
    },
    {
        id: 'webhook-settings',
        name: 'Webhook Settings',
        description: 'Discord webhook configuration',
        path: '/admin/webhook-settings',
        category: 'webhook',
        availableActions: ['view', 'edit', 'manage'],
        availableSubActions: ['view_details', 'view_sensitive', 'edit_settings', 'manage_webhooks', 'manage_integrations'],
        restrictableFields: [
            { id: 'webhook_url', name: 'Webhook URL', description: 'Configure webhook endpoint', forActions: ['view', 'edit'], sensitive: true },
            { id: 'send_messages', name: 'Send Messages', description: 'Trigger webhook messages', forActions: ['manage'] },
            { id: 'message_templates', name: 'Message Templates', description: 'Webhook message formats', forActions: ['view', 'edit'] },
        ],
        availableConditions: ['requires_approval', 'ip_whitelist'],
    },
    {
        id: 'chain-of-command-webhook',
        name: 'Chain of Command Webhook',
        description: 'Automated CoC Discord posting',
        path: '/admin/chain-of-command-webhook',
        category: 'webhook',
        availableActions: ['view', 'edit', 'manage'],
        availableSubActions: ['view_details', 'view_history', 'edit_settings', 'manage_webhooks'],
        restrictableFields: [
            { id: 'webhook_config', name: 'Webhook Configuration', description: 'Configure webhook settings', forActions: ['edit'], sensitive: true },
            { id: 'manual_post', name: 'Manual Post', description: 'Trigger manual webhook post', forActions: ['manage'] },
            { id: 'schedule', name: 'Post Schedule', description: 'Automated posting schedule', forActions: ['view', 'edit'] },
        ],
        availableConditions: ['requires_approval'],
        supportsTimeRestrictions: true,
    },
    {
        id: 'subdivision-leadership-webhook',
        name: 'Subdivision Leadership Webhook',
        description: 'Subdivision leadership Discord posting',
        path: '/admin/subdivision-leadership-webhook',
        category: 'webhook',
        availableActions: ['view', 'edit', 'manage'],
        availableSubActions: ['view_details', 'view_history', 'edit_settings', 'manage_webhooks'],
        restrictableFields: [
            { id: 'webhook_config', name: 'Webhook Configuration', description: 'Configure webhook settings', forActions: ['edit'], sensitive: true },
            { id: 'manual_post', name: 'Manual Post', description: 'Trigger manual posting', forActions: ['manage'] },
        ],
        availableConditions: ['subdivision_only', 'requires_approval'],
    },
    {
        id: 'form-builder',
        name: 'Form Builder',
        description: 'Custom form creation and management',
        path: '/admin/form-builder',
        category: 'content',
        availableActions: ['view', 'create', 'edit', 'delete', 'export', 'import'],
        availableSubActions: ['view_list', 'view_details', 'view_analytics', 'create_draft', 'create_publish', 'create_template', 'edit_content', 'edit_settings', 'delete_soft', 'delete_permanent'],
        restrictableFields: [
            { id: 'forms', name: 'Forms', description: 'Create and edit forms', forActions: ['create', 'edit', 'delete'] },
            { id: 'submissions', name: 'Submissions', description: 'View form submissions', forActions: ['view', 'delete'], sensitive: true },
            { id: 'webhooks', name: 'Form Webhooks', description: 'Configure form webhooks', forActions: ['create', 'edit', 'delete'] },
            { id: 'templates', name: 'Form Templates', description: 'Saved form templates', forActions: ['create', 'edit', 'delete'] },
        ],
        availableConditions: ['own_items_only', 'requires_approval'],
        supportsLimits: true,
    },
    {
        id: 'arrest-reports',
        name: 'Arrest Reports',
        description: 'Case status management',
        path: '/admin/arrest-reports',
        category: 'content',
        availableActions: ['view', 'edit', 'export'],
        availableSubActions: ['view_list', 'view_details', 'view_history', 'view_sensitive', 'edit_content', 'edit_status'],
        restrictableFields: [
            { id: 'case_status', name: 'Case Status', description: 'Update case statuses', forActions: ['edit'] },
            { id: 'case_notes', name: 'Case Notes', description: 'Add notes to cases', forActions: ['view', 'edit'] },
            { id: 'suspect_info', name: 'Suspect Information', description: 'Suspect personal data', forActions: ['view'], sensitive: true },
            { id: 'officer_notes', name: 'Officer Notes', description: 'Internal officer notes', forActions: ['view', 'edit'], sensitive: true },
        ],
        availableConditions: ['own_items_only', 'subdivision_only'],
        supportsTimeRestrictions: true,
    },
    {
        id: 'arrests-database',
        name: 'Arrests Database',
        description: 'Suspect records search',
        path: '/admin/arrests-database',
        category: 'content',
        availableActions: ['view', 'export'],
        availableSubActions: ['view_list', 'view_details', 'view_sensitive', 'view_history'],
        restrictableFields: [
            { id: 'basic_info', name: 'Basic Info', description: 'Basic arrest records', forActions: ['view'] },
            { id: 'detailed_records', name: 'Detailed Records', description: 'Full arrest details', forActions: ['view'], sensitive: true },
        ],
        availableConditions: ['subdivision_only'],
    },
    {
        id: 'images',
        name: 'Image Host',
        description: 'Image hosting management',
        path: '/admin/images',
        category: 'content',
        availableActions: ['view', 'create', 'delete', 'bulk_edit'],
        availableSubActions: ['view_list', 'view_details', 'create_publish', 'delete_soft', 'delete_permanent', 'delete_bulk'],
        restrictableFields: [
            { id: 'upload', name: 'Upload Images', description: 'Upload new images', forActions: ['create'] },
            { id: 'organize', name: 'Organize', description: 'Organize and tag images', forActions: ['edit'] },
            { id: 'delete', name: 'Delete Images', description: 'Remove images', forActions: ['delete'] },
        ],
        availableConditions: ['own_items_only', 'max_per_day'],
        supportsLimits: true,
        notes: 'Daily upload limits may apply',
    },
    {
        id: 'site-info',
        name: 'Site Information',
        description: 'Site settings and maintenance mode',
        path: '/admin/site-info',
        category: 'system',
        availableActions: ['view', 'edit', 'manage'],
        availableSubActions: ['view_details', 'edit_settings', 'manage_settings'],
        restrictableFields: [
            { id: 'site_name', name: 'Site Name', description: 'Site title and branding', forActions: ['edit'] },
            { id: 'maintenance_mode', name: 'Maintenance Mode', description: 'Enable/disable maintenance', forActions: ['edit', 'manage'] },
            { id: 'version', name: 'Version Info', description: 'Site version information', forActions: ['view', 'edit'] },
            { id: 'advanced_settings', name: 'Advanced Settings', description: 'Advanced configuration', forActions: ['edit'], sensitive: true },
        ],
        availableConditions: ['requires_2fa'],
        notes: 'Maintenance mode blocks all non-admin access',
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
