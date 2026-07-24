const ytmusic = require('./ytmusic');
const { db } = require('../database/schema');

class AutoplayManager {
    /**
     * @param {string} guildId
     * @param {string} userId
     * @param {string} mode 'dynamic' or 'static'
     * @param {string} initialVideoId
     */
    constructor(guildId, userId, mode = 'static', initialVideoId = null) {
        this.guildId = guildId;
        this.userId = userId;
        this.mode = mode; 
        this.seedVideoId = initialVideoId;
        this.recentSeeds = initialVideoId ? [initialVideoId] : [];
        
        // Infinite Memory (Local Session)
        this.playedIds = new Set();
        if (initialVideoId) this.playedIds.add(initialVideoId);
        
        this.buffer = [];
        this.isFetching = false;
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
            // Low water mark: Pre-fetch in background without waiting
            this.fillBuffer(config, artistHistory).catch(() => {});
        }
        
        return this.buffer.shift() || null;
    }
    
    /**
     * Fetches recommendations and applies dynamic filtering.
     */
    async fillBuffer(config, artistHistory = []) {
        if (this.isFetching || !this.seedVideoId) return;
        this.isFetching = true;
        
        try {
            // Compile the dynamic regex from config
            let regex;
            try {
                regex = new RegExp(config.regex_blacklist, 'i');
            } catch (e) {
                // Fallback if regex is broken (shouldn't happen with modal validation)
                regex = /\b(slowed|reverb|nightcore|remix)\b/i;
            }

const normalizeString = (str) => {
    if (!str) return '';
    return str.toLowerCase()
        .replace(/\s*\[.*?\]\s*/g, '')
        .replace(/\s*\(.*?\)\s*/g, '')
        .replace(/[^a-z0-9]/g, '');
};

            // Fetch persistent user history to prevent repeating across sessions
            let persistentHistoryIds = new Set();
            let persistentHistorySignatures = new Set();
            if (this.userId) {
                try {
                    const rows = db.prepare('SELECT video_id, track_title, track_author FROM track_history WHERE user_id = ?').all(this.userId);
                    rows.forEach(r => {
                        persistentHistoryIds.add(r.video_id);
                        if (r.track_title && r.track_author) {
                            const sig = `${normalizeString(r.track_title)}|${normalizeString(r.track_author)}`;
                            persistentHistorySignatures.add(sig);
                        }
                    });
                } catch (e) {
                    console.error('[AutoplayManager] Error fetching track history:', e.message);
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
                        const fav = db.prepare('SELECT track_url FROM user_favorites ORDER BY RANDOM() LIMIT 1').get();
                        if (fav && fav.track_url) {
                            const url = new URL(fav.track_url);
                            const favId = url.searchParams.get('v');
                            if (favId) newSeed = favId;
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

                    // Fetch recommendations
                    const tracks = await ytmusic.getAdvancedUpNexts(activeSeed);
                    
                    // Filter with Advanced Heuristics (Tiered Fallback System)
                    let validTracks = [];
                    
                    const sorter = (a, b) => {
                        if (a.videoType === 'MUSIC_VIDEO_TYPE_ATV' && b.videoType !== 'MUSIC_VIDEO_TYPE_ATV') return -1;
                        if (a.videoType !== 'MUSIC_VIDEO_TYPE_ATV' && b.videoType === 'MUSIC_VIDEO_TYPE_ATV') return 1;
                        return 0;
                    };

                    const isPlayedOrInHistory = (t) => {
                        if (this.playedIds.has(t.videoId) || persistentHistoryIds.has(t.videoId)) return true;
                        
                        const sig = `${normalizeString(t.title)}|${normalizeString(t.artists)}`;
                        if (persistentHistorySignatures.has(sig)) return true;
                        
                        return false;
                    };

                    // Tier 1: Strict (ATV/OMV + Regex + Artist History)
                    validTracks = tracks.filter(t => {
                        if (!t.videoId || isPlayedOrInHistory(t)) return false;
                        if (t.videoType !== 'MUSIC_VIDEO_TYPE_ATV' && t.videoType !== 'MUSIC_VIDEO_TYPE_OMV') return false;
                        const searchStr = `${t.title} ${t.artists}`;
                        if (regex.test(searchStr)) return false;
                        if (artistHistory.includes(t.artists)) return false;
                        return true;
                    }).sort(sorter);

                    // Tier 2: Soft Regex (ATV/OMV + Artist History, Ignore Regex)
                    if (validTracks.length === 0) {
                        validTracks = tracks.filter(t => {
                            if (!t.videoId || isPlayedOrInHistory(t)) return false;
                            if (t.videoType !== 'MUSIC_VIDEO_TYPE_ATV' && t.videoType !== 'MUSIC_VIDEO_TYPE_OMV') return false;
                            if (artistHistory.includes(t.artists)) return false;
                            return true;
                        }).sort(sorter);
                    }

                    // Tier 3: Desperate (Ignore VideoType & Regex, Only require Artist History)
                    if (validTracks.length === 0) {
                        validTracks = tracks.filter(t => {
                            if (!t.videoId || isPlayedOrInHistory(t)) return false;
                            if (artistHistory.includes(t.artists)) return false;
                            return true;
                        }); // No need to sort ATV/OMV since this is a desperate fallback
                    }

                    
                    if (validTracks.length === 0) {
                        this.retryCount++;
                        await new Promise(r => setTimeout(r, 1000 * Math.pow(2, this.retryCount)));
                        continue;
                    }
                    
                    // Smart Shuffling: Group by artist to prevent clusters
                    const artistMap = new Map();
                    for (const t of validTracks) {
                        if (!artistMap.has(t.artists)) artistMap.set(t.artists, []);
                        artistMap.get(t.artists).push(t);
                    }
                    
                    const shuffled = [];
                    while (artistMap.size > 0) {
                        for (const [artist, list] of artistMap.entries()) {
                            shuffled.push(list.shift());
                            if (list.length === 0) artistMap.delete(artist);
                        }
                    }
                    
                    this.buffer.push(...shuffled.slice(0, 25));
                    this.retryCount = 0;
                    break;
                } catch(e) {
                    console.error(`[AutoplayManager] Fetch error:`, e.message);
                    this.retryCount++;
                    await new Promise(r => setTimeout(r, 1000 * Math.pow(2, this.retryCount)));
                }
            }
        } finally {
            this.isFetching = false;
        }
    }
}

module.exports = AutoplayManager;
