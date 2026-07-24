const { SlashCommandBuilder, MessageFlags } = require('discord.js');

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
        const player = client.moonlink.players.get(interaction.guildId);

        if (!player) {
            return interaction.reply({
                content: '❌ There is no active player in this server.',
                flags: [MessageFlags.Ephemeral],
            });
        }

        const mode = interaction.options.getString('mode');

        // Moonlink v5 has a setLoop("off" | "track" | "queue") method
        player.setLoop(mode);

        let icon = '▶️';
        let text = 'Disabled';
        
        if (mode === 'track') {
            icon = '🔂';
            text = 'Track Loop';
        } else if (mode === 'queue') {
            icon = '🔁';
            text = 'Queue Loop';
        }

        await interaction.reply({ 
            content: `${icon} Repeat mode set to: **${text}**`, 
            flags: [MessageFlags.Ephemeral] 
        });
    },
};
