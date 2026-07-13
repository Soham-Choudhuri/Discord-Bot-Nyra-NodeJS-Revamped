const { EmbedBuilder, ActivityType } = require('discord.js');
const ytmusic = require('../services/ytmusic');
const configManager = require('../services/configManager');
const { db } = require('../database/schema'); // For JIT Fallback search

/**
 * Extracts the YouTube videoId from a track URI.
 */
function extractVideoId(uri) {
    if (!uri) return null;
    try {
        const url = new URL(uri);
        return url.searchParams.get('v') || null;
    } catch {
        if (/^[a-zA-Z0-9_-]{11}$/.test(uri)) return uri;
        return null;
    }
}

/**
 * Formats a duration in milliseconds to mm:ss or hh:mm:ss.
 */
function formatDuration(ms) {
    // Failsafe for missing or undefined data (fixes NaN:NaN)
    if (ms == null || isNaN(ms)) return 'Unknown';

    // Lavalink's max-integer signature for Live Streams
    if (ms >= 9223372036854770000) return '🔴 LIVE';

    const seconds = Math.floor((ms / 1000) % 60);
    const minutes = Math.floor((ms / (1000 * 60)) % 60);
    const hours = Math.floor(ms / (1000 * 60 * 60));

    if (hours > 0) return `${hours}:${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
    return `${minutes}:${String(seconds).padStart(2, '0')}`;
}

/**
 * Shared circuit breaker logic for track errors and stuck tracks.
 * @returns {boolean} True if tripped, False if safe.
 */
async function checkCircuitBreaker(player, client) {
    let breakerCount = player.get('circuit_breaker') || 0;
    breakerCount++;
    player.set('circuit_breaker', breakerCount);

    clearTimeout(player.get('breaker_timeout'));
    player.set('breaker_timeout', setTimeout(() => {
        player.set('circuit_breaker', 0);
    }, 10000));

    if (breakerCount >= 3) {
        console.error(`🔴 Circuit Breaker tripped in guild ${player.guildId}! Too many rapid errors.`);
        const channelId = player.textChannelId || player.voiceChannelId;
        const textChannel = client.channels.cache.get(channelId);
        if (textChannel) {
            textChannel.send(`🔴 NodeLink is experiencing severe errors. Playback paused to prevent spam.`).catch(() => {});
        }
        await player.stopPlaying();
        player.set('circuit_breaker', 0);
        return true;
    }
    return false;
}

/**
 * Registers global player events on the Lavalink-Client manager.
 */
function registerPlayerEvents(client) {

    // ─── Track Start Event ───────────────────────────────────────────
    client.moonlink.on("trackStart", async (player, track) => {
        const guildId = player.guildId;
        const config = configManager.get(guildId);

        // We retrieve custom metadata that we will attach to the player in stream.js
        const autoplayManager = player.get('autoplayManager');
        const videoId = extractVideoId(track.info?.uri);

        if (autoplayManager && videoId) {
            autoplayManager.addHistory(videoId);
        }

        // --- Artist History Tracking (Engine Improvement) ---
        let artistHistory = player.get('artistHistory') || [];
        if (track.author && !artistHistory.includes(track.author)) {
            artistHistory.push(track.author);
            const memoryLimit = Math.min(config.artist_memory || 5, 10);
            while (artistHistory.length > memoryLimit) {
                artistHistory.shift();
            }
            player.set('artistHistory', artistHistory);
        }

        // Proactively fill the Autoplay buffer so `/queue` can display upcoming tracks
        if (autoplayManager && videoId) {
            autoplayManager.fillBuffer(config, artistHistory).catch(() => {});
        }

        // We always try to route the NP message to the Voice Channel's text chat.
        // Fallback to interaction text channel if somehow VC text channel isn't accessible.
        const voiceChannelId = player.voiceChannelId;
        const textChannelId = player.textChannelId; // This will now be the VC ID from stream.js
        const textChannel = client.channels.cache.get(textChannelId) || client.channels.cache.get(voiceChannelId);

        if (textChannel) {
            const isVerbose = config.verbose_mode === 1;
            let response;

            // --- UI Component Generation ---
            if (isVerbose) {
                const embed = new EmbedBuilder()
                    .setColor(0x7C3AED)
                    .setAuthor({ name: '🎵 Now Playing' })
                    .setTitle(track.title)
                    .setURL(track.uri)
                    .addFields(
                        { name: 'Artist', value: track.author || 'Unknown', inline: true },
                        { name: 'Duration', value: formatDuration(track.duration), inline: true },
                    )
                    .setTimestamp();

                if (track.artworkUrl) embed.setThumbnail(track.artworkUrl);

                if (player.queue.size > 0) {
                    embed.setFooter({ text: `${player.queue.size} track(s) remaining in queue` });
                } else if (player.get('autoplay')) {
                    embed.setFooter({ text: '♾️ Autoplay is enabled' });
                }

                response = { embeds: [embed], components: [], content: null };
            } else {
                // The Compact Text
                response = { content: `🎵 Now playing: **${track.author} - ${track.title}**`, embeds: [], components: [] };
            }

            // --- Activity Status Update (Global) ---
            client.user.setActivity(`${track.author} - ${track.title}`, { type: ActivityType.Listening });

            // --- Persistent Message Logic (Delete & Resend) ---
            if (config.np_message_id) {
                try {
                    const oldMsg = await textChannel.messages.fetch(config.np_message_id);
                    if (oldMsg && oldMsg.deletable) await oldMsg.delete();
                } catch (e) { }
            }

            try {
                const newMsg = await textChannel.send(response);
                configManager.set(guildId, 'np_message_id', newMsg.id);

                // Removed Compact Mode Reaction Trigger
            } catch (error) {
                console.error('❌ Persistent NP message error:', error.message);
            }
        }
    });

    // ─── Queue End Event (The Autoplay & JIT Engine) ─────────────────
    client.moonlink.on("queueEnd", async (player) => {
        const guildId = player.guildId;

        // 1. Check the Just-In-Time Favorites Queue first
        const favoritesQueue = player.get('favoritesQueue');

        if (favoritesQueue && favoritesQueue.length > 0) {
            // Pop the next track ID off the array and update the state
            const nextVideoId = favoritesQueue.shift();
            player.set('favoritesQueue', favoritesQueue);

            try {
                const url = `https://music.youtube.com/watch?v=${nextVideoId}`;
                let searchResult = await client.moonlink.search({
                    query: url,
                    source: 'ytmsearch',
                    requester: client.user
                });

                if (!searchResult.tracks || searchResult.tracks.length === 0) {
                    // Fallback to plain text search if URL fails (e.g. video deleted or region blocked)
                    const fav = db.prepare('SELECT track_title, track_author FROM user_favorites WHERE track_url = ?').get(url);
                    if (fav) {
                        console.log(`[JIT Favorites] Fallback search for: ${fav.track_title} ${fav.track_author}`);
                        searchResult = await client.moonlink.search({ query: `${fav.track_title} ${fav.track_author}`, source: 'ytmsearch', requester: client.user });
                    }
                }

                if (searchResult.tracks && searchResult.tracks.length > 0) {
                    await player.queue.add(searchResult.tracks[0]);
                    await player.play();
                    return; // Session continues with the next favorite!
                } else {
                    // If all fails, immediately re-emit queueEnd to skip to the next one
                    client.moonlink.emit("queueEnd", player);
                    return;
                }
            } catch (error) {
                console.error(`❌ JIT Favorites error for guild ${guildId}:`, error.message);
                client.moonlink.emit("queueEnd", player);
                return;
            }
        }

        // 2. If no favorites are left, fall back to the standard Autoplay engine
        const isAutoplay = player.get('autoplay');
        const autoplayManager = player.get('autoplayManager');

        // If Autoplay is on, fetch the next algorithmic track
        if (isAutoplay && autoplayManager) {
            let consecutiveFails = 0;
            const maxFails = 5;

            while (consecutiveFails < maxFails) {
                try {
                    const config = configManager.get(guildId);
                    if (config.autoplay_seed) {
                        autoplayManager.seedVideoId = config.autoplay_seed;
                    }

                    const artistHistory = player.get('artistHistory') || [];
                    const nextMeta = await autoplayManager.getNextTrack(config, artistHistory);

                    if (!nextMeta) break; // Buffer empty or fetch failed

                    let searchResult;
                    let fetchRetries = 0;
                    while (fetchRetries < 3) {
                        try {
                            searchResult = await client.moonlink.search({
                                query: `${nextMeta.title} ${nextMeta.artists}`,
                                source: 'ytmsearch',
                                requester: client.user
                            });
                            break; // Success!
                        } catch (netError) {
                            console.error(`❌ Network/NodeLink search error for guild ${guildId}:`, netError.message);
                            fetchRetries++;
                            if (fetchRetries >= 3) {
                                const textChannel = client.channels.cache.get(player.textChannelId || player.voiceChannelId);
                                if (textChannel) {
                                    textChannel.send('⚠️ **Network Error**: NodeLink could not be reached. Autoplay paused.').catch(()=>{});
                                }
                                break;
                            }
                            // Exponential Backoff: 2s, 4s, 8s
                            await new Promise(r => setTimeout(r, 1000 * Math.pow(2, fetchRetries)));
                        }
                    }

                    if (fetchRetries >= 3) break; // Break the outer Autoplay loop

                    if (searchResult && searchResult.tracks && searchResult.tracks.length > 0) {
                        await player.queue.add(searchResult.tracks[0]);
                        await player.play();
                        return; // Session continues with algorithmic autoplay!
                    } else {
                        console.warn(`⚠️ Autoplay could not resolve track: ${nextMeta.title}. Trying next...`);
                        consecutiveFails++;
                    }
                } catch (error) {
                    console.error(`❌ Autoplay error for guild ${guildId}:`, error.message);
                    consecutiveFails++;
                }
            }

            if (consecutiveFails >= maxFails) {
                const textChannel = client.channels.cache.get(player.textChannelId || player.voiceChannelId);
                if (textChannel) {
                    textChannel.send('⚠️ Autoplay failed to load tracks repeatedly. Stopping session.').catch(()=>{});
                }
            }
        }

        // 3. --- Session End Logic (Runs if no favorites, no Autoplay, or if they fail) ---
        const config = configManager.get(guildId);
        if (config.np_message_id) {
            try {
                const channelId = player.textChannelId || player.voiceChannelId;
                const textChannel = client.channels.cache.get(channelId);
                if (textChannel) {
                    const msg = await textChannel.messages.fetch(config.np_message_id);
                    if (msg && msg.deletable) {
                        await msg.delete();
                    }
                    await textChannel.send({
                        content: '🏁 **Queue finished!** I\'m still in the voice channel.',
                        embeds: []
                    });
                }
            } catch (e) { }
            configManager.set(guildId, 'np_message_id', null);
        }

        // Clear Activity Status
        const activePlayers = client.moonlink.players.all.filter(p => p.playing);
        if (activePlayers.length === 0) client.user.setActivity();

        // Cleanup memory for the next session
        if (autoplayManager) autoplayManager.playedIds.clear();
        player.set('favoritesQueue', null);
    });

    // ─── Error Handling Improvement ──────────────────────────────────
    client.moonlink.on("trackException", async (player, track, payload) => {
        console.error(`⚠️ Track error in guild ${player.guildId}:`, payload.error || payload);
        
        // Circuit Breaker
        const tripped = await checkCircuitBreaker(player, client);
        if (tripped) return;

        const config = configManager.get(player.guildId);

        if (config.verbose_mode === 1) {
            const channelId = player.textChannelId || player.voiceChannelId;
            const textChannel = client.channels.cache.get(channelId);
            if (textChannel) {
                textChannel.send(`⚠️ Skipped **${track.title}** due to a NodeLink playback error.`).catch(()=>{});
            }
        }

        // If a track fails, don't just sit there—skip it!
        if (player.queue.size > 0) {
            await player.skip();
        } else if (player.get('autoplay')) {
            client.moonlink.emit("queueEnd", player);
        } else {
            await player.stop();
        }
    });

    client.moonlink.on("trackStuck", async (player, track, payload) => {
        console.warn(`⚠️ Track stuck in guild ${player.guildId}. Threshold: ${payload.thresholdMs}ms`);

        // Circuit Breaker
        const tripped = await checkCircuitBreaker(player, client);
        if (tripped) return;

        // Increment a "stuck counter" in the player metadata
        let stuckCount = player.get('stuck_count') || 0;
        stuckCount++;
        player.set('stuck_count', stuckCount);

        // If it gets stuck more than twice on the same track, skip it
        if (stuckCount >= 2) {
            console.log(`⏩ Track "zombified." Skipping to next...`);
            player.set('stuck_count', 0);
            const config = configManager.get(player.guildId);

            if (config.verbose_mode === 1) {
                const channelId = player.textChannelId || player.voiceChannelId;
                const textChannel = client.channels.cache.get(channelId);
                if (textChannel) {
                    textChannel.send(`⚠️ Skipped **${track.title}** because it got stuck repeatedly.`).catch(()=>{});
                }
            }

            if (player.queue.size > 0) {
                await player.skip();
            } else if (player.get('autoplay')) {
                client.moonlink.emit("queueEnd", player);
            } else {
                await player.stop();
            }
        }
    });
}

module.exports = { registerPlayerEvents, extractVideoId, formatDuration };
