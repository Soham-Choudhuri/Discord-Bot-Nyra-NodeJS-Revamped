const { SlashCommandBuilder, MessageFlags } = require('discord.js');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('skip')
        .setDescription('Skip the currently playing track'),

    async execute(interaction, client) {
        await interaction.deferReply({ flags: [MessageFlags.Ephemeral] });

        const player = client.moonlink.players.get(interaction.guildId);

        if (!player || !player.playing) {
            return interaction.editReply({
                content: '❌ Nothing is currently playing.'
            });
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
