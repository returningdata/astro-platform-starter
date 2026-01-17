import type { APIRoute } from 'astro';
import { getStore } from '@netlify/blobs';
import { getFormById, type FormDefinition } from './forms';
import type { FormSubmission } from './form-submissions';

export const prerender = false;

/**
 * Get form submissions store
 */
function getSubmissionsStore() {
    return getStore({ name: 'form-submissions', consistency: 'strong' });
}

/**
 * Get all submissions across all forms
 */
async function getAllSubmissions(): Promise<FormSubmission[]> {
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
 * Get submissions for a specific form
 */
async function getFormSubmissions(formId: string): Promise<FormSubmission[]> {
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
                // Format Discord ID(s) as mention(s)
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
                value: String(value).substring(0, 1024),
                inline: field.type !== 'textarea'
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
 * Edit Discord message to remove the approval embed
 */
async function removeApprovalEmbed(form: FormDefinition, submission: FormSubmission): Promise<boolean> {
    if (!form.discordWebhookUrl || !submission.discordMessageId) {
        return false;
    }

    try {
        const embeds = buildSubmissionEmbeds(form, submission);

        const payload = {
            content: `**${form.name} Submission** - ID: \`${submission.id}\` - ✅ Approved`,
            embeds
        };

        const response = await fetch(`${form.discordWebhookUrl}/messages/${submission.discordMessageId}`, {
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
async function sendApprovalNotification(form: FormDefinition, submissionId: string, approverDiscordId: string): Promise<boolean> {
    if (!form.discordWebhookUrl) {
        return false;
    }

    try {
        const now = new Date();
        const unixTimestamp = Math.floor(now.getTime() / 1000);
        const dateApproved = now.toLocaleDateString('en-US', {
            year: 'numeric',
            month: '2-digit',
            day: '2-digit'
        });
        const timeApproved = `<t:${unixTimestamp}:t>`;

        const payload = {
            embeds: [{
                title: `✅ ${form.name} Submission Approved`,
                color: 0x00FF00,
                fields: [
                    { name: 'Submission ID', value: `\`${submissionId}\``, inline: true },
                    { name: 'Approved By', value: `<@${approverDiscordId}>`, inline: true },
                    { name: 'Date Approved', value: dateApproved, inline: true },
                    { name: 'Time Approved', value: timeApproved, inline: true }
                ],
                timestamp: now.toISOString()
            }]
        };

        const response = await fetch(form.discordWebhookUrl, {
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
    const submissionId = url.searchParams.get('id');

    if (!submissionId) {
        return new Response(generateHTML('Error', '<p class="error">No submission ID provided.</p>'), {
            status: 400,
            headers: { 'Content-Type': 'text/html' }
        });
    }

    // Find the submission across all forms
    const allSubmissions = await getAllSubmissions();
    const submission = allSubmissions.find(s => s.id === submissionId);

    if (!submission) {
        return new Response(generateHTML('Error', '<p class="error">Submission not found.</p>'), {
            status: 404,
            headers: { 'Content-Type': 'text/html' }
        });
    }

    // Get the form definition
    const form = await getFormById(submission.formId);
    if (!form) {
        return new Response(generateHTML('Error', '<p class="error">Form definition not found.</p>'), {
            status: 404,
            headers: { 'Content-Type': 'text/html' }
        });
    }

    if (submission.approvalStatus === 'approved') {
        return new Response(generateHTML('Already Approved', `
            <div class="success-box">
                <h2>✅ Submission Already Approved</h2>
                <p>This submission has already been approved.</p>
                <p><strong>Submission ID:</strong> ${submissionId}</p>
                <p><strong>Form:</strong> ${form.name}</p>
                <p><strong>Approved By:</strong> ${submission.approvedBy || 'Unknown'}</p>
                <p><strong>Approved At:</strong> ${submission.approvedAt ? new Date(submission.approvedAt).toLocaleString() : 'Unknown'}</p>
            </div>
        `), {
            status: 200,
            headers: { 'Content-Type': 'text/html' }
        });
    }

    // Build a summary of the submission data
    let summaryHtml = '';
    for (const section of form.sections) {
        summaryHtml += `<div class="section-summary"><h4>${section.title}</h4>`;
        for (const field of section.fields) {
            let value = submission.data[field.id];
            if (Array.isArray(value)) {
                value = value.join(', ') || 'None';
            } else if (typeof value === 'boolean') {
                value = value ? 'Yes' : 'No';
            } else if (!value) {
                value = 'Not provided';
            }
            summaryHtml += `<p><strong>${field.label}:</strong> ${value}</p>`;
        }
        summaryHtml += '</div>';
    }

    // Show approval form
    const formHTML = `
        <div class="form-container">
            <h2>Approve ${form.name} Submission</h2>
            <p><strong>Submission ID:</strong> ${submissionId}</p>
            <p><strong>Submitted:</strong> ${new Date(submission.createdAt).toLocaleString()}</p>
            ${submission.submittedBy ? `<p><strong>Submitted By:</strong> ${submission.submittedBy}</p>` : ''}

            <div class="submission-details">
                ${summaryHtml}
            </div>

            <form method="POST" action="/api/form-approve">
                <input type="hidden" name="id" value="${submissionId}">
                <div class="form-group">
                    <label for="discordId">Your Discord User ID:</label>
                    <input type="text" id="discordId" name="discordId" required
                           placeholder="e.g., 123456789012345678"
                           pattern="[0-9]{17,19}"
                           title="Discord ID must be 17-19 digits">
                    <small>Right-click your name in Discord and select "Copy User ID"</small>
                </div>
                <button type="submit" class="approve-btn">✅ Approve Submission</button>
            </form>
        </div>
    `;

    return new Response(generateHTML(`Approve ${form.name}`, formHTML), {
        status: 200,
        headers: { 'Content-Type': 'text/html' }
    });
};

/**
 * POST - Process approval
 */
export const POST: APIRoute = async ({ request }) => {
    const formData = await request.formData();
    const submissionId = formData.get('id') as string;
    const discordId = formData.get('discordId') as string;

    if (!submissionId || !discordId) {
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

    // Find the submission
    const allSubmissions = await getAllSubmissions();
    const submission = allSubmissions.find(s => s.id === submissionId);

    if (!submission) {
        return new Response(generateHTML('Error', '<p class="error">Submission not found.</p>'), {
            status: 404,
            headers: { 'Content-Type': 'text/html' }
        });
    }

    // Get the form definition
    const form = await getFormById(submission.formId);
    if (!form) {
        return new Response(generateHTML('Error', '<p class="error">Form definition not found.</p>'), {
            status: 404,
            headers: { 'Content-Type': 'text/html' }
        });
    }

    if (submission.approvalStatus === 'approved') {
        return new Response(generateHTML('Already Approved', `
            <div class="success-box">
                <h2>✅ Submission Already Approved</h2>
                <p>This submission was already approved.</p>
            </div>
        `), {
            status: 200,
            headers: { 'Content-Type': 'text/html' }
        });
    }

    // Get form-specific submissions and update
    const formSubmissions = await getFormSubmissions(submission.formId);
    const submissionIndex = formSubmissions.findIndex(s => s.id === submissionId);

    if (submissionIndex === -1) {
        return new Response(generateHTML('Error', '<p class="error">Submission not found in form submissions.</p>'), {
            status: 404,
            headers: { 'Content-Type': 'text/html' }
        });
    }

    // Update submission status
    const now = new Date().toISOString();
    formSubmissions[submissionIndex] = {
        ...formSubmissions[submissionIndex],
        approvalStatus: 'approved',
        approvedBy: discordId,
        approvedAt: now
    };

    await saveFormSubmissions(submission.formId, formSubmissions);

    // Edit the Discord message to remove the approval embed
    if (submission.discordMessageId) {
        await removeApprovalEmbed(form, formSubmissions[submissionIndex]);
    }

    // Send Discord notification
    const notificationSent = await sendApprovalNotification(form, submissionId, discordId);

    const resultHTML = `
        <div class="success-box">
            <h2>✅ Submission Approved Successfully</h2>
            <p><strong>Submission ID:</strong> ${submissionId}</p>
            <p><strong>Form:</strong> ${form.name}</p>
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
    <title>${title} - DPPD Forms</title>
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
        h4 {
            color: #5865F2;
            margin-bottom: 8px;
            font-size: 14px;
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
        .submission-details {
            background: rgba(0, 0, 0, 0.2);
            border-radius: 8px;
            padding: 16px;
            margin: 16px 0;
            max-height: 300px;
            overflow-y: auto;
        }
        .section-summary {
            margin-bottom: 16px;
            padding-bottom: 16px;
            border-bottom: 1px solid rgba(255, 255, 255, 0.1);
        }
        .section-summary:last-child {
            margin-bottom: 0;
            padding-bottom: 0;
            border-bottom: none;
        }
        .section-summary p {
            font-size: 13px;
            margin: 4px 0;
            color: rgba(255, 255, 255, 0.8);
        }
        .section-summary strong {
            color: rgba(255, 255, 255, 0.6);
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
