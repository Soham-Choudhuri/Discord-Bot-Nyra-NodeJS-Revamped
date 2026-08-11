const { SlashCommandBuilder, EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, MessageFlags } = require('discord.js');

// Helper function to convert milliseconds to a clean HH:MM:SS format
function formatDuration(ms) {
    if (ms == null || isNaN(ms)) return 'Unknown';
    if (ms >= 9223372036854770000) return '🔴 LIVE'; // Lavalink Live Stream
    const seconds = Math.floor((ms / 1000) % 60);
    const minutes = Math.floor((ms / (1000 * 60)) % 60);
    const hours = Math.floor(ms / (1000 * 60 * 60));
    if (hours > 0) return `${hours}:${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
    return `${minutes}:${String(seconds).padStart(2, '0')}`;
}

module.exports = {
    data: new SlashCommandBuilder()
        .setName('queue')
        .setDescription('View the current playback queue'),

    async execute(interaction, client) {
        const player = client.moonlink.players.get(interaction.guildId);

        // 1. Guard Clauses
        if (!player || (!player.playing && player.queue.size === 0)) {
            return interaction.reply({
                content: '❌ Nothing is currently playing.',
                flags: [MessageFlags.Ephemeral],
            });
        }

        // Send Initial Payload Statelessly
        const payload = this.generateQueuePayload(player, 0, interaction.guild.name);
        await interaction.reply({ ...payload, withResponse: true });
    },

    generateQueuePayload(player, page, guildName) {
        const queueTracks = player.queue.all || []; 
        const currentTrack = player.current;

        if (!currentTrack) {
            return { content: '❌ Nothing is currently playing.', embeds: [], components: [], flags: [MessageFlags.Ephemeral] };
        }

        // Combine standard queue with autoplay buffer if enabled
        let displayTracks = [...queueTracks];
        const isAutoplay = player.get('autoplay') || false;
        const autoplayManager = player.get('autoplayManager');
        
        if (isAutoplay && autoplayManager && autoplayManager.buffer && autoplayManager.buffer.length > 0) {
            const upcomingAutoplay = autoplayManager.buffer.slice(0, 15);
            const mappedAutoplay = upcomingAutoplay.map(t => ({
                title: t.title,
                author: t.artists,
                uri: `https://music.youtube.com/watch?v=${t.videoId}`,
                duration: null,
                isAutoplay: true
            }));
            displayTracks.push(...mappedAutoplay);
        }

        // Pagination Setup
        const tracksPerPage = 10;
        const maxPages = Math.ceil(displayTracks.length / tracksPerPage) || 1;

        // Bounds enforcement
        if (page < 0) page = 0;
        if (page >= maxPages) page = maxPages - 1;

        const start = page * tracksPerPage;
        const end = start + tracksPerPage;
        const currentSlice = displayTracks.slice(start, end);

        const embed = new EmbedBuilder()
            .setColor('#2b2d31')
            .setAuthor({ name: `🎶 Queue for ${guildName}` })
            .setDescription(`**💿 Now Playing**\n${currentTrack.author || 'Unknown'} - ${currentTrack.title} \`[${formatDuration(currentTrack.duration)}]\`\n\n**🔼 Up Next**`)
            .setFooter({ text: `Page ${page + 1} of ${maxPages}` });

        if (currentSlice.length > 0) {
            const trackList = currentSlice.map((track, index) => {
                const durationStr = track.isAutoplay ? '♾️ Autoplay' : formatDuration(track.duration);
                const artistStr = track.author || 'Unknown';
                return `**${start + index + 1}.** ${artistStr} - ${track.title} \`[${durationStr}]\``;
            }).join('\n');
            embed.addFields({ name: '\u200b', value: trackList });
        } else {
            embed.addFields({ name: '\u200b', value: '*The queue is empty.*' });
        }

        const row = new ActionRowBuilder().addComponents(
            new ButtonBuilder()
                .setCustomId(`queue_prev_${page - 1}`)
                .setLabel('◀ Previous')
                .setStyle(ButtonStyle.Secondary)
                .setDisabled(page === 0),
            new ButtonBuilder()
                .setCustomId(`queue_next_${page + 1}`)
                .setLabel('Next ▶')
                .setStyle(ButtonStyle.Secondary)
                .setDisabled(page === maxPages - 1 || maxPages === 0)
        );

        return {
            embeds: [embed],
            components: maxPages > 1 ? [row] : [],
            flags: [MessageFlags.Ephemeral]
        };
    }
};
