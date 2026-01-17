import type { APIRoute } from 'astro';
import { getStore } from '@netlify/blobs';
import { extractUserFromSession, sendAuditLog, checkPermission } from '../../utils/discord-webhook';

export const prerender = false;

// Field types supported by the form builder
export type FieldType = 'text' | 'textarea' | 'select' | 'checkbox' | 'number' | 'date' | 'url' | 'email' | 'checkbox-group';

export interface FormField {
    id: string;
    type: FieldType;
    label: string;
    placeholder?: string;
    required: boolean;
    helpText?: string;
    options?: string[]; // For select and checkbox-group types
}

export interface FormSection {
    id: string;
    title: string;
    icon?: string; // Icon name or SVG
    color: string; // Tailwind color class like 'indigo', 'blue', 'purple', etc.
    fields: FormField[];
}

export interface FormDefinition {
    id: string;
    name: string;
    slug: string; // URL-friendly name for the form
    description: string;
    sections: FormSection[];
    discordWebhookUrl?: string;
    enabled: boolean;
    requiresApproval?: boolean; // If true, submissions will have an approval workflow
    createdAt: string;
    updatedAt: string;
    createdBy?: string;
}

/**
 * Get forms store
 */
function getFormsStore() {
    return getStore({ name: 'form-definitions', consistency: 'strong' });
}

/**
 * Default Arrest Reports form definition
 */
const DEFAULT_ARREST_REPORTS_FORM: FormDefinition = {
    id: 'default_arrest_reports',
    name: 'Arrest Report',
    slug: 'arrest-report',
    description: 'Submit an arrest report for DPPD processing',
    discordWebhookUrl: '',
    enabled: true,
    createdAt: '2025-01-01T00:00:00.000Z',
    updatedAt: '2025-01-01T00:00:00.000Z',
    createdBy: 'System',
    sections: [
        {
            id: 'section_discord_info',
            title: 'Discord Information',
            color: 'indigo',
            fields: [
                { id: 'discordUsername', type: 'text', label: 'Discord Username', placeholder: 'e.g., user#1234', required: true, helpText: 'Your full Discord username' },
                { id: 'discordId', type: 'text', label: 'Discord ID', placeholder: 'e.g., 123456789012345678', required: true, helpText: 'Your 18-digit Discord user ID' }
            ]
        },
        {
            id: 'section_officer_suspect',
            title: 'Officer & Suspect Information',
            color: 'blue',
            fields: [
                { id: 'officerName', type: 'text', label: 'Officer Name', placeholder: 'e.g., John Smith', required: true },
                { id: 'officerCallsign', type: 'text', label: 'Officer Callsign', placeholder: 'e.g., 1-Adam-12', required: true },
                { id: 'suspectName', type: 'text', label: 'Suspect Name', placeholder: 'Suspect\'s full name', required: true },
                { id: 'suspectDob', type: 'date', label: 'Suspect DOB', placeholder: '', required: true },
                { id: 'suspectGender', type: 'select', label: 'Suspect Gender', required: true, options: ['Male', 'Female', 'Unknown'] },
                { id: 'suspectCid', type: 'text', label: 'Suspect CID (CIVID)', placeholder: 'Suspect\'s CID/CIVID', required: false },
                { id: 'suspectImage', type: 'url', label: 'Suspect Image URL', placeholder: 'https://...', required: false, helpText: 'Optional: Link to mugshot or image' }
            ]
        },
        {
            id: 'section_charges',
            title: 'Charges',
            color: 'purple',
            fields: [
                { id: 'reasonForStop', type: 'textarea', label: 'Reason for Initial Stop', placeholder: 'Describe the reason for the initial stop...', required: true },
                { id: 'suspectBehavior', type: 'checkbox-group', label: 'Suspect Behavior During Arrest', required: false, options: ['Compliant', 'Non-Compliant', 'Aggressive', 'Attempted to Flee', 'Verbal Abuse', 'Physical Resistance'], helpText: 'Select all that apply' },
                { id: 'charges', type: 'textarea', label: 'List of Charges Applied', placeholder: 'List all charges applied to the suspect...', required: true }
            ]
        },
        {
            id: 'section_transport_booking',
            title: 'Transporting & Booking',
            color: 'cyan',
            fields: [
                { id: 'bookingLocation', type: 'select', label: 'Location of Booking', required: true, options: ['Mission Row PD', 'Bolingbroke Penitentiary', 'Sandy Shores Sheriff', 'Paleto Bay Sheriff', 'Other'] },
                { id: 'suspectStatements', type: 'textarea', label: 'Suspect Statements', placeholder: 'Any statements made by the suspect during arrest/booking...', required: false }
            ]
        },
        {
            id: 'section_finalization',
            title: 'Finalization',
            color: 'green',
            fields: [
                { id: 'mirandaRights', type: 'select', label: 'Miranda Rights Read?', required: true, options: ['Yes', 'No', 'Refused to Listen'] },
                { id: 'caseStatus', type: 'select', label: 'Case Status', required: true, options: ['Open', 'Closed', 'Unresolved'] },
                { id: 'additionalNotes', type: 'textarea', label: 'Additional Notes', placeholder: 'Any additional notes or information...', required: false }
            ]
        }
    ]
};

