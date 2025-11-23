export default async (req, context) => {
  try {
    const DISCORD_BOT_TOKEN = Netlify.env.get('DISCORD_BOT_TOKEN');
    const GUILD_ID = '1322805466975440906';
    const CHANNEL_ID = '1322808533271711775'; // 10 codes channel

    if (!DISCORD_BOT_TOKEN) {
      return new Response(JSON.stringify({
        error: 'Discord bot token not configured',
        instructions: 'Please set DISCORD_BOT_TOKEN environment variable'
      }), {
        status: 500,
        headers: { 'Content-Type': 'application/json' }
      });
    }

    // Fetch messages from Discord channel
    const response = await fetch(
      `https://discord.com/api/v10/channels/${CHANNEL_ID}/messages?limit=20`,
      {
        headers: {
          'Authorization': `Bot ${DISCORD_BOT_TOKEN}`,
          'Content-Type': 'application/json'
        }
      }
    );

    if (!response.ok) {
      const error = await response.text();
      return new Response(JSON.stringify({
        error: 'Failed to fetch Discord messages',
        details: error
      }), {
        status: response.status,
        headers: { 'Content-Type': 'application/json' }
      });
    }

    const messages = await response.json();

    // Transform messages for easier frontend consumption
    const formattedMessages = messages.map(msg => ({
      id: msg.id,
      content: msg.content,
      author: {
        username: msg.author.username,
        avatar: msg.author.avatar
      },
      timestamp: msg.timestamp,
      embeds: msg.embeds
    }));

    return new Response(JSON.stringify({
      success: true,
      messages: formattedMessages
    }), {
      status: 200,
      headers: {
        'Content-Type': 'application/json',
        'Cache-Control': 'public, max-age=300' // Cache for 5 minutes
      }
    });
  } catch (error) {
    return new Response(JSON.stringify({
      error: 'Internal server error',
      message: error.message
    }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' }
    });
  }
};
