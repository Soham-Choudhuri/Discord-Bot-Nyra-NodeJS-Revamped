const { Events, ModalBuilder, TextInputBuilder, TextInputStyle, ActionRowBuilder, MessageFlags } = require('discord.js');
const configManager = require('../services/configManager');
const queries = require('../database/queries');

module.exports = {
    name: Events.InteractionCreate,
    once: false,
    async execute(interaction, client) {
        const guildId = interaction.guildId;
        const config = configManager.get(guildId);

        // ─── Command Channel Restriction ────────────────────────────
        if (interaction.isChatInputCommand()) {
            const isOwner = interaction.user.id === interaction.guild.ownerId;
            const isWhitelisted = process.env.WHITELISTED_USERS?.split(',').includes(interaction.user.id);
            if (config.cmd_channel && interaction.channelId !== config.cmd_channel && !isOwner && !isWhitelisted) {
                return interaction.reply({
                    content: `❌ Commands are restricted to <#${config.cmd_channel}>.`,
                    flags: [MessageFlags.Ephemeral]
                });
            }

            const command = client.commands.get(interaction.commandName);
            if (!command) return;

            try {
                await command.execute(interaction, client);
                
                // Auto-Delete has been removed since all commands are Ephemeral
            } catch (error) {
                console.error(`❌ Error executing /${interaction.commandName}:`, error);
                const replyData = { content: '❌ Something went wrong while executing this command.', flags: [MessageFlags.Ephemeral] };
                
                if (interaction.replied || interaction.deferred) {
                    await interaction.followUp(replyData).catch(() => {});
                } else {
                    await interaction.reply(replyData).catch(() => {});
                }
                
                // Removed auto-delete fallback logic
            }
            return;
        }

        // ─── Button Clicks (Queue Pagination) ───────────────────────
        if (interaction.isButton() && interaction.customId.startsWith('queue_')) {
            const parts = interaction.customId.split('_');
            let targetPage = parseInt(parts[2], 10);
            
            // Failsafe against malformed or legacy button IDs
            if (isNaN(targetPage)) {
                targetPage = 0; 
            }
            const player = client.moonlink.players.get(guildId);
            
            if (!player || (!player.playing && player.queue.size === 0)) {
                return interaction.update({ content: '❌ Nothing is currently playing.', embeds: [], components: [] }).catch(() => {});
            }

            const queueCommand = client.commands.get('queue');
            if (queueCommand && queueCommand.generateQueuePayload) {
                const payload = queueCommand.generateQueuePayload(player, targetPage, interaction.guild.name);
                await interaction.update(payload).catch(() => {});
            }
            return;
        }

        // ─── Button Clicks (View Pagination) ───────────────────────
        if (interaction.isButton() && interaction.customId.startsWith('view_')) {
            const parts = interaction.customId.split('_');
            let targetPage = parseInt(parts[2], 10);
            
            // Failsafe against malformed or legacy button IDs
            if (isNaN(targetPage)) {
                targetPage = 0; 
            }
            
            const viewCommand = client.commands.get('view');
            if (viewCommand && viewCommand.generateViewPayload) {
                const row = queries.getPlaylistName.get(interaction.user.id);
                if (!row) return interaction.update({ content: '❌ Playlist not found.', embeds: [], components: [] }).catch(() => {});
                
                const countRow = queries.getPlaylistCount.get(interaction.user.id);
                if (!countRow) return interaction.update({ content: '❌ Playlist not found.', embeds: [], components: [] }).catch(() => {});
                const totalTracks = countRow.total;

                const payload = viewCommand.generateViewPayload(interaction.user.id, row.playlist_name, totalTracks, targetPage);
                await interaction.update(payload).catch(() => {});
            }
            return;
        }

        // ─── Select Menus ───────────────────────
        if (interaction.isStringSelectMenu()) {

            if (interaction.customId === 'fav_remove_menu') {
                const userId = interaction.user.id;
                const videoIdToRemove = interaction.values[0];

                try {
                    queries.deleteFavorite.run(userId, videoIdToRemove);

                    await interaction.update({
                        content: `✅ Track successfully removed from your favorites.`,
                        components: []
                    });
                } catch (error) {
                    await interaction.update({ content: '❌ Failed to remove track due to a database error.', components: [] });
                }
                return;
            }

            if (interaction.customId === 'settings_menu') {
                const setting = interaction.values[0];

                // Direct Toggle for Verbose Mode
                if (setting === 'verbose_mode') {
                    const newValue = config.verbose_mode === 1 ? 0 : 1;
                    configManager.set(guildId, 'verbose_mode', newValue);
                    
                    // Refresh the settings dashboard
                    const settingsCommand = client.commands.get('settings');
                    try {
                        return await settingsCommand.execute(interaction, client);
                    } catch (error) {
                        console.error('Failed to refresh verbose_mode settings:', error);
                    }
                }

                // Modals for other settings
                const modal = new ModalBuilder()
                    .setCustomId(`modal_${setting}`)
                    .setTitle('Update Nyra Configuration');

                const input = new TextInputBuilder()
                    .setCustomId('new_value')
                    .setStyle(TextInputStyle.Short)
                    .setRequired(true);

                if (setting === 'max_queue_size') {
                    input.setLabel('New Max Queue Size (1-500)').setPlaceholder('50');
                } else if (setting === 'autoplay_seed') {
                    input.setLabel('Custom Autoplay Seed').setPlaceholder('Video ID or "none"').setRequired(false);
                } else if (setting === 'delete_timer') {
                    input.setLabel('Auto-Delete Timer (Seconds)').setPlaceholder('e.g. 10 (0 to disable)');
                } else if (setting === 'cmd_channel') {
                    input.setLabel('Restricted Command Channel ID').setPlaceholder('Channel ID or "none"').setRequired(false);
                } else if (setting === 'artist_memory') {
                    input.setLabel('Artist Memory (1-10)').setPlaceholder('e.g. 5');
                } else if (setting === 'regex_blacklist') {
                    input.setLabel('Regex Blacklist Pattern').setPlaceholder('Enter a valid JS regex string').setStyle(TextInputStyle.Paragraph);
                }

                const row = new ActionRowBuilder().addComponents(input);
                modal.addComponents(row);
                await interaction.showModal(modal);
            }
            return;
        }

        // ─── Modal Submissions ──────────────────────────────────────
        if (interaction.isModalSubmit()) {
            let value = interaction.fields.getTextInputValue('new_value');

            if (interaction.customId === 'modal_max_queue_size') {
                const num = parseInt(value, 10);
                if (isNaN(num)) {
                    return interaction.reply({ content: '❌ Enter a valid number.', flags: [MessageFlags.Ephemeral] });
                }
                const clamped = Math.max(1, Math.min(num, 5000));
                configManager.set(guildId, 'max_queue_size', clamped);
            } 
            else if (interaction.customId === 'modal_autoplay_seed') {
                if (!value || value.toLowerCase() === 'none') value = null;
                configManager.set(guildId, 'autoplay_seed', value);
            }
            else if (interaction.customId === 'modal_delete_timer') {
                const num = parseInt(value, 10);
                if (isNaN(num)) {
                    return interaction.reply({ content: '❌ Enter a valid number.', flags: [MessageFlags.Ephemeral] });
                }
                const clamped = Math.max(0, Math.min(num, 86400));
                configManager.set(guildId, 'delete_timer', clamped);
            }
            else if (interaction.customId === 'modal_cmd_channel') {
                if (!value || value.toLowerCase() === 'none') value = null;
                configManager.set(guildId, 'cmd_channel', value);
            }
            else if (interaction.customId === 'modal_artist_memory') {
                const num = parseInt(value, 10);
                if (isNaN(num)) {
                    return interaction.reply({ content: '❌ Enter a valid number.', flags: [MessageFlags.Ephemeral] });
                }
                const clamped = Math.max(1, Math.min(num, 50));
                configManager.set(guildId, 'artist_memory', clamped);
            }
            else if (interaction.customId === 'modal_regex_blacklist') {
                try {
                    new RegExp(value, 'i');
                    configManager.set(guildId, 'regex_blacklist', value);
                } catch (e) {
                    return interaction.reply({ content: '❌ Invalid Regex pattern. Please check your syntax.', flags: [MessageFlags.Ephemeral] });
                }
            }

            // Refresh dashboard
            const settingsCommand = client.commands.get('settings');
            try {
                await interaction.deferUpdate();
                return await settingsCommand.execute(interaction, client);
            } catch (error) {
                console.error('Failed to refresh dashboard on modal submit:', error);
            }
        }
    },
};
