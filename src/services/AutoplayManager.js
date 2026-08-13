const ytmusic = require('./ytmusic');
const queries = require('../database/queries');

// Removed normalizeString from P-Core to prevent Regex execution on active streams

class AutoplayManager {
    /**
     * @param {string} guildId
     * @param {string} userId
     * @param {string} mode 'dynamic' or 'static'
     * @param {string|string[]} initialVideoId
     */
    constructor(guildId, userId, mode = 'static', initialVideoId = null) {
        this.guildId = guildId;
        this.userId = userId;
        this.mode = mode; 
        
        let initialSeed = initialVideoId;
        if (Array.isArray(initialVideoId) && initialVideoId.length > 0) {
            // Pick a random track as the active seed, but seed the recent history heavily
            initialSeed = initialVideoId[Math.floor(Math.random() * initialVideoId.length)];
            // Randomly select up to 3 seeds for the dynamic engine
            this.recentSeeds = [...initialVideoId].sort(() => 0.5 - Math.random()).slice(0, 3);
        } else {
            this.recentSeeds = initialSeed ? [initialSeed] : [];
        }
        
        this.seedVideoId = initialSeed;
        
        // Infinite Memory (Local Session)
        this.playedIds = new Set();
        if (initialSeed) this.playedIds.add(initialSeed);
        
        this.buffer = [];
        this.fetchPromise = null;
        this.retryCount = 0;
    }
    
    /**
     * Record a track that was played into infinite memory
     * and naturally advance the seed if in dynamic mode.
     */
    addHistory(videoId) {
        if (!videoId) return;
        this.playedIds.add(videoId);
        if (this.mode === 'dynamic') {
            this.seedVideoId = videoId;
            if (!this.recentSeeds.includes(videoId)) {
                this.recentSeeds.push(videoId);
                if (this.recentSeeds.length > 3) this.recentSeeds.shift(); // keep last 3
            }
        }
    }
    
    /**
     * Get the next recommended track metadata.
     * @param {object} config - Guild configuration
     * @param {string[]} artistHistory - Recent artist names
     */
    async getNextTrack(config, artistHistory = []) {
        if (!this.seedVideoId) return null;

        // If buffer is empty, we MUST wait for the fill
        if (this.buffer.length === 0) {
            await this.fillBuffer(config, artistHistory);
        } else if (this.buffer.length <= 1) {
            // Low water mark: Pre-fetch asynchronously after NodeLink UDP pipeline stabilizes (3s delay)
            if (!this.fetchPromise) {
                setTimeout(() => {
                    this.fillBuffer(config, artistHistory).catch(() => {});
                }, 3000);
            }
        }
        
        return this.buffer.shift() || null;
    }
    
