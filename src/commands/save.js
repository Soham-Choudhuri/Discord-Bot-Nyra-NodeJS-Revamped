const { SlashCommandBuilder, MessageFlags, EmbedBuilder } = require('discord.js');
const queries = require('../database/queries');
const { extractVideoId } = require('../lavalink/playerEvents');
const { getPlaylistTracks } = require('../services/ytmusic');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('save')
        .setDescription('Save a YouTube Music playlist as your Autoplay base, or add current song.')
        .addStringOption(option =>
            option.setName('url')
                .setDescription('The URL of your YouTube Music playlist')
                .setRequired(false)
        ),
    async execute(interaction, client) {
        await interaction.deferReply({ flags: [MessageFlags.Ephemeral] });
        const url = interaction.options.getString('url');
        const userId = interaction.user.id;

        if (url) {
            const playlistRegex = /^https?:\/\/(music\.|www\.)?youtube\.com\/playlist\?list=([a-zA-Z0-9_-]+)/;
            const match = url.match(playlistRegex);
            if (!match) {
                return interaction.editReply('❌ Invalid URL. Please provide a valid YouTube Music playlist URL (e.g., https://music.youtube.com/playlist?list=...)');
            }
            
            const playlistId = match[2];
            
            try {
                const playlistName = 'Saved Playlist';
                let totalTracks = 0;

                let tracks = await getPlaylistTracks(playlistId);
                const originalLength = tracks.length;
                
                // Enforce 500 track upper limit to prevent V8 memory bloat
                if (tracks.length > 500) {
                    tracks = tracks.slice(0, 500);
                }
                
                totalTracks = tracks.length;

                if (totalTracks > 0) {
                    // Upsert playlist metadata
                    queries.upsertPlaylistMeta.run(userId, playlistId, playlistName);
                    
                    // Clear existing tracks
                    queries.deletePlaylistTracks.run(userId);

                    // Fast bulk insert using centralized transaction
                    queries.insertPlaylistTracksBulk(userId, tracks);
                }

                if (totalTracks === 0) {
                    return interaction.editReply('❌ Playlist is empty, private, or could not be loaded.');
                }

                let embedDesc = `Your playlist has been linked to your account!\nContains ${totalTracks} tracks.`;
                if (originalLength > 500) {
                    embedDesc += `\n\n⚠️ *Playlist was truncated from ${originalLength} tracks to fit the 500-track system limit.*`;
                }

                const embed = new EmbedBuilder()
                    .setColor(0x7C3AED)
                    .setTitle('💾 Playlist Saved')
                    .setDescription(embedDesc)
                    .setFooter({ text: 'It will now be used automatically when you start an empty /autoplay session.' });

                return interaction.editReply({ embeds: [embed] });

            } catch (e) {
                console.error("Save Playlist Error:", e);
                return interaction.editReply('❌ An error occurred while fetching the playlist.');
            }
        } else {
            const player = client.moonlink.players.get(interaction.guildId);
            if (!player || !player.playing) {
                return interaction.editReply('❌ You must either provide a playlist URL, or be playing a track to add it to your saved playlist.');
            }

            const currentTrack = player.current;
            const videoId = extractVideoId(currentTrack?.uri);
            if (!videoId) {
                return interaction.editReply('❌ Could not extract a valid YouTube ID from the current track.');
            }

            const row = queries.getSavedPlaylist.get(userId);
            if (!row) {
                return interaction.editReply('❌ You do not have a saved playlist. Use `/save <url>` first to link one.');
            }

            const result = queries.insertPlaylistTrack.run(
                userId, videoId, currentTrack.title || 'Unknown Title', currentTrack.author || 'Unknown Artist'
            );

            if (result.changes === 0) {
                return interaction.editReply(`ℹ️ **${currentTrack.title}** is already in your saved playlist.`);
            }

            return interaction.editReply(`✅ Added **${currentTrack.title}** to your local saved playlist (**${row.playlist_name}**).`);
        }
    }
};
