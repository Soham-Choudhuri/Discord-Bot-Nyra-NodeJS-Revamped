const { Events } = require('discord.js');



module.exports = {
    name: Events.VoiceStateUpdate,
    once: false,
    async execute(oldState, newState, client) {
        const guildId = oldState.guild.id || newState.guild.id;

        // 1. Fetch the Lavalink player for this guild
        const player = client.moonlink.players.get(guildId);

        // If there's no active player, we don't need to track timeouts
        if (!player) return;

        // Forced Disconnect Trap: If the bot itself was kicked/disconnected by an admin
        if (oldState.member.id === client.user.id && !newState.channelId) {
            console.log(`⚠️ Bot forcefully disconnected in ${guildId}. Tearing down player session...`);
            const existingTimer = player.get('disconnect_timer');
            if (existingTimer) clearTimeout(existingTimer);
            
            player.set('autoplayManager', null);
            player.set('artistHistory', null);
            player.set('favoritesQueue', null);
            player.set('disconnect_timer', null);
            
            await player.destroy();
            return;
        }

        // Only care about the bot's voice channel
        const botMember = oldState.guild.members.cache.get(client.user.id);
        if (!botMember?.voice?.channel) return;

        const voiceChannel = botMember.voice.channel;

        // Count human members in the bot's voice channel (exclude bots)
        const humanMembers = voiceChannel.members.filter(m => !m.user.bot).size;

        if (humanMembers === 0) {
            // Bot is alone — start a 2-minute disconnect timer
            const existingTimer = player.get('disconnect_timer');
            if (existingTimer) return;

            console.log(`⏳ Bot alone in ${voiceChannel.name} (${guildId}). Disconnecting in 2 minutes...`);

            const timer = setTimeout(async () => {
                const activePlayer = client.moonlink.players.get(guildId);
                if (activePlayer) {
                    activePlayer.set('disconnect_timer', null);
                    await activePlayer.destroy('Channel empty for 2 minutes');
                    console.log(`👋 Auto-disconnected from ${guildId} (empty channel).`);
                }
            }, 2 * 60 * 1000);

            player.set('disconnect_timer', timer);
        } else {
            // Someone is in the channel — cancel the timer if it's running
            const existingTimer = player.get('disconnect_timer');
            if (existingTimer) {
                clearTimeout(existingTimer);
                player.set('disconnect_timer', null);
                console.log(`✅ Disconnect timer cancelled for ${guildId}.`);
            }
        }
    },
};
