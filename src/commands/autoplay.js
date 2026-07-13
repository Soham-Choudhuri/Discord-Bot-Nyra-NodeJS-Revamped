const { SlashCommandBuilder, MessageFlags } = require('discord.js');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('autoplay')
        .setDescription('Toggle the endless radio feature on/off for the current session')
        .addStringOption(option =>
            option.setName('mode')
                .setDescription('The recommendation algorithm to use (Default: Static)')
                .addChoices(
                    { name: 'Static (Consistent Vibe)', value: 'static' },
                    { name: 'Dynamic (Evolving Vibe)', value: 'dynamic' }
                )
        ),
    async execute(interaction, client) {
        // Fetch the player instead of the old custom queue
        const player = client.moonlink.players.get(interaction.guildId);

        if (!player || (!player.playing && player.queue.size === 0)) {
            return interaction.reply({
                content: '❌ Nothing is currently playing. Start a track first with `/stream`.',
                flags: [MessageFlags.Ephemeral],
            });
        }

        // Toggle autoplay state using the native metadata store
        const isAutoplay = player.get('autoplay') || false;
        player.set('autoplay', !isAutoplay);

        if (player.get('autoplay')) {
            const mode = interaction.options.getString('mode') || 'static';
            const { extractVideoId } = require('../lavalink/playerEvents');

            // Extract the video ID from the current track
            const currentVideoId = extractVideoId(player.current?.uri);

            const AutoplayManager = require('../services/AutoplayManager');
            const configManager = require('../services/configManager');
            // Attach the manager directly to the player
            const autoplayManager = new AutoplayManager(interaction.guildId, mode, currentVideoId);
            player.set('autoplayManager', autoplayManager);

            // Proactively trigger fetch so /queue is instantly populated
            const config = configManager.get(interaction.guildId);
            const artistHistory = player.get('artistHistory') || [];
            autoplayManager.fillBuffer(config, artistHistory).catch(() => {});

            await interaction.reply({ content: `♾️ **Autoplay: ON** (${mode === 'static' ? 'Static Mode' : 'Dynamic Mode'})\nRecommended tracks will play when the queue ends.`, flags: [MessageFlags.Ephemeral] });
        } else {
            // Clean up the manager when disabled
            player.set('autoplayManager', null);
            await interaction.reply({ content: '⏸️ **Autoplay: OFF**\nPlayback will stop when the queue ends.', flags: [MessageFlags.Ephemeral] });
        }
    },
};
