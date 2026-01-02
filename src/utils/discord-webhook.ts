/**
 * Discord Webhook Logging Utility
 *
 * This module provides detailed audit logging to Discord for all admin actions.
 * Logs include: user info, timestamps, action types, and detailed change tracking.
 */

/**
 * Get Discord webhook URL from environment variable
 * SECURITY: Never hardcode webhook URLs in source code
 */
function getDiscordWebhookUrl(): string | null {
    const url = typeof Netlify !== 'undefined'
        ? Netlify.env.get('DISCORD_WEBHOOK_URL')
        : process.env.DISCORD_WEBHOOK_URL;

    if (!url) {
        console.warn('DISCORD_WEBHOOK_URL environment variable not set. Audit logging to Discord is disabled.');
        return null;
    }

    // Validate URL format
    try {
        const parsed = new URL(url);
        if (!parsed.hostname.includes('discord.com')) {
            console.warn('DISCORD_WEBHOOK_URL does not appear to be a valid Discord webhook URL.');
        }
    } catch {
        console.error('DISCORD_WEBHOOK_URL is not a valid URL.');
        return null;
    }

    return url;
}

export type ActionType = 'LOGIN' | 'LOGOUT' | 'CREATE' | 'UPDATE' | 'DELETE' | 'SAVE';

export type EntityType =
    | 'USER'
    | 'WAREHOUSE'
    | 'EVENTS'
    | 'UNIFORMS'
    | 'RESOURCES'
    | 'THEME_SETTINGS'
    | 'DEPARTMENT_DATA'
    | 'SUBDIVISIONS'
    | 'FOOTER';

interface UserInfo {
    id?: string;
    username?: string;
    displayName?: string;
    role?: string;
}

interface ChangeDetail {
    field: string;
    oldValue?: any;
    newValue?: any;
}

interface AuditLogOptions {
    action: ActionType;
    entityType: EntityType;
    user?: UserInfo;
    entityId?: string;
    entityName?: string;
    changes?: ChangeDetail[];
    metadata?: Record<string, any>;
    success?: boolean;
    errorMessage?: string;
}

// Color codes for different action types
const ACTION_COLORS: Record<ActionType, number> = {
    LOGIN: 0x00FF00,      // Green
    LOGOUT: 0xFFFF00,     // Yellow
    CREATE: 0x00BFFF,     // Blue
    UPDATE: 0xFFA500,     // Orange
    DELETE: 0xFF0000,     // Red
    SAVE: 0x9932CC        // Purple
};

// Emoji for action types
const ACTION_EMOJIS: Record<ActionType, string> = {
    LOGIN: '🔐',
    LOGOUT: '🚪',
    CREATE: '✨',
    UPDATE: '📝',
    DELETE: '🗑️',
    SAVE: '💾'
};

// Entity type display names
const ENTITY_DISPLAY_NAMES: Record<EntityType, string> = {
    USER: 'User Account',
    WAREHOUSE: 'Warehouse',
    EVENTS: 'Events',
    UNIFORMS: 'Uniforms',
    RESOURCES: 'Resources',
    THEME_SETTINGS: 'Theme Settings',
    DEPARTMENT_DATA: 'Department Data',
    SUBDIVISIONS: 'Subdivisions',
    FOOTER: 'Footer'
};

/**
 * Format a value for display in Discord embed
 */
function formatValue(value: any, maxLength: number = 200): string {
    if (value === undefined || value === null) {
        return '_empty_';
    }
    if (typeof value === 'object') {
        const str = JSON.stringify(value, null, 2);
        if (str.length > maxLength) {
            return '```json\n' + str.substring(0, maxLength) + '...\n```';
        }
        return '```json\n' + str + '\n```';
    }
    const str = String(value);
    if (str.length > maxLength) {
        return str.substring(0, maxLength) + '...';
    }
    return str || '_empty_';
}

/**
 * Generate a unique tracking ID for the log entry
 */
function generateTrackingId(): string {
    const timestamp = Date.now().toString(36);
    const random = Math.random().toString(36).substring(2, 8);
    return `${timestamp}-${random}`.toUpperCase();
}

/**
 * Get the current timestamp in a readable format
 */
function getTimestamp(): string {
    const now = new Date();
    return now.toISOString();
}

/**
 * Get Discord timestamp format for relative time display
 */
function getDiscordTimestamp(): string {
    const unix = Math.floor(Date.now() / 1000);
    return `<t:${unix}:F> (<t:${unix}:R>)`;
}

/**
 * Build the fields for changes in the embed
 */
function buildChangeFields(changes: ChangeDetail[]): Array<{name: string, value: string, inline: boolean}> {
    const fields: Array<{name: string, value: string, inline: boolean}> = [];

    for (const change of changes.slice(0, 10)) { // Limit to 10 changes to avoid embed limits
        const oldVal = formatValue(change.oldValue, 100);
        const newVal = formatValue(change.newValue, 100);

        fields.push({
            name: `📋 ${change.field}`,
            value: `**Before:** ${oldVal}\n**After:** ${newVal}`,
            inline: false
        });
    }

    if (changes.length > 10) {
        fields.push({
            name: '⚠️ Additional Changes',
            value: `_${changes.length - 10} more changes not shown_`,
            inline: false
        });
    }

    return fields;
}

