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

module.exports = { initialize, search, getUpNexts, getAdvancedUpNexts };
