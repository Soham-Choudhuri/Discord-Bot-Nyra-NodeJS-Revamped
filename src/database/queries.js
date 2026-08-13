const { db } = require('./schema');

module.exports = {
    // Settings
    getSettings: db.prepare('SELECT * FROM settings WHERE guild_id = ?'),
    upsertSettings: db.prepare('INSERT INTO settings (guild_id) VALUES (?) ON CONFLICT(guild_id) DO NOTHING'),
    
    // Individual Setting Updaters (Pre-compiled to avoid dynamic string execution)
    updateMaxQueueSize: db.prepare('UPDATE settings SET max_queue_size = ? WHERE guild_id = ?'),
    updateVerboseMode: db.prepare('UPDATE settings SET verbose_mode = ? WHERE guild_id = ?'),
    updateAutoplaySeed: db.prepare('UPDATE settings SET autoplay_seed = ? WHERE guild_id = ?'),
    updateDeleteTimer: db.prepare('UPDATE settings SET delete_timer = ? WHERE guild_id = ?'),
    updateCmdChannel: db.prepare('UPDATE settings SET cmd_channel = ? WHERE guild_id = ?'),
    updateArtistMemory: db.prepare('UPDATE settings SET artist_memory = ? WHERE guild_id = ?'),
    updateRegexBlacklist: db.prepare('UPDATE settings SET regex_blacklist = ? WHERE guild_id = ?'),
    updateReplyMode: db.prepare('UPDATE settings SET reply_mode = ? WHERE guild_id = ?'),
    updateWhitelistRole: db.prepare('UPDATE settings SET whitelist_role = ? WHERE guild_id = ?'),

    // User Preferences & History
    getUserPref: db.prepare('SELECT is_tracking_enabled FROM user_preferences WHERE user_id = ?'),
    setUserPref: db.prepare('INSERT INTO user_preferences (user_id, is_tracking_enabled) VALUES (?, ?) ON CONFLICT(user_id) DO UPDATE SET is_tracking_enabled = excluded.is_tracking_enabled'),
    deleteTrackHistory: db.prepare('DELETE FROM track_history WHERE user_id = ? AND video_id = ?'),
    insertTrackHistory: db.prepare('INSERT INTO track_history (user_id, video_id, track_title, track_author, track_signature) VALUES (?, ?, ?, ?, ?)'),
    
    // Playlists
    getSavedPlaylist: db.prepare('SELECT * FROM user_saved_playlist WHERE user_id = ?'),
    getPlaylistName: db.prepare('SELECT playlist_name FROM user_saved_playlist WHERE user_id = ?'),
    getPlaylistCount: db.prepare('SELECT COUNT(*) as total FROM playlist_tracks WHERE user_id = ?'),
    getPlaylistSlice: db.prepare('SELECT title, artist FROM playlist_tracks WHERE user_id = ? LIMIT ? OFFSET ?'),
    deletePlaylistTracks: db.prepare('DELETE FROM playlist_tracks WHERE user_id = ?'),
    deletePlaylistMeta: db.prepare('DELETE FROM user_saved_playlist WHERE user_id = ?'),
    upsertPlaylistMeta: db.prepare('INSERT OR REPLACE INTO user_saved_playlist (user_id, playlist_id, playlist_name) VALUES (?, ?, ?)'),
    insertPlaylistTrack: db.prepare('INSERT OR IGNORE INTO playlist_tracks (user_id, video_id, title, artist) VALUES (?, ?, ?, ?)'),
    getAllPlaylistTrackIds: db.prepare('SELECT video_id, title, artist FROM playlist_tracks WHERE user_id = ?'),

    // Favorites
    getFavorites: db.prepare('SELECT video_id, track_url, track_title, track_author FROM user_favorites WHERE user_id = ? ORDER BY added_at DESC'),
    getFavoritesVideoIds: db.prepare('SELECT video_id FROM user_favorites WHERE user_id = ? AND video_id IS NOT NULL'),
    checkFavorite: db.prepare('SELECT 1 FROM user_favorites WHERE user_id = ? AND track_url = ?'),
    insertFavorite: db.prepare('INSERT INTO user_favorites (user_id, track_title, track_author, track_url, video_id) VALUES (?, ?, ?, ?, ?)'),
    deleteFavorite: db.prepare('DELETE FROM user_favorites WHERE user_id = ? AND track_url = ?'),

    // History (Autoplay/View)
    getHistoryTracks: db.prepare('SELECT video_id, track_title, track_author FROM track_history WHERE user_id = ?'),
    getHistorySignatures: db.prepare('SELECT video_id, track_signature FROM track_history WHERE user_id = ? ORDER BY played_at DESC LIMIT 150'),
    getHistoryDetailed: db.prepare('SELECT video_id, track_title, track_author FROM track_history WHERE user_id = ? ORDER BY played_at DESC'),
    getRecentHistory: db.prepare('SELECT video_id, track_title, track_author, played_at FROM track_history WHERE user_id = ? ORDER BY played_at DESC LIMIT 15'),
    clearHistory: db.prepare('DELETE FROM track_history WHERE user_id = ?')
};

// Bulk Transactions
module.exports.insertPlaylistTracksBulk = db.transaction((userId, tracks) => {
    for (const track of tracks) {
        module.exports.insertPlaylistTrack.run(userId, track.id, track.title, track.artist);
    }
});

module.exports.deleteFullPlaylist = db.transaction((userId) => {
    module.exports.deletePlaylistTracks.run(userId);
    module.exports.deletePlaylistMeta.run(userId);
});
