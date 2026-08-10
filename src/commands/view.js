const { SlashCommandBuilder, MessageFlags, EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, ComponentType } = require('discord.js');
const { db } = require('../database/schema');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('view')
        .setDescription('View your saved playlist in an interactive format.'),
    async execute(interaction) {
        await interaction.deferReply({ flags: [MessageFlags.Ephemeral] });

        const row = db.prepare('SELECT * FROM user_saved_playlist WHERE user_id = ?').get(interaction.user.id);
        if (!row) {
            return interaction.editReply('❌ You do not have a saved playlist. Use `/save <url>` first to link one.');
        }

        let tracks = [];
        try {
            tracks = JSON.parse(row.track_ids);
        } catch (e) {
            return interaction.editReply('❌ Failed to read your playlist data.');
        }

        if (tracks.length === 0) {
            return interaction.editReply('❌ Your saved playlist is empty.');
        }

        // Map legacy string-only items to object format for display fallback
        tracks = tracks.map(t => {
            if (typeof t === 'string') return { id: t, title: 'Unknown Track', artist: 'Unknown Artist' };
            return t;
        });

        // Pagination Config
        const ITEMS_PER_PAGE = 15;
        const totalPages = Math.ceil(tracks.length / ITEMS_PER_PAGE);
        let currentPage = 0;

        const generateEmbed = (pageIndex) => {
            const start = pageIndex * ITEMS_PER_PAGE;
            const end = start + ITEMS_PER_PAGE;
            const slice = tracks.slice(start, end);

            const description = slice.map((t, idx) => `**${start + idx + 1}.** ${t.title} - *${t.artist}*`).join('\n');

            return new EmbedBuilder()
                .setColor(0x7C3AED)
                .setTitle(`💾 ${row.playlist_name}`)
                .setDescription(description)
                .setFooter({ text: `Page ${pageIndex + 1} of ${totalPages} • Total Tracks: ${tracks.length}` });
        };

        const generateButtons = (pageIndex) => {
            const rowBuilder = new ActionRowBuilder();
            
            rowBuilder.addComponents(
                new ButtonBuilder()
                    .setCustomId('prev')
                    .setLabel('◀ Prev')
                    .setStyle(ButtonStyle.Primary)
                    .setDisabled(pageIndex === 0),
                new ButtonBuilder()
                    .setCustomId('next')
                    .setLabel('Next ▶')
                    .setStyle(ButtonStyle.Primary)
                    .setDisabled(pageIndex === totalPages - 1)
            );
            return rowBuilder;
        };

        // If only 1 page, just send embed
        if (totalPages === 1) {
            return interaction.editReply({ embeds: [generateEmbed(0)] });
        }

        const message = await interaction.editReply({ 
            embeds: [generateEmbed(0)], 
            components: [generateButtons(0)] 
        });

        const collector = message.createMessageComponentCollector({ 
            componentType: ComponentType.Button, 
            time: 60000 
        });

        collector.on('collect', async (i) => {
            // Ensure only the original user can paginate
            if (i.user.id !== interaction.user.id) {
                return i.reply({ content: "You cannot interact with this menu.", flags: [MessageFlags.Ephemeral] });
            }

            if (i.customId === 'prev') currentPage--;
            if (i.customId === 'next') currentPage++;

            await i.update({ 
                embeds: [generateEmbed(currentPage)], 
                components: [generateButtons(currentPage)] 
            });
        });

        collector.on('end', async () => {
            // Disable buttons on timeout
            try {
                const disabledRow = new ActionRowBuilder()
                    .addComponents(
                        new ButtonBuilder().setCustomId('prev').setLabel('◀ Prev').setStyle(ButtonStyle.Secondary).setDisabled(true),
                        new ButtonBuilder().setCustomId('next').setLabel('Next ▶').setStyle(ButtonStyle.Secondary).setDisabled(true)
                    );
                await interaction.editReply({ components: [disabledRow] });
            } catch (e) {
                // Message might be deleted, ignore error
            }
        });
    }
};
