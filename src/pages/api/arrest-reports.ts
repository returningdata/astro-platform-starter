import type { APIRoute } from 'astro';
import { getStore } from '@netlify/blobs';
import { extractUserFromHeaders, sendAuditLog } from '../../utils/discord-webhook';

export const prerender = false;

// Discord webhook URL for arrest reports
const ARREST_REPORTS_WEBHOOK_URL = 'https://discord.com/api/webhooks/1363111869274919052/B6yYvryNHl9pCRBqX5JkHe0YHxMfU2fNkeeRWtuThNJBxtig0VJUTaJpQBF3BCQAYK-e';

export interface ArrestReport {
    id: string;
    createdAt: string;
    updatedAt: string;
    discordMessageId?: string;
    // Approval fields
    approvalStatus: 'pending' | 'approved' | 'denied';
    approvedBy?: string;
    approvedAt?: string;
    approvalNote?: string;
    // Section 1: Discord Info
    discordUsername: string;
    discordId: string;
    // Section 2: Officer and Suspect Info
    officerName: string;
    officerCallsign: string;
    suspectName: string;
    suspectDob: string;
    suspectGender: string;
    suspectCid: string;
    suspectImage: string;
    // Section 3: Charges
    reasonForStop: string;
    suspectBehavior: string[];
    charges: string;
    // Section 4: Transporting and Booking
    bookingLocation: string;
    suspectStatements: string;
    // Section 5: Finalization
    mirandaRights: 'yes' | 'no' | 'refused';
    caseStatus: 'open' | 'closed' | 'unresolved';
    additionalNotes: string;
}

/**
 * Get arrest reports store
 */
function getArrestReportsStore() {
    return getStore({ name: 'arrest-reports', consistency: 'strong' });
}

/**
 * Get all arrest reports
 */
async function getArrestReports(): Promise<ArrestReport[]> {
    try {
        const store = getArrestReportsStore();
        const reports = await store.get('reports', { type: 'json' }) as ArrestReport[] | null;
        return reports || [];
    } catch (error) {
        console.error('Error fetching arrest reports:', error);
        return [];
    }
}

/**
 * Save arrest reports
 */
async function saveArrestReports(reports: ArrestReport[]): Promise<void> {
    const store = getArrestReportsStore();
    await store.setJSON('reports', reports);
}

/**
 * Generate unique ID for report based on officer name, case count, and date
 * Format: DPPD-{officerName}-{caseNumber}-{date}
 */
