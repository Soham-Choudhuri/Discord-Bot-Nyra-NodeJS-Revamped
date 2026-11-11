const { SlashCommandBuilder, EmbedBuilder, MessageFlags } = require('discord.js');
const ytmusic = require('../services/ytmusic');
const configManager = require('../services/configManager');
const { extractVideoId } = require('../lavalink/playerEvents');
const AutoplayManager = require('../services/AutoplayManager');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('mix')
        .setDescription('Start an endless YouTube Music radio mix based on a song')
        .addStringOption(option =>
            option
                .setName('query')
                .setDescription('A search term or URL for the starting song')
                .setRequired(true)
        ),

    async execute(interaction, client) {
        const config = configManager.get(interaction.guildId);
        const replyFlags = config.reply_mode === 1 ? [] : [MessageFlags.Ephemeral];
        
        await interaction.deferReply({ flags: replyFlags });

        const member = interaction.member;
        const voiceChannel = member?.voice?.channel;

        if (!voiceChannel) {
            return interaction.editReply({
                content: '❌ You must be in a voice channel to use this command.',
                flags: [MessageFlags.Ephemeral],
            });
        }
        
        const player = client.moonlink.players.get(interaction.guildId);
        if (player && player.queue.size >= config.max_queue_size) {
            return interaction.editReply({
                content: `❌ The queue has reached the maximum size of **${config.max_queue_size}** tracks.`,
                flags: replyFlags,
            });
        }

        const query = interaction.options.getString('query');

        try {
            const player = client.moonlink.players.create({
                guildId: interaction.guildId,
                voiceChannelId: voiceChannel.id,
                textChannelId: voiceChannel.id,
                selfDeaf: true,
                volume: 100
            });

            if (!player.connected) await player.connect();

            // Set session owner for history tracking
            if (!player.get('sessionOwner')) {
                player.set('sessionOwner', interaction.user);
            }

            const isUrl = /^https?:\/\//.test(query);
            
            // 1. Resolve the initial seed track
            let searchParams;
            if (isUrl) {
                searchParams = { query: query };
            } else {
                // Explicit YTM search
                const ytmResults = await ytmusic.search(query);
                if (ytmResults && ytmResults.length > 0) {
                    const tracks = ytmResults.filter(r => r.type === 'SONG' || r.type === 'VIDEO' || !r.type);
                    if (tracks.length > 0) {
                        const bestMatch = await ytmusic.findBestMatch(query, tracks);
                        if (bestMatch && bestMatch.videoId) {
                            searchParams = { query: `https://music.youtube.com/watch?v=${bestMatch.videoId}`, source: 'ytmsearch' };
                        }
                    }
                }
                if (!searchParams) {
                    searchParams = { query: query, source: 'ytmsearch' };
                }
            }

            let searchResult;
            try {
                searchResult = await client.moonlink.search({
                    ...searchParams,
                    requester: interaction.user
                });
                
                // Diversified Prefix Rotation Fallback
                if (!searchResult || !searchResult.tracks || searchResult.tracks.length === 0 || searchResult.loadType === 'error' || searchResult.loadType === 'empty') {
                    console.log(`[Search Fallback] Primary search failed for "${query}". Retrying with alternative YouTube client prefix (ytsearch)...`);
                    searchResult = await client.moonlink.search({
                        query: query,
                        source: 'ytsearch',
                        requester: interaction.user
                    });
                }
            } catch (err) {
                 return interaction.editReply({ content: `❌ Network Error: NodeLink could not be reached.` });
            }

            if (!searchResult || !searchResult.tracks || searchResult.tracks.length === 0 || searchResult.loadType === 'error' || searchResult.loadType === 'empty') {
                return interaction.editReply({ content: `❌ No results found for: **${query}**` });
            }

            // We rely on the search resolving properly to the first result
            const seedTrack = searchResult.tracks[0];
            
            const videoId = extractVideoId(seedTrack.uri);
            if (!videoId) {
                return interaction.editReply({ content: `❌ Could not extract YouTube Video ID to start a mix.` });
            }

            // Tell the user we are starting the mix
            await interaction.editReply({ content: `⏳ Generating YouTube Music Mix for **${seedTrack.title}**...` });

            // 2. Add the seed track to queue and play
            if (player.queue.size >= config.max_queue_size) {
                 return interaction.editReply({ content: `❌ The queue is full! Maximum allowed songs: **${config.max_queue_size}**` });
            }

            await player.queue.add(seedTrack);
            if (!player.playing && !player.get('is_starting')) {
                player.set('is_starting', true);
                // Play-on-Ready delay to allow NodeLink PREFETCH_COUNT to stabilize
                (async () => {
                    await new Promise(resolve => setTimeout(resolve, 750));
                    await player.play();
                    player.set('is_starting', false);
                })();
            }

            // 3. Automatically turn ON Autoplay so it natively manages the endless mix
            player.set('autoplay', true);
            
            // Start the Autoplay engine with the seed track
            const autoplayManager = new AutoplayManager(interaction.guildId, interaction.user.id, 'dynamic', videoId);
            player.set('autoplayManager', autoplayManager);
            
            // 4. Pre-fill buffer for seamless continuation asynchronously in the background
            autoplayManager.fillBuffer(config, player.get('artistHistory') || []).catch(err => {
                console.error('[Mix] Autoplay buffer background fill failed:', err);
            });

            // 5. Send confirmation embed
            const embed = new EmbedBuilder()
                .setColor(0x7C3AED)
                .setTitle('📻 YouTube Music Mix Started')
                .setDescription(`Started an endless mix based on [${seedTrack.title}](${seedTrack.uri})\nAutoplay has been enabled. Upcoming tracks are now managed automatically.`)
                .setThumbnail(seedTrack.artworkUrl)
                .setTimestamp();

            await interaction.editReply({ content: null, embeds: [embed] });

        } catch (error) {
            console.error('❌ /mix error:', error);
            await interaction.editReply({ content: '❌ An error occurred while generating the mix.' }).catch(() => { });
        }
    },
};
