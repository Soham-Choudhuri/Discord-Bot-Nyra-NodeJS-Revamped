/**
 * Registers Moonlink-Client node lifecycle events.
 * These log connection state changes for the NodeLink server.
 */
function registerLavalinkEvents(manager, client) {
    manager.on('nodeCreate', (node) => {
        console.log(`🟢 Moonlink node "${node.identifier}" is ready. (Fresh connection)`);
    });

    manager.on('nodeError', (node, error) => {
        console.error(`🔴 Moonlink node "${node.identifier}" encountered an error:`, error?.message || error);
    });

    manager.on('nodeClose', async (node, code, reason) => {
        console.warn(`🟡 Moonlink node "${node.identifier}" disconnected. | Reason: ${reason || code || 'None'}`);
        
        // Orphaned Session Leak Fix: Teardown all zombie sessions
        for (const player of manager.players.all) {
            try {
                if (client) {
                    const textChannel = client.channels.cache.get(player.textChannelId);
                    if (textChannel) {
                        await textChannel.send({ content: '⚠️ **Audio Server Disconnected**: The NodeLink backend has unexpectedly dropped. Your session has been safely closed.' }).catch(() => {});
                    }
                }
                await player.destroy();
            } catch (err) {
                console.error(`Error destroying player for guild ${player.guildId}:`, err.message);
            }
        }
    });
}

module.exports = { registerLavalinkEvents };
