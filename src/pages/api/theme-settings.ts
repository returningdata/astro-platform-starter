import type { APIRoute } from 'astro';
import { getStore } from '@netlify/blobs';

export const prerender = false;

export interface ThemeSettings {
    activeTheme: 'christmas' | 'halloween' | 'default';
    christmasMusic: string; // YouTube video ID
    halloweenMusic: string; // YouTube video ID
    defaultMusic: string; // YouTube video ID
}

const defaultThemeSettings: ThemeSettings = {
    activeTheme: 'christmas',
    christmasMusic: 'yXfWUNl1PbM',
    halloweenMusic: 'qw07ZfxeV4g',
    defaultMusic: '329iFlRszxs'
};

function getThemeStore() {
    return getStore({ name: 'theme-settings', consistency: 'strong' });
}

async function getThemeSettings(): Promise<ThemeSettings> {
    try {
        const store = getThemeStore();
        const data = await store.get('settings', { type: 'json' });
        if (data) {
            return data as ThemeSettings;
        }
        return defaultThemeSettings;
    } catch (error) {
        console.error('Error fetching theme settings:', error);
        return defaultThemeSettings;
    }
}

export const GET: APIRoute = async () => {
    const settings = await getThemeSettings();
    return new Response(JSON.stringify({ settings }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' }
    });
};

export const POST: APIRoute = async ({ request }) => {
    try {
        const data = await request.json();
        const store = getThemeStore();

        const settingsToSave: ThemeSettings = {
            activeTheme: data.settings.activeTheme || 'christmas',
            christmasMusic: data.settings.christmasMusic || defaultThemeSettings.christmasMusic,
            halloweenMusic: data.settings.halloweenMusic || defaultThemeSettings.halloweenMusic,
            defaultMusic: data.settings.defaultMusic || defaultThemeSettings.defaultMusic
        };

        await store.setJSON('settings', settingsToSave);

        return new Response(JSON.stringify({ success: true }), {
            status: 200,
            headers: { 'Content-Type': 'application/json' }
        });
    } catch (error) {
        console.error('Error saving theme settings:', error);
        return new Response(JSON.stringify({ success: false, error: 'Failed to save theme settings' }), {
            status: 500,
            headers: { 'Content-Type': 'application/json' }
        });
    }
};
