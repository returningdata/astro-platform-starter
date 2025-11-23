export default async (req, context) => {
  try {
    const DISCORD_BOT_TOKEN = Netlify.env.get('DISCORD_BOT_TOKEN');
    const GUILD_ID = '1322805466975440906';
    const VOICE_CHANNEL_ID = Netlify.env.get('DISCORD_ON_DUTY_CHANNEL_ID'); // This should be the voice channel ID for on-duty officers

    if (!DISCORD_BOT_TOKEN) {
      return new Response(JSON.stringify({
        error: 'Discord bot token not configured',
        instructions: 'Please set DISCORD_BOT_TOKEN environment variable'
      }), {
        status: 500,
        headers: { 'Content-Type': 'application/json' }
      });
    }

    // Note: For a more accurate count, you might want to check a specific role or voice channel
    // This example checks guild member count with a specific role
    // You'll need to configure which role indicates "on duty"

    const ON_DUTY_ROLE_ID = Netlify.env.get('DISCORD_ON_DUTY_ROLE_ID');

    if (!ON_DUTY_ROLE_ID && !VOICE_CHANNEL_ID) {
      return new Response(JSON.stringify({
        count: 0,
        method: 'placeholder',
        message: 'Please configure DISCORD_ON_DUTY_ROLE_ID or DISCORD_ON_DUTY_CHANNEL_ID'
      }), {
        status: 200,
        headers: {
          'Content-Type': 'application/json',
          'Cache-Control': 'public, max-age=30'
        }
      });
    }

    let count = 0;
    let officers = [];

    if (VOICE_CHANNEL_ID) {
      // Check voice channel members
      const channelResponse = await fetch(
        `https://discord.com/api/v10/channels/${VOICE_CHANNEL_ID}`,
        {
          headers: {
            'Authorization': `Bot ${DISCORD_BOT_TOKEN}`,
            'Content-Type': 'application/json'
          }
        }
      );

      if (channelResponse.ok) {
        const channelData = await channelResponse.json();
        // Voice channel member count would need guild member fetching
        // This is a simplified version
      }
    }

    if (ON_DUTY_ROLE_ID) {
      // Fetch guild members with the on-duty role
      const membersResponse = await fetch(
        `https://discord.com/api/v10/guilds/${GUILD_ID}/members?limit=1000`,
        {
          headers: {
            'Authorization': `Bot ${DISCORD_BOT_TOKEN}`,
            'Content-Type': 'application/json'
          }
        }
      );

      if (membersResponse.ok) {
        const members = await membersResponse.json();
        const onDutyMembers = members.filter(member =>
          member.roles.includes(ON_DUTY_ROLE_ID)
        );

        count = onDutyMembers.length;
        officers = onDutyMembers.map(member => ({
          id: member.user.id,
          username: member.user.username,
          nickname: member.nick || member.user.username,
          avatar: member.user.avatar
        }));
      }
    }

    return new Response(JSON.stringify({
      success: true,
      count: count,
      officers: officers
    }), {
      status: 200,
      headers: {
        'Content-Type': 'application/json',
        'Cache-Control': 'public, max-age=30' // Cache for 30 seconds for live updates
      }
    });
  } catch (error) {
    return new Response(JSON.stringify({
      error: 'Internal server error',
      message: error.message,
      count: 0
    }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' }
    });
  }
};
