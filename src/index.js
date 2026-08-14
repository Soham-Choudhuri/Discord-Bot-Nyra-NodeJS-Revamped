require('dotenv').config();

const { Client, GatewayIntentBits, Options } = require('discord.js');
const { Manager } = require('moonlink.js');
const { loadCommands } = require('./handlers/commandHandler');
const { loadEvents } = require('./handlers/eventHandler');
const { registerLavalinkEvents } = require('./lavalink/lavalinkEvents');
const { registerPlayerEvents } = require('./lavalink/playerEvents');
const ytmusic = require('./services/ytmusic');
require('./database/schema');

// ─── Discord Client ───────────────────────────────────────────────
const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildVoiceStates,
        GatewayIntentBits.GuildMessageReactions
    ],
    makeCache: Options.cacheWithLimits({
        ...Options.DefaultMakeCacheSettings,
        MessageManager: 0,
        PresenceManager: 0,
        ThreadManager: 0,
        ReactionManager: 0,
        ReactionUserManager: 0,
        GuildMemberManager: {
            maxSize: 50,
            keepOverLimit: member => member.id === client.user?.id
        },
        UserManager: {
            maxSize: 50,
            keepOverLimit: user => user.id === client.user?.id
        }
    }),
});

require('./handlers/antiCrash')(client);

// ─── Moonlink Manager ───────────────────────────────────────────────
client.moonlink = new Manager({
    nodes: [
        {
            password: process.env.LAVALINK_PASSWORD,
            host: process.env.LAVALINK_HOST,
            port: parseInt(process.env.LAVALINK_PORT) || 2333,
            secure: false,
            identifier: 'Nyra-Node'
        }
    ],
    options: {
        clientName: "Nyra Brooks"
    },
    // This tells moonlink.js how to send packets to Discord
    send: (guildId, payload) => {
        const guild = client.guilds.cache.get(guildId);
        if (guild) guild.shard.send(typeof payload === 'string' ? JSON.parse(payload) : payload);
    }
});

// We removed `client.queue = new Map()` because moonlink.js 
// has a robust, built-in queue system (player.queue) that we will use instead.

// ─── Register Moonlink Node Events ───────────────────────────────
// We pass the new moonlink manager to your event registrar
registerLavalinkEvents(client.moonlink, client);
registerPlayerEvents(client);
client.on("raw", (d) => client.moonlink.packetUpdate(d));

// ─── Initialize & Start ──────────────────────────────────────────
(async () => {
    try {
        // Initialize the YTMusic API session
        await ytmusic.initialize();

        // Load dynamic event listeners
        loadEvents(client);

        // Load and register slash commands
        await loadCommands(client);

        // Login to Discord
        await client.login(process.env.DISCORD_TOKEN);

    } catch (error) {
        console.error('❌ Fatal startup error:', error);
        process.exit(1);
    }
})();

// ─── Graceful Shutdown Protocols ──────────────────────────────
const shutdown = async (signal) => {
    console.log(`\n🛑 Received ${signal}. Initiating graceful shutdown...`);
    
    try {
        // 1. Destroy all active music players gracefully
        if (client.moonlink && client.moonlink.players) {
            for (const player of client.moonlink.players.all) {
                await player.destroy();
            }
            console.log('✅ All audio sessions terminated cleanly.');
        }

        // 2. Safely close the SQLite Database to prevent WAL corruption
        const { db } = require('./database/schema');
        if (db && db.open) {
            db.close();
            console.log('✅ Database connection closed securely.');
        }

        // 3. Disconnect from Discord
        client.destroy();
        console.log('✅ Disconnected from Discord. Goodbye!');
        
        process.exit(0);
    } catch (error) {
        console.error('❌ Error during shutdown:', error);
        process.exit(1);
    }
};

// Listen for termination signals (Ctrl+C in terminal, or PM2 restart commands)
process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));

// ─── Automated Memory Management ──────────────────────────────────
// Background Sweep has been moved to execute exclusively between tracks (trackEnd)
// to completely eliminate Stop-The-World stutters during active playback!
