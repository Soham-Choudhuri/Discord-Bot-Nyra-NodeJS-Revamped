const YTMusic = require('ytmusic-api');

const ytmusic = new YTMusic();
let initialized = false;

/**
 * Initialize the YTMusic API session.
 * Must be called once before using any other methods.
 */
async function initialize() {
    if (initialized) return;
    await ytmusic.initialize();
    initialized = true;
    console.log('🎧 YTMusic API initialized.');
}

/**
 * Search YouTube Music for songs matching the query.
 * @param {string} query - The search query.
 * @returns {Promise<Array>} Array of search results.
 */
async function search(query) {
    if (!initialized) await initialize();
    return ytmusic.searchSongs(query);
}

/**
 * Get the "Up Next" recommendations for a given videoId.
 * This is the Node.js equivalent of Python's ytmusicapi.get_watch_playlist().
 * Internally calls YouTube Music's /next endpoint with playlistId RDAMVM{videoId}.
 * 
 * @param {string} videoId - The YouTube video ID (11 characters).
 * @returns {Promise<Array<{videoId: string, title: string, artists: string, duration: string, thumbnail: string}>>}
 */
async function getUpNexts(videoId) {
    if (!initialized) await initialize();
    return ytmusic.getUpNexts(videoId);
}

/**
 * Advanced Up Next fetcher.
 * Uses raw ytmusic constructRequest to extract the hidden musicVideoType
 * necessary for ATV isolation heuristics.
 */
async function getAdvancedUpNexts(videoId) {
    if (!initialized) await initialize();
    const res = await ytmusic.constructRequest('next', {
        videoId,
        playlistId: `RDAMVM${videoId}`,
        isAudioOnly: true
    });
    
    const tabs = res?.contents?.singleColumnMusicWatchNextResultsRenderer?.tabbedRenderer?.watchNextTabbedResultsRenderer?.tabs[0]?.tabRenderer?.content?.musicQueueRenderer?.content?.playlistPanelRenderer?.contents;
    
    if (!tabs) return [];
    
    // Slice 1 to skip the current track which is the first item
    return tabs.slice(1).map(item => {
        const renderer = item.playlistPanelVideoRenderer;
        if (!renderer) return null;
        
        return {
            videoId: renderer.videoId,
            title: renderer.title?.runs?.map(r => r.text).join('') || '',
            artists: renderer.shortBylineText?.runs?.map(r => r.text).join('') || '',
            videoType: renderer.navigationEndpoint?.watchEndpoint?.watchEndpointMusicSupportedConfigs?.watchEndpointMusicConfig?.musicVideoType || 'UNKNOWN'
        };
    }).filter(Boolean);
}

const Piscina = require('piscina');
const path = require('path');

// Initialize the worker pool clamped to 4 threads (E-Cores equivalent)
const pool = new Piscina({
    filename: path.resolve(__dirname, '../workers/ytmusic.worker.js'),
    minThreads: 1, // Keep at least one warm
    maxThreads: 1  // Limit to 1 to physically prevent P-Core CPU starvation on i3 hardware
});

/**
 * Initialize the YTMusic worker pool.
 */
async function initialize() {
    // We can run a dummy initialize task on one thread to warm it up
    await pool.run({ method: 'initialize', args: [] });
    console.log('🎧 YTMusic Piscina Worker Pool initialized.');
}

/**
 * Search YouTube Music for songs matching the query.
 * @param {string} query - The search query.
 * @returns {Promise<Array>} Array of search results.
 */
async function search(query) {
    return pool.run({ method: 'search', args: [query] });
}

/**
 * Get the "Up Next" recommendations for a given videoId.
 * @param {string} videoId - The YouTube video ID (11 characters).
 * @returns {Promise<Array>}
 */
async function getUpNexts(videoId) {
    return pool.run({ method: 'getUpNexts', args: [videoId] });
}

/**
 * Advanced Up Next fetcher with E-Core heuristics filtering.
 */
async function getAdvancedUpNexts(videoId, filters = {}) {
    return pool.run({ method: 'getAdvancedUpNexts', args: [videoId, filters] });
}

/**
 * Fetch all tracks from a playlist.
 * Bypasses the 100-track limit by following continuation tokens.
 * @param {string} playlistId - The YouTube playlist ID.
 * @returns {Promise<Array<{id: string, title: string, artist: string}>>}
 */
async function getPlaylistTracks(playlistId) {
    return pool.run({ method: 'getPlaylistTracks', args: [playlistId] });
}

/**
 * Offloads Levenshtein distance string matching to the Piscina pool.
 * @param {string} query
 * @param {Array} tracks 
 */
async function findBestMatch(query, tracks) {
    return pool.run({ method: 'findBestMatch', args: [query, tracks] });
}

module.exports = { initialize, search, getUpNexts, getAdvancedUpNexts, getPlaylistTracks, findBestMatch };
