const { SlashCommandBuilder, MessageFlags } = require('discord.js');
const queries = require('../database/queries');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('unsave')
        .setDescription('Remove your linked YouTube Music playlist.'),
    async execute(interaction) {
        await interaction.deferReply({ flags: [MessageFlags.Ephemeral] });
        const userId = interaction.user.id;
        
        const row = queries.getSavedPlaylist.get(userId);
        if (!row) {
            return interaction.editReply({ content: 'ℹ️ You do not have a saved playlist.' });
        }

        queries.deleteFullPlaylist(userId);
        return interaction.editReply({ content: `🗑️ Your saved playlist **${row.playlist_name}** has been removed.` });
    }
};
