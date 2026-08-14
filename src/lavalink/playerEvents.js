const { EmbedBuilder, ActivityType } = require('discord.js');
const ytmusic = require('../services/ytmusic');
const configManager = require('../services/configManager');
const queries = require('../database/queries'); // For JIT Fallback search

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
 * Aggressive state wipe. Used when fetching errors occur on an empty queue.
 */
async function resetToDefaultState(player, client, reason) {
    const autoplayManager = player.get('autoplayManager');
    if (autoplayManager) autoplayManager.playedIds.clear();
    
    player.queue.clear();
    player.set('autoplay', false);
    player.set('autoplayManager', null);
    player.set('favoritesQueue', null);
    player.set('artistHistory', []);
    player.set('circuit_breaker', 0);
    player.set('stuck_count', 0);
    player.set('stalled_ticks', 0);
    
    if (player.setLoop) {
        player.setLoop(0); // 0 or 'none' depending on lib
    } else {
        player.loop = 0;
    }

    try {
        await player.stop();
    } catch (e) {}

    if (reason) {
        const channelId = player.textChannelId || player.voiceChannelId;
        const textChannel = client.channels.cache.get(channelId);
        if (textChannel) {
            textChannel.send(reason).catch(()=>{});
        }
    }
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
        await resetToDefaultState(player, client, `🔴 **NodeLink Circuit Breaker Tripped!** Encountered massive error spam. The session has been forcefully reset to its idle state to protect the engine.`);
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
        const videoId = extractVideoId(track.uri);

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

        // --- Loop Notification Guard ---
        const lastPlayedId = player.get('last_played_track_id');
        if (player.loop === 'track' && lastPlayedId === videoId) {
            // Suppress the Now Playing spam if the same track is looping
            return;
        }
        player.set('last_played_track_id', videoId);

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
            const npMessageId = player.get('np_message_id');
            if (npMessageId) {
                try {
                    const oldMsg = await textChannel.messages.fetch(npMessageId);
                    if (oldMsg && oldMsg.deletable) await oldMsg.delete();
                } catch (e) { }
            }

            try {
                const newMsg = await textChannel.send(response);
                player.set('np_message_id', newMsg.id);

                // Removed Compact Mode Reaction Trigger
            } catch (error) {
                console.error('❌ Persistent NP message error:', error.message);
            }
        }
    });

    // ─── Track End Event (History Interception) ──────────────────────
    client.moonlink.on("trackEnd", (player, track) => {
        // 0. Skip History Guard (for /stop and /stopafter)
        if (player.get('skipHistory')) {
            player.set('skipHistory', false);
            return;
        }

        // 1. Identify the true requester
        // For standard songs: track.requester
        // For Autoplay songs: they were requested by client.user, so fallback to sessionOwner
        let userId = track.requester?.id;
        if (!userId || userId === client.user.id) {
            userId = player.get('sessionOwner')?.id;
        }

        if (!userId) return;

        // 2. Extract metadata
        const videoId = extractVideoId(track.uri);
        const trackTitle = track.title;
        const trackAuthor = track.author;

        if (!videoId || !trackTitle || !trackAuthor) return;

        try {
            const prefs = queries.getUserPref.get(userId);
            
            if (prefs && prefs.is_tracking_enabled === 1) {
                const trackSignature = track.signature || null;
                queries.deleteTrackHistory.run(userId, videoId);
                queries.insertTrackHistory.run(userId, videoId, track.title, track.author, trackSignature);
            }
        } catch (error) {
            console.error(`❌ Track History Insert Error:`, error.message);
        }

        // --- Strategic Garbage Collection ---
        // Run the Stop-The-World sweep exclusively in the 50ms gap between songs
        // to keep RAM low without stuttering the active UDP pipeline!
        if (global.gc) global.gc();
    });

    // ─── Queue End Event (The Autoplay & JIT Engine) ─────────────────
    client.moonlink.on("queueEnd", async (player) => {
        setTimeout(async () => {
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
                    requester: client.user
                });
                        
                if (searchResult.loadType === 'empty' || searchResult.loadType === 'error') {
                    // Silenced [JIT Favorites] fallback log to prevent event loop blocking
                    searchResult = await client.moonlink.search({ query: `${nextVideoId}`, source: 'ytmsearch', requester: client.user });
                }

                if (searchResult.tracks && searchResult.tracks.length > 0) {
                    await player.queue.add(searchResult.tracks[0]);
                    await player.play();
                    
                    // The "Play-Paused" UDP Pre-Warm (For the very first track in the session)
                    if (player.queue.size === 0 && !player.get('nyra_has_warmed_up')) {
                        player.set('nyra_has_warmed_up', true);
                        (async () => {
                            await player.pause();
                            await new Promise(resolve => setTimeout(resolve, 1500));
                            await player.resume();
                        })();
                    }

                    return; // Session continues with the next favorite!
                } else {
                    // If all fails, immediately re-emit queueEnd to skip to the next one
                    client.moonlink.emit("queueEnd", player);
                    return;
                }
            } catch (error) {
                console.error(`❌ JIT Favorites error for guild ${guildId}:`, error.message);
                await resetToDefaultState(player, client, `⚠️ **JIT Fetch Error**: Failed to load the next favorite track. The session has been aggressively reset.`);
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
                        // --- Inject Pre-computed E-Core Signature for heuristics ---
                        if (nextMeta && nextMeta.signature) {
                            searchResult.tracks[0].signature = nextMeta.signature;
                        }
                        await player.queue.add(searchResult.tracks[0]);
                        await player.play();
                        
                        // The "Play-Paused" UDP Pre-Warm (For the very first track in the session)
                        if (player.queue.size === 0 && !player.get('nyra_has_warmed_up')) {
                            player.set('nyra_has_warmed_up', true);
                            (async () => {
                                await player.pause();
                                await new Promise(resolve => setTimeout(resolve, 1500));
                                await player.resume();
                            })();
                        }

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
                await resetToDefaultState(player, client, `⚠️ **Autoplay Network Failure**: YouTube rate-limits repeatedly blocked track resolution. The session has been aggressively reset to protect the engine.`);
            }
        }

        // 3. --- Session End Logic ---
        const npMessageId = player.get('np_message_id');
        if (npMessageId) {
            try {
                const channelId = player.textChannelId || player.voiceChannelId;
                const textChannel = client.channels.cache.get(channelId);
                if (textChannel) {
                    const msg = await textChannel.messages.fetch(npMessageId);
                    if (msg && msg.deletable) msg.delete();
                    await textChannel.send({
                        content: '🏁 **Queue finished!** I\'m still in the voice channel.',
                        embeds: []
                    });
                }
            } catch (e) { }
            player.set('np_message_id', null);
        }

        // Clear Activity Status
        const activePlayers = client.moonlink.players.all.filter(p => p.playing);
        if (activePlayers.length === 0) client.user.setActivity();

        // Cleanup memory for the next session
        if (autoplayManager) autoplayManager.playedIds.clear();
        player.set('favoritesQueue', null);
        }, 1000);
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
        } else {
            await resetToDefaultState(player, client, `⚠️ **Fatal Playback Error**: NodeLink failed to stream **${track.title}**. Since the queue is empty, the session has been aggressively reset.`);
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
            // Silenced ⏩ Track zombified log to prevent event loop blocking
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
            } else {
                await resetToDefaultState(player, client, `⚠️ **Track Stuck**: NodeLink could not play **${track.title}**. Since the queue is empty, the session has been aggressively reset.`);
            }
        }
    });

    // ─── Custom Watchdog for NodeLink Recovery Loops ─────────────────
    client.moonlink.on('nodeRaw', async (node, payload) => {
        if (payload.op === 'playerUpdate') {
            const guildId = payload.guildId;
            const player = client.moonlink.players.get(guildId);
            if (!player || !player.playing || player.paused) return;

            const currentPos = payload.state.position || 0;
            const lastPos = player.get('last_position') || 0;
            player.set('last_position', currentPos);
            
            // If the stream advanced less than 500ms since the last tick (and isn't at the start), it's stalled.
            if (currentPos > 0 && (currentPos - lastPos) < 500 && (currentPos - lastPos) >= 0) {
                const stalledTicks = (player.get('stalled_ticks') || 0) + 1;
                player.set('stalled_ticks', stalledTicks);

                // Wait for ~7 seconds of stalled ticks before forcing recovery
                if (stalledTicks >= 7) {
                    player.set('stalled_ticks', 0);
                    
                    if (player.queue.size > 0) {
                        const channelId = player.textChannelId || player.voiceChannelId;
                        const textChannel = client.channels.cache.get(channelId);
                        if (textChannel) {
                            textChannel.send(`⚠️ Audio stream stalled. Bypassing engine loop and skipping track to force recovery...`).catch(()=>{});
                        }
                        await player.skip();
                    } else {
                        await resetToDefaultState(player, client, `⚠️ **Audio Stream Stalled**: The UDP pipeline failed beyond recovery. Since the queue is empty, the session has been aggressively reset.`);
                    }
                }
            } else {
                // Reset stalled ticks if playback is advancing normally
                player.set('stalled_ticks', 0);
            }
        }
    });
}

module.exports = { registerPlayerEvents, extractVideoId, formatDuration };
