const { SlashCommandBuilder, EmbedBuilder, ActionRowBuilder, StringSelectMenuBuilder, PermissionFlagsBits, MessageFlags } = require('discord.js');
const configManager = require('../services/configManager');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('settings')
        .setDescription('Manage Nyra configuration for this server'),

    async execute(interaction, client) {
        const guildId = interaction.guildId;
        const config = configManager.get(guildId);

        const isOwner = interaction.user.id === interaction.guild.ownerId;
        const hasPerms = interaction.member.permissions.has(PermissionFlagsBits.ManageGuild);
        const isWhitelisted = config.whitelist_role && interaction.member.roles.cache.has(config.whitelist_role);

        if (!isOwner && !hasPerms && !isWhitelisted) {
            return interaction.reply({
                content: '❌ You do not have permission to manage bot settings.',
                flags: config.reply_mode === 1 ? [] : [MessageFlags.Ephemeral]
            });
        }

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
                { name: '💬 Reply Mode', value: config.reply_mode === 1 ? '`Global` (Public)' : '`Ephemeral` (Private)', inline: true },
                { name: '🛡️ Whitelist Role', value: config.whitelist_role ? `<@&${config.whitelist_role}>` : '`None`', inline: true }
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
                        },
                        {
                            label: 'Reply Mode',
                            description: 'Toggle if bot replies are visible to everyone.',
                            value: 'reply_mode',
                            emoji: '💬'
                        },
                        {
                            label: 'Whitelist Role',
                            description: 'Set a role to bypass command and dashboard restrictions.',
                            value: 'whitelist_role',
                            emoji: '🛡️'
                        }
                    ]),
            );

        const response = {
            embeds: [embed],
            components: [row],
            flags: config.reply_mode === 1 ? [] : [MessageFlags.Ephemeral]
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