    /**
     * Fetches recommendations and applies dynamic filtering.
     */
    async fillBuffer(config, artistHistory = []) {
        if (!this.seedVideoId) return;

        // Gracefully wait if a background fetch is already active
        if (this.fetchPromise) {
            await this.fetchPromise;
            return;
        }
        
        this.fetchPromise = (async () => {
            try {
                // Fetch persistent user history to prevent repeating across sessions
                let persistentHistoryIds = new Set();
                let persistentHistorySignatures = new Set();
                let playlistTrackIds = new Set();
                let playlistSignatures = []; // Raw objects passed directly to E-Core
            
            if (this.userId) {
                try {
                    // 1. Check their history (Limit 150)
                    const rows = queries.getHistorySignatures.all(this.userId);
                    rows.forEach(r => {
                        if (r.video_id) persistentHistoryIds.add(r.video_id);
                        if (r.track_signature) persistentHistorySignatures.add(r.track_signature);
                    });

                        // 2. Check their explicitly saved playlists
                        const savedRows = queries.getAllPlaylistTrackIds.all(this.userId);
                        savedRows.forEach(r => {
                            if (r.video_id) playlistTrackIds.add(r.video_id);
                            if (r.title && r.artist) {
                                // Defer heavy Regex normalization to the background E-Core
                                playlistSignatures.push({ title: r.title, artist: r.artist });
                            }
                        });
                } catch (e) {
                    console.error('[AutoplayManager] Error fetching persistent data:', e.message);
                }
            }

            let recoveryAttempts = 0;
            while (this.retryCount < 3 || recoveryAttempts < 2) {
                // Seed Recovery Logic
                if (this.retryCount >= 3) {
                    console.warn(`[AutoplayManager] Dead end reached for seed ${this.seedVideoId}. Attempting recovery...`);
                    
                    let newSeed = null;
                    
                    // Priority 1: Dynamic Recovery via User Favorites
                    try {
                        const favs = queries.getFavoritesVideoIds.all(this.userId);
                        if (favs && favs.length > 0) {
                            const fav = favs[Math.floor(Math.random() * favs.length)];
                            if (fav && fav.video_id) {
                                newSeed = fav.video_id;
                            }
                        }
                    } catch (err) {
                        console.error('[AutoplayManager] SQLite Recovery failed:', err.message);
                    }
                    
                    // Priority 2: Fallback to Played IDs
                    if (!newSeed) {
                        const playedArray = Array.from(this.playedIds);
                        const candidates = playedArray.filter(id => id !== this.seedVideoId);
                        if (candidates.length > 0) {
                            newSeed = candidates[Math.floor(Math.random() * candidates.length)];
                        } else if (config.autoplay_seed) {
                            newSeed = config.autoplay_seed;
                        }
                    }
                    
                    if (newSeed) {
                        this.seedVideoId = newSeed;
                        this.retryCount = 0;
                        recoveryAttempts++;
                        console.log(`[AutoplayManager] Recovered with new seed: ${this.seedVideoId}`);
                    } else {
                        console.error(`[AutoplayManager] Recovery failed. No fallback seeds available.`);
                        break;
                    }
                }

                try {
                    // Bi-directional Seed Evolution: Fetch recommendations from a cluster of recent seeds
                    const activeSeed = (this.recentSeeds && this.recentSeeds.length > 0)
                        ? this.recentSeeds[Math.floor(Math.random() * this.recentSeeds.length)]
                        : this.seedVideoId;

                    // Fetch recommendations and offload ALL filtering and shuffling to the worker
                    const filters = {
                        artistHistory: artistHistory,
                        persistentHistoryIds: Array.from(persistentHistoryIds),
                        persistentHistorySignatures: Array.from(persistentHistorySignatures),
                        playlistTrackIds: Array.from(playlistTrackIds),
                        playlistSignatures: playlistSignatures, // Arrays of objects
                        playedIds: Array.from(this.playedIds),
                        regexBlacklist: config.regex_blacklist
                    };
                    
                    let validTracks = await ytmusic.getAdvancedUpNexts(activeSeed, filters);
                    
                    if (!validTracks || validTracks.length === 0) {
                        this.retryCount++;
                        await new Promise(r => setTimeout(r, 1000 * Math.pow(2, this.retryCount)));
                        continue;
                    }
                    
                    this.buffer.push(...validTracks);
                    this.retryCount = 0;

                    // Force Garbage Collection hints
                    validTracks.length = 0;
                    validTracks = null;

                    // Execute immediate manual memory sweep if exposed
                    // GC removed to prevent stuttering active streams on the P-Core

                    break;
                } catch(e) {
                    console.error(`[AutoplayManager] Fetch error:`, e.message);
                    this.retryCount++;
                    await new Promise(r => setTimeout(r, 1000 * Math.pow(2, this.retryCount)));
                }
            }
        } catch (globalErr) {
            console.error('[AutoplayManager] Fatal error in fetchPromise:', globalErr);
        }
        })(); // Self-invoking async function to trap the Promise

        try {
            await this.fetchPromise;
        } finally {
            this.fetchPromise = null;
        }
    }
}

module.exports = AutoplayManager;