function generateId(officerName: string, existingReports: ArrestReport[]): string {
    // Clean officer name: remove spaces and special characters, convert to uppercase
    const cleanName = officerName
        .replace(/[^a-zA-Z0-9]/g, '')
        .toUpperCase() || 'UNKNOWN';

    // Count how many cases this officer already has
    const officerCaseCount = existingReports.filter(report => {
        const reportOfficerName = report.officerName
            .replace(/[^a-zA-Z0-9]/g, '')
            .toUpperCase();
        return reportOfficerName === cleanName;
    }).length;

    // New case number is count + 1
    const caseNumber = officerCaseCount + 1;

    // Generate date in MMDDYYYY format
    const now = new Date();
    const month = String(now.getMonth() + 1).padStart(2, '0');
    const day = String(now.getDate()).padStart(2, '0');
    const year = now.getFullYear();
    const dateStr = `${month}${day}${year}`;

    return `DPPD-${cleanName}-${caseNumber}-${dateStr}`;
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
 * Build Discord embeds for arrest report
 */
function buildArrestReportEmbeds(report: ArrestReport): any[] {
    const timestamp = new Date().toISOString();
    const statusColors = {
        open: 0xFFA500,      // Orange
        closed: 0x00FF00,    // Green
        unresolved: 0xFF0000 // Red
    };

    const approvalColors = {
        pending: 0xFFFF00,   // Yellow
        approved: 0x00FF00,  // Green
        denied: 0xFF0000     // Red
    };

    const approvalDisplay = {
        pending: '⏳ Pending',
        approved: '✅ Approved',
        denied: '❌ Denied'
    };

    const behaviorDisplay = report.suspectBehavior.length > 0
        ? report.suspectBehavior.join(', ')
        : 'Not specified';

    const mirandaDisplay = {
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
                { name: 'Suspect Gender', value: report.suspectGender || 'Not provided', inline: true },
                { name: 'Suspect CID (CIVID)', value: report.suspectCid || 'Not provided', inline: true }
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
 * Get the site URL from environment or default
 */
function getSiteUrl(): string {
    // Check for Netlify URL environment variable
    const url = import.meta.env.SITE || import.meta.env.URL || 'https://delperro.netlify.app';
    return url.replace(/\/$/, ''); // Remove trailing slash if present
}

/**
 * Send arrest report to Discord with an Approve link
 * Note: Discord webhooks don't support interactive button components,
 * so we include the approval link in the embed instead.
 */
async function sendToDiscordWithApproveButton(report: ArrestReport): Promise<string | null> {
    try {
        const embeds = buildArrestReportEmbeds(report);
        const siteUrl = getSiteUrl();
        const approveUrl = `${siteUrl}/api/arrest-approve?id=${encodeURIComponent(report.id)}`;

        // Add an approval action embed at the end with the clickable link
        const approvalEmbed = {
            title: '✅ Supervisor Action Required',
            description: `**[Click here to Approve this Report](${approveUrl})**`,
            color: 0x57F287, // Discord green
            fields: [
                {
                    name: '📋 Instructions',
                    value: 'Click the link above to open the approval form. You will need to enter your Discord User ID to approve this report.',
                    inline: false
                }
            ],
            footer: { text: `Report ID: ${report.id}` }
        };

        embeds.push(approvalEmbed);

        const payload = {
            content: `**New Arrest Report Submitted** - ID: \`${report.id}\``,
            embeds
        };

        const response = await fetch(`${ARREST_REPORTS_WEBHOOK_URL}?wait=true`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
        });

        if (!response.ok) {
            console.error('Discord webhook error:', response.status, await response.text());
            return null;
        }

        const message = await response.json();
        return message.id || null;
    } catch (error) {
        console.error('Failed to send to Discord:', error);
        return null;
    }
}

/**
 * GET - Retrieve all arrest reports
 */
export const GET: APIRoute = async () => {
    try {
        const reports = await getArrestReports();

        // Calculate statistics
        const stats = {
            total: reports.length,
            open: reports.filter(r => r.caseStatus === 'open').length,
            closed: reports.filter(r => r.caseStatus === 'closed').length,
            unresolved: reports.filter(r => r.caseStatus === 'unresolved').length
        };

        return new Response(JSON.stringify({
            success: true,
            reports,
            stats
        }), {
            status: 200,
            headers: { 'Content-Type': 'application/json' }
        });
    } catch (error) {
        console.error('Error in GET arrest reports:', error);
        return new Response(JSON.stringify({
            success: false,
            error: String(error)
        }), {
            status: 500,
            headers: { 'Content-Type': 'application/json' }
        });
    }
};

/**
 * POST - Create new arrest report
 */
export const POST: APIRoute = async ({ request }) => {
    try {
        const data = await request.json();
        const user = extractUserFromHeaders(request);

        // Get existing reports to generate unique ID based on officer's case count
        const existingReports = await getArrestReports();
        const officerName = data.officerName || 'UNKNOWN';

        // Create new report with generated ID and timestamps
        const newReport: ArrestReport = {
            id: generateId(officerName, existingReports),
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
            approvalStatus: 'pending',
            discordUsername: data.discordUsername || '',
            discordId: data.discordId || '',
            officerName: data.officerName || '',
            officerCallsign: data.officerCallsign || '',
            suspectName: data.suspectName || '',
            suspectDob: data.suspectDob || '',
            suspectGender: data.suspectGender || '',
            suspectCid: data.suspectCid || '',
            suspectImage: data.suspectImage || '',
            reasonForStop: data.reasonForStop || '',
            suspectBehavior: data.suspectBehavior || [],
            charges: data.charges || '',
            bookingLocation: data.bookingLocation || '',
            suspectStatements: data.suspectStatements || '',
            mirandaRights: data.mirandaRights || 'no',
            caseStatus: data.caseStatus || 'open',
            additionalNotes: data.additionalNotes || ''
        };

        // Add new report to existing reports
        existingReports.unshift(newReport); // Add to beginning

        // Save to blob storage
        await saveArrestReports(existingReports);

        // Send to Discord with approve button
        const discordMessageId = await sendToDiscordWithApproveButton(newReport);

        if (discordMessageId) {
            // Update report with message ID for future reference
            newReport.discordMessageId = discordMessageId;
            existingReports[0] = newReport;
            await saveArrestReports(existingReports);
        }

        // Log the action
        await sendAuditLog({
            action: 'CREATE',
            entityType: 'EVENTS', // Using EVENTS as closest match, could add ARREST_REPORTS to types
            user,
            entityId: newReport.id,
            entityName: `Arrest Report - ${newReport.suspectName}`,
            success: true,
            metadata: {
                'Report ID': newReport.id,
                'Suspect': newReport.suspectName,
                'Officer': newReport.officerName,
                'Case Status': newReport.caseStatus
            }
        });

        return new Response(JSON.stringify({
            success: true,
            report: newReport,
            message: 'Arrest report submitted successfully'
        }), {
            status: 200,
            headers: { 'Content-Type': 'application/json' }
        });
    } catch (error) {
        console.error('Error creating arrest report:', error);
        return new Response(JSON.stringify({
            success: false,
            error: String(error)
        }), {
            status: 500,
            headers: { 'Content-Type': 'application/json' }
        });
    }
};

/**
 * PUT - Update arrest report (for approve/deny actions)
 */
export const PUT: APIRoute = async ({ request }) => {
    try {
        const data = await request.json();
        const user = extractUserFromHeaders(request);

        if (!data.id) {
            return new Response(JSON.stringify({
                success: false,
                error: 'Report ID is required'
            }), {
                status: 400,
                headers: { 'Content-Type': 'application/json' }
            });
        }

        const reports = await getArrestReports();
        const reportIndex = reports.findIndex(r => r.id === data.id);

        if (reportIndex === -1) {
            return new Response(JSON.stringify({
                success: false,
                error: 'Report not found'
            }), {
                status: 404,
                headers: { 'Content-Type': 'application/json' }
            });
        }

        const oldReport = { ...reports[reportIndex] };

        // Update the report
        reports[reportIndex] = {
            ...reports[reportIndex],
            ...data,
            updatedAt: new Date().toISOString()
        };

        await saveArrestReports(reports);

        // If the report was just approved, edit the Discord message to remove "Supervisor Action Required" embed
        if (data.approvalStatus === 'approved' && oldReport.approvalStatus !== 'approved' && oldReport.discordMessageId) {
            await removeApprovalEmbed(oldReport.discordMessageId, reports[reportIndex]);
        }

        // Log the action
        await sendAuditLog({
            action: 'UPDATE',
            entityType: 'EVENTS',
            user,
            entityId: data.id,
            entityName: `Arrest Report - ${reports[reportIndex].suspectName}`,
            success: true,
            metadata: {
                'Report ID': data.id,
                'Previous Status': oldReport.caseStatus,
                'New Status': reports[reportIndex].caseStatus
            }
        });

        return new Response(JSON.stringify({
            success: true,
            report: reports[reportIndex],
            message: 'Arrest report updated successfully'
        }), {
            status: 200,
            headers: { 'Content-Type': 'application/json' }
        });
    } catch (error) {
        console.error('Error updating arrest report:', error);
        return new Response(JSON.stringify({
            success: false,
            error: String(error)
        }), {
            status: 500,
            headers: { 'Content-Type': 'application/json' }
        });
    }
};
