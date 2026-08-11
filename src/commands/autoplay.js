const { SlashCommandBuilder, MessageFlags } = require('discord.js');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('autoplay')
        .setDescription('Toggle the endless radio feature on/off for the current session')
        .addStringOption(option =>
            option.setName('mode')
                .setDescription('The recommendation algorithm to use (Default: Static)')
                .addChoices(
                    { name: 'Static (Consistent Vibe)', value: 'static' },
                    { name: 'Dynamic (Evolving Vibe)', value: 'dynamic' }
                )
        )
        .addStringOption(option =>
            option.setName('query')
                .setDescription('Optional: Search your saved playlist for a specific first seed track')
                .setRequired(false)
        ),
    async execute(interaction, client) {
        await interaction.deferReply({ flags: [MessageFlags.Ephemeral] });
        
        let player = client.moonlink.players.get(interaction.guildId);
        let startingFromEmpty = false;
        let playlistSeeds = null;
        
        const query = interaction.options.getString('query');
        let initialSeedOverride = null;

        // Fetch playlist if query is provided OR if starting from empty
        if (query || !player || (!player.playing && player.queue.size === 0)) {
            const { db } = require('../database/schema');
            const row = db.prepare('SELECT * FROM user_saved_playlist WHERE user_id = ?').get(interaction.user.id);
            if (!row) {
                if (query) return interaction.editReply('❌ You do not have a saved playlist to search from.');
                return interaction.editReply('❌ Nothing is currently playing. Start a track first with `/stream` or `/save` a playlist to use Discovery Mode.');
            }

            try {
                const parsed = JSON.parse(row.track_ids);
                if (!parsed || parsed.length === 0) throw new Error("Empty playlist");
                // Support both legacy array of strings and new array of objects
                playlistSeeds = parsed.map(t => typeof t === 'string' ? t : t.id);

                if (query) {
                    const queryLower = query.toLowerCase();
                    const match = parsed.find(t => {
                        if (typeof t === 'string') return false;
                        return t.title.toLowerCase().includes(queryLower) || t.artist.toLowerCase().includes(queryLower);
                    });
                    if (match) {
                        initialSeedOverride = match.id;
                    } else {
                        return interaction.editReply(`❌ Could not find any track matching "${query}" in your saved playlist.`);
                    }
                }
            } catch (e) {
                return interaction.editReply('❌ Your saved playlist is empty or corrupted.');
            }

            // Only bootstrap a new session if nothing is playing
            if (!player || (!player.playing && player.queue.size === 0)) {
                const voiceChannel = interaction.member?.voice?.channel;
                if (!voiceChannel) {
                    return interaction.editReply('❌ You must be in a voice channel to start an Autoplay session from your saved playlist.');
                }
                
                if (!player) {
                    player = client.moonlink.players.create({
                        guildId: interaction.guildId,
                        voiceChannelId: voiceChannel.id,
                        textChannelId: voiceChannel.id,
                        selfDeaf: true,
                        volume: 100
                    });
                }
                if (!player.connected) {
                    await player.connect();
                    // UDP Socket Stabilization Delay
                    await new Promise(resolve => setTimeout(resolve, 1000));
                }
                if (!player.get('sessionOwner')) player.set('sessionOwner', interaction.user);
                
                // Instantly clear the original JSON payload from memory
                if (global.gc) global.gc();

                startingFromEmpty = true;
            }
        }

        // Toggle autoplay state using the native metadata store
        // If starting from empty, we force it ON.
        const isAutoplay = startingFromEmpty ? false : (player.get('autoplay') || false);
        player.set('autoplay', !isAutoplay);

        if (player.get('autoplay')) {
            const mode = interaction.options.getString('mode') || 'static';
            const { extractVideoId } = require('../lavalink/playerEvents');

            let currentVideoId = null;
            if (startingFromEmpty) {
                currentVideoId = playlistSeeds; // Pass the whole array of seeds to AutoplayManager
            } else {
                currentVideoId = initialSeedOverride || extractVideoId(player.current?.uri);

                // Seed Resolution Fallback for Spotify/Non-YouTube tracks
                if (!currentVideoId && player.current) {
                    try {
                        const searchQuery = `${player.current.title} ${player.current.author}`;
                        const res = await client.moonlink.search({
                            query: searchQuery,
                            source: 'ytmsearch',
                            requester: client.user
                        });
                        if (res.tracks && res.tracks.length > 0) {
                            currentVideoId = extractVideoId(res.tracks[0].uri);
                        }
                    } catch (e) {
                        console.error("Autoplay Seed Resolution Failed:", e.message);
                    }
                }
            }

            const AutoplayManager = require('../services/AutoplayManager');
            // Attach the manager directly to the player
            const autoplayManager = new AutoplayManager(interaction.guildId, interaction.user.id, mode, currentVideoId, initialSeedOverride);
            player.set('autoplayManager', autoplayManager);
            
            if (startingFromEmpty) {
                await interaction.editReply(`♾️ **Discovery Mode: ON** (${mode === 'static' ? 'Static' : 'Dynamic'})\nBootstrapping from your saved playlist...${initialSeedOverride ? `\nForced initial seed track loaded.` : ''}`);
                // Kickstart the queue loop to immediately fetch and play
                client.moonlink.emit("queueEnd", player);
            } else {
                await interaction.editReply(`♾️ **Autoplay: ON** (${mode === 'static' ? 'Static Mode' : 'Dynamic Mode'})\nRecommended tracks will play when the queue ends.`);
            }
        } else {
            // Clean up the manager when disabled
            player.set('autoplayManager', null);
            await interaction.editReply('⏸️ **Autoplay: OFF**\nPlayback will stop when the queue ends.');
        }
    },
};
