const { SlashCommandBuilder, MessageFlags } = require('discord.js');
const configManager = require('../services/configManager');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('stop')
        .setDescription('Stop playback and clear the queue'),

    async execute(interaction, client) {
        const player = client.moonlink.players.get(interaction.guildId);

        if (!player || (!player.playing && player.queue.size === 0)) {
            return interaction.reply({
                content: '❌ Nothing is currently playing.',
                flags: [MessageFlags.Ephemeral],
            });
        }

        // Clear the upcoming tracks and stop playback
        player.queue.clear();
        player.set('autoplay', false);
        player.set('favoritesQueue', null);

        const autoplayManager = player.get('autoplayManager');
        if (autoplayManager) autoplayManager.playedIds.clear();

        // Stop the current track but STAY in the voice channel
        player.set('skipHistory', true);
        await player.stop();
        client.user.setActivity();

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

        await interaction.reply({ content: '⏹️ Stopped playback and cleared the queue. I\'m still in the channel.', flags: [MessageFlags.Ephemeral] });
    },
};
