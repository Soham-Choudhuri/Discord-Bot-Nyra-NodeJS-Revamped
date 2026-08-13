const { SlashCommandBuilder, MessageFlags } = require('discord.js');
const configManager = require('../services/configManager');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('skip')
        .setDescription('Skip the currently playing track'),

    async execute(interaction, client) {
        const config = configManager.get(interaction.guildId);
        const replyFlags = config.reply_mode === 1 ? [] : [MessageFlags.Ephemeral];
        
        await interaction.deferReply({ flags: replyFlags });

        const player = client.moonlink.players.get(interaction.guildId);

        if (!player || !player.playing) {
            return interaction.editReply({ content: '❌ Nothing is currently playing.', flags: replyFlags });
        }

        const skippedTitle = player.current?.title || 'Unknown';

        // lavalink-client automatically handles queue progression on skip
        if (player.queue.size === 0) {
            await player.stop();
        } else {
            await player.skip();
        }

        await interaction.editReply({ content: `⏭️ Skipped: **${skippedTitle}**` });
    },
};
