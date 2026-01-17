import type { APIRoute } from 'astro';
import { getStore } from '@netlify/blobs';
import { sendAuditLog, extractUserFromSession } from '../../utils/discord-webhook';
import { getFormBySlug, getFormById, type FormDefinition, type FormSection } from './forms';

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
 */
function generateSubmissionId(formSlug: string): string {
    const now = new Date();
    const dateStr = `${String(now.getMonth() + 1).padStart(2, '0')}${String(now.getDate()).padStart(2, '0')}${now.getFullYear()}`;
    const random = Math.random().toString(36).substr(2, 6).toUpperCase();
    return `${formSlug.toUpperCase()}-${dateStr}-${random}`;
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

        // Create submission
        const submission: FormSubmission = {
            id: generateSubmissionId(form.slug),
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

        // Send to Discord first
        const discordMessageId = await sendToDiscord(form, submission);
        if (discordMessageId) {
            submission.discordMessageId = discordMessageId;
            existingSubmissions[0] = submission;
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
