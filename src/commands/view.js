const { SlashCommandBuilder, MessageFlags, EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, ComponentType } = require('discord.js');
const queries = require('../database/queries');
const configManager = require('../services/configManager');

const ITEMS_PER_PAGE = 15;

const generateEmbed = (userId, playlistName, totalTracks, pageIndex) => {
    const totalPages = Math.ceil(totalTracks / ITEMS_PER_PAGE);
    const start = pageIndex * ITEMS_PER_PAGE;
    
    const slice = queries.getPlaylistSlice.all(userId, ITEMS_PER_PAGE, start);

    const description = slice.map((t) => `**${t.track_id}.** ${t.title} - *${t.artist}*`).join('\n');

    return new EmbedBuilder()
        .setColor(0x7C3AED)
        .setTitle(`💾 ${playlistName}`)
        .setDescription(description)
        .setFooter({ text: `Page ${pageIndex + 1} of ${totalPages} • Total Tracks: ${totalTracks}` });
};

const generateButtons = (totalTracks, pageIndex) => {
    const totalPages = Math.ceil(totalTracks / ITEMS_PER_PAGE);
    const rowBuilder = new ActionRowBuilder();
    
    rowBuilder.addComponents(
        new ButtonBuilder()
            .setCustomId(`view_prev_${pageIndex - 1}`)
            .setLabel('◀ Prev')
            .setStyle(ButtonStyle.Primary)
            .setDisabled(pageIndex === 0),
        new ButtonBuilder()
            .setCustomId(`view_next_${pageIndex + 1}`)
            .setLabel('Next ▶')
            .setStyle(ButtonStyle.Primary)
            .setDisabled(pageIndex === totalPages - 1)
    );
    return rowBuilder;
};

const generateViewPayload = (userId, playlistName, totalTracks, targetPage) => {
    return {
        content: null,
        embeds: [generateEmbed(userId, playlistName, totalTracks, targetPage)],
        components: Math.ceil(totalTracks / ITEMS_PER_PAGE) > 1 ? [generateButtons(totalTracks, targetPage)] : []
    };
};

module.exports = {
    data: new SlashCommandBuilder()
        .setName('view')
        .setDescription('View your saved playlist in an interactive format.'),
    generateEmbed,
    generateButtons,
    generateViewPayload,
    async execute(interaction) {
        const config = configManager.get(interaction.guildId);
        const replyFlags = config.reply_mode === 1 ? [] : [MessageFlags.Ephemeral];
        
        await interaction.deferReply({ flags: replyFlags });

        const row = queries.getPlaylistName.get(interaction.user.id);
        if (!row) {
            return interaction.editReply({ content: '❌ You do not have a saved playlist. Use `/save <url>` first to link one.', flags: replyFlags });
        }

        const countRow = queries.getPlaylistCount.get(interaction.user.id);
        const totalTracks = countRow.total;

        if (totalTracks === 0) {
            return interaction.editReply({ content: '❌ Your saved playlist is empty.', flags: replyFlags });
        }

        const payload = generateViewPayload(interaction.user.id, row.playlist_name, totalTracks, 0);

        return interaction.editReply(payload);
    }
};
