/**
 * Registers Moonlink-Client node lifecycle events.
 * These log connection state changes for the NodeLink server.
 */
function registerLavalinkEvents(manager) {
    manager.on('nodeCreate', (node) => {
        console.log(`🟢 Moonlink node "${node.identifier}" is ready. (Fresh connection)`);
    });

    manager.on('nodeError', (node, error) => {
        console.error(`🔴 Moonlink node "${node.identifier}" encountered an error:`, error?.message || error);
    });

    manager.on('nodeClose', (node, code, reason) => {
        console.warn(`🟡 Moonlink node "${node.identifier}" disconnected. | Reason: ${reason || code || 'None'}`);
    });

    // Simplified Moonlink Debug Logging
    manager.on('nodeRaw', (node, payload) => {
         // Filter out verbose heartbeat messages to keep console clean
         if (payload.op !== 'stats' && payload.op !== 'playerUpdate') {
             // console.log(`📡 [NodeLink: ${node.identifier}]`, payload);
         }
    });
}

module.exports = { registerLavalinkEvents };
