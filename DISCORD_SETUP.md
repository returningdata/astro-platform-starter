# Discord Integration Setup Guide

This guide explains how to enable live Discord data integration for the Del Perro Police Department Officer Hub.

## Overview

The site now features live Discord integration for:
- **Meeting Announcements** - Shows recent messages from the meetings channel
- **Department Uniforms** - Displays uniform guidelines and images from Discord
- **10 Codes** - Shows radio codes and protocols from Discord
- **Officers On Duty** - Real-time count of on-duty officers

## Prerequisites

1. A Discord Bot with appropriate permissions
2. Access to the Discord server (Guild ID: 1322805466975440906)
3. Netlify environment variable configuration access

## Setup Steps

### 1. Create a Discord Bot

1. Go to [Discord Developer Portal](https://discord.com/developers/applications)
2. Click "New Application" and give it a name (e.g., "DPPD Hub Bot")
3. Navigate to the "Bot" section
4. Click "Add Bot"
5. Under "Privileged Gateway Intents", enable:
   - Server Members Intent (for on-duty tracking)
   - Message Content Intent (for reading channel messages)
6. Copy the Bot Token (you'll need this for the next step)

### 2. Invite the Bot to Your Server

1. In the Discord Developer Portal, go to "OAuth2" > "URL Generator"
2. Select scopes:
   - `bot`
3. Select bot permissions:
   - Read Messages/View Channels
   - Read Message History
4. Copy the generated URL and open it in your browser
5. Select your Discord server and authorize the bot

### 3. Configure Netlify Environment Variables

Add the following environment variables to your Netlify site:

**Required:**
- `DISCORD_BOT_TOKEN` - Your Discord bot token from step 1

**Optional (for enhanced features):**
- `DISCORD_ON_DUTY_ROLE_ID` - The Discord role ID that indicates an officer is on duty
- `DISCORD_ON_DUTY_CHANNEL_ID` - A voice channel ID to track officers on duty

To add environment variables:
1. Go to your Netlify site dashboard
2. Navigate to Site settings > Environment variables
3. Click "Add a variable"
4. Add each variable with its corresponding value
5. Redeploy your site for changes to take effect

### 4. Finding Discord IDs

To get Channel IDs and Role IDs:
1. Enable Developer Mode in Discord: User Settings > Advanced > Developer Mode
2. Right-click on a channel or role and select "Copy ID"

**Channel IDs already configured:**
- Meeting Announcements: `1392569191583842517`
- Uniforms: `1322807838745170023`
- 10 Codes: `1322808533271711775`

### 5. Testing the Integration

1. Deploy your site to Netlify
2. Visit the homepage
3. The live sections will show:
   - Loading indicators initially
   - Discord content if the bot is configured correctly
   - Configuration instructions if the bot token is missing

## How It Works

The integration uses Netlify Functions to securely communicate with Discord's API:

- `/.netlify/functions/discord-meetings` - Fetches meeting announcements
- `/.netlify/functions/discord-uniforms` - Fetches uniform information
- `/.netlify/functions/discord-codes` - Fetches 10 codes
- `/.netlify/functions/discord-on-duty` - Gets count of on-duty officers

The homepage automatically refreshes:
- On-duty count: Every 30 seconds
- Other content: Every 60 seconds

## Troubleshooting

### "Configure Discord bot token" message
- Ensure `DISCORD_BOT_TOKEN` is set in Netlify environment variables
- Redeploy the site after adding the variable

### No content showing
- Verify the bot has been invited to the server
- Check that the bot has permission to read the specific channels
- Verify the channel IDs are correct

### On-duty count shows 0
- Configure `DISCORD_ON_DUTY_ROLE_ID` environment variable
- Ensure the bot has permission to view server members
- Check that the Server Members Intent is enabled in Discord Developer Portal

## Security Notes

- The Discord bot token is kept secure in Netlify environment variables
- Never commit the bot token to Git
- The token is only accessible to Netlify Functions (server-side)
- Client-side code never has access to the bot token

## Support

For issues with:
- Discord bot setup: Check [Discord Developer Documentation](https://discord.com/developers/docs)
- Netlify functions: Check [Netlify Functions Documentation](https://docs.netlify.com/functions/overview/)
- This integration: Review the function files in `netlify/functions/`
