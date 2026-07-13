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
            regex_blacklist TEXT DEFAULT '\\b(slowed|reverb|nightcore|sped\\s*up|chipmunk|mashup|tiktok|remix|8d|bass\\s*boosted|acoustic|demo|instrumental|karaoke|cover|live)\\b'
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
            added_at DATETIME DEFAULT CURRENT_TIMESTAMP
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

    console.log('🗄️ Database schema initialized and migrated.');
}

module.exports = { db, initSchema };
