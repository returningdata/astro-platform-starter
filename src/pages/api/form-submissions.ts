import type { APIRoute } from 'astro';
import { getStore } from '@netlify/blobs';
import { sendAuditLog, extractUserFromSession } from '../../utils/discord-webhook';
import { getFormBySlug, getFormById, type FormDefinition, type FormSection } from './forms';
import type { ArrestReport } from './arrest-reports';
import { getArrestReportsWebhookSettings } from './arrest-reports-webhook-settings';

export const prerender = false;

export interface FormSubmission {
    id: string;
    formId: string;
    formName: string;
    formSlug: string;
    data: Record<string, any>;
    discordMessageId?: string;
    createdAt: string;
    submittedBy?: string;
    // Approval fields
    approvalStatus?: 'pending' | 'approved' | 'denied';
    approvedBy?: string;
    approvedAt?: string;
    approvalNote?: string;
}

/**
 * Get form submissions store
 */
function getSubmissionsStore() {
    return getStore({ name: 'form-submissions', consistency: 'strong' });
}

/**
 * Get all submissions for a specific form
 */
export async function getFormSubmissions(formId: string): Promise<FormSubmission[]> {
    try {
        const store = getSubmissionsStore();
        const submissions = await store.get(`submissions_${formId}`, { type: 'json' }) as FormSubmission[] | null;
        return submissions || [];
    } catch (error) {
        console.error('Error fetching form submissions:', error);
        return [];
    }
}

/**
 * Get all submissions across all forms
 */
export async function getAllSubmissions(): Promise<FormSubmission[]> {
    try {
        const store = getSubmissionsStore();
        const allSubmissions = await store.get('all_submissions', { type: 'json' }) as FormSubmission[] | null;
        return allSubmissions || [];
    } catch (error) {
        console.error('Error fetching all submissions:', error);
        return [];
    }
}

/**
 * Save submissions for a form
 */
async function saveFormSubmissions(formId: string, submissions: FormSubmission[]): Promise<void> {
    const store = getSubmissionsStore();
    await store.setJSON(`submissions_${formId}`, submissions);

    // Also update the all_submissions index
    const allSubmissions = await getAllSubmissions();
    const otherSubmissions = allSubmissions.filter(s => s.formId !== formId);
    const updatedAll = [...submissions, ...otherSubmissions].sort((a, b) =>
        new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
    );
    await store.setJSON('all_submissions', updatedAll);
}

/**
 * Generate unique ID for submission
 * Format: DPPD-{FORMNAME}-{ID}-{DATETIME}
 * Example: DPPD-TRAFFICSTOP-5-01172026143022
 */
async function generateSubmissionId(formSlug: string, formId: string): Promise<string> {
    // Clean form name: remove special characters and spaces, convert to uppercase
    const cleanFormName = formSlug
        .replace(/[^a-zA-Z0-9]/g, '')
        .toUpperCase() || 'FORM';

    // Get existing submissions for this form to determine the next ID number
    const existingSubmissions = await getFormSubmissions(formId);
    const nextId = existingSubmissions.length + 1;

    // Generate datetime in MMDDYYYYHHMMSS format
    const now = new Date();
    const month = String(now.getMonth() + 1).padStart(2, '0');
    const day = String(now.getDate()).padStart(2, '0');
    const year = now.getFullYear();
    const hours = String(now.getHours()).padStart(2, '0');
    const minutes = String(now.getMinutes()).padStart(2, '0');
    const seconds = String(now.getSeconds()).padStart(2, '0');
    const dateTimeStr = `${month}${day}${year}${hours}${minutes}${seconds}`;

    return `DPPD-${cleanFormName}-${nextId}-${dateTimeStr}`;
}

/**
 * Get arrest reports store for syncing arrest report submissions
 */
function getArrestReportsStore() {
    return getStore({ name: 'arrest-reports', consistency: 'strong' });
}