/**
 * Compare two objects and return the differences
 */
export function compareObjects(oldObj: any, newObj: any, prefix: string = ''): ChangeDetail[] {
    const changes: ChangeDetail[] = [];

    if (!oldObj && !newObj) return changes;
    if (!oldObj) {
        changes.push({ field: prefix || 'data', oldValue: null, newValue: newObj });
        return changes;
    }
    if (!newObj) {
        changes.push({ field: prefix || 'data', oldValue: oldObj, newValue: null });
        return changes;
    }

    const allKeys = new Set([...Object.keys(oldObj), ...Object.keys(newObj)]);

    for (const key of allKeys) {
        const fieldName = prefix ? `${prefix}.${key}` : key;
        const oldVal = oldObj[key];
        const newVal = newObj[key];

        // Skip certain fields that shouldn't be compared
        if (key === 'updatedAt' || key === 'createdAt') continue;

        if (typeof oldVal === 'object' && typeof newVal === 'object' &&
            !Array.isArray(oldVal) && !Array.isArray(newVal) &&
            oldVal !== null && newVal !== null) {
            // Recursively compare nested objects
            changes.push(...compareObjects(oldVal, newVal, fieldName));
        } else if (JSON.stringify(oldVal) !== JSON.stringify(newVal)) {
            changes.push({ field: fieldName, oldValue: oldVal, newValue: newVal });
        }
    }

    return changes;
}

/**
 * Send an audit log to Discord webhook
 */
export async function sendAuditLog(options: AuditLogOptions): Promise<void> {
    const {
        action,
        entityType,
        user,
        entityId,
        entityName,
        changes = [],
        metadata = {},
        success = true,
        errorMessage
    } = options;

    const trackingId = generateTrackingId();
    const timestamp = getTimestamp();
    const discordTime = getDiscordTimestamp();

    // Build the embed
    const embed: any = {
        title: `${ACTION_EMOJIS[action]} ${action} - ${ENTITY_DISPLAY_NAMES[entityType]}`,
        color: success ? ACTION_COLORS[action] : 0x808080, // Gray for failures
        timestamp: timestamp,
        footer: {
            text: `Tracking ID: ${trackingId} | DPPD Admin Panel`
        },
        fields: []
    };

    // Add user information
    if (user) {
        const userInfo = [
            user.displayName || user.username || 'Unknown User',
            user.username ? `(@${user.username})` : '',
            user.role ? `[${user.role}]` : '',
            user.id ? `\nID: \`${user.id}\`` : ''
        ].filter(Boolean).join(' ');

        embed.fields.push({
            name: '👤 User',
            value: userInfo,
            inline: true
        });
    }

    // Add timestamp
    embed.fields.push({
        name: '🕐 Time',
        value: discordTime,
        inline: true
    });

    // Add entity information
    if (entityId || entityName) {
        const entityInfo = [
            entityName ? `**${entityName}**` : '',
            entityId ? `\nID: \`${entityId}\`` : ''
        ].filter(Boolean).join('');

        embed.fields.push({
            name: `🎯 ${ENTITY_DISPLAY_NAMES[entityType]}`,
            value: entityInfo || '_Not specified_',
            inline: true
        });
    }

    // Add status
    embed.fields.push({
        name: '📊 Status',
        value: success ? '✅ Success' : `❌ Failed${errorMessage ? `\n${errorMessage}` : ''}`,
        inline: true
    });

    // Add changes if any
    if (changes.length > 0) {
        embed.fields.push({
            name: '📝 Changes Made',
            value: `${changes.length} field(s) modified`,
            inline: false
        });

        embed.fields.push(...buildChangeFields(changes));
    }

    // Add metadata if any
    if (Object.keys(metadata).length > 0) {
        const metadataStr = Object.entries(metadata)
            .map(([k, v]) => `**${k}:** ${formatValue(v, 50)}`)
            .join('\n');

        if (metadataStr) {
            embed.fields.push({
                name: '📎 Additional Info',
                value: metadataStr,
                inline: false
            });
        }
    }

    // Build the webhook payload
    const payload = {
        embeds: [embed]
    };

    // Send to Discord
    try {
        const webhookUrl = getDiscordWebhookUrl();
        if (!webhookUrl) {
            // Webhook not configured, skip sending
            return;
        }

        const response = await fetch(webhookUrl, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify(payload)
        });

        if (!response.ok) {
            console.error('Discord webhook error:', response.status, await response.text());
        }
    } catch (error) {
        console.error('Failed to send Discord webhook:', error);
    }
}

import { validateSession, hasPermission, type AdminUser } from './session';

/**
 * Helper function to extract user info from request headers
 * @deprecated Use extractUserFromSession for secure authentication
 */
