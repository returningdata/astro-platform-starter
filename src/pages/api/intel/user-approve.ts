import type { APIRoute } from 'astro';
import { getStore } from '@netlify/blobs';
import {
    type IntelUser,
    type ClearanceLevel,
    CLEARANCE_HIERARCHY,
    CLEARANCE_DISPLAY_NAMES
} from '../../../utils/google-oauth';

export const prerender = false;

const INTEL_USERS_STORE_NAME = 'intel-users';

// Discord webhook URL for approval notifications
const PENDING_APPROVALS_WEBHOOK_URL = 'https://discord.com/api/webhooks/1462559557342593094/4kPnCBS9kEf-QqxHg_oetaemL7fl0vzBz2d3SxltgovJiBVhYlWLomawGQKRKuC5hSkl';

/**
 * Generate HTML page wrapper
 */
function generateHTML(title: string, content: string): string {
    return `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>${title} - DPPD Intel</title>
    <style>
        * {
            box-sizing: border-box;
            margin: 0;
            padding: 0;
        }
        body {
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
            background: linear-gradient(135deg, #1a1a2e 0%, #16213e 100%);
            min-height: 100vh;
            display: flex;
            align-items: center;
            justify-content: center;
            padding: 20px;
            color: #fff;
        }
        .container {
            background: rgba(255, 255, 255, 0.1);
            backdrop-filter: blur(10px);
            border-radius: 16px;
            padding: 40px;
            max-width: 600px;
            width: 100%;
            box-shadow: 0 8px 32px rgba(0, 0, 0, 0.3);
        }
        h1 {
            text-align: center;
            margin-bottom: 24px;
            color: #5865F2;
        }
        h2 {
            margin-bottom: 16px;
        }
        .form-container p {
            margin-bottom: 12px;
        }
        .form-group {
            margin: 20px 0;
        }
        label {
            display: block;
            margin-bottom: 8px;
            font-weight: 500;
        }
        input[type="text"] {
            width: 100%;
            padding: 12px;
            border: 2px solid rgba(255, 255, 255, 0.2);
            border-radius: 8px;
            background: rgba(0, 0, 0, 0.2);
            color: #fff;
            font-size: 16px;
        }
        input[type="text"]:focus {
            outline: none;
            border-color: #5865F2;
        }
        input::placeholder {
            color: rgba(255, 255, 255, 0.5);
        }
        select {
            width: 100%;
            padding: 12px;
            border: 2px solid rgba(255, 255, 255, 0.2);
            border-radius: 8px;
            background: rgba(0, 0, 0, 0.2);
            color: #fff;
            font-size: 16px;
            cursor: pointer;
        }
        select:focus {
            outline: none;
            border-color: #5865F2;
        }
        option {
            background: #1a1a2e;
            color: #fff;
        }
        small {
            display: block;
            margin-top: 8px;
            color: rgba(255, 255, 255, 0.6);
            font-size: 12px;
        }
        .approve-btn {
            width: 100%;
            padding: 14px;
            background: #57F287;
            color: #000;
            border: none;
            border-radius: 8px;
            font-size: 16px;
            font-weight: 600;
            cursor: pointer;
            margin-top: 20px;
            transition: background 0.2s;
        }
        .approve-btn:hover {
            background: #3ba55c;
        }
        .deny-btn {
            width: 100%;
            padding: 14px;
            background: #ED4245;
            color: #fff;
            border: none;
            border-radius: 8px;
            font-size: 16px;
            font-weight: 600;
            cursor: pointer;
            margin-top: 10px;
            transition: background 0.2s;
        }
        .deny-btn:hover {
            background: #c73e40;
        }
        .success-box {
            text-align: center;
        }
        .success-box p {
            margin: 12px 0;
        }
        .error {
            color: #ED4245;
            text-align: center;
            font-size: 18px;
        }
        .success {
            color: #57F287;
        }
        .warning {
            color: #FEE75C;
        }
        .user-details {
            background: rgba(0, 0, 0, 0.2);
            border-radius: 8px;
            padding: 16px;
            margin: 16px 0;
        }
        .user-details .user-avatar {
            width: 64px;
            height: 64px;
            border-radius: 50%;
            margin: 0 auto 12px;
            display: block;
        }
        .user-details p {
            font-size: 14px;
            margin: 8px 0;
            color: rgba(255, 255, 255, 0.8);
        }
        .user-details strong {
            color: rgba(255, 255, 255, 0.6);
        }
        .badge {
            display: inline-block;
            padding: 4px 12px;
            border-radius: 20px;
            font-size: 12px;
            font-weight: 600;
            margin-top: 8px;
        }
        .badge-pending {
            background: #FEE75C;
            color: #000;
        }
        .badge-approved {
            background: #57F287;
            color: #000;
        }
        .badge-denied {
            background: #ED4245;
            color: #fff;
        }
    </style>
</head>
<body>
    <div class="container">
        <h1>DPPD Intel System</h1>
        ${content}
    </div>
</body>
</html>`;
}

