const { SlashCommandBuilder, EmbedBuilder, MessageFlags } = require('discord.js');
const configManager = require('../services/configManager');
const ytmusic = require('../services/ytmusic');
const { findBestMatch } = require('../utils/searchMatcher');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('stream')
        .setDescription('Play a song or playlist from YouTube Music')
        .addStringOption(option =>
            option
                .setName('query')
                .setDescription('A search term or URL')
                .setRequired(true)
        ),

    async execute(interaction, client) {
        const member = interaction.member;
        const voiceChannel = member?.voice?.channel;

        // Validate: user must be in a voice channel
        if (!voiceChannel) {
            return interaction.reply({
                content: '❌ You must be in a voice channel to use this command.',
                flags: [MessageFlags.Ephemeral],
            });
        }

        await interaction.deferReply({ flags: [MessageFlags.Ephemeral] });

        const query = interaction.options.getString('query');

        try {
            // Get or Create the Moonlink Player
            const player = client.moonlink.players.create({
                guildId: interaction.guildId,
                voiceChannelId: voiceChannel.id,
                textChannelId: voiceChannel.id, // Route NP message to VC text chat
                selfDeaf: true,
                volume: 100
            });

            // Ensure the player is connected to the voice channel
            if (!player.connected) await player.connect();

            // Enforce Max Queue Size from config
            const config = configManager.get(interaction.guildId);
            if (player.queue.size >= config.max_queue_size) {
                return interaction.editReply({ content: `❌ The queue is full! Maximum allowed songs: **${config.max_queue_size}**` });
            }

            // Determine the search identifier
            const isUrl = /^https?:\/\//.test(query);

            let searchParams;
            if (isUrl) {
                searchParams = { query: query };
            } else {
                // Fetch guaranteed tracks from YouTube Music explicitly
                const ytmResults = await ytmusic.search(query);
                if (ytmResults && ytmResults.length > 0) {
                    // Filter to ensure we only process tracks (if ytmusic-api returns mixed types, it's safer)
                    const tracks = ytmResults.filter(r => r.type === 'SONG' || r.type === 'VIDEO' || !r.type);
                    if (tracks.length > 0) {
                        const bestMatch = findBestMatch(query, tracks, item => `${item.title} ${item.artists?.map(a => a.name).join(' ') || item.author || ''}`);
                        if (bestMatch && bestMatch.videoId) {
                            searchParams = { query: `https://music.youtube.com/watch?v=${bestMatch.videoId}`, source: 'ytmsearch' };
                        }
                    }
                }
                
                // Fallback to standard generic query if our explicit search yields no videoId
                if (!searchParams) {
                    searchParams = { query: query, source: 'ytmsearch' };
                }
            }

            // Resolve the query through Moonlink
            let result = await client.moonlink.search({
                ...searchParams,
                requester: interaction.user
            });
            
            // Diversified Prefix Rotation Fallback
            if (!result || !result.tracks || result.tracks.length === 0 || result.loadType === 'empty' || result.loadType === 'error') {
                console.log(`[Search Fallback] Primary search failed for "${query}". Retrying with alternative YouTube client prefix (ytsearch)...`);
                result = await client.moonlink.search({
                    query: query,
                    source: 'ytsearch',
                    requester: interaction.user
                });
            }

            if (!result || !result.tracks || result.tracks.length === 0 || result.loadType === 'empty' || result.loadType === 'error') {
                return interaction.editReply({ content: `❌ No results found for: **${query}**` });
            }

            let tracksToAdd = [];
            let embedTitle = '';
            let embedDesc = '';

            switch (result.loadType) {
                case 'track':
                case 'search': {
                    // Logic Improvement: We rely on the initial explicit search being highly accurate.
                    // If it resolved to a specific video ID URL, result.tracks[0] is exactly what we requested.
                    tracksToAdd = [result.tracks[0]];
                    embedTitle = '🎵 Track Queued';
                    embedDesc = `[${tracksToAdd[0].title}](${tracksToAdd[0].uri}) — ${tracksToAdd[0].author}`;
                    break;
                }
                case 'playlist': {
                    tracksToAdd = result.tracks;
                    embedTitle = '📋 Playlist Queued';
                    embedDesc = `**${result.playlistInfo?.name || 'Unknown Playlist'}** — ${tracksToAdd.length} track(s)`;
                    break;
                }
                default: {
                    return interaction.editReply({ content: `❌ Unexpected result type.` });
                }
            }

            // Add the track(s) to the moonlink managed queue
            await player.queue.add(tracksToAdd);

            // If nothing is playing, tell the player to start immediately
            if (!player.playing) {
                // Play-on-Ready delay to allow NodeLink PREFETCH_COUNT to stabilize
                await new Promise(resolve => setTimeout(resolve, 750));
                await player.play();
            }

            // Send confirmation embed
            const embed = new EmbedBuilder()
                .setColor(0x7C3AED)
                .setTitle(embedTitle)
                .setDescription(embedDesc)
                .setTimestamp();

            if (player.queue.size > 0) {
                embed.setFooter({ text: `Queue length: ${player.queue.size}` });
            }

            await interaction.editReply({ embeds: [embed] });

        } catch (error) {
            console.error('❌ /stream error:', error);
            await interaction.editReply({ content: '❌ An error occurred while processing your request.' }).catch(() => { });
        }
    },
};