export function extractUserFromHeaders(request: Request): UserInfo {
    const userHeader = request.headers.get('X-Admin-User');

    let user: UserInfo = {};

    if (userHeader) {
        try {
            const parsed = JSON.parse(userHeader);
            user = {
                id: parsed.id,
                username: parsed.username,
                displayName: parsed.displayName,
                role: parsed.role
            };
        } catch {
            // Header wasn't valid JSON
        }
    }

    return user;
}

/**
 * Securely extract and validate user from session cookie
 * Returns null if not authenticated
 */
export async function extractUserFromSession(request: Request): Promise<AdminUser | null> {
    return await validateSession(request);
}

/**
 * Check if a user has the required permission
 */
export function checkPermission(user: AdminUser | null, permission: string): boolean {
    return hasPermission(user, permission);
}

/**
 * Log a login attempt
 */
export async function logLogin(
    user: UserInfo,
    success: boolean,
    errorMessage?: string
): Promise<void> {
    await sendAuditLog({
        action: 'LOGIN',
        entityType: 'USER',
        user,
        entityName: user.username || 'Unknown',
        success,
        errorMessage,
        metadata: {
            'Login Type': 'Admin Panel',
            'Attempted Username': user.username
        }
    });
}

/**
 * Log a data save operation
 */
export async function logDataSave(
    entityType: EntityType,
    user: UserInfo,
    oldData: any,
    newData: any,
    success: boolean = true,
    errorMessage?: string
): Promise<void> {
    const changes = compareObjects(oldData, newData);

    await sendAuditLog({
        action: 'SAVE',
        entityType,
        user,
        changes,
        success,
        errorMessage,
        metadata: {
            'Total Changes': changes.length,
            'Data Type': entityType
        }
    });
}

/**
 * Log a user management action (create/update/delete)
 */
export async function logUserManagement(
    action: 'CREATE' | 'UPDATE' | 'DELETE',
    performedBy: UserInfo,
    targetUser: { id?: string; username?: string; displayName?: string; role?: string },
    oldData?: any,
    newData?: any,
    success: boolean = true,
    errorMessage?: string
): Promise<void> {
    const changes = action === 'UPDATE' ? compareObjects(oldData, newData) : [];

    // Remove password from changes for security
    const filteredChanges = changes.filter(c => !c.field.toLowerCase().includes('password'));

    // Add a note if password was changed
    if (changes.some(c => c.field.toLowerCase().includes('password'))) {
        filteredChanges.push({
            field: 'password',
            oldValue: '********',
            newValue: '********'
        });
    }

    await sendAuditLog({
        action,
        entityType: 'USER',
        user: performedBy,
        entityId: targetUser.id,
        entityName: targetUser.displayName || targetUser.username,
        changes: filteredChanges,
        success,
        errorMessage,
        metadata: {
            'Target Username': targetUser.username,
            'Target Role': targetUser.role,
            'Action Performed By': performedBy.displayName || performedBy.username
        }
    });
}

/**
 * Log array-based data changes (warehouse, events, uniforms, etc.)
 */
export async function logArrayDataChange(
    entityType: EntityType,
    user: UserInfo,
    oldArray: any[],
    newArray: any[],
    idField: string = 'id',
    nameField: string = 'name',
    success: boolean = true,
    errorMessage?: string
): Promise<void> {
    const oldMap = new Map(oldArray.map(item => [item[idField], item]));
    const newMap = new Map(newArray.map(item => [item[idField], item]));

    const changes: ChangeDetail[] = [];
    const metadata: Record<string, any> = {
        'Previous Count': oldArray.length,
        'New Count': newArray.length
    };

    // Find added items
    const added: string[] = [];
    for (const [id, item] of newMap) {
        if (!oldMap.has(id)) {
            added.push(item[nameField] || id);
        }
    }

    // Find removed items
    const removed: string[] = [];
    for (const [id, item] of oldMap) {
        if (!newMap.has(id)) {
            removed.push(item[nameField] || id);
        }
    }

    // Find modified items
    const modified: string[] = [];
    for (const [id, newItem] of newMap) {
        const oldItem = oldMap.get(id);
        if (oldItem && JSON.stringify(oldItem) !== JSON.stringify(newItem)) {
            modified.push(newItem[nameField] || id);
            const itemChanges = compareObjects(oldItem, newItem, newItem[nameField] || id);
            changes.push(...itemChanges.slice(0, 3)); // Limit changes per item
        }
    }

    if (added.length > 0) {
        changes.unshift({
            field: 'Items Added',
            oldValue: null,
            newValue: added.join(', ')
        });
    }

    if (removed.length > 0) {
        changes.unshift({
            field: 'Items Removed',
            oldValue: removed.join(', '),
            newValue: null
        });
    }

    if (modified.length > 0 && added.length === 0 && removed.length === 0) {
        metadata['Modified Items'] = modified.join(', ');
    }

    await sendAuditLog({
        action: 'SAVE',
        entityType,
        user,
        changes,
        success,
        errorMessage,
        metadata
    });
}
