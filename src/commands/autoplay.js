const { SlashCommandBuilder, MessageFlags } = require('discord.js');
const queries = require('../database/queries');
const { extractVideoId } = require('../lavalink/playerEvents');
const AutoplayManager = require('../services/AutoplayManager');
const configManager = require('../services/configManager');

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
        ),
    async execute(interaction, client) {
        const config = configManager.get(interaction.guildId);
        const replyFlags = config.reply_mode === 1 ? [] : [MessageFlags.Ephemeral];

        await interaction.deferReply({ flags: replyFlags });
        
        let player = client.moonlink.players.get(interaction.guildId);
        let startingFromEmpty = false;
        let playlistSeeds = null;
        const userId = interaction.user.id;

        if (!player || (!player.playing && player.queue.size === 0)) {
            const row = queries.getSavedPlaylist.get(userId);
            if (!row) {
                return interaction.editReply({ content: '❌ Nothing is currently playing. Start a track first with `/stream` or `/save` a playlist to use Discovery Mode.', flags: replyFlags });
            }

            const voiceChannel = interaction.member?.voice?.channel;
            if (!voiceChannel) {
                return interaction.editReply({ content: '❌ You must be in a voice channel to start an Autoplay session from your saved playlist.', flags: replyFlags });
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
                player.set('needs_warmup', true);
            }
            if (!player.get('sessionOwner')) player.set('sessionOwner', interaction.user);
            
            const allTracks = queries.getAllPlaylistTrackIds.all(userId);
            if (!allTracks || allTracks.length === 0) {
                return interaction.editReply('❌ Your saved playlist is empty.');
            }
            
            const randomTrack = allTracks[Math.floor(Math.random() * allTracks.length)];
            playlistSeeds = randomTrack.video_id; // Pass a single random seed directly to the manager

            startingFromEmpty = true;
        }

        // Toggle autoplay state using the native metadata store
        // If starting from empty, we force it ON.
        const isAutoplay = startingFromEmpty ? false : (player.get('autoplay') || false);
        player.set('autoplay', !isAutoplay);

        if (player.get('autoplay')) {
            const mode = interaction.options.getString('mode') || 'static';
            let currentVideoId = null;
            if (startingFromEmpty) {
                currentVideoId = playlistSeeds; // Pass the single random seed to AutoplayManager
            } else {
                currentVideoId = extractVideoId(player.current?.uri);

                // Seed Resolution Fallback for Spotify/Non-YouTube tracks
                if (!currentVideoId && player.current) {
                    try {
                        const query = `${player.current.title} ${player.current.author}`;
                        const res = await client.moonlink.search({
                            query: query,
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

            // Attach the manager directly to the player
            // Attach the manager directly to the player
            const autoplayManager = new AutoplayManager(interaction.guildId, interaction.user.id, mode, currentVideoId);
            player.set('autoplayManager', autoplayManager);
            
            if (startingFromEmpty) {
                await interaction.editReply(`♾️ **Discovery Mode: ON** (${mode === 'static' ? 'Static' : 'Dynamic'})\nBootstrapping from your saved playlist...`);
                
                (async () => {
                    if (player.get('needs_warmup')) {
                        await new Promise(resolve => setTimeout(resolve, 1000));
                        player.set('needs_warmup', false);
                    }
                    
                    const config = configManager.get(interaction.guildId);
                    const nextMeta = await autoplayManager.getNextTrack(config, []);
                    if (nextMeta) {
                        const searchResult = await client.moonlink.search({
                            query: `${nextMeta.title} ${nextMeta.artists}`,
                            source: 'ytmsearch',
                            requester: client.user
                        });
                        
                        if (searchResult && searchResult.tracks && searchResult.tracks.length > 0) {
                            searchResult.tracks[0].signature = nextMeta.signature;
                            await player.queue.add(searchResult.tracks[0]);
                            await player.play();
                        }
                    }
                })();
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
