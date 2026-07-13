const { Events, ModalBuilder, TextInputBuilder, TextInputStyle, ActionRowBuilder, MessageFlags } = require('discord.js');
const configManager = require('../services/configManager');

module.exports = {
    name: Events.InteractionCreate,
    once: false,
    async execute(interaction, client) {
        const guildId = interaction.guildId;
        const config = configManager.get(guildId);

        // ─── Command Channel Restriction ────────────────────────────
        if (interaction.isChatInputCommand()) {
            const isOwner = interaction.user.id === interaction.guild.ownerId;
            if (config.cmd_channel && interaction.channelId !== config.cmd_channel && !isOwner) {
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

        // ─── Select Menus (Settings) ───────────────────────
        if (interaction.isStringSelectMenu()) {

            if (interaction.customId === 'settings_menu') {
                const setting = interaction.values[0];

                // Direct Toggle for Verbose Mode
                if (setting === 'verbose_mode') {
                    const newValue = config.verbose_mode === 1 ? 0 : 1;
                    configManager.set(guildId, 'verbose_mode', newValue);
                    
                    // Refresh the settings dashboard
                    const settingsCommand = client.commands.get('settings');
                    return settingsCommand.execute(interaction, client);
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
                const num = parseInt(value);
                if (isNaN(num) || num < 1 || num > 500) {
                    return interaction.reply({ content: '❌ Enter a number between 1 and 500.', flags: [MessageFlags.Ephemeral] });
                }
                configManager.set(guildId, 'max_queue_size', num);
            } 
            else if (interaction.customId === 'modal_autoplay_seed') {
                if (!value || value.toLowerCase() === 'none') value = null;
                configManager.set(guildId, 'autoplay_seed', value);
            }
            else if (interaction.customId === 'modal_delete_timer') {
                const num = parseInt(value);
                if (isNaN(num) || num < 0) {
                    return interaction.reply({ content: '❌ Enter a valid number (0 or higher).', flags: [MessageFlags.Ephemeral] });
                }
                configManager.set(guildId, 'delete_timer', num);
            }
            else if (interaction.customId === 'modal_cmd_channel') {
                if (!value || value.toLowerCase() === 'none') value = null;
                configManager.set(guildId, 'cmd_channel', value);
            }
            else if (interaction.customId === 'modal_artist_memory') {
                const num = parseInt(value);
                if (isNaN(num) || num < 1 || num > 10) {
                    return interaction.reply({ content: '❌ Enter a number between 1 and 10.', flags: [MessageFlags.Ephemeral] });
                }
                configManager.set(guildId, 'artist_memory', num);
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
            await interaction.deferUpdate();
            return settingsCommand.execute(interaction, client);
        }
    },
};
