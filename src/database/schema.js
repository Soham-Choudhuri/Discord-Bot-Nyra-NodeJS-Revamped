const Database = require('better-sqlite3');
const path = require('path');
const fs = require('fs');

// Ensure database directory exists
const dbDir = path.join(__dirname, '../../data');
if (!fs.existsSync(dbDir)) {
    fs.mkdirSync(dbDir, { recursive: true });
}

const db = new Database(path.join(dbDir, 'nyra.db'));

// Optimization settings
db.pragma('journal_mode = WAL');
db.pragma('synchronous = NORMAL');
db.pragma('temp_store = MEMORY'); // Forces temporary tables/indices into RAM, bypassing disk I/O completely
db.pragma('cache_size = -16000'); // Hard-caps SQLite cache at ~16MB. A negative value specifies memory in KB.
db.pragma('mmap_size = 268435456'); // Allocates 256MB of Memory-Mapped I/O. Offloads read caching to the OS, keeping Node.js V8 heap perfectly clean.
db.pragma('busy_timeout = 5000'); // Tells queries to wait up to 5 seconds if the DB is locked, preventing crash exceptions during high concurrency.

/**
 * Initialize the database schema.
 */
function initSchema() {
    // Settings table
    db.prepare(`
        CREATE TABLE IF NOT EXISTS settings (
            guild_id TEXT PRIMARY KEY,
            max_queue_size INTEGER DEFAULT 50,
            verbose_mode INTEGER DEFAULT 1,
            autoplay_seed TEXT DEFAULT NULL,
            delete_timer INTEGER DEFAULT 0,
            cmd_channel TEXT DEFAULT NULL,
            np_message_id TEXT DEFAULT NULL,
            artist_memory INTEGER DEFAULT 5,
            regex_blacklist TEXT DEFAULT '\\b(slowed|reverb|nightcore|sped\\s*up|chipmunk|mashup|tiktok|remix|8d|bass\\s*boosted|acoustic|demo|instrumental|karaoke|cover|live)\\b',
            reply_mode INTEGER DEFAULT 0,
            whitelist_role TEXT DEFAULT NULL
        )
    `).run();

    // --- User Favorites Table ---
    // Stores tracks saved by users via the ❤️ button or reaction
    db.prepare(`
        CREATE TABLE IF NOT EXISTS user_favorites (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id TEXT NOT NULL,
            track_title TEXT NOT NULL,
            track_author TEXT NOT NULL,
            track_url TEXT NOT NULL,
            video_id TEXT,
            added_at DATETIME DEFAULT CURRENT_TIMESTAMP
        )
    `).run();

    // --- Persistent Track History ---
    db.prepare(`
        CREATE TABLE IF NOT EXISTS user_preferences (
            user_id TEXT PRIMARY KEY,
            is_tracking_enabled INTEGER DEFAULT 0
        )
    `).run();

    db.prepare(`
        CREATE TABLE IF NOT EXISTS track_history (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id TEXT NOT NULL,
            video_id TEXT NOT NULL,
            track_title TEXT NOT NULL,
            track_author TEXT NOT NULL,
            track_signature TEXT,
            played_at DATETIME DEFAULT CURRENT_TIMESTAMP
        )
    `).run();

    // --- User Saved Playlist (Normalized) ---
    // Clean wipe legacy table if it contains the old track_ids JSON blob
    const userSavedColumns = db.prepare('PRAGMA table_info(user_saved_playlist)').all();
    if (userSavedColumns.some(c => c.name === 'track_ids')) {
        db.prepare('DROP TABLE IF EXISTS user_saved_playlist').run();
    }

    db.prepare(`
        CREATE TABLE IF NOT EXISTS user_saved_playlist (
            user_id TEXT PRIMARY KEY,
            playlist_id TEXT,
            playlist_name TEXT
        )
    `).run();

    // Normalized Tracks Table
    db.prepare(`
        CREATE TABLE IF NOT EXISTS playlist_tracks (
            user_id TEXT NOT NULL,
            video_id TEXT NOT NULL,
            title TEXT NOT NULL,
            artist TEXT NOT NULL,
            PRIMARY KEY (user_id, video_id)
        )
    `).run();



    // Migration for existing tables: Add new columns if they don't exist
    const settingsColumns = db.prepare('PRAGMA table_info(settings)').all();
    const settingsColumnNames = settingsColumns.map(c => c.name);

    if (!settingsColumnNames.includes('delete_timer')) {
        db.prepare('ALTER TABLE settings ADD COLUMN delete_timer INTEGER DEFAULT 0').run();
    }
    if (!settingsColumnNames.includes('cmd_channel')) {
        db.prepare('ALTER TABLE settings ADD COLUMN cmd_channel TEXT DEFAULT NULL').run();
    }
    if (!settingsColumnNames.includes('np_message_id')) {
        db.prepare('ALTER TABLE settings ADD COLUMN np_message_id TEXT DEFAULT NULL').run();
    }
    if (!settingsColumnNames.includes('artist_memory')) {
        db.prepare('ALTER TABLE settings ADD COLUMN artist_memory INTEGER DEFAULT 5').run();
    }
    if (!settingsColumnNames.includes('regex_blacklist')) {
        db.prepare('ALTER TABLE settings ADD COLUMN regex_blacklist TEXT DEFAULT \'\\b(slowed|reverb|nightcore|sped\\s*up|chipmunk|mashup|tiktok|remix|8d|bass\\s*boosted|acoustic|demo|instrumental|karaoke|cover|live)\\b\'').run();
    }
    if (!settingsColumnNames.includes('reply_mode')) {
        db.prepare('ALTER TABLE settings ADD COLUMN reply_mode INTEGER DEFAULT 0').run();
    }
    if (!settingsColumnNames.includes('whitelist_role')) {
        db.prepare('ALTER TABLE settings ADD COLUMN whitelist_role TEXT DEFAULT NULL').run();
    }

    // --- Safe Migration for user_favorites ---

    // 2. Rename old columns for legacy users (Rename is also safe in modern SQLite)
    const favColumns = db.prepare('PRAGMA table_info(user_favorites)').all();
    const favColumnNames = favColumns.map(c => c.name);

    if (favColumnNames.includes('userId') && !favColumnNames.includes('user_id')) {
        db.prepare('ALTER TABLE user_favorites RENAME COLUMN userId TO user_id').run();
    }
    if (favColumnNames.includes('video_id') && !favColumnNames.includes('track_url')) {
        db.prepare('ALTER TABLE user_favorites RENAME COLUMN video_id TO track_url').run();
    }
    if (favColumnNames.includes('title') && !favColumnNames.includes('track_title')) {
        db.prepare('ALTER TABLE user_favorites RENAME COLUMN title TO track_title').run();
    }
    if (favColumnNames.includes('artist') && !favColumnNames.includes('track_author')) {
        db.prepare('ALTER TABLE user_favorites RENAME COLUMN artist TO track_author').run();
    }
    if (!favColumnNames.includes('video_id')) {
        db.prepare('ALTER TABLE user_favorites ADD COLUMN video_id TEXT').run();
    }

    // --- Safe Migration for track_history ---
    const historyColumns = db.prepare('PRAGMA table_info(track_history)').all();
    const historyColumnNames = historyColumns.map(c => c.name);
    
    if (!historyColumnNames.includes('track_signature')) {
        db.prepare('ALTER TABLE track_history ADD COLUMN track_signature TEXT').run();
    }

    // --- Indexes for Performance ---
    db.prepare('CREATE INDEX IF NOT EXISTS idx_user_favorites_user_id ON user_favorites(user_id)').run();
    db.prepare('CREATE INDEX IF NOT EXISTS idx_track_history_user_id ON track_history(user_id)').run();

    console.log('🗄️ Database schema initialized and migrated.');
}

initSchema();

module.exports = { db, initSchema };
