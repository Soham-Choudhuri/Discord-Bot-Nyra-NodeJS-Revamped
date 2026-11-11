const { SlashCommandBuilder, EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, StringSelectMenuBuilder, MessageFlags, ComponentType } = require('discord.js');
const queries = require('../database/queries');
const configManager = require('../services/configManager');
const { extractVideoId } = require('../lavalink/playerEvents');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('favorites')
        .setDescription('Manage your personal saved tracks')
        .addSubcommand(subcommand =>
            subcommand
                .setName('add')
                .setDescription('Add the currently playing track to your favorites')
        )
        .addSubcommand(subcommand =>
            subcommand
                .setName('see')
                .setDescription('See your list of saved favorite tracks')
        )
        .addSubcommand(subcommand =>
            subcommand
                .setName('stream')
                .setDescription('Play your saved favorites as a custom playlist')
        )
        .addSubcommand(subcommand =>
            subcommand
                .setName('remove')
                .setDescription('Remove a track from your favorites')
        ),

    generateFavoritesPayload(userId, username, avatarURL, totalTracks, targetPage) {
        const tracksPerPage = 15;
        const maxPages = Math.ceil(totalTracks / tracksPerPage) || 1;

        if (targetPage < 0) targetPage = 0;
        if (targetPage >= maxPages) targetPage = maxPages - 1;

        const offset = targetPage * tracksPerPage;
        const slice = queries.getFavoritesSlice.all(userId, tracksPerPage, offset);

        const embed = new EmbedBuilder()
            .setColor(0x7C3AED)
            .setTitle(`❤️ ${username}'s Favorites`)
            .setThumbnail(avatarURL);

        let description = '';
        for (let i = 0; i < slice.length; i++) {
            const track = slice[i];
            const num = String(offset + i + 1).padStart(2, '0');
            description += `\`${num}.\` **${track.track_title}** — ${track.track_author}\n`;
        }

        embed.setDescription(description)
            .setFooter({ text: `Page ${targetPage + 1} of ${maxPages}  •  ${totalTracks} total tracks` });

        const row = new ActionRowBuilder().addComponents(
            new ButtonBuilder()
                .setCustomId(`fav_view_${userId}_${targetPage - 1}`)
                .setLabel('Previous')
                .setStyle(ButtonStyle.Primary)
                .setDisabled(targetPage === 0),
            new ButtonBuilder()
                .setCustomId(`fav_view_${userId}_${targetPage + 1}`)
                .setLabel('Next')
                .setStyle(ButtonStyle.Primary)
                .setDisabled(targetPage === maxPages - 1)
        );

        return { embeds: [embed], components: [row] };
    },

    async execute(interaction, client) {
        const config = configManager.get(interaction.guildId);
        const replyFlags = config.reply_mode === 1 ? [] : [MessageFlags.Ephemeral];

        await interaction.deferReply({ flags: replyFlags });
        
        const userId = interaction.user.id;
        const subcommand = interaction.options.getSubcommand();

        // ─── Subcommand: ADD ──────────────────────────────────────────
        if (subcommand === 'add') {
            const player = client.moonlink.players.get(interaction.guildId);
            
            if (!player || !player.current) {
                return interaction.editReply({ content: '❌ Nothing is currently playing.' });
            }

            const track = player.current;
            const trackUrl = track.uri;
            const trackTitle = track.title;
            const trackAuthor = track.author || 'Unknown Artist';

            const existing = queries.checkFavorite.get(userId, trackUrl);

            if (existing) {
                return interaction.editReply({ content: `ℹ️ **${trackTitle}** is already in your favorites!` });
            }

            try {
                const videoId = extractVideoId(trackUrl);
                queries.insertFavorite.run(userId, trackTitle, trackAuthor, trackUrl, videoId);
                return interaction.editReply({ content: `❤️ Added **${trackTitle}** to your favorites!` });
            } catch (error) {
                console.error('❌ DB Error (Favorites add):', error.message);
                return interaction.editReply({ content: '❌ Failed to save track due to a database error.' });
            }
        }

        // ─── Subcommand: SEE ──────────────────────────────────────────
        if (subcommand === 'see') {
            const countRow = queries.getFavoritesCount.get(userId);
            if (!countRow || countRow.total === 0) {
                return interaction.editReply({
                    content: '📭 You haven\'t saved any tracks yet! Click the ❤️ button when a song is playing to save it.'
                });
            }

            const payload = this.generateFavoritesPayload(userId, interaction.user.username, interaction.user.displayAvatarURL(), countRow.total, 0);
            return interaction.editReply(payload);
        }

        // Fetch user's favorites from the database for REMOVE and STREAM
        let savedTracks = [];
        try {
            savedTracks = queries.getFavorites.all(userId);
        } catch (error) {
            console.error('❌ DB Error (Favorites fetch):', error.message);
            return interaction.editReply({ content: '❌ A database error occurred.' });
        }

        if (savedTracks.length === 0) {
            return interaction.editReply({
                content: '📭 You haven\'t saved any tracks yet! Click the ❤️ button when a song is playing to save it.'
            });
        }

        // ─── Subcommand: REMOVE ───────────────────────────────────────
        if (subcommand === 'remove') {
            // Discord select menus have a max of 25 options
            const optionsLimit = Math.min(savedTracks.length, 25);
            const options = savedTracks.slice(0, optionsLimit).map((track, index) => ({
                label: track.track_title.substring(0, 100), // Max 100 chars
                description: track.track_author.substring(0, 100),
                value: track.track_url,
                emoji: '💔'
            }));

            const selectMenu = new StringSelectMenuBuilder()
                .setCustomId('fav_remove_menu')
                .setPlaceholder('Select a track to remove...')
                .addOptions(options);

            const row = new ActionRowBuilder().addComponents(selectMenu);

            return interaction.editReply({
                content: 'Select a track below to remove it from your favorites (showing up to 25 most recent):',
                components: [row]
            });
        }

        // ─── Subcommand: STREAM ───────────────────────────────────────
        if (subcommand === 'stream') {
            const voiceChannel = interaction.member?.voice?.channel;
            if (!voiceChannel) {
                return interaction.editReply({ content: '❌ You must be in a voice channel to stream your favorites.' });
            }

            const player = client.moonlink.players.create({
                guildId: interaction.guildId,
                voiceChannelId: voiceChannel.id,
                textChannelId: interaction.channelId,
                selfDeaf: true,
                volume: 100
            });

            if (!player.connected) await player.connect();

            // Extract just the video IDs (limit to 50 for a single session)
            const injectionLimit = Math.min(savedTracks.length, 50);
            const tracksToLoad = savedTracks.slice(0, injectionLimit).map(t => t.video_id || extractVideoId(t.track_url)).filter(Boolean);

            await interaction.editReply({ content: `🔄 Initializing your personal playlist...` });

            // 1. Resolve ONLY the first track to kickstart the engine
            const firstVideoId = tracksToLoad.shift(); 
            const url = `https://music.youtube.com/watch?v=${firstVideoId}`;
            
            try {
                const result = await client.moonlink.search({ query: url, source: 'ytmsearch', requester: interaction.user });
                
                if (result.tracks && result.tracks.length > 0) {
                    await player.queue.add(result.tracks[0]);
                    
                    if (!player.playing) {
                        player.set('is_starting', true);
                        await player.play();
                    }
                } else {
                    return interaction.editReply({ content: `❌ Failed to load the first track. Please try again.` });
                }
            } catch (e) {
                console.error(`Failed to load first favorite:`, e.message);
                return interaction.editReply({ content: `❌ An error occurred while starting your playlist.` });
            }

            // 2. Stash the remaining IDs directly onto the player for JIT loading
            player.set('favoritesQueue', tracksToLoad);

            const embed = new EmbedBuilder()
                .setColor(0x7C3AED)
                .setTitle('❤️ Favorites Playlist Started')
                .setDescription(`Queued the first track! The remaining **${tracksToLoad.length}** tracks will load seamlessly in the background as each song finishes.`)
                .setTimestamp();

            return interaction.editReply({ content: null, embeds: [embed] });
        }
    },
};
