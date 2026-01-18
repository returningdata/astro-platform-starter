/**
 * Advanced Permission Checking Utility
 *
 * Provides granular page-level permission checking with support for:
 * - Action-based permissions (view, create, edit, delete, manage)
 * - Field-level restrictions
 * - Conditional permissions (own items only, max per day, etc.)
 */

import { getStore } from '@netlify/blobs';
import type { AdminUser } from './session';

// Permission action types
export type PermissionAction = 'view' | 'create' | 'edit' | 'delete' | 'manage';

// Condition types for restricted permissions
export type ConditionType = 'own_items_only' | 'max_per_day' | 'requires_approval' | 'time_restricted';

export interface PermissionCondition {
    type: ConditionType;
    value?: string | number | boolean;
    description?: string;
}

export interface PagePermission {
    pageId: string;
    actions: PermissionAction[];
    restrictions?: {
        allowedFields?: string[];
        conditions?: PermissionCondition[];
    };
}

export interface PermissionCheckResult {
    allowed: boolean;
    reason?: string;
    restrictions?: {
        allowedFields?: string[];
        conditions?: PermissionCondition[];
    };
}

// Cache for roles config to avoid repeated blob reads
let rolesConfigCache: RolesConfig | null = null;
let cacheTimestamp = 0;
const CACHE_TTL = 60000; // 1 minute cache

interface DiscordRoleMapping {
    id: string;
    discordRoleId: string;
    roleName: string;
    internalRole: 'super_admin' | 'subdivision_overseer' | 'custom';
    permissions: string[];
    pagePermissions?: PagePermission[];
    priority: number;
    description?: string;
    isActive?: boolean;
}

interface RolesConfig {
    discordRoleMappings: DiscordRoleMapping[];
    pageDefinitions?: PageDefinition[];
}

interface PageDefinition {
    id: string;
    name: string;
    availableActions: PermissionAction[];
    restrictableFields?: { id: string; name: string; description: string; }[];
    availableConditions?: ConditionType[];
}

/**
 * Get the roles configuration from blob store with caching
 */
async function getRolesConfig(): Promise<RolesConfig | null> {
    const now = Date.now();
    if (rolesConfigCache && (now - cacheTimestamp) < CACHE_TTL) {
        return rolesConfigCache;
    }

    try {
        const store = getStore({ name: 'roles-config', consistency: 'strong' });
        const data = await store.get('config', { type: 'json' }) as RolesConfig | null;
        if (data) {
            rolesConfigCache = data;
            cacheTimestamp = now;
        }
        return data;
    } catch (error) {
        console.error('Error fetching roles config:', error);
        return null;
    }
}

/**
 * Clear the roles config cache (call after updates)
 */
export function clearPermissionCache(): void {
    rolesConfigCache = null;
    cacheTimestamp = 0;
}

/**
 * Check if a user has permission to perform an action on a specific page
 */
export async function checkPagePermission(
    user: AdminUser | null,
    pageId: string,
    action: PermissionAction,
    context?: {
        itemOwnerId?: string;
        fieldId?: string;
    }
): Promise<PermissionCheckResult> {
    // No user = no access
    if (!user) {
        return { allowed: false, reason: 'Not authenticated' };
    }

    // Super admin has full access
    if (user.role === 'super_admin') {
        return { allowed: true };
    }

    // Get the user's page permissions
    const pagePermissions = await getUserPagePermissions(user, pageId);

    if (!pagePermissions) {
        // Fall back to legacy permission check
        const legacyPermId = getLegacyPermissionId(pageId);
        if (legacyPermId && user.permissions.includes(legacyPermId)) {
            // Legacy permission grants view and edit for backward compatibility
            if (action === 'view' || action === 'edit' || action === 'create') {
                return { allowed: true };
            }
        }

        // Special handling for subdivision overseer
        if (user.role === 'subdivision_overseer') {
            if (pageId === 'subdivisions' || pageId === 'department-data') {
                if (action === 'view' || action === 'edit') {
                    return {
                        allowed: true,
                        restrictions: {
                            allowedFields: ['subdivision_leadership', 'availability'],
                        }
                    };
                }
            }
        }

        return { allowed: false, reason: 'No permission for this page' };
    }

    // Check if the action is allowed
    if (!pagePermissions.actions.includes(action)) {
        return { allowed: false, reason: `Action '${action}' not permitted on this page` };
    }

    // Check field restrictions
    if (context?.fieldId && pagePermissions.restrictions?.allowedFields) {
        if (!pagePermissions.restrictions.allowedFields.includes(context.fieldId)) {
            return { allowed: false, reason: `Not permitted to modify field '${context.fieldId}'` };
        }
    }

    // Check conditions
    if (pagePermissions.restrictions?.conditions) {
        for (const condition of pagePermissions.restrictions.conditions) {
            const conditionResult = await checkCondition(condition, user, context);
            if (!conditionResult.allowed) {
                return conditionResult;
            }
        }
    }

    return {
        allowed: true,
        restrictions: pagePermissions.restrictions,
    };
}

/**
 * Get page permissions for a user from their role mapping
 */
async function getUserPagePermissions(user: AdminUser, pageId: string): Promise<PagePermission | null> {
    const config = await getRolesConfig();
    if (!config) return null;

    // Find matching role mapping by checking user's stored role mapping info
    // Since users are created from Discord OAuth, we need to match their permissions
    for (const mapping of config.discordRoleMappings) {
        if (mapping.isActive === false) continue;

        // Check if this mapping matches the user's internal role and permissions
        if (mapping.internalRole === user.role) {
            // Check if the user's permissions match this mapping
            const userPermSet = new Set(user.permissions);
            const mappingPermSet = new Set(mapping.permissions);

            // If permissions match, use this mapping's page permissions
            const permissionsMatch = mapping.permissions.length === user.permissions.length &&
                mapping.permissions.every(p => userPermSet.has(p));

            if (permissionsMatch && mapping.pagePermissions) {
                const pagePerm = mapping.pagePermissions.find(pp => pp.pageId === pageId);
                if (pagePerm) return pagePerm;
            }
        }
    }

    return null;
}

