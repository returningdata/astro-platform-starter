import type { APIRoute } from 'astro';
import { getStore } from '@netlify/blobs';

export const prerender = false;

// Discord webhook URL for arrest reports (same one used for posting reports)
const ARREST_REPORTS_WEBHOOK_URL = 'https://discord.com/api/webhooks/1363111869274919052/B6yYvryNHl9pCRBqX5JkHe0YHxMfU2fNkeeRWtuThNJBxtig0VJUTaJpQBF3BCQAYK-e';

interface ArrestReport {
    id: string;
    createdAt: string;
    updatedAt: string;
    discordMessageId?: string;
    approvalStatus: 'pending' | 'approved' | 'denied';
    approvedBy?: string;
    approvedAt?: string;
    approvalNote?: string;
    discordUsername: string;
    discordId: string;
    officerName: string;
    officerCallsign: string;
    suspectName: string;
    suspectDob: string;
    suspectGender: string;
    suspectImage: string;
    reasonForStop: string;
    suspectBehavior: string[];
    charges: string;
    bookingLocation: string;
    suspectStatements: string;
    mirandaRights: 'yes' | 'no' | 'refused';
    caseStatus: 'open' | 'closed' | 'unresolved';
    additionalNotes: string;
}

/**
 * Get arrest reports from blob store
 */
async function getArrestReports(): Promise<ArrestReport[]> {
    try {
        const store = getStore({ name: 'arrest-reports', consistency: 'strong' });
        const reports = await store.get('reports', { type: 'json' }) as ArrestReport[] | null;
        return reports || [];
    } catch (error) {
        console.error('Error fetching arrest reports:', error);
        return [];
    }
}

/**
 * Save arrest reports to blob store
 */
async function saveArrestReports(reports: ArrestReport[]): Promise<void> {
    const store = getStore({ name: 'arrest-reports', consistency: 'strong' });
    await store.setJSON('reports', reports);
}

/**
 * Build Discord embeds for arrest report (without the approval embed)
 */
function buildArrestReportEmbeds(report: ArrestReport): any[] {
    const timestamp = new Date().toISOString();
    const statusColors = {
        open: 0xFFA500,      // Orange
        closed: 0x00FF00,    // Green
        unresolved: 0xFF0000 // Red
    };

    const behaviorDisplay = report.suspectBehavior.length > 0
        ? report.suspectBehavior.join(', ')
        : 'Not specified';

    const mirandaDisplay: Record<string, string> = {
        yes: '✅ Yes',
        no: '❌ No',
        refused: '🚫 Refused to Listen'
    };

    return [
        // Section 1: Discord Info
        {
            title: '📋 Section 1: Discord Information',
            color: 0x5865F2,
            fields: [
                { name: 'Discord Username', value: report.discordUsername || 'Not provided', inline: true },
                { name: 'Discord ID', value: report.discordId ? `<@${report.discordId}>` : 'Not provided', inline: true }
            ],
            timestamp
        },
        // Section 2: Officer and Suspect Info
        {
            title: '👮 Section 2: Officer & Suspect Information',
            color: 0x1e40af,
            fields: [
                { name: 'Officer Name', value: report.officerName || 'Not provided', inline: true },
                { name: 'Officer Callsign', value: report.officerCallsign || 'Not provided', inline: true },
                { name: '​', value: '​', inline: true },
                { name: 'Suspect Name', value: report.suspectName || 'Not provided', inline: true },
                { name: 'Suspect DOB', value: report.suspectDob || 'Not provided', inline: true },
                { name: 'Suspect Gender', value: report.suspectGender || 'Not provided', inline: true }
            ],
            image: report.suspectImage ? { url: report.suspectImage } : undefined,
            timestamp
        },
        // Section 3: Charges
        {
            title: '⚖️ Section 3: Charges',
            color: 0x9932CC,
            fields: [
                { name: 'Reason for Initial Stop', value: report.reasonForStop || 'Not provided', inline: false },
                { name: 'Suspect Behavior', value: behaviorDisplay, inline: false },
                { name: 'List of Charges Applied', value: report.charges || 'Not provided', inline: false }
            ],
            timestamp
        },
        // Section 4: Transporting and Booking
        {
            title: '🚔 Section 4: Transporting & Booking',
            color: 0x00BFFF,
            fields: [
                { name: 'Location of Booking', value: report.bookingLocation || 'Not provided', inline: false },
                { name: 'Suspect Statements', value: report.suspectStatements || 'No statements recorded', inline: false }
            ],
            timestamp
        },
        // Section 5: Finalization
        {
            title: '📝 Section 5: Finalization',
            color: statusColors[report.caseStatus] || 0x808080,
            fields: [
                { name: 'Miranda Rights Read?', value: mirandaDisplay[report.mirandaRights] || 'Unknown', inline: true },
                { name: 'Case Status', value: report.caseStatus.toUpperCase(), inline: true },
                { name: 'Additional Notes', value: report.additionalNotes || 'None', inline: false }
            ],
            footer: { text: `Report ID: ${report.id}` },
            timestamp
        }
    ];
}

