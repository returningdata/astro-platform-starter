import type { APIRoute } from 'astro';
import { getStore } from '@netlify/blobs';
import { logDataSave, extractUserFromSession, checkPermission } from '../../utils/discord-webhook';

export const prerender = false;

export interface MusicPlaylistItem {
    id: string; // YouTube video ID
    title: string; // Song title for display
}

export interface ThemeSettings {
    activeTheme: 'christmas' | 'halloween' | 'default' | 'new-year';
    christmasMusic: string; // YouTube video ID
    halloweenMusic: string; // YouTube video ID
    defaultMusic: string; // YouTube video ID (kept for backwards compatibility)
    newYearMusic: string; // YouTube video ID
    // Playlist support - array of songs for each theme
    defaultMusicPlaylist?: MusicPlaylistItem[];
    christmasMusicPlaylist?: MusicPlaylistItem[];
    halloweenMusicPlaylist?: MusicPlaylistItem[];
    newYearMusicPlaylist?: MusicPlaylistItem[];
}

const defaultThemeSettings: ThemeSettings = {
    activeTheme: 'new-year',
    christmasMusic: 'yXfWUNl1PbM',
    halloweenMusic: 'qw07ZfxeV4g',
    defaultMusic: 'lY2yjAdbvdQ',
    newYearMusic: 'MmC4BLodWDk',
    // Default theme playlist - songs from Spotify Pop Mix playlist
    defaultMusicPlaylist: [
        { id: 'lY2yjAdbvdQ', title: 'Treat You Better - Shawn Mendes' },
        { id: 'JGwWNGJdvx8', title: 'Shape of You - Ed Sheeran' },
        { id: '4NRXx6U8ABQ', title: 'Blinding Lights - The Weeknd' },
        { id: 'ic8j13piAhQ', title: 'Cruel Summer - Taylor Swift' },
        { id: 'kPa7bsKwL-c', title: 'Die With A Smile - Lady Gaga, Bruno Mars' },
        { id: 'hT_nvWreIhg', title: 'Counting Stars - OneRepublic' },
        { id: 'G7KNmW9a75Y', title: 'Flowers - Miley Cyrus' },
        { id: 'vkQ06Y9rg7A', title: 'Sorry - Justin Bieber' },
        { id: 'QYh6mYIJG2Y', title: '7 rings - Ariana Grande' },
        { id: 'tD4HCZe-tew', title: 'Lush Life - Zara Larsson' },
        { id: 'V9PVRfjEBTI', title: 'BIRDS OF A FEATHER - Billie Eilish' },
        { id: 'PMivT7MJ41M', title: "That's What I Like - Bruno Mars" },
        { id: 'H5v3kku4y6Q', title: 'As It Was - Harry Styles' },
        { id: 'oygrmJFKYZY', title: "Don't Start Now - Dua Lipa" },
        { id: 'PT2_F-1esPk', title: 'Closer - The Chainsmokers ft. Halsey' },
        { id: 'xpVfcZ0ZcFM', title: "There's Nothing Holdin' Me Back - Shawn Mendes" },
        { id: 'NmugSMBh_iI', title: 'Maps - Maroon 5' },
        { id: 'ZmDBbnmKpqQ', title: 'Without Me - Halsey' },
        { id: 'nSDgHBxUbVQ', title: 'Photograph - Ed Sheeran' },
        { id: 'nfs8NYg7yQM', title: 'Attention - Charlie Puth' },
        { id: 'e-ORhEE9VVg', title: 'Blank Space - Taylor Swift' },
        { id: 'LMOKlXfXn50', title: 'Save Your Tears (Remix) - The Weeknd, Ariana Grande' },
        { id: 'LOZuxwVk7TU', title: 'Toxic - Britney Spears' },
        { id: 'M11SvDtPBhA', title: 'Party In The U.S.A. - Miley Cyrus' },
        { id: 'Vzo-EL_62fQ', title: 'Ghost - Justin Bieber' },
        { id: 'eVli-tstM5E', title: 'Espresso - Sabrina Carpenter' },
        { id: 'KEG7b851Ric', title: 'Taste - Sabrina Carpenter' },
        { id: 'bVeTqsJU7c4', title: "we can't be friends - Ariana Grande" },
        { id: 'bpOSxM0rNPM', title: 'Poker Face - Lady Gaga' }
    ]
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
    // Validate session server-side
    const user = await extractUserFromSession(request);

    if (!user) {
        return new Response(JSON.stringify({ error: 'Unauthorized' }), {
            status: 401,
            headers: { 'Content-Type': 'application/json' }
        });
    }

    // Check if user has theme-settings permission
    if (!checkPermission(user, 'theme-settings')) {
        return new Response(JSON.stringify({ error: 'Forbidden' }), {
            status: 403,
            headers: { 'Content-Type': 'application/json' }
        });
    }

    try {
        // Get current settings for comparison
        const oldSettings = await getThemeSettings();

        const data = await request.json();
        const store = getThemeStore();

        const settingsToSave: ThemeSettings = {
            activeTheme: data.settings.activeTheme || 'new-year',
            christmasMusic: data.settings.christmasMusic || defaultThemeSettings.christmasMusic,
            halloweenMusic: data.settings.halloweenMusic || defaultThemeSettings.halloweenMusic,
            defaultMusic: data.settings.defaultMusic || defaultThemeSettings.defaultMusic,
            newYearMusic: data.settings.newYearMusic || defaultThemeSettings.newYearMusic,
            // Playlist support
            defaultMusicPlaylist: data.settings.defaultMusicPlaylist || defaultThemeSettings.defaultMusicPlaylist,
            christmasMusicPlaylist: data.settings.christmasMusicPlaylist,
            halloweenMusicPlaylist: data.settings.halloweenMusicPlaylist,
            newYearMusicPlaylist: data.settings.newYearMusicPlaylist
        };

        await store.setJSON('settings', settingsToSave);

        // Log the change to Discord
        await logDataSave(
            'THEME_SETTINGS',
            user,
            oldSettings,
            settingsToSave,
            true
        );

        return new Response(JSON.stringify({ success: true }), {
            status: 200,
            headers: { 'Content-Type': 'application/json' }
        });
    } catch (error) {
        console.error('Error saving theme settings:', error);

        // Log the failed attempt
        await logDataSave(
            'THEME_SETTINGS',
            user,
            null,
            null,
            false,
            'Failed to save theme settings'
        );

        return new Response(JSON.stringify({ success: false, error: 'Failed to save theme settings' }), {
            status: 500,
            headers: { 'Content-Type': 'application/json' }
        });
    }
};
