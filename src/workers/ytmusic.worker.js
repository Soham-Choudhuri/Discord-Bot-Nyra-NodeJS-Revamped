const YTMusic = require('ytmusic-api');

const ytmusic = new YTMusic();
let initialized = false;

// Pre-compiled regex for maximum CPU performance during massive array filtering
const METADATA_STRIP_REGEX = /^•$|\b(?:views|plays)\b/i;

function normalizeString(str) {
    if (!str) return '';
    return str.toLowerCase()
        .replace(/\s*\[.*?\]\s*/g, '')
        .replace(/\s*\(.*?\)\s*/g, '')
        .replace(/[^a-z0-9]/g, '');
}

async function initialize() {
    if (initialized) return;
    await ytmusic.initialize();
    initialized = true;
    console.log(`🎧 YTMusic Worker Thread Initialized`);
}

async function search(query) {
    if (!initialized) await initialize();
    try {
        return await ytmusic.searchSongs(query);
    } catch (error) {
        console.error(`[Worker] Search network error:`, error.message);
        return [];
    }
}

async function getUpNexts(videoId) {
    if (!initialized) await initialize();
    try {
        return await ytmusic.getUpNexts(videoId);
    } catch (error) {
        console.error(`[Worker] UpNext network error:`, error.message);
        return [];
    }
}