/**
 * Send approval notification to Discord
 */
async function sendApprovalNotification(
    user: IntelUser,
    newClearance: ClearanceLevel,
    approverDiscordId: string
): Promise<boolean> {
    try {
        const now = new Date();
        const unixTimestamp = Math.floor(now.getTime() / 1000);

        const clearanceColors: Record<ClearanceLevel, number> = {
            'pending': 0xFEE75C,
            'public_trust': 0x57F287,
            'confidential': 0x06B6D4,
            'secret': 0x3B82F6,
            'top_secret': 0xF97316,
            'top_secret_sci': 0x8B5CF6,
            'special_access': 0xEC4899,
            'denied': 0xED4245
        };

        const isApproved = newClearance !== 'denied';
        const emoji = isApproved ? '' : '';

        const payload = {
            embeds: [{
                title: `${emoji} User Clearance ${isApproved ? 'Approved' : 'Denied'}`,
                color: clearanceColors[newClearance],
                fields: [
                    {
                        name: 'User',
                        value: user.callsign && user.officerName
                            ? `${user.callsign} | ${user.officerName}`
                            : user.name || user.email,
                        inline: true
                    },
                    { name: 'Email', value: user.email, inline: true },
                    { name: 'New Clearance', value: CLEARANCE_DISPLAY_NAMES[newClearance], inline: true },
                    { name: 'Approved By', value: `<@${approverDiscordId}>`, inline: true },
                    { name: 'Time', value: `<t:${unixTimestamp}:R>`, inline: true }
                ],
                thumbnail: user.picture ? { url: user.picture } : undefined,
                timestamp: now.toISOString()
            }]
        };

        const response = await fetch(PENDING_APPROVALS_WEBHOOK_URL, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
        });

        return response.ok;
    } catch (error) {
        console.error('Failed to send approval notification:', error);
        return false;
    }
}

/**
 * GET - Show approval form for a user
 */
export const GET: APIRoute = async ({ url }) => {
    const userId = url.searchParams.get('id');

    if (!userId) {
        return new Response(generateHTML('Error', '<p class="error">No user ID provided.</p>'), {
            status: 400,
            headers: { 'Content-Type': 'text/html' }
        });
    }

    // Get the user
    const store = getStore({ name: INTEL_USERS_STORE_NAME, consistency: 'strong' });
    const user = await store.get(userId, { type: 'json' }) as IntelUser | null;

    if (!user) {
        return new Response(generateHTML('Error', '<p class="error">User not found.</p>'), {
            status: 404,
            headers: { 'Content-Type': 'text/html' }
        });
    }

    // Check if already approved
    if (user.clearanceLevel !== 'pending') {
        const badgeClass = user.clearanceLevel === 'denied' ? 'badge-denied' : 'badge-approved';
        return new Response(generateHTML('Already Processed', `
            <div class="success-box">
                <h2>User Already Processed</h2>
                <div class="user-details">
                    ${user.picture ? `<img src="${user.picture}" alt="${user.name}" class="user-avatar" />` : ''}
                    <p><strong>Name:</strong> ${user.callsign && user.officerName ? `${user.callsign} | ${user.officerName}` : user.name}</p>
                    <p><strong>Email:</strong> ${user.email}</p>
                    ${user.discordId ? `<p><strong>Discord:</strong> ${user.discordUsername || ''} (${user.discordId})</p>` : ''}
                    <span class="badge ${badgeClass}">${CLEARANCE_DISPLAY_NAMES[user.clearanceLevel]}</span>
                </div>
                <p>This user has already been processed.</p>
            </div>
        `), {
            status: 200,
            headers: { 'Content-Type': 'text/html' }
        });
    }

    // Build clearance level options (exclude pending and denied for approval)
    const clearanceOptions = CLEARANCE_HIERARCHY
        .filter(level => level !== 'pending' && level !== 'denied')
        .map(level => `<option value="${level}">${CLEARANCE_DISPLAY_NAMES[level]}</option>`)
        .join('');

    // Show approval form
    const formHTML = `
        <div class="form-container">
            <h2>Approve User Clearance</h2>

            <div class="user-details">
                ${user.picture ? `<img src="${user.picture}" alt="${user.name}" class="user-avatar" />` : ''}
                <p><strong>Name:</strong> ${user.callsign && user.officerName ? `${user.callsign} | ${user.officerName}` : user.name}</p>
                <p><strong>Email:</strong> ${user.email}</p>
                ${user.discordId ? `<p><strong>Discord:</strong> ${user.discordUsername || ''} (${user.discordId})</p>` : ''}
                ${user.badgeNumber ? `<p><strong>Badge:</strong> ${user.badgeNumber}</p>` : ''}
                <p><strong>Registered:</strong> ${new Date(user.createdAt).toLocaleString()}</p>
                <span class="badge badge-pending">Pending Approval</span>
            </div>

            <form method="POST" action="/api/intel/user-approve">
                <input type="hidden" name="userId" value="${userId}">

                <div class="form-group">
                    <label for="clearanceLevel">Grant Clearance Level:</label>
                    <select id="clearanceLevel" name="clearanceLevel" required>
                        ${clearanceOptions}
                    </select>
                </div>

                <div class="form-group">
                    <label for="approverDiscordId">Your Discord User ID:</label>
                    <input type="text" id="approverDiscordId" name="approverDiscordId" required
                           placeholder="e.g., 123456789012345678"
                           pattern="[0-9]{17,19}"
                           title="Discord ID must be 17-19 digits">
                    <small>Right-click your name in Discord and select "Copy User ID"</small>
                </div>

                <button type="submit" name="action" value="approve" class="approve-btn">Approve User</button>
                <button type="submit" name="action" value="deny" class="deny-btn">Deny Access</button>
            </form>
        </div>
    `;

    return new Response(generateHTML('Approve User', formHTML), {
        status: 200,
        headers: { 'Content-Type': 'text/html' }
    });
};