/**
 * Get all arrest reports from the arrest-reports store
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
 * Save arrest reports to the arrest-reports store
 */
async function saveArrestReports(reports: ArrestReport[]): Promise<void> {
    const store = getArrestReportsStore();
    await store.setJSON('reports', reports);
}

/**
 * Generate unique ID for arrest report based on officer name, case count, and date
 * Format: DPPD-{officerName}-{caseNumber}-{date}
 */
function generateArrestReportId(officerName: string, existingReports: ArrestReport[]): string {
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
 * Build Discord embeds for arrest report
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
 * Send arrest report to Discord with approval link
 */
async function sendArrestReportToDiscord(report: ArrestReport): Promise<string | null> {
    try {
        // Get the webhook URL from settings
        const webhookSettings = await getArrestReportsWebhookSettings();
        const webhookUrl = webhookSettings.discordWebhookUrl;

        if (!webhookUrl) {
            console.log('No webhook URL configured for arrest reports, skipping Discord notification');
            return null;
        }

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

        const response = await fetch(`${webhookUrl}?wait=true`, {
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
        console.error('Failed to send arrest report to Discord:', error);
        return null;
    }
}

/**
 * Sync form submission to arrest-reports store (for arrest report forms)
 * This ensures arrest reports submitted via the forms system also appear in /admin/arrest-reports
 */
async function syncArrestReportSubmission(formData: Record<string, any>): Promise<ArrestReport | null> {
    try {
        // Get existing arrest reports to generate the correct ID format
        const existingReports = await getArrestReports();
        const officerName = formData.officerName || 'UNKNOWN';

        // Create arrest report with the proper ID format
        const arrestReport: ArrestReport = {
            id: generateArrestReportId(officerName, existingReports),
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
            approvalStatus: 'pending',
            // Section 1: Discord Info
            discordUsername: formData.discordUsername || '',
            discordId: formData.discordId || '',
            // Section 2: Officer and Suspect Info
            officerName: formData.officerName || '',
            officerCallsign: formData.officerCallsign || '',
            suspectName: formData.suspectName || '',
            suspectDob: formData.suspectDob || '',
            suspectGender: formData.suspectGender || '',
            suspectCid: formData.suspectCid || '',
            suspectImage: formData.suspectImage || '',
            // Section 3: Charges
            reasonForStop: formData.reasonForStop || '',
            suspectBehavior: Array.isArray(formData.suspectBehavior) ? formData.suspectBehavior : [],
            charges: formData.charges || '',
            // Section 4: Transporting and Booking
            bookingLocation: formData.bookingLocation || '',
            suspectStatements: formData.suspectStatements || '',
            // Section 5: Finalization
            mirandaRights: formData.mirandaRights || 'no',
            caseStatus: formData.caseStatus || 'open',
            additionalNotes: formData.additionalNotes || ''
        };

        // Add to existing reports
        existingReports.unshift(arrestReport);

        // Send to Discord using arrest report webhook settings
        const discordMessageId = await sendArrestReportToDiscord(arrestReport);
        if (discordMessageId) {
            arrestReport.discordMessageId = discordMessageId;
            existingReports[0] = arrestReport;
        }

        // Save to arrest reports store
        await saveArrestReports(existingReports);

        console.log('Synced arrest report to arrest-reports store:', arrestReport.id);
        return arrestReport;
    } catch (error) {
        console.error('Failed to sync arrest report submission:', error);
        return null;
    }
}

/**
 * Get section color hex value
 */
function getSectionColorHex(color: string): number {
    const colorMap: Record<string, number> = {
        'indigo': 0x6366F1,
        'blue': 0x3B82F6,
        'purple': 0x8B5CF6,
        'cyan': 0x06B6D4,
        'amber': 0xF59E0B,
        'green': 0x10B981,
        'red': 0xEF4444,
        'pink': 0xEC4899,
        'orange': 0xF97316,
        'teal': 0x14B8A6,
        'yellow': 0xEAB308,
        'slate': 0x64748B
    };
    return colorMap[color] || 0x6366F1;
}

/**
 * Build Discord embeds for a form submission - each section becomes a different embed
 */
function buildSubmissionEmbeds(form: FormDefinition, submission: FormSubmission): any[] {
    const timestamp = new Date().toISOString();
    const embeds: any[] = [];

    // Create an embed for each section
    for (const section of form.sections) {
        const fields: { name: string; value: string; inline: boolean }[] = [];

        for (const field of section.fields) {
            let value = submission.data[field.id];

            // Format the value based on type
            if (field.type === 'discord-id' && value && value !== '') {
                // Format Discord ID(s) as mention(s) - supports multiple IDs separated by commas
                const ids = String(value).split(',').map(id => id.trim()).filter(id => id);
                value = ids.map(id => `<@${id}>`).join(' ');
            } else if (Array.isArray(value)) {
                value = value.join(', ') || 'None selected';
            } else if (typeof value === 'boolean') {
                value = value ? 'Yes' : 'No';
            } else if (value === null || value === undefined || value === '') {
                value = 'Not provided';
            }

            fields.push({
                name: field.label,
                value: String(value).substring(0, 1024), // Discord field value limit
                inline: field.type !== 'textarea' // Textareas should not be inline
            });
        }

        // Only add section if it has fields
        if (fields.length > 0) {
            embeds.push({
                title: section.title,
                color: getSectionColorHex(section.color),
                fields,
                timestamp
            });
        }
    }

    // Add footer to the last embed
    if (embeds.length > 0) {
        embeds[embeds.length - 1].footer = { text: `Submission ID: ${submission.id}` };
    }

    return embeds;
}

/**
 * Get the site URL from environment or default
 */
function getSiteUrl(): string {
    const url = import.meta.env.SITE || import.meta.env.URL || 'https://delperro.netlify.app';
    return url.replace(/\/$/, ''); // Remove trailing slash if present
}

/**
 * Send submission to Discord webhook
 * If the form requires approval, adds an approval link embed
 */
async function sendToDiscord(form: FormDefinition, submission: FormSubmission): Promise<string | null> {
    if (!form.discordWebhookUrl) {
        console.log('No webhook URL configured for form:', form.name);
        return null;
    }

    try {
        const embeds = buildSubmissionEmbeds(form, submission);

        // If form requires approval, add an approval action embed
        if (form.requiresApproval) {
            const siteUrl = getSiteUrl();
            const approveUrl = `${siteUrl}/api/form-approve?id=${encodeURIComponent(submission.id)}`;

            const approvalEmbed = {
                title: '✅ Supervisor Action Required',
                description: `**[Click here to Approve this Submission](${approveUrl})**`,
                color: 0x57F287, // Discord green
                fields: [
                    {
                        name: '📋 Instructions',
                        value: 'Click the link above to open the approval form. You will need to enter your Discord User ID to approve this submission.',
                        inline: false
                    }
                ],
                footer: { text: `Submission ID: ${submission.id}` }
            };

            embeds.push(approvalEmbed);
        }

        const payload = {
            content: `**New ${form.name} Submission** - ID: \`${submission.id}\``,
            embeds
        };

        const response = await fetch(`${form.discordWebhookUrl}?wait=true`, {
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
 * GET - Retrieve submissions
 */
export const GET: APIRoute = async ({ url, request }) => {
    const formId = url.searchParams.get('formId');
    const submissionId = url.searchParams.get('id');

    try {
        if (submissionId) {
            // Get specific submission
            const allSubmissions = await getAllSubmissions();
            const submission = allSubmissions.find(s => s.id === submissionId);

            if (!submission) {
                return new Response(JSON.stringify({
                    success: false,
                    error: 'Submission not found'
                }), {
                    status: 404,
                    headers: { 'Content-Type': 'application/json' }
                });
            }

            return new Response(JSON.stringify({
                success: true,
                submission
            }), {
                status: 200,
                headers: { 'Content-Type': 'application/json' }
            });
        }

        if (formId) {
            // Get submissions for specific form
            const submissions = await getFormSubmissions(formId);

            // Calculate stats
            const stats = {
                total: submissions.length
            };

            return new Response(JSON.stringify({
                success: true,
                submissions,
                stats
            }), {
                status: 200,
                headers: { 'Content-Type': 'application/json' }
            });
        }

        // Get all submissions
        const submissions = await getAllSubmissions();

        return new Response(JSON.stringify({
            success: true,
            submissions,
            stats: {
                total: submissions.length
            }
        }), {
            status: 200,
            headers: { 'Content-Type': 'application/json' }
        });
    } catch (error) {
        console.error('Error in GET submissions:', error);
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
 * POST - Create a new submission
 */
export const POST: APIRoute = async ({ request }) => {
    try {
        const data = await request.json();
        const { formSlug, formId, ...formData } = data;

        // Get the form definition
        let form: FormDefinition | null = null;
        if (formSlug) {
            form = await getFormBySlug(formSlug);
        } else if (formId) {
            form = await getFormById(formId);
        }

        if (!form) {
            return new Response(JSON.stringify({
                success: false,
                error: 'Form not found'
            }), {
                status: 404,
                headers: { 'Content-Type': 'application/json' }
            });
        }

        if (!form.enabled) {
            return new Response(JSON.stringify({
                success: false,
                error: 'This form is currently disabled'
            }), {
                status: 400,
                headers: { 'Content-Type': 'application/json' }
            });
        }

        // Get user info if available (optional for public form submissions)
        const user = await extractUserFromSession(request);

        // Generate the submission ID first (needs to count existing submissions)
        const submissionId = await generateSubmissionId(form.slug, form.id);

        // Create submission
        const submission: FormSubmission = {
            id: submissionId,
            formId: form.id,
            formName: form.name,
            formSlug: form.slug,
            data: formData,
            createdAt: new Date().toISOString(),
            submittedBy: user?.username,
            // Set approval status to pending if form requires approval
            approvalStatus: form.requiresApproval ? 'pending' : undefined
        };

        // Get existing submissions and add new one
        const existingSubmissions = await getFormSubmissions(form.id);
        existingSubmissions.unshift(submission);

        // For arrest report forms, sync to arrest-reports store and use that webhook
        // For other forms, use the general form webhook
        let arrestReport = null;
        if (form.slug === 'arrest-report') {
            // Sync to arrest-reports store (this handles its own Discord notification)
            arrestReport = await syncArrestReportSubmission(formData);
            if (arrestReport) {
                // Update the submission ID to match the arrest report ID format
                submission.id = arrestReport.id;
                submission.discordMessageId = arrestReport.discordMessageId;
                existingSubmissions[0] = submission;
            }
        } else {
            // Send to Discord for non-arrest-report forms
            const discordMessageId = await sendToDiscord(form, submission);
            if (discordMessageId) {
                submission.discordMessageId = discordMessageId;
                existingSubmissions[0] = submission;
            }
        }

        // Save submissions
        await saveFormSubmissions(form.id, existingSubmissions);

        // Log the action
        await sendAuditLog({
            action: 'CREATE',
            entityType: 'EVENTS',
            user,
            entityId: submission.id,
            entityName: `Form Submission: ${form.name}`,
            success: true,
            metadata: {
                'Submission ID': submission.id,
                'Form Name': form.name,
                'Form Slug': form.slug
            }
        });

        return new Response(JSON.stringify({
            success: true,
            submission,
            message: 'Form submitted successfully'
        }), {
            status: 200,
            headers: { 'Content-Type': 'application/json' }
        });
    } catch (error) {
        console.error('Error creating submission:', error);
        return new Response(JSON.stringify({
            success: false,
            error: String(error)
        }), {
            status: 500,
            headers: { 'Content-Type': 'application/json' }
        });
    }
};
