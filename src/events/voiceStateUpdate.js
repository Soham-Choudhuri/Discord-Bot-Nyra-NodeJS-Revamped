const { Events } = require('discord.js');

// Store disconnect timeouts per guild
const disconnectTimers = new Map();

module.exports = {
    name: Events.VoiceStateUpdate,
    once: false,
    async execute(oldState, newState, client) {
        const guildId = oldState.guild.id || newState.guild.id;

        // 1. Fetch the Lavalink player for this guild
        const player = client.moonlink.players.get(guildId);

        // If there's no active player, we don't need to track timeouts
        if (!player) return;

        // Only care about the bot's voice channel
        const botMember = oldState.guild.members.cache.get(client.user.id);
        if (!botMember?.voice?.channel) return;

        const voiceChannel = botMember.voice.channel;

        // Count human members in the bot's voice channel (exclude bots)
        const humanMembers = voiceChannel.members.filter(m => !m.user.bot).size;

        if (humanMembers === 0) {
            // Bot is alone — start a 2-minute disconnect timer
            if (disconnectTimers.has(guildId)) return;

            console.log(`⏳ Bot alone in ${voiceChannel.name} (${guildId}). Disconnecting in 2 minutes...`);

            const timer = setTimeout(async () => {
                disconnectTimers.delete(guildId);

                // Fetch the player again in case a user destroyed it manually during the timeout
                const activePlayer = client.moonlink.players.get(guildId);
                if (activePlayer) {
                    // Destroy player and leave the channel
                    await activePlayer.destroy('Channel empty for 2 minutes');
                    console.log(`👋 Auto-disconnected from ${guildId} (empty channel).`);
                }
            }, 2 * 60 * 1000);

            disconnectTimers.set(guildId, timer);
        } else {
            // Someone is in the channel — cancel the timer if it's running
            if (disconnectTimers.has(guildId)) {
                clearTimeout(disconnectTimers.get(guildId));
                disconnectTimers.delete(guildId);
                console.log(`✅ Disconnect timer cancelled for ${guildId}.`);
            }
        }
    },
};
