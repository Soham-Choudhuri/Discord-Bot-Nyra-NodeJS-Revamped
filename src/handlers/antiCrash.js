/**
 * Global Error Handlers to prevent Node.js from terminating the process.
 */
module.exports = (client) => {
    // Fired when a promise fails and has no .catch() attached
    process.on('unhandledRejection', (reason, promise) => {
        console.error('🛡️ [Anti-Crash] Unhandled Rejection at:', promise);
        console.error('↳ Reason:', reason);
    });

    // Fired when a synchronous error is thrown and not caught by a try/catch block
    process.on('uncaughtException', async (err, origin) => {
        console.error('🛡️ [Anti-Crash] Uncaught Exception:', err);
        console.error('↳ Origin:', origin);
        
        console.log('🛑 [Anti-Crash] Initiating emergency graceful shutdown to prevent V8 corruption...');
        try {
            if (client.moonlink && client.moonlink.players) {
                for (const player of client.moonlink.players.all) {
                    await player.destroy();
                }
            }
            const { db } = require('../database/schema');
            if (db && db.open) {
                db.close();
            }
            client.destroy();
        } catch (shutdownError) {
            console.error('❌ [Anti-Crash] Error during emergency shutdown:', shutdownError);
        }
        
        process.exit(1);
    });

    // Fired for background monitor tracing before an exception bubbles up
    process.on('uncaughtExceptionMonitor', (err, origin) => {
        console.warn('⚠️ [Anti-Crash] Exception Monitor Triggered:', err.message);
    });

    // Discord API connection errors (e.g., brief internet outages)
    client.on('error', (err) => {
        console.error('📡 [Discord API] Client Error:', err.message);
    });

    // WebSocket shard disconnects
    client.on('shardError', (error, shardId) => {
        console.error(`📡 [Discord API] WebSocket Error on Shard ${shardId}:`, error.message);
    });
};