/**
 * Map page IDs to legacy permission IDs
 */
function getLegacyPermissionId(pageId: string): string | null {
    const mapping: Record<string, string> = {
        'garage': 'warehouse',
        'events': 'events',
        'resources': 'resources',
        'uniforms': 'uniforms',
        'theme-settings': 'theme-settings',
        'department-data': 'department-data',
        'subdivisions': 'subdivisions',
        'footer': 'footer',
        'user-management': 'user-management',
        'roles-management': 'roles-management',
        'webhook-settings': 'webhook-settings',
        'chain-of-command-webhook': 'chain-of-command-webhook',
        'subdivision-leadership-webhook': 'subdivision-leadership-webhook',
        'arrest-reports': 'arrest-reports',
        'form-builder': 'form-builder',
        'arrests-database': 'arrest-reports',
        'images': 'warehouse',
    };
    return mapping[pageId] || null;
}

/**
 * Check a specific condition
 */
async function checkCondition(
    condition: PermissionCondition,
    user: AdminUser,
    context?: {
        itemOwnerId?: string;
        fieldId?: string;
    }
): Promise<PermissionCheckResult> {
    switch (condition.type) {
        case 'own_items_only':
            if (context?.itemOwnerId && context.itemOwnerId !== user.id) {
                return { allowed: false, reason: 'You can only modify your own items' };
            }
            return { allowed: true };

        case 'max_per_day':
            // This would require tracking user actions in a separate store
            // For now, return true - implement rate limiting in a future update
            return { allowed: true };

        case 'requires_approval':
            // This condition just marks that the action needs approval
            // The actual approval workflow would be handled elsewhere
            return {
                allowed: true,
                restrictions: {
                    conditions: [{ type: 'requires_approval', description: 'This action requires approval' }]
                }
            };

        case 'time_restricted':
            // Check if current time falls within allowed hours
            // For now, return true - implement time restriction checking if needed
            return { allowed: true };

        default:
            return { allowed: true };
    }
}

/**
 * Check if user can access a page at all (any action)
 */
export async function canAccessPage(user: AdminUser | null, pageId: string): Promise<boolean> {
    const result = await checkPagePermission(user, pageId, 'view');
    return result.allowed;
}

/**
 * Get all allowed actions for a user on a specific page
 */
export async function getAllowedActions(
    user: AdminUser | null,
    pageId: string
): Promise<PermissionAction[]> {
    if (!user) return [];

    if (user.role === 'super_admin') {
        return ['view', 'create', 'edit', 'delete', 'manage'];
    }

    const pagePermissions = await getUserPagePermissions(user, pageId);
    if (pagePermissions) {
        return pagePermissions.actions;
    }

    // Fall back to legacy permissions
    const legacyPermId = getLegacyPermissionId(pageId);
    if (legacyPermId && user.permissions.includes(legacyPermId)) {
        // Legacy permissions grant basic CRUD
        return ['view', 'create', 'edit', 'delete'];
    }

    // Special handling for subdivision overseer
    if (user.role === 'subdivision_overseer') {
        if (pageId === 'subdivisions' || pageId === 'department-data') {
            return ['view', 'edit'];
        }
    }

    return [];
}

/**
 * Get allowed fields for a user on a specific page
 * Returns null if all fields are allowed, or an array of allowed field IDs
 */
export async function getAllowedFields(
    user: AdminUser | null,
    pageId: string
): Promise<string[] | null> {
    if (!user) return [];

    if (user.role === 'super_admin') {
        return null; // All fields allowed
    }

    const pagePermissions = await getUserPagePermissions(user, pageId);
    if (pagePermissions?.restrictions?.allowedFields) {
        return pagePermissions.restrictions.allowedFields;
    }

    // Special handling for subdivision overseer
    if (user.role === 'subdivision_overseer') {
        if (pageId === 'department-data') {
            return ['subdivision_leadership'];
        }
        if (pageId === 'subdivisions') {
            return ['availability', 'details'];
        }
    }

    return null; // All fields allowed by default for legacy permissions
}

/**
 * Check multiple permissions at once
 */
export async function checkMultiplePermissions(
    user: AdminUser | null,
    checks: Array<{ pageId: string; action: PermissionAction }>
): Promise<Map<string, PermissionCheckResult>> {
    const results = new Map<string, PermissionCheckResult>();

    for (const check of checks) {
        const key = `${check.pageId}:${check.action}`;
        const result = await checkPagePermission(user, check.pageId, check.action);
        results.set(key, result);
    }

    return results;
}

/**
 * Build a permission summary for a user (useful for admin dashboard)
 */
export async function getPermissionSummary(user: AdminUser | null): Promise<{
    pageId: string;
    pageName: string;
    actions: PermissionAction[];
    hasRestrictions: boolean;
}[]> {
    if (!user) return [];

    const config = await getRolesConfig();
    const pageDefinitions = config?.pageDefinitions || [];

    const summary = [];

    for (const page of pageDefinitions) {
        const actions = await getAllowedActions(user, page.id);
        if (actions.length > 0) {
            const allowedFields = await getAllowedFields(user, page.id);
            summary.push({
                pageId: page.id,
                pageName: page.name,
                actions,
                hasRestrictions: allowedFields !== null,
            });
        }
    }

    return summary;
}
