const { SlashCommandBuilder, MessageFlags } = require('discord.js');
const queries = require('../database/queries');
const configManager = require('../services/configManager');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('unsave')
        .setDescription('Remove your linked YouTube Music playlist.'),
    async execute(interaction) {
        const config = configManager.get(interaction.guildId);
        const replyFlags = config.reply_mode === 1 ? [] : [MessageFlags.Ephemeral];
        
        await interaction.deferReply({ flags: replyFlags });
        const userId = interaction.user.id;
        
        const row = queries.getSavedPlaylist.get(userId);
        if (!row) {
            return interaction.editReply({ content: '❌ You do not have a saved playlist to delete.', flags: replyFlags });
        }

        queries.deleteFullPlaylist(userId);
        return interaction.editReply({ content: `🗑️ Your saved playlist **${row.playlist_name}** has been removed.` });
    }
};
