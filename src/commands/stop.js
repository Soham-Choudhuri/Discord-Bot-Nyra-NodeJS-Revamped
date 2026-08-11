const { SlashCommandBuilder, MessageFlags } = require('discord.js');
const configManager = require('../services/configManager');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('stop')
        .setDescription('Stop playback and clear the queue'),

    async execute(interaction, client) {
        await interaction.deferReply({ flags: [MessageFlags.Ephemeral] });

        const player = client.moonlink.players.get(interaction.guildId);

        if (!player || (!player.playing && player.queue.size === 0)) {
            return interaction.editReply({
                content: '❌ Nothing is currently playing.',
            });
        }

        // Clear the upcoming tracks and stop playback
        player.queue.clear();
        player.set('autoplay', false);
        player.set('favoritesQueue', null);

        const autoplayManager = player.get('autoplayManager');
        if (autoplayManager) autoplayManager.playedIds.clear();
        
        player.set('autoplayManager', null);
        player.set('artistHistory', []);

        // Stop the current track but STAY in the voice channel
        player.set('skipHistory', true);
        await player.stop();

        const activePlayers = client.moonlink.players.all.filter(p => p.playing && p.guildId !== interaction.guildId);
        if (activePlayers.length === 0) client.user.setActivity();

        // Delete NP Message
        const config = configManager.get(interaction.guildId);
        if (config.np_message_id) {
            const channelId = player.textChannelId || player.voiceChannelId;
            const textChannel = client.channels.cache.get(channelId);
            if (textChannel) {
                textChannel.messages.fetch(config.np_message_id).then(msg => {
                    if (msg && msg.deletable) msg.delete();
                }).catch(() => {});
            }
            configManager.set(interaction.guildId, 'np_message_id', null);
        }

        await interaction.editReply({ content: '⏹️ Stopped playback and cleared the queue. I\'m still in the channel.' });
    },
};
