const { SlashCommandBuilder, MessageFlags } = require('discord.js');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('skip')
        .setDescription('Skip the currently playing track'),

    async execute(interaction, client) {
        const player = client.moonlink.players.get(interaction.guildId);

        if (!player || !player.playing) {
            return interaction.reply({
                content: '❌ Nothing is currently playing.',
                flags: [MessageFlags.Ephemeral],
            });
        }

        const skippedTitle = player.current?.title || 'Unknown';

        // lavalink-client automatically handles queue progression on skip
        if (player.queue.size === 0) {
            if (player.get('autoplay')) {
                client.moonlink.emit('queueEnd', player);
            } else {
                await player.stop();
            }
        } else {
            await player.skip();
        }

        await interaction.reply({ content: `⏭️ Skipped: **${skippedTitle}**`, flags: [MessageFlags.Ephemeral] });
    },
};
