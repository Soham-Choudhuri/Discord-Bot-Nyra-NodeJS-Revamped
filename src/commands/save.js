const { SlashCommandBuilder, MessageFlags, EmbedBuilder } = require('discord.js');
const { db } = require('../database/schema');
const { extractVideoId } = require('../lavalink/playerEvents');
const { getPlaylistTracks, search: ytmSearch } = require('../services/ytmusic');

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
            // Strict regex for YouTube Music playlist (also accept standard YouTube if needed, but restrict to playlist)
            const playlistRegex = /^https?:\/\/(music\.|www\.)?youtube\.com\/playlist\?list=([a-zA-Z0-9_-]+)/;
            const match = url.match(playlistRegex);
            if (!match) {
                return interaction.editReply('❌ Invalid URL. Please provide a valid YouTube Music playlist URL (e.g., https://music.youtube.com/playlist?list=...)');
            }
            
            const playlistId = match[2];
            
            try {
                // Use robust YouTube Music internal API to extract the full playlist via continuation tokens
                const tracks = await getPlaylistTracks(playlistId);

                if (tracks.length === 0) {
                    return interaction.editReply('❌ Playlist is empty, private, or could not be loaded.');
                }

                // Since getPlaylistTracks fetches from a playlist context, we might not always have the exact playlist name readily available in the tracks array.
                // We default to Saved Playlist, or you could do an extra fetch to get the playlist metadata if absolutely needed.
                const playlistName = 'Saved Playlist';

                const upsert = db.transaction(() => {
                    db.prepare('DELETE FROM user_saved_playlist WHERE user_id = ?').run(userId);
                    db.prepare('INSERT INTO user_saved_playlist (user_id, playlist_id, playlist_name, track_ids) VALUES (?, ?, ?, ?)').run(userId, playlistId, playlistName, JSON.stringify(tracks));
                });
                upsert();

                const embed = new EmbedBuilder()
                    .setColor(0x7C3AED)
                    .setTitle('💾 Playlist Saved')
                    .setDescription(`Your playlist has been linked to your account!\nContains ${tracks.length} tracks.`)
                    .setFooter({ text: 'It will now be used automatically when you start an empty /autoplay session.' });

                return interaction.editReply({ embeds: [embed] });

            } catch (e) {
                console.error("Save Playlist Error:", e);
                return interaction.editReply('❌ An error occurred while fetching the playlist.');
            }
        } else {
            // No URL provided: append current track to saved playlist
            const player = client.moonlink.players.get(interaction.guildId);
            if (!player || !player.playing) {
                return interaction.editReply('❌ You must either provide a playlist URL, or be playing a track to add it to your saved playlist.');
            }

            const currentTrack = player.current;
            const videoId = extractVideoId(currentTrack?.uri);
            if (!videoId) {
                return interaction.editReply('❌ Could not extract a valid YouTube ID from the current track.');
            }

            const row = db.prepare('SELECT * FROM user_saved_playlist WHERE user_id = ?').get(userId);
            if (!row) {
                return interaction.editReply('❌ You do not have a saved playlist. Use `/save <url>` first to link one.');
            }

            let trackObjects = [];
            try {
                trackObjects = JSON.parse(row.track_ids);
            } catch(e) { }

            // Ensure we handle legacy migrations where tracks were just strings
            if (trackObjects.length > 0 && typeof trackObjects[0] === 'string') {
                // In-memory conversion for the current session (full migration not necessary unless wanted)
                trackObjects = trackObjects.map(id => ({ id, title: 'Unknown Title', artist: 'Unknown Artist' }));
            }

            if (trackObjects.find(t => t.id === videoId)) {
                return interaction.editReply(`ℹ️ **${currentTrack.title}** is already in your saved playlist.`);
            }

            trackObjects.push({ 
                id: videoId, 
                title: currentTrack.title || 'Unknown Title', 
                artist: currentTrack.author || 'Unknown Artist' 
            });
            db.prepare('UPDATE user_saved_playlist SET track_ids = ? WHERE user_id = ?').run(JSON.stringify(trackObjects), userId);

            return interaction.editReply(`✅ Added **${currentTrack.title}** to your local saved playlist (**${row.playlist_name}**).`);
        }
    }
};
