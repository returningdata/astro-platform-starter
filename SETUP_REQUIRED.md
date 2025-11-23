# Setup Required - Action Items

## Discord Integration Setup

To enable the live Discord features on the site, the following environment variable must be configured in Netlify:

### Required Environment Variable

Add this to your Netlify site's environment variables:

```
DISCORD_BOT_TOKEN=<your-discord-bot-token>
```

### Optional Environment Variables (for enhanced on-duty tracking)

```
DISCORD_ON_DUTY_ROLE_ID=<role-id-for-on-duty-officers>
DISCORD_ON_DUTY_CHANNEL_ID=<voice-channel-id-for-on-duty>
```

## How to Get Your Discord Bot Token

1. Visit https://discord.com/developers/applications
2. Create a new application or select an existing one
3. Go to the "Bot" section
4. Copy the bot token
5. Invite the bot to your server with these permissions:
   - Read Messages/View Channels
   - Read Message History
   - View Server Members (for on-duty tracking)

## How to Add Environment Variables in Netlify

1. Log into Netlify
2. Go to your site dashboard
3. Click "Site settings"
4. Click "Environment variables" in the left sidebar
5. Click "Add a variable"
6. Enter variable name: `DISCORD_BOT_TOKEN`
7. Enter the bot token value
8. Click "Save"
9. Redeploy your site for changes to take effect

## What Works Now

✅ Meeting announcements section loads from Discord
✅ Uniforms section displays live Discord content
✅ 10 Codes section shows live Discord messages
✅ Officers on duty counter (requires configuration)
✅ Case types include Felony, Criminal, and Misdemeanor
✅ All sections auto-refresh (30s for on-duty, 60s for others)

## What Needs Configuration

⚠️ Discord bot token must be added to Netlify environment variables
⚠️ Discord bot must be invited to the server
⚠️ Optional: Configure on-duty role/channel for accurate officer count

For complete setup instructions, see DISCORD_SETUP.md
