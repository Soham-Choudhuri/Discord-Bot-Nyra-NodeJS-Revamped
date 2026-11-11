const configManager = require('../services/configManager');

/**
 * Automatically delete a message or interaction reply after a delay specified in the guild settings.
 * @param {import('discord.js').Message | import('discord.js').Interaction} target - The message or interaction to delete.
 * @param {string} guildId - The guild ID to fetch settings for.
 */
async function autoDelete(target, guildId) {
    if (!target || !guildId) return;

    try {
        const config = configManager.get(guildId);
        
        // delete_timer is in seconds, 0 means disabled
        if (config.delete_timer > 0) {
            let messageId;
            let channelId = target.channelId;
            const client = target.client;

            // Resolve the actual message ID to prevent holding the heavy Interaction/Message object
            if (target.deleteReply && typeof target.deleteReply === 'function') {
                try {
                    const replyMsg = await target.fetchReply();
                    messageId = replyMsg.id;
                } catch {
                    return; // Ephemeral or missing
                }
            } else {
                messageId = target.id;
            }

            if (!messageId || !channelId || !client) return;

            setTimeout(async () => {
                try {
                    const channel = client.channels.cache.get(channelId);
                    if (channel) {
                        await channel.messages.delete(messageId).catch(() => null);
                    }
                } catch (e) {
                    // Message might already be deleted
                }
            }, config.delete_timer * 1000);
        }
    } catch (error) {
        console.error('❌ autoDelete error:', error);
    }
}

module.exports = { autoDelete };
