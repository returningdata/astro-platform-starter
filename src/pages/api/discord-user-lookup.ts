import type { APIRoute } from 'astro';
import { getStore } from '@netlify/blobs';
import { getGuildMember, getDiscordConfig } from '../../utils/discord-oauth';
import { extractUserFromSession, checkPermission } from '../../utils/discord-webhook';

export const prerender = false;

const DISCORD_API_BASE = 'https://discord.com/api/v10';

interface DiscordUserInfo {
    id: string;
    username: string;
    displayName: string;
    avatar: string | null;
    callSign?: string;
    parsedName?: string;
}

interface RosterMatch {
    name: string;
    callSign: string;
    rank?: string;
}

/**
 * Search the roster data (from department-data blob) for a matching Discord ID
 * Returns the name and callSign if found
 */
async function findInRoster(discordId: string): Promise<RosterMatch | null> {
    try {
        const store = getStore({ name: 'department-data', consistency: 'strong' });
        const data = await store.get('department-data', { type: 'json' });

        if (!data || typeof data !== 'object') {
            return null;
        }

        const departmentData = data as {
            commandPositions?: Array<{ discordId?: string; name: string; callSign: string; rank: string }>;
            rankPositions?: Array<{ rank: string; members: Array<{ discordId?: string; name: string; callSign: string }> }>;
        };

        // Check command positions (high command)
        if (departmentData.commandPositions) {
            for (const position of departmentData.commandPositions) {
                if (position.discordId === discordId && position.name) {
                    return {
                        name: position.name,
                        callSign: position.callSign,
                        rank: position.rank
                    };
                }
            }
        }

        // Check rank positions (all other ranks)
        if (departmentData.rankPositions) {
            for (const rankGroup of departmentData.rankPositions) {
                for (const member of rankGroup.members) {
                    if (member.discordId === discordId && member.name) {
                        return {
                            name: member.name,
                            callSign: member.callSign,
                            rank: rankGroup.rank
                        };
                    }
                }
            }
        }

        return null;
    } catch (error) {
        console.error('Error searching roster for Discord ID:', error);
        return null;
    }
}

/**
 * Parse callsign and name from Discord nickname
 * Common formats:
 * - "1R-01 | John Doe"
 * - "1R-01 - John Doe"
 * - "1R-01 John Doe"
 * - "[1R-01] John Doe"
 */
function parseNickname(nickname: string): { callSign: string; name: string } | null {
    if (!nickname) return null;

    // Pattern to match callsign format: digit(s) + R/r + dash + digit(s)
    // Examples: 1R-01, 2R-15, 10R-05
    const callSignPattern = /^[\[\(]?(\d+[Rr]-\d+)[\]\)]?\s*[\|\-]?\s*(.+)$/;
    const match = nickname.match(callSignPattern);

    if (match) {
        const callSign = match[1].toUpperCase();
        const name = match[2].trim();
        return { callSign, name };
    }

    return null;
}

/**
 * GET /api/discord-user-lookup?userId=<discord_user_id>
 * Looks up a Discord user by their ID and returns their username/display name
 */
export const GET: APIRoute = async ({ request, url }) => {
    // Validate session server-side
    const user = await extractUserFromSession(request);

    if (!user) {
        return new Response(JSON.stringify({ error: 'Unauthorized' }), {
            status: 401,
            headers: { 'Content-Type': 'application/json' }
        });
    }

    // Check if user has relevant permissions (department-data or subdivisions)
    const hasPermission = checkPermission(user, 'department-data') ||
                          checkPermission(user, 'department-data-subdivisions') ||
                          checkPermission(user, 'subdivisions');

    if (!hasPermission) {
        return new Response(JSON.stringify({ error: 'Forbidden' }), {
            status: 403,
            headers: { 'Content-Type': 'application/json' }
        });
    }

    const userId = url.searchParams.get('userId');

    if (!userId) {
        return new Response(JSON.stringify({ error: 'Missing userId parameter' }), {
            status: 400,
            headers: { 'Content-Type': 'application/json' }
        });
    }

    // Validate that userId looks like a Discord snowflake (17-20 digit number)
    if (!/^\d{17,20}$/.test(userId)) {
        return new Response(JSON.stringify({ error: 'Invalid Discord user ID format' }), {
            status: 400,
            headers: { 'Content-Type': 'application/json' }
        });
    }

    try {
        // First, check the roster data for this Discord ID
        const rosterMatch = await findInRoster(userId);

        if (rosterMatch) {
            // Found in roster - return the roster data (most authoritative source)
            const userInfo: DiscordUserInfo = {
                id: userId,
                username: '',  // Not available from roster
                displayName: `${rosterMatch.callSign} | ${rosterMatch.name}`,
                avatar: null,  // Not available from roster
                callSign: rosterMatch.callSign,
                parsedName: rosterMatch.name
            };

            return new Response(JSON.stringify({
                success: true,
                user: userInfo,
                isMember: true,
                source: 'roster'
            }), {
                status: 200,
                headers: { 'Content-Type': 'application/json' }
            });
        }

        // Not found in roster - try to get the user as a guild member (fallback)
        const guildMember = await getGuildMember(userId);

        if (guildMember) {
            // User is a member of the guild
            const nickname = guildMember.nick || guildMember.user?.global_name || guildMember.user?.username || '';
            const parsed = parseNickname(nickname);

            const userInfo: DiscordUserInfo = {
                id: userId,
                username: guildMember.user?.username || '',
                displayName: nickname,
                avatar: guildMember.avatar || guildMember.user?.avatar || null,
                callSign: parsed?.callSign,
                parsedName: parsed?.name
            };

            return new Response(JSON.stringify({
                success: true,
                user: userInfo,
                isMember: true,
                source: 'discord',
                warning: 'User not found in roster - data pulled from Discord'
            }), {
                status: 200,
                headers: { 'Content-Type': 'application/json' }
            });
        }

        // User is not a guild member - try to fetch basic user info using bot token
        const config = getDiscordConfig();
        const userResponse = await fetch(`${DISCORD_API_BASE}/users/${userId}`, {
            headers: {
                Authorization: `Bot ${config.botToken}`
            }
        });

        if (userResponse.ok) {
            const discordUser = await userResponse.json();
            const userInfo: DiscordUserInfo = {
                id: discordUser.id,
                username: discordUser.username,
                displayName: discordUser.global_name || discordUser.username,
                avatar: discordUser.avatar
            };

            return new Response(JSON.stringify({
                success: true,
                user: userInfo,
                isMember: false,
                source: 'discord',
                warning: 'User not found in roster and is not a member of the Discord server'
            }), {
                status: 200,
                headers: { 'Content-Type': 'application/json' }
            });
        }

        if (userResponse.status === 404) {
            return new Response(JSON.stringify({
                success: false,
                error: 'Discord user not found'
            }), {
                status: 404,
                headers: { 'Content-Type': 'application/json' }
            });
        }

        throw new Error(`Discord API error: ${userResponse.status}`);
    } catch (error) {
        console.error('Error looking up Discord user:', error);
        return new Response(JSON.stringify({
            success: false,
            error: 'Failed to lookup Discord user'
        }), {
            status: 500,
            headers: { 'Content-Type': 'application/json' }
        });
    }
};
