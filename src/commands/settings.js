const { SlashCommandBuilder, EmbedBuilder, ActionRowBuilder, StringSelectMenuBuilder, PermissionFlagsBits, MessageFlags } = require('discord.js');
const configManager = require('../services/configManager');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('settings')
        .setDescription('Manage Nyra configuration for this server')
        .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild),

    async execute(interaction, client) {
        const guildId = interaction.guildId;
        const config = configManager.get(guildId);

        const embed = new EmbedBuilder()
            .setColor(0x7C3AED)
            .setTitle('⚙️ Nyra Dashboard')
            .setDescription('Configure Nyra settings for your server. Changes are applied instantly.')
            .addFields(
                { name: '📊 Max Queue Size', value: `\`${config.max_queue_size}\` songs`, inline: true },
                { name: '📝 Display Mode', value: config.verbose_mode === 1 ? '`Verbose` (Full Embeds)' : '`Compact` (Text Only)', inline: true },
                { name: '♾️ Autoplay Seed', value: config.autoplay_seed ? `\`${config.autoplay_seed}\`` : '`Default` (Last Song)', inline: true },
                { name: '⏳ Auto-Delete Timer', value: config.delete_timer > 0 ? `\`${config.delete_timer}s\`` : '`Disabled`', inline: true },
                { name: '🔒 Command Channel', value: config.cmd_channel ? `<#${config.cmd_channel}>` : '`No Restriction`', inline: true },
                { name: '🧠 Artist Memory', value: `\`${config.artist_memory}\` unique artists`, inline: true },
                { name: '🚫 Regex Blacklist', value: `\`${config.regex_blacklist.length > 50 ? config.regex_blacklist.substring(0, 47) + '...' : config.regex_blacklist}\``, inline: true },
            )
            .setTimestamp();

        const row = new ActionRowBuilder()
            .addComponents(
                new StringSelectMenuBuilder()
                    .setCustomId('settings_menu')
                    .setPlaceholder('Select a setting to modify...')
                    .addOptions([
                        {
                            label: 'Max Queue Size',
                            description: 'Set the maximum number of songs allowed in the queue.',
                            value: 'max_queue_size',
                            emoji: '📊'
                        },
                        {
                            label: 'Verbose vs. Compact Mode',
                            description: 'Toggle between detailed embeds and simple text lines.',
                            value: 'verbose_mode',
                            emoji: '📝'
                        },
                        {
                            label: 'Auto-Delete Timer',
                            description: 'Set how long bot messages stay (0 to disable).',
                            value: 'delete_timer',
                            emoji: '⏳'
                        },
                        {
                            label: 'Command Channel',
                            description: 'Restrict bot commands to a specific channel.',
                            value: 'cmd_channel',
                            emoji: '🔒'
                        },
                        {
                            label: 'Artist Memory',
                            description: 'Set how many unique artists to avoid in autoplay.',
                            value: 'artist_memory',
                            emoji: '🧠'
                        },
                        {
                            label: 'Regex Blacklist',
                            description: 'Update the pattern for filtering unofficial content.',
                            value: 'regex_blacklist',
                            emoji: '🚫'
                        },
                        {
                            label: 'Autoplay Seed',
                            description: 'Set a custom permanent seed for the autoplay algorithm.',
                            value: 'autoplay_seed',
                            emoji: '♾️'
                        }
                    ]),
            );

        const response = {
            embeds: [embed],
            components: [row],
            flags: [MessageFlags.Ephemeral]
        };

        if (interaction.isMessageComponent() && !interaction.replied && !interaction.deferred) {
            await interaction.update(response);
        } else if (interaction.replied || interaction.deferred) {
            await interaction.editReply(response);
        } else {
            await interaction.reply(response);
        }
    },
};
