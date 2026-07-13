const { SlashCommandBuilder, EmbedBuilder, ActionRowBuilder, StringSelectMenuBuilder, MessageFlags, ComponentType } = require('discord.js');
const { db } = require('../database/schema');
const configManager = require('../services/configManager');

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

    async execute(interaction, client) {
        const userId = interaction.user.id;
        const subcommand = interaction.options.getSubcommand();

        // Fetch user's favorites from the database (Ordered newest to oldest)
        let savedTracks = [];
        try {
            savedTracks = db.prepare('SELECT track_url, track_title, track_author FROM user_favorites WHERE user_id = ? ORDER BY added_at DESC').all(userId);
        } catch (error) {
            console.error('❌ DB Error (Favorites fetch):', error.message);
            return interaction.reply({ content: '❌ A database error occurred.', flags: [MessageFlags.Ephemeral] });
        }

        if (savedTracks.length === 0) {
            return interaction.reply({
                content: '📭 You haven\'t saved any tracks yet! Click the ❤️ button when a song is playing to save it.',
                flags: [MessageFlags.Ephemeral]
            });
        }

        // ─── Subcommand: ADD ──────────────────────────────────────────
        if (subcommand === 'add') {
            const player = client.moonlink.players.get(interaction.guildId);
            
            if (!player || !player.current) {
                return interaction.reply({ content: '❌ Nothing is currently playing.', flags: [MessageFlags.Ephemeral] });
            }

            const track = player.current;
            const trackUrl = track.uri;
            const trackTitle = track.title;
            const trackAuthor = track.author || 'Unknown Artist';

            const existing = db.prepare('SELECT 1 FROM user_favorites WHERE user_id = ? AND track_url = ?').get(userId, trackUrl);

            if (existing) {
                return interaction.reply({ content: `ℹ️ **${trackTitle}** is already in your favorites!`, flags: [MessageFlags.Ephemeral] });
            }

            try {
                db.prepare('INSERT INTO user_favorites (user_id, track_title, track_author, track_url) VALUES (?, ?, ?, ?)').run(
                    userId, trackTitle, trackAuthor, trackUrl
                );
                return interaction.reply({ content: `❤️ Added **${trackTitle}** to your favorites!`, flags: [MessageFlags.Ephemeral] });
            } catch (error) {
                console.error('❌ DB Error (Favorites add):', error.message);
                return interaction.reply({ content: '❌ Failed to save track due to a database error.', flags: [MessageFlags.Ephemeral] });
            }
        }

        // ─── Subcommand: SEE ──────────────────────────────────────────
        if (subcommand === 'see') {
            const embed = new EmbedBuilder()
                .setColor(0x7C3AED)
                .setTitle(`❤️ ${interaction.user.username}'s Favorites`)
                .setThumbnail(interaction.user.displayAvatarURL());

            let description = '';
            // Display up to 15 tracks to keep the embed clean
            const displayLimit = Math.min(savedTracks.length, 15);

            for (let i = 0; i < displayLimit; i++) {
                const track = savedTracks[i];
                const num = String(i + 1).padStart(2, '0');
                description += `\`${num}.\` **${track.track_title}** — ${track.track_author}\n`;
            }

            if (savedTracks.length > 15) {
                description += `\n*...and ${savedTracks.length - 15} more saved track(s)*`;
            }

            embed.setDescription(description)
                .setFooter({ text: `${savedTracks.length} total tracks saved` });

            return interaction.reply({ embeds: [embed], flags: [MessageFlags.Ephemeral] });
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
                .setCustomId('remove_favorite')
                .setPlaceholder('Select a track to remove...')
                .addOptions(options);

            const row = new ActionRowBuilder().addComponents(selectMenu);

            const response = await interaction.reply({
                content: 'Select a track below to remove it from your favorites (showing up to 25 most recent):',
                components: [row],
                flags: [MessageFlags.Ephemeral],
                withResponse: true // Allows us to create a collector
            });

            // Create a component collector right here in the command
            const collector = response.resource.message.createMessageComponentCollector({
                componentType: ComponentType.StringSelect,
                time: 60000 // Menu expires in 60 seconds
            });

            collector.on('collect', async i => {
                if (i.user.id !== userId) return; // Security check

                const videoIdToRemove = i.values[0];

                try {
                    db.prepare('DELETE FROM user_favorites WHERE user_id = ? AND track_url = ?').run(userId, videoIdToRemove);

                    // Update the interaction to confirm deletion and remove the dropdown
                    await i.update({
                        content: `✅ Track successfully removed from your favorites.`,
                        components: []
                    });
                } catch (error) {
                    await i.update({ content: '❌ Failed to remove track due to a database error.', components: [] });
                }
            });

            collector.on('end', collected => {
                // If they never clicked anything, clean up the menu
                if (collected.size === 0) {
                    interaction.editReply({ content: '⏳ Menu timed out.', components: [] }).catch(() => { });
                }
            });

            return;
        }

        // ─── Subcommand: STREAM ───────────────────────────────────────
        if (subcommand === 'stream') {
            const voiceChannel = interaction.member?.voice?.channel;
            if (!voiceChannel) {
                return interaction.reply({ content: '❌ You must be in a voice channel to stream your favorites.', flags: [MessageFlags.Ephemeral] });
            }

            await interaction.deferReply({ flags: [MessageFlags.Ephemeral] });

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
            const tracksToLoad = savedTracks.slice(0, injectionLimit).map(t => t.track_url);

            await interaction.editReply({ content: `🔄 Initializing your personal playlist...` });

            // 1. Resolve ONLY the first track to kickstart the engine
            const firstVideoId = tracksToLoad.shift(); 
            const url = `https://music.youtube.com/watch?v=${firstVideoId}`;
            
            try {
                const result = await client.moonlink.search({ query: url, source: 'ytmsearch', requester: interaction.user });
                
                if (result.tracks && result.tracks.length > 0) {
                    await player.queue.add(result.tracks[0]);
                    
                    if (!player.playing) {
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
