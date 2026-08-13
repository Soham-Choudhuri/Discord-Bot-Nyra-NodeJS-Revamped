const { SlashCommandBuilder, MessageFlags } = require('discord.js');
const configManager = require('../services/configManager');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('stopafter')
        .setDescription('Wait for the current song to finish, then stop and clear the queue'),

    async execute(interaction, client) {
        await interaction.deferReply({ flags: [MessageFlags.Ephemeral] });

        const player = client.moonlink.players.get(interaction.guildId);

        if (!player || !player.playing) {
            return interaction.editReply({
                content: '❌ Nothing is currently playing.',
            });
        }

        // Clear the upcoming tracks and disable autoplay
        player.queue.clear();
        player.set('autoplay', false);
        player.set('autoplayManager', null);
        player.set('artistHistory', []);
        player.set('favoritesQueue', null);

        // Delete NP Message
        const npMessageId = player.get('np_message_id');
        if (npMessageId) {
            const channelId = player.textChannelId || player.voiceChannelId;
            const textChannel = client.channels.cache.get(channelId);
            if (textChannel) {
                textChannel.messages.fetch(npMessageId).then(msg => {
                    if (msg && msg.deletable) msg.delete();
                }).catch(() => {});
            }
            player.set('np_message_id', null);
        }

        await interaction.editReply({ content: '⏳ **Lazy Stop**: Current song will finish, then playback will stop and queue will be cleared.' });
    },
};