/**
 * Remove the "Supervisor Action Required" embed from the Discord message by editing it
 */
async function removeApprovalEmbed(messageId: string, report: ArrestReport): Promise<boolean> {
    try {
        // Build the embeds without the approval embed
        const embeds = buildArrestReportEmbeds(report);

        const payload = {
            content: `**Arrest Report** - ID: \`${report.id}\` - ✅ Approved`,
            embeds
        };

        const response = await fetch(`${ARREST_REPORTS_WEBHOOK_URL}/messages/${messageId}`, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
        });

        if (!response.ok) {
            console.error('Failed to edit Discord message:', response.status, await response.text());
            return false;
        }

        return true;
    } catch (error) {
        console.error('Failed to edit Discord message:', error);
        return false;
    }
}

/**
 * Send approval notification to Discord webhook
 */
async function sendApprovalNotification(reportId: string, approverDiscordId: string): Promise<boolean> {
    try {
        const now = new Date();
        const unixTimestamp = Math.floor(now.getTime() / 1000);
        const dateApproved = now.toLocaleDateString('en-US', {
            year: 'numeric',
            month: '2-digit',
            day: '2-digit'
        });
        // Use sesh.fyi/Discord timestamp format for time
        const timeApproved = `<t:${unixTimestamp}:t>`;

        const payload = {
            embeds: [{
                title: '✅ Arrest Report Approved',
                color: 0x00FF00,
                fields: [
                    { name: 'Arrest Report ID', value: `\`${reportId}\``, inline: true },
                    { name: 'Approved By', value: `<@${approverDiscordId}>`, inline: true },
                    { name: 'Date Approved', value: dateApproved, inline: true },
                    { name: 'Time Approved', value: timeApproved, inline: true }
                ],
                timestamp: now.toISOString()
            }]
        };

        const response = await fetch(ARREST_REPORTS_WEBHOOK_URL, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
        });

        if (!response.ok) {
            console.error('Discord webhook error:', response.status, await response.text());
            return false;
        }

        return true;
    } catch (error) {
        console.error('Failed to send Discord approval notification:', error);
        return false;
    }
}

/**
 * GET - Show approval form
 */