async function getAdvancedUpNexts(videoId, filters = {}) {
    if (!initialized) await initialize();
    let res = null;

    for (let attempt = 1; attempt <= 3; attempt++) {
        try {
            res = await ytmusic.constructRequest('next', {
                videoId,
                playlistId: `RDAMVM${videoId}`,
                isAudioOnly: true
            });
            break; // Success, break out of the retry loop
        } catch (error) {
            console.error(`[Worker] AdvancedUpNext network error (Attempt ${attempt}/3):`, error.message);
            if (attempt === 3) {
                console.error(`[Worker] AdvancedUpNext exhausted all 3 network attempts. Aborting.`);
                return [];
            }
            await new Promise(resolve => setTimeout(resolve, 1000));
        }
    }
    
    const tabs = res?.contents?.singleColumnMusicWatchNextResultsRenderer?.tabbedRenderer?.watchNextTabbedResultsRenderer?.tabs[0]?.tabRenderer?.content?.musicQueueRenderer?.content?.playlistPanelRenderer?.contents;
    
    if (!tabs) return [];
    
    const tracks = tabs.slice(1).map(item => {
        const renderer = item.playlistPanelVideoRenderer;
        if (!renderer) return null;
        
        const title = renderer.title?.runs?.map(r => r.text).join('') || '';
        const artists = renderer.shortBylineText?.runs?.map(r => r.text).join('') || '';
        
        return {
            videoId: renderer.videoId,
            title,
            artists,
            signature: `${normalizeString(title)}|${normalizeString(artists)}`,
            videoType: renderer.navigationEndpoint?.watchEndpoint?.watchEndpointMusicSupportedConfigs?.watchEndpointMusicConfig?.musicVideoType || 'UNKNOWN'
        };
    }).filter(Boolean);

    // If no filters were passed, return raw tracks
    if (!filters || Object.keys(filters).length === 0) return tracks;

    const {
        artistHistory = [],
        persistentHistoryIds = [],
        persistentHistorySignatures = [],
        playlistTrackIds = [],
        playlistSignatures = [],
        playedIds = [],
        regexBlacklist = ''
    } = filters;

    // Convert arrays back to sets for fast lookup inside the worker
    const playedIdsSet = new Set(playedIds);
    const persistentHistoryIdsSet = new Set(persistentHistoryIds);
    const playlistTrackIdsSet = new Set(playlistTrackIds);
    const persistentHistorySignaturesSet = new Set(persistentHistorySignatures);
    
    // Normalize raw playlist objects natively on the E-Core worker
    const playlistSignaturesSet = new Set();
    if (playlistSignatures && playlistSignatures.length > 0) {
        for (const sig of playlistSignatures) {
            if (sig.title && sig.artist) {
                playlistSignaturesSet.add(`${normalizeString(sig.title)}|${normalizeString(sig.artist)}`);
            }
        }
    }

    let regex;
    try {
        regex = new RegExp(regexBlacklist || '\\b(slowed|reverb|nightcore|remix)\\b', 'i');
    } catch (e) {
        regex = /\b(slowed|reverb|nightcore|remix)\b/i;
    }

    const sorter = (a, b) => {
        if (a.videoType === 'MUSIC_VIDEO_TYPE_ATV' && b.videoType !== 'MUSIC_VIDEO_TYPE_ATV') return -1;
        if (a.videoType !== 'MUSIC_VIDEO_TYPE_ATV' && b.videoType === 'MUSIC_VIDEO_TYPE_ATV') return 1;
        return 0;
    };

    const isPlayedOrInHistory = (t) => {
        if (playedIdsSet.has(t.videoId) || persistentHistoryIdsSet.has(t.videoId)) return true;
        if (playlistTrackIdsSet.has(t.videoId)) return true; // Negative Filtering
        
        const sig = `${normalizeString(t.title)}|${normalizeString(t.artists)}`;
        if (persistentHistorySignaturesSet.has(sig)) return true;
        if (playlistSignaturesSet.has(sig)) return true;
        
        return false;
    };

    let validTracks = [];

    // Tier 1: Strict (ATV/OMV + Regex + Artist History)
    validTracks = tracks.filter(t => {
        if (!t.videoId || isPlayedOrInHistory(t)) return false;
        if (t.videoType !== 'MUSIC_VIDEO_TYPE_ATV' && t.videoType !== 'MUSIC_VIDEO_TYPE_OMV') return false;
        const searchStr = `${t.title} ${t.artists}`;
        if (regex.test(searchStr)) return false;
        if (artistHistory.includes(t.artists)) return false;
        return true;
    }).sort(sorter);

    // Tier 2: Soft Regex
    if (validTracks.length === 0) {
        validTracks = tracks.filter(t => {
            if (!t.videoId || isPlayedOrInHistory(t)) return false;
            if (t.videoType !== 'MUSIC_VIDEO_TYPE_ATV' && t.videoType !== 'MUSIC_VIDEO_TYPE_OMV') return false;
            if (artistHistory.includes(t.artists)) return false;
            return true;
        }).sort(sorter);
    }

    // Tier 3: Desperate
    if (validTracks.length === 0) {
        validTracks = tracks.filter(t => {
            if (!t.videoId || isPlayedOrInHistory(t)) return false;
            if (artistHistory.includes(t.artists)) return false;
            return true;
        });
    }

    if (validTracks.length === 0) return [];

    // Smart Shuffling
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
    
    return shuffled.slice(0, 25);
}

