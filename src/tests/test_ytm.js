const YTMusic = require('ytmusic-api');

async function run() {
    const ytmusic = new YTMusic();
    await ytmusic.initialize();
    try {
        const search = await ytmusic.searchPlaylists("pop");
        const validPlaylists = search.filter(s => s.playlistId);
        if (validPlaylists.length > 0) {
            console.log(validPlaylists[0]);
            const pid = validPlaylists[0].playlistId;
            console.log("Found Playlist ID:", pid);
            const data = await ytmusic.getPlaylist(pid);
            console.log("Playlist Name:", data.name);
            console.log("Keys:", Object.keys(data));
            if (data.content && data.content.length > 0) {
                console.log("First Video ID:", data.content[0].videoId);
            }
        }
    } catch(e) {
        console.error(e);
    }
}
run();