export const GET: APIRoute = async ({ url }) => {
    const reportId = url.searchParams.get('id');

    if (!reportId) {
        return new Response(generateHTML('Error', '<p class="error">No report ID provided.</p>'), {
            status: 400,
            headers: { 'Content-Type': 'text/html' }
        });
    }

    // Check if report exists
    const reports = await getArrestReports();
    const report = reports.find(r => r.id === reportId);

    if (!report) {
        return new Response(generateHTML('Error', '<p class="error">Report not found.</p>'), {
            status: 404,
            headers: { 'Content-Type': 'text/html' }
        });
    }

    if (report.approvalStatus === 'approved') {
        return new Response(generateHTML('Already Approved', `
            <div class="success-box">
                <h2>✅ Report Already Approved</h2>
                <p>This report has already been approved.</p>
                <p><strong>Report ID:</strong> ${reportId}</p>
                <p><strong>Approved By:</strong> ${report.approvedBy || 'Unknown'}</p>
                <p><strong>Approved At:</strong> ${report.approvedAt ? new Date(report.approvedAt).toLocaleString() : 'Unknown'}</p>
            </div>
        `), {
            status: 200,
            headers: { 'Content-Type': 'text/html' }
        });
    }

    // Show approval form
    const formHTML = `
        <div class="form-container">
            <h2>Approve Arrest Report</h2>
            <p><strong>Report ID:</strong> ${reportId}</p>
            <p><strong>Officer:</strong> ${report.officerName}</p>
            <p><strong>Suspect:</strong> ${report.suspectName}</p>
            <form method="POST" action="/api/arrest-approve">
                <input type="hidden" name="id" value="${reportId}">
                <div class="form-group">
                    <label for="discordId">Your Discord User ID:</label>
                    <input type="text" id="discordId" name="discordId" required
                           placeholder="e.g., 123456789012345678"
                           pattern="[0-9]{17,19}"
                           title="Discord ID must be 17-19 digits">
                    <small>Right-click your name in Discord and select "Copy User ID"</small>
                </div>
                <button type="submit" class="approve-btn">✅ Approve Report</button>
            </form>
        </div>
    `;

    return new Response(generateHTML('Approve Report', formHTML), {
        status: 200,
        headers: { 'Content-Type': 'text/html' }
    });
};

/**
 * POST - Process approval
 */
export const POST: APIRoute = async ({ request }) => {
    const formData = await request.formData();
    const reportId = formData.get('id') as string;
    const discordId = formData.get('discordId') as string;

    if (!reportId || !discordId) {
        return new Response(generateHTML('Error', '<p class="error">Missing required fields.</p>'), {
            status: 400,
            headers: { 'Content-Type': 'text/html' }
        });
    }

    // Validate Discord ID format (17-19 digits)
    if (!/^[0-9]{17,19}$/.test(discordId)) {
        return new Response(generateHTML('Error', '<p class="error">Invalid Discord ID format. It should be 17-19 digits.</p>'), {
            status: 400,
            headers: { 'Content-Type': 'text/html' }
        });
    }

    // Get and update report
    const reports = await getArrestReports();
    const reportIndex = reports.findIndex(r => r.id === reportId);

    if (reportIndex === -1) {
        return new Response(generateHTML('Error', '<p class="error">Report not found.</p>'), {
            status: 404,
            headers: { 'Content-Type': 'text/html' }
        });
    }

    const report = reports[reportIndex];

    if (report.approvalStatus === 'approved') {
        return new Response(generateHTML('Already Approved', `
            <div class="success-box">
                <h2>✅ Report Already Approved</h2>
                <p>This report was already approved.</p>
            </div>
        `), {
            status: 200,
            headers: { 'Content-Type': 'text/html' }
        });
    }

    // Update report status
    const now = new Date().toISOString();
    reports[reportIndex] = {
        ...report,
        approvalStatus: 'approved',
        approvedBy: discordId,
        approvedAt: now,
        updatedAt: now
    };

    await saveArrestReports(reports);

    // Edit the Discord message to remove the "Supervisor Action Required" embed
    if (report.discordMessageId) {
        await removeApprovalEmbed(report.discordMessageId, reports[reportIndex]);
    }

    // Send Discord notification
    const notificationSent = await sendApprovalNotification(reportId, discordId);

    const resultHTML = `
        <div class="success-box">
            <h2>✅ Report Approved Successfully</h2>
            <p><strong>Report ID:</strong> ${reportId}</p>
            <p><strong>Approved By:</strong> <@${discordId}></p>
            <p><strong>Date/Time:</strong> ${new Date().toLocaleString()}</p>
            ${notificationSent
                ? '<p class="success">Discord notification sent!</p>'
                : '<p class="warning">Note: Discord notification could not be sent.</p>'}
            <p>You can close this page now.</p>
        </div>
    `;

    return new Response(generateHTML('Approval Successful', resultHTML), {
        status: 200,
        headers: { 'Content-Type': 'text/html' }
    });
};

/**
 * Generate HTML page wrapper
 */
function generateHTML(title: string, content: string): string {
    return `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>${title} - DPPD Arrest Reports</title>
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
            max-width: 500px;
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
    </style>
</head>
<body>
    <div class="container">
        <h1>🚔 DPPD</h1>
        ${content}
    </div>
</body>
</html>`;
}