/**
 * POST - Process approval/denial
 */
export const POST: APIRoute = async ({ request }) => {
    const formData = await request.formData();
    const userId = formData.get('userId') as string;
    const clearanceLevel = formData.get('clearanceLevel') as ClearanceLevel;
    const approverDiscordId = formData.get('approverDiscordId') as string;
    const action = formData.get('action') as string;

    if (!userId || !approverDiscordId) {
        return new Response(generateHTML('Error', '<p class="error">Missing required fields.</p>'), {
            status: 400,
            headers: { 'Content-Type': 'text/html' }
        });
    }

    // Validate Discord ID format
    if (!/^[0-9]{17,19}$/.test(approverDiscordId)) {
        return new Response(generateHTML('Error', '<p class="error">Invalid Discord ID format. It should be 17-19 digits.</p>'), {
            status: 400,
            headers: { 'Content-Type': 'text/html' }
        });
    }

    // Get the user
    const store = getStore({ name: INTEL_USERS_STORE_NAME, consistency: 'strong' });
    const user = await store.get(userId, { type: 'json' }) as IntelUser | null;

    if (!user) {
        return new Response(generateHTML('Error', '<p class="error">User not found.</p>'), {
            status: 404,
            headers: { 'Content-Type': 'text/html' }
        });
    }

    if (user.clearanceLevel !== 'pending') {
        return new Response(generateHTML('Already Processed', `
            <div class="success-box">
                <h2>User Already Processed</h2>
                <p>This user has already been processed with clearance level: ${CLEARANCE_DISPLAY_NAMES[user.clearanceLevel]}</p>
            </div>
        `), {
            status: 200,
            headers: { 'Content-Type': 'text/html' }
        });
    }

    // Determine new clearance level based on action
    const newClearance: ClearanceLevel = action === 'deny' ? 'denied' : clearanceLevel;

    // Validate clearance level if approving
    if (action === 'approve' && !CLEARANCE_HIERARCHY.includes(newClearance)) {
        return new Response(generateHTML('Error', '<p class="error">Invalid clearance level.</p>'), {
            status: 400,
            headers: { 'Content-Type': 'text/html' }
        });
    }

    // Update user clearance
    user.clearanceLevel = newClearance;
    await store.setJSON(userId, user);

    // Send Discord notification
    const notificationSent = await sendApprovalNotification(user, newClearance, approverDiscordId);

    const isApproved = action !== 'deny';
    const resultHTML = `
        <div class="success-box">
            <h2>${isApproved ? 'User Approved' : 'User Denied'}</h2>
            <div class="user-details">
                ${user.picture ? `<img src="${user.picture}" alt="${user.name}" class="user-avatar" />` : ''}
                <p><strong>Name:</strong> ${user.callsign && user.officerName ? `${user.callsign} | ${user.officerName}` : user.name}</p>
                <p><strong>Email:</strong> ${user.email}</p>
                <p><strong>New Clearance:</strong> ${CLEARANCE_DISPLAY_NAMES[newClearance]}</p>
                <span class="badge ${isApproved ? 'badge-approved' : 'badge-denied'}">${CLEARANCE_DISPLAY_NAMES[newClearance]}</span>
            </div>
            ${notificationSent
                ? '<p class="success">Discord notification sent!</p>'
                : '<p class="warning">Note: Discord notification could not be sent.</p>'}
            <p>You can close this page now.</p>
        </div>
    `;

    return new Response(generateHTML(isApproved ? 'Approval Successful' : 'Denial Successful', resultHTML), {
        status: 200,
        headers: { 'Content-Type': 'text/html' }
    });
};
