const { getPlaylistTracks } = require('./src/services/ytmusic');

async function run() {
    try {
        const playlistId = 'PLMC9KNkIncKvYin_USF1qoJQnIyMAfRxl';
        console.log("Fetching playlist: " + playlistId);
        
        const tracks = await getPlaylistTracks(playlistId);
        
        console.log(`Fetched ${tracks.length} tracks.`);
        if (tracks.length > 0) {
            console.log(tracks[0]);
            console.log(tracks[tracks.length - 1]);
        }
    } catch(e) {
        console.error(e);
    }
}
run();
