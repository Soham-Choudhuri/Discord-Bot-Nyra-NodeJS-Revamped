const { SlashCommandBuilder, MessageFlags } = require('discord.js');
const configManager = require('../services/configManager');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('repeat')
        .setDescription('Toggle track or queue loop mode')
        .addStringOption(option =>
            option.setName('mode')
                .setDescription('Select the repeat mode')
                .setRequired(true)
                .addChoices(
                    { name: 'Off (Disable Loop)', value: 'off' },
                    { name: 'Track (Loop current song)', value: 'track' },
                    { name: 'Queue (Loop entire queue)', value: 'queue' }
                )),

    async execute(interaction, client) {
        const config = configManager.get(interaction.guildId);
        const replyFlags = config.reply_mode === 1 ? [] : [MessageFlags.Ephemeral];
        
        await interaction.deferReply({ flags: replyFlags });

        const player = client.moonlink.players.get(interaction.guildId);

        if (!player || (!player.playing && player.queue.size === 0)) {
            return interaction.editReply({
                content: '❌ Nothing is currently playing.',
                flags: replyFlags
            });
        }

        const mode = interaction.options.getString('mode');

        // Moonlink v5 has a setLoop("off" | "track" | "queue") method
        player.setLoop(mode);

        let icon = '▶️';
        let text = 'Disabled';
        let extraNote = '';
        
        if (mode === 'track') {
            icon = '🔂';
            text = 'Track Loop';
        } else if (mode === 'queue') {
            icon = '🔁';
            text = 'Queue Loop';
        }

        if (mode !== 'off' && player.get('autoplay')) {
            player.set('autoplay', false);
            player.set('autoplayManager', null);
            extraNote = '\n*(Autoplay has been disabled to allow looping)*';
        }

        await interaction.editReply({ 
            content: `${icon} Repeat mode set to: **${text}**${extraNote}` 
        });
    },
};
