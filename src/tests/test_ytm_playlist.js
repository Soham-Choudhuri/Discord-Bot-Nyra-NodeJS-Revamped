const ytmusicService = require('../services/ytmusic');

async function test() {
    console.log('Initializing...');
    await ytmusicService.initialize();

    console.log('Fetching playlist...');
    const YTMusic = require('ytmusic-api');
    const api = new YTMusic();
    await api.initialize();

    console.log('Searching for a playlist...');
    const searchRes = await api.searchPlaylists('Top Hits');
    if (!searchRes || searchRes.length === 0) {
        console.log('No playlists found');
        return;
    }
    const playlistId = searchRes[0].playlistId;
    console.log(`Found playlist ID: ${playlistId} (${searchRes[0].name})`);

    console.log('Fetching playlist with custom scraper...');
    const count = await ytmusicService.getPlaylistTracks(playlistId, async (chunk) => {
        console.log(`Received chunk of ${chunk.length} tracks.`);
    });

    console.log(`Total tracks scraped: ${count}`);
}

test().catch(console.error);