/**
 * Get all form definitions
 */
export async function getFormDefinitions(): Promise<FormDefinition[]> {
    try {
        const store = getFormsStore();
        let forms = await store.get('forms', { type: 'json' }) as FormDefinition[] | null;

        // If no forms exist, seed with the default Arrest Reports form
        if (!forms || forms.length === 0) {
            forms = [DEFAULT_ARREST_REPORTS_FORM];
            await store.setJSON('forms', forms);
        } else {
            // Check if the default arrest report form exists, add it if not
            const hasArrestReportForm = forms.some(f => f.slug === 'arrest-report' || f.id === 'default_arrest_reports');
            if (!hasArrestReportForm) {
                forms.unshift(DEFAULT_ARREST_REPORTS_FORM);
                await store.setJSON('forms', forms);
            }
        }

        return forms;
    } catch (error) {
        console.error('Error fetching form definitions:', error);
        return [];
    }
}

/**
 * Get a single form definition by slug
 */
export async function getFormBySlug(slug: string): Promise<FormDefinition | null> {
    const forms = await getFormDefinitions();
    return forms.find(f => f.slug === slug) || null;
}

/**
 * Get a single form definition by ID
 */
export async function getFormById(id: string): Promise<FormDefinition | null> {
    const forms = await getFormDefinitions();
    return forms.find(f => f.id === id) || null;
}

/**
 * Save form definitions
 */
async function saveFormDefinitions(forms: FormDefinition[]): Promise<void> {
    const store = getFormsStore();
    await store.setJSON('forms', forms);
}

/**
 * Generate a unique ID
 */
