# Discord Integration Guide

This guide explains how to integrate Discord channels with the Del Perro Police Department Officer Hub website.

## Overview

The DPPD website integrates with Discord to show:
- **Officers On Duty**: Live count from Discord channel
- **Recent Activity**: Updates from duty status changes and case activities

## Discord Channels

### Officers On Duty Channel
- **Channel ID**: `1339320714188292340`
- **Purpose**: Display which officers are currently on duty
- **URL**: https://discord.com/channels/1322805466975440906/1339320714188292340

### Duty Status Channel
- **Channel ID**: `1416057260706234389`
- **Purpose**: Track when officers go on/off duty
- **Used for**: Recent Activity feed on homepage

## Implementation Notes

To fully implement Discord integration, you'll need to:

1. **Create a Discord Bot**
   - Create a bot in the Discord Developer Portal
   - Add bot to your Discord server with appropriate permissions
   - Get the bot token

2. **Set up Discord API Integration**
   - Use a serverless function (Netlify Function) to fetch Discord data
   - Store Discord bot token as environment variable
   - Implement endpoints to:
     - Get officers on duty count
     - Get recent duty status changes
     - Get recent activity from channels

3. **Update Frontend**
   - Call the serverless function endpoints from the website
   - Update the stats on the homepage dynamically
   - Refresh data periodically (every 1-5 minutes)

## Required Environment Variables

```
DISCORD_BOT_TOKEN=your_bot_token_here
DISCORD_GUILD_ID=1322805466975440906
DISCORD_OFFICERS_CHANNEL_ID=1339320714188292340
DISCORD_DUTY_STATUS_CHANNEL_ID=1416057260706234389
```

## Example API Endpoints Needed

### GET /api/officers-on-duty
Returns the count of officers currently on duty

```json
{
  "count": 5,
  "officers": [
    { "name": "Officer Smith", "status": "Patrol" },
    { "name": "Officer Johnson", "status": "Traffic" }
  ]
}
```

### GET /api/recent-activity
Returns recent activity from Discord channels

```json
{
  "activities": [
    {
      "type": "duty_change",
      "officer": "Officer Smith",
      "status": "on_duty",
      "timestamp": "2025-11-23T12:30:00Z"
    },
    {
      "type": "case_update",
      "caseId": "2025-001",
      "action": "created",
      "timestamp": "2025-11-23T12:15:00Z"
    }
  ]
}
```

## Security Considerations

- Never expose the Discord bot token in frontend code
- Use serverless functions to handle Discord API calls
- Implement rate limiting to avoid Discord API limits
- Restrict access to officer-only channels appropriately

## Next Steps

1. Set up Discord bot and get credentials
2. Create Netlify Functions for Discord API integration
3. Update homepage to call these functions
4. Test the integration thoroughly

---

For questions about Discord integration, contact the technical administrator.