async function getPlaylistTracks(playlistId) {
    if (!initialized) await initialize();
    const tracks = [];
    let continuation = null;
    let browseId = `VL${playlistId}`;

    try {
        do {
            const payload = continuation ? { continuation } : { browseId };
            const res = await ytmusic.constructRequest('browse', payload);
            
            let items = [];
            if (!continuation) {
                const sectionList = res?.contents?.twoColumnBrowseResultsRenderer?.secondaryContents?.sectionListRenderer;
                const musicPlaylistShelf = sectionList?.contents?.find(c => c.musicPlaylistShelfRenderer)?.musicPlaylistShelfRenderer;
                items = musicPlaylistShelf?.contents || [];
            } else {
                items = res?.onResponseReceivedActions?.[0]?.appendContinuationItemsAction?.continuationItems || [];
            }

            const lastItem = items[items.length - 1];
            if (lastItem?.continuationItemRenderer) {
                continuation = lastItem.continuationItemRenderer?.continuationEndpoint?.continuationCommand?.token || null;
                items.pop();
            } else {
                continuation = null;
            }

            for (const item of items) {
                const renderer = item.musicResponsiveListItemRenderer;
                if (!renderer) continue;
                
                const playEndpoint = renderer.overlay?.musicItemThumbnailOverlayRenderer?.content?.musicPlayButtonRenderer?.playNavigationEndpoint;
                const videoId = playEndpoint?.watchEndpoint?.videoId;
                if (!videoId) continue;
                
                const flexColumn0 = renderer.flexColumns?.[0]?.musicResponsiveListItemFlexColumnRenderer?.text?.runs;
                const title = flexColumn0?.map(r => r.text).join('') || 'Unknown Title';
                
                const flexColumn1 = renderer.flexColumns?.[1]?.musicResponsiveListItemFlexColumnRenderer?.text?.runs;
                const artist = flexColumn1?.map(r => r.text.trim()).filter(t => t && !METADATA_STRIP_REGEX.test(t)).join(', ') || 'Unknown Artist';
                
                tracks.push({ id: videoId, title, artist });
            }

            // Dereference massive JSON payload arrays
            items.length = 0;
            items = null;

            // Instantly wipe V8 heap to prevent RAM ballooning across loops
            if (global.gc) global.gc();

        } while (continuation);
        
    } catch (e) {
        console.error("YTMusic Playlist Extractor Error:", e);
    }
    
    return tracks;
}

/**
 * Calculates Levenshtein distance using flat Uint16Arrays to eliminate V8 GC pressure.
 */
function levenshteinDistance(a, b) {
    if (a.length === 0) return b.length;
    if (b.length === 0) return a.length;

    let prevRow = new Uint16Array(a.length + 1);
    let currRow = new Uint16Array(a.length + 1);

    for (let j = 0; j <= a.length; j++) {
        prevRow[j] = j;
    }

    for (let i = 1; i <= b.length; i++) {
        currRow[0] = i;
        for (let j = 1; j <= a.length; j++) {
            if (b.charAt(i - 1) === a.charAt(j - 1)) {
                currRow[j] = prevRow[j - 1];
            } else {
                currRow[j] = Math.min(
                    prevRow[j - 1] + 1, // substitution
                    currRow[j - 1] + 1, // insertion
                    prevRow[j] + 1      // deletion
                );
            }
        }
        // Swap arrays to avoid reallocation
        let temp = prevRow;
        prevRow = currRow;
        currRow = temp;
    }

    return prevRow[a.length];
}

/**
 * Offloaded string matching logic.
 */
function findBestMatchWorker(query, items) {
    if (!items || items.length === 0) return null;
    if (!query) return items[0];

    const lowerQuery = query.toLowerCase();
    
    let bestMatch = items[0];
    let minDistance = Infinity;

    for (const item of items) {
        // Replicate the key extraction previously done via closure
        const itemString = `${item.title} ${item.artists?.map ? item.artists.map(a => a.name).join(' ') : (item.artists || item.author || '')}`.toLowerCase();
        
        // Exact substring match check first
        if (itemString.includes(lowerQuery) || lowerQuery.includes(itemString)) {
            const distance = Math.abs(itemString.length - lowerQuery.length);
            if (distance < minDistance) {
                minDistance = distance;
                bestMatch = item;
            }
        } else {
            const distance = levenshteinDistance(lowerQuery, itemString);
            if (distance < minDistance) {
                minDistance = distance;
                bestMatch = item;
            }
        }
    }

    return bestMatch;
}

// The default export for Piscina handles message routing
module.exports = async ({ method, args }) => {
    switch (method) {
        case 'initialize':
            return await initialize();
        case 'search':
            return await search(...args);
        case 'getUpNexts':
            return await getUpNexts(...args);
        case 'getAdvancedUpNexts':
            return await getAdvancedUpNexts(...args);
        case 'getPlaylistTracks':
            return await getPlaylistTracks(...args);
        case 'findBestMatch':
            return findBestMatchWorker(...args);
        default:
            throw new Error(`Unknown method: ${method}`);
    }
};
