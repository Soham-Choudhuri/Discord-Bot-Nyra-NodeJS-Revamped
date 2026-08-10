const { SlashCommandBuilder, MessageFlags } = require('discord.js');
const { db } = require('../database/schema');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('unsave')
        .setDescription('Remove your linked YouTube Music playlist.'),
    async execute(interaction) {
        const userId = interaction.user.id;
        
        const row = db.prepare('SELECT * FROM user_saved_playlist WHERE user_id = ?').get(userId);
        if (!row) {
            return interaction.reply({ content: 'ℹ️ You do not have a saved playlist.', flags: [MessageFlags.Ephemeral] });
        }

        db.prepare('DELETE FROM user_saved_playlist WHERE user_id = ?').run(userId);
        return interaction.reply({ content: `🗑️ Your saved playlist **${row.playlist_name}** has been removed.`, flags: [MessageFlags.Ephemeral] });
    }
};
