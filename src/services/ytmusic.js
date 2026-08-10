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

/**
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

/**
 * Fetch all tracks from a playlist using YouTube's internal browse endpoint.
 * Bypasses the standard 100-track limit by following continuation tokens.
 * @param {string} playlistId - The YouTube playlist ID (without VL prefix).
 * @returns {Promise<Array<{id: string, title: string, artist: string}>>}
 */
async function getPlaylistTracks(playlistId) {
    if (!initialized) await initialize();
    const tracks = [];
    let continuation = null;
    let browseId = `VL${playlistId}`;

    try {
        do {
            const payload = continuation ? { continuation } : { browseId };
            const res = await ytmusic.constructRequest('browse', payload);
            
            // Extract the list items depending on whether it's the initial load or a continuation
            let items = [];
            if (!continuation) {
                // Initial Load
                const sectionList = res?.contents?.twoColumnBrowseResultsRenderer?.secondaryContents?.sectionListRenderer;
                const musicPlaylistShelf = sectionList?.contents?.find(c => c.musicPlaylistShelfRenderer)?.musicPlaylistShelfRenderer;
                items = musicPlaylistShelf?.contents || [];
            } else {
                // Continuation Load
                items = res?.onResponseReceivedActions?.[0]?.appendContinuationItemsAction?.continuationItems || [];
            }

            // Check if last item is a continuation
            const lastItem = items[items.length - 1];
            if (lastItem?.continuationItemRenderer) {
                continuation = lastItem.continuationItemRenderer?.continuationEndpoint?.continuationCommand?.token || null;
                items.pop(); // Remove it from the track processing list
            } else {
                continuation = null;
            }

            for (const item of items) {
                const renderer = item.musicResponsiveListItemRenderer;
                if (!renderer) continue;
                
                const playEndpoint = renderer.overlay?.musicItemThumbnailOverlayRenderer?.content?.musicPlayButtonRenderer?.playNavigationEndpoint;
                const videoId = playEndpoint?.watchEndpoint?.videoId;
                if (!videoId) continue;
                
                // Extract Title
                const flexColumn0 = renderer.flexColumns?.[0]?.musicResponsiveListItemFlexColumnRenderer?.text?.runs;
                const title = flexColumn0?.map(r => r.text).join('') || 'Unknown Title';
                
                // Extract Artists (usually flexColumn 1)
                const flexColumn1 = renderer.flexColumns?.[1]?.musicResponsiveListItemFlexColumnRenderer?.text?.runs;
                // Filter out ' • ' separators and view counts
                const artist = flexColumn1?.map(r => r.text).filter(t => t !== ' • ' && !t.includes(' views') && !t.includes(' plays')).join(', ') || 'Unknown Artist';
                
                tracks.push({ id: videoId, title, artist });
            }

            // Force Garbage Collection hints by manually dereferencing massive JSON block objects
            items.length = 0;
            items = null;
            res = null;

            // Explicitly yield to the Node.js event loop to prevent WebSocket heartbeat starvation
            await new Promise(resolve => setImmediate(resolve));

        } while (continuation);
        
    } catch (e) {
        console.error("YTMusic Playlist Extractor Error:", e);
    }
    
    return tracks;
}

module.exports = { initialize, search, getUpNexts, getAdvancedUpNexts, getPlaylistTracks };
