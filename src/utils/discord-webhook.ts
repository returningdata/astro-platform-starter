/**
 * Discord Webhook Logger
 * Sends notifications to Discord for various site activities
 */

const DISCORD_WEBHOOK_URL = 'https://discord.com/api/webhooks/1345927814699941969/OHLt_xVWzpKTGFGlNqelstJOLAtcftC9BE--2OHLXtJsR22t1TyUsKzJZk3dKigfWiC3';

export type LogType = 'login' | 'logout' | 'create' | 'update' | 'delete' | 'change' | 'error' | 'info';

export interface LogOptions {
    type: LogType;
    category: string;
    title: string;
    description?: string;
    fields?: Array<{ name: string; value: string; inline?: boolean }>;
    user?: string;
    timestamp?: Date;
}

// Color mapping for different log types
const LOG_COLORS: Record<LogType, number> = {
    login: 0x2ECC71,     // Green
    logout: 0xE74C3C,    // Red
    create: 0x3498DB,    // Blue
    update: 0xF39C12,    // Orange
    delete: 0xE74C3C,    // Red
    change: 0x9B59B6,    // Purple
    error: 0xE74C3C,     // Red
    info: 0x95A5A6       // Gray
};

// Emoji mapping for different log types
const LOG_EMOJIS: Record<LogType, string> = {
    login: '🔐',
    logout: '🚪',
    create: '✨',
    update: '📝',
    delete: '🗑️',
    change: '🔄',
    error: '❌',
    info: 'ℹ️'
};

/**
 * Send a log message to Discord webhook
 */
export async function logToDiscord(options: LogOptions): Promise<void> {
    const { type, category, title, description, fields = [], user, timestamp = new Date() } = options;

    const embed = {
        title: `${LOG_EMOJIS[type]} ${title}`,
        description: description || undefined,
        color: LOG_COLORS[type],
        fields: [
            { name: 'Category', value: category, inline: true },
            { name: 'Action', value: type.charAt(0).toUpperCase() + type.slice(1), inline: true },
            ...(user ? [{ name: 'User', value: user, inline: true }] : []),
            ...fields
        ],
        timestamp: timestamp.toISOString(),
        footer: {
            text: 'DPPD Activity Logger'
        }
    };

    try {
        const response = await fetch(DISCORD_WEBHOOK_URL, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                embeds: [embed]
            })
        });

        if (!response.ok) {
            console.error('Discord webhook failed:', response.status, await response.text());
        }
    } catch (error) {
        // Don't throw - logging failures shouldn't break the main functionality
        console.error('Failed to send Discord webhook:', error);
    }
}

/**
 * Log a user login event
 */
export async function logLogin(username: string, displayName: string, role: string): Promise<void> {
    await logToDiscord({
        type: 'login',
        category: 'Authentication',
        title: 'User Login',
        description: `**${displayName}** logged into the admin panel`,
        fields: [
            { name: 'Username', value: username, inline: true },
            { name: 'Role', value: role, inline: true }
        ]
    });
}

/**
 * Log a data change event
 */
export async function logDataChange(
    category: string,
    action: LogType,
    title: string,
    details?: string,
    user?: string
): Promise<void> {
    await logToDiscord({
        type: action,
        category,
        title,
        description: details,
        user
    });
}

/**
 * Log a user management action
 */
export async function logUserManagement(
    action: 'create' | 'update' | 'delete',
    targetUser: string,
    performedBy?: string,
    details?: string
): Promise<void> {
    const actionText = {
        create: 'User Created',
        update: 'User Updated',
        delete: 'User Deleted'
    };

    await logToDiscord({
        type: action,
        category: 'User Management',
        title: actionText[action],
        description: details,
        fields: [
            { name: 'Target User', value: targetUser, inline: true }
        ],
        user: performedBy
    });
}

/**
 * Log a subdivision change
 */
export async function logSubdivisionChange(
    action: 'create' | 'update' | 'delete',
    subdivisionName: string,
    details?: string
): Promise<void> {
    const actionText = {
        create: 'Subdivision Created',
        update: 'Subdivisions Updated',
        delete: 'Subdivision Deleted'
    };

    await logToDiscord({
        type: action,
        category: 'Subdivisions',
        title: actionText[action],
        description: details || `Subdivision: ${subdivisionName}`
    });
}

/**
 * Log warehouse changes
 */
export async function logWarehouseChange(details: string): Promise<void> {
    await logToDiscord({
        type: 'update',
        category: 'Warehouse',
        title: 'Equipment Inventory Updated',
        description: details
    });
}

/**
 * Log events changes
 */
export async function logEventsChange(details: string): Promise<void> {
    await logToDiscord({
        type: 'update',
        category: 'Events',
        title: 'Community Events Updated',
        description: details
    });
}

/**
 * Log resources changes
 */
export async function logResourcesChange(details: string): Promise<void> {
    await logToDiscord({
        type: 'update',
        category: 'Resources',
        title: 'Resources Updated',
        description: details
    });
}

/**
 * Log uniforms changes
 */
export async function logUniformsChange(details: string): Promise<void> {
    await logToDiscord({
        type: 'update',
        category: 'Uniforms',
        title: 'Uniforms Updated',
        description: details
    });
}

/**
 * Log department data changes
 */
export async function logDepartmentDataChange(details: string): Promise<void> {
    await logToDiscord({
        type: 'update',
        category: 'Department Data',
        title: 'Department Data Updated',
        description: details
    });
}

/**
 * Log theme settings changes
 */
export async function logThemeChange(details: string): Promise<void> {
    await logToDiscord({
        type: 'change',
        category: 'Theme',
        title: 'Theme Settings Changed',
        description: details
    });
}