function generateId(): string {
    return `form_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
}

/**
 * Generate a slug from a name
 */
function generateSlug(name: string, existingForms: FormDefinition[], excludeId?: string): string {
    let baseSlug = name
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-|-$/g, '');

    // Ensure uniqueness
    let slug = baseSlug;
    let counter = 1;
    while (existingForms.some(f => f.slug === slug && f.id !== excludeId)) {
        slug = `${baseSlug}-${counter}`;
        counter++;
    }

    return slug;
}

/**
 * GET - Retrieve all form definitions or a specific one
 */
export const GET: APIRoute = async ({ url }) => {
    try {
        const slug = url.searchParams.get('slug');
        const id = url.searchParams.get('id');
        const enabledOnly = url.searchParams.get('enabled') === 'true';

        if (slug) {
            const form = await getFormBySlug(slug);
            if (!form) {
                return new Response(JSON.stringify({
                    success: false,
                    error: 'Form not found'
                }), {
                    status: 404,
                    headers: { 'Content-Type': 'application/json' }
                });
            }
            return new Response(JSON.stringify({
                success: true,
                form
            }), {
                status: 200,
                headers: { 'Content-Type': 'application/json' }
            });
        }

        if (id) {
            const form = await getFormById(id);
            if (!form) {
                return new Response(JSON.stringify({
                    success: false,
                    error: 'Form not found'
                }), {
                    status: 404,
                    headers: { 'Content-Type': 'application/json' }
                });
            }
            return new Response(JSON.stringify({
                success: true,
                form
            }), {
                status: 200,
                headers: { 'Content-Type': 'application/json' }
            });
        }

        let forms = await getFormDefinitions();

        if (enabledOnly) {
            forms = forms.filter(f => f.enabled);
        }

        return new Response(JSON.stringify({
            success: true,
            forms
        }), {
            status: 200,
            headers: { 'Content-Type': 'application/json' }
        });
    } catch (error) {
        console.error('Error in GET forms:', error);
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
 * POST - Create a new form definition
 */
export const POST: APIRoute = async ({ request }) => {
    // Validate session server-side for admin actions
    const user = await extractUserFromSession(request);

    if (!user) {
        return new Response(JSON.stringify({ error: 'Unauthorized' }), {
            status: 401,
            headers: { 'Content-Type': 'application/json' }
        });
    }

    // Check if user has form-builder permission
    if (!checkPermission(user, 'form-builder')) {
        return new Response(JSON.stringify({ error: 'Forbidden' }), {
            status: 403,
            headers: { 'Content-Type': 'application/json' }
        });
    }

    try {
        const data = await request.json();
        const existingForms = await getFormDefinitions();

        // Generate slug from name
        const slug = data.slug || generateSlug(data.name, existingForms);

        // Create new form definition
        const newForm: FormDefinition = {
            id: generateId(),
            name: data.name || 'New Form',
            slug,
            description: data.description || '',
            sections: data.sections || [],
            discordWebhookUrl: data.discordWebhookUrl || '',
            enabled: data.enabled !== false,
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
            createdBy: user.username
        };

        existingForms.push(newForm);
        await saveFormDefinitions(existingForms);

        // Log the action
        await sendAuditLog({
            action: 'CREATE',
            entityType: 'EVENTS',
            user,
            entityId: newForm.id,
            entityName: `Form: ${newForm.name}`,
            success: true,
            metadata: {
                'Form ID': newForm.id,
                'Form Name': newForm.name,
                'Slug': newForm.slug
            }
        });

        return new Response(JSON.stringify({
            success: true,
            form: newForm,
            message: 'Form created successfully'
        }), {
            status: 200,
            headers: { 'Content-Type': 'application/json' }
        });
    } catch (error) {
        console.error('Error creating form:', error);
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
 * PUT - Update a form definition
 */
export const PUT: APIRoute = async ({ request }) => {
    // Validate session server-side for admin actions
    const user = await extractUserFromSession(request);

    if (!user) {
        return new Response(JSON.stringify({ error: 'Unauthorized' }), {
            status: 401,
            headers: { 'Content-Type': 'application/json' }
        });
    }

    // Check if user has form-builder permission
    if (!checkPermission(user, 'form-builder')) {
        return new Response(JSON.stringify({ error: 'Forbidden' }), {
            status: 403,
            headers: { 'Content-Type': 'application/json' }
        });
    }

    try {
        const data = await request.json();

        if (!data.id) {
            return new Response(JSON.stringify({
                success: false,
                error: 'Form ID is required'
            }), {
                status: 400,
                headers: { 'Content-Type': 'application/json' }
            });
        }

        const forms = await getFormDefinitions();
        const formIndex = forms.findIndex(f => f.id === data.id);

        if (formIndex === -1) {
            return new Response(JSON.stringify({
                success: false,
                error: 'Form not found'
            }), {
                status: 404,
                headers: { 'Content-Type': 'application/json' }
            });
        }

        const oldForm = { ...forms[formIndex] };

        // Update slug if name changed
        let newSlug = forms[formIndex].slug;
        if (data.name && data.name !== oldForm.name) {
            newSlug = data.slug || generateSlug(data.name, forms, data.id);
        } else if (data.slug && data.slug !== oldForm.slug) {
            newSlug = data.slug;
        }

        // Update the form
        forms[formIndex] = {
            ...forms[formIndex],
            ...data,
            slug: newSlug,
            updatedAt: new Date().toISOString()
        };

        await saveFormDefinitions(forms);

        // Log the action
        await sendAuditLog({
            action: 'UPDATE',
            entityType: 'EVENTS',
            user,
            entityId: data.id,
            entityName: `Form: ${forms[formIndex].name}`,
            success: true,
            metadata: {
                'Form ID': data.id,
                'Previous Name': oldForm.name,
                'New Name': forms[formIndex].name
            }
        });

        return new Response(JSON.stringify({
            success: true,
            form: forms[formIndex],
            message: 'Form updated successfully'
        }), {
            status: 200,
            headers: { 'Content-Type': 'application/json' }
        });
    } catch (error) {
        console.error('Error updating form:', error);
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
 * DELETE - Delete a form definition
 */
export const DELETE: APIRoute = async ({ request }) => {
    // Validate session server-side for admin actions
    const user = await extractUserFromSession(request);

    if (!user) {
        return new Response(JSON.stringify({ error: 'Unauthorized' }), {
            status: 401,
            headers: { 'Content-Type': 'application/json' }
        });
    }

    // Check if user has form-builder permission
    if (!checkPermission(user, 'form-builder')) {
        return new Response(JSON.stringify({ error: 'Forbidden' }), {
            status: 403,
            headers: { 'Content-Type': 'application/json' }
        });
    }

    try {
        const data = await request.json();

        if (!data.id) {
            return new Response(JSON.stringify({
                success: false,
                error: 'Form ID is required'
            }), {
                status: 400,
                headers: { 'Content-Type': 'application/json' }
            });
        }

        const forms = await getFormDefinitions();
        const formIndex = forms.findIndex(f => f.id === data.id);

        if (formIndex === -1) {
            return new Response(JSON.stringify({
                success: false,
                error: 'Form not found'
            }), {
                status: 404,
                headers: { 'Content-Type': 'application/json' }
            });
        }

        const deletedForm = forms[formIndex];
        forms.splice(formIndex, 1);

        await saveFormDefinitions(forms);

        // Log the action
        await sendAuditLog({
            action: 'DELETE',
            entityType: 'EVENTS',
            user,
            entityId: data.id,
            entityName: `Form: ${deletedForm.name}`,
            success: true,
            metadata: {
                'Form ID': data.id,
                'Form Name': deletedForm.name
            }
        });

        return new Response(JSON.stringify({
            success: true,
            message: 'Form deleted successfully'
        }), {
            status: 200,
            headers: { 'Content-Type': 'application/json' }
        });
    } catch (error) {
        console.error('Error deleting form:', error);
        return new Response(JSON.stringify({
            success: false,
            error: String(error)
        }), {
            status: 500,
            headers: { 'Content-Type': 'application/json' }
        });
    }
};
