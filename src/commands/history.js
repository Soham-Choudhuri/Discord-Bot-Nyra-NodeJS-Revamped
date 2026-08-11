const { SlashCommandBuilder, EmbedBuilder, MessageFlags } = require('discord.js');
const { db } = require('../database/schema');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('history')
        .setDescription('Manage your personal playback history')
        .addSubcommand(subcommand =>
            subcommand
                .setName('toggle')
                .setDescription('Toggle your personal track history logging (Opt-in/Opt-out)')
        )
        .addSubcommand(subcommand =>
            subcommand
                .setName('view')
                .setDescription('View your recently played tracks')
        )
        .addSubcommand(subcommand =>
            subcommand
                .setName('wipe')
                .setDescription('Permanently delete your entire track history from the database')
        ),

    async execute(interaction) {
        const subcommand = interaction.options.getSubcommand();
        const userId = interaction.user.id;

        // Force ephemeral to respect privacy
        await interaction.deferReply({ flags: [MessageFlags.Ephemeral] });

        if (subcommand === 'toggle') {
            // Get current preference
            const pref = db.prepare('SELECT is_tracking_enabled FROM user_preferences WHERE user_id = ?').get(userId);
            const currentState = pref ? pref.is_tracking_enabled : 0;
            const newState = currentState === 1 ? 0 : 1;

            // Upsert the new preference
            db.prepare(`
                INSERT INTO user_preferences (user_id, is_tracking_enabled) 
                VALUES (?, ?) 
                ON CONFLICT(user_id) DO UPDATE SET is_tracking_enabled = ?
            `).run(userId, newState, newState);

            if (newState === 1) {
                return interaction.editReply({ content: '✅ **Track History Enabled:** Nyra will now save tracks you play (and Autoplay tracks in your sessions) to your personal database profile.' });
            } else {
                return interaction.editReply({ content: '⏸️ **Track History Disabled:** Nyra has stopped logging your playback history. (Note: Existing history is kept until you run `/history wipe`).' });
            }
        }

        if (subcommand === 'view') {
            const pref = db.prepare('SELECT is_tracking_enabled FROM user_preferences WHERE user_id = ?').get(userId);
            const isEnabled = pref && pref.is_tracking_enabled === 1;

            const tracks = db.prepare(`
                SELECT video_id, track_title, track_author, played_at 
                FROM track_history 
                WHERE user_id = ? 
                ORDER BY played_at DESC 
                LIMIT 15
            `).all(userId);

            if (tracks.length === 0) {
                return interaction.editReply({ 
                    content: `📭 You don't have any tracks in your history yet.\n\n*Status: ${isEnabled ? '✅ Logging Enabled' : '⏸️ Logging Disabled'}*` 
                });
            }

            const embed = new EmbedBuilder()
                .setColor(0x7C3AED)
                .setAuthor({ name: `🕰️ ${interaction.user.displayName}'s Playback History`, iconURL: interaction.user.displayAvatarURL() })
                .setDescription(`*Status: ${isEnabled ? '✅ Logging Enabled' : '⏸️ Logging Disabled'}*\n\n` + 
                    tracks.map((t, i) => `**${tracks.length - i}.** [${t.track_title}](https://music.youtube.com/watch?v=${t.video_id}) — ${t.track_author}`).join('\n')
                )
                .setFooter({ text: 'Showing the last 15 played tracks' })
                .setTimestamp();

            return interaction.editReply({ embeds: [embed] });
        }

        if (subcommand === 'wipe') {
            const result = db.prepare('DELETE FROM track_history WHERE user_id = ?').run(userId);

            // Also optionally disable it? We'll leave it as they requested, but maybe inform them.
            const pref = db.prepare('SELECT is_tracking_enabled FROM user_preferences WHERE user_id = ?').get(userId);
            let extra = '';
            if (pref && pref.is_tracking_enabled === 1) {
                extra = '\n*(Note: Logging is still enabled. Use `/history toggle` to turn it off).*';
            }

            return interaction.editReply({ 
                content: `🗑️ **History Wiped!** Permanently deleted ${result.changes} track(s) from your profile.${extra}` 
            });
        }
    }
};
