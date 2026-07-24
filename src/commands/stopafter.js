const { SlashCommandBuilder, MessageFlags } = require('discord.js');
const configManager = require('../services/configManager');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('stopafter')
        .setDescription('Wait for the current song to finish, then stop and clear the queue'),

    async execute(interaction, client) {
        const player = client.moonlink.players.get(interaction.guildId);

        if (!player || !player.playing) {
            return interaction.reply({
                content: '❌ Nothing is currently playing.',
                flags: [MessageFlags.Ephemeral],
            });
        }

        // Clear the upcoming tracks and disable autoplay
        player.queue.clear();
        player.set('autoplay', false);
        player.set('favoritesQueue', null);

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

        await interaction.reply({ content: '⏳ **Lazy Stop**: Current song will finish, then playback will stop and queue will be cleared.', flags: [MessageFlags.Ephemeral] });
    },
};
