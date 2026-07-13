const { db } = require('../database/schema');

class ConfigManager {
    constructor() {
        // Map<guildId, ConfigObject>
        this.cache = new Map();
        
        // Prepare statements for performance
        this.statements = {
            get: db.prepare('SELECT * FROM settings WHERE guild_id = ?'),
            upsert: db.prepare(`
                INSERT INTO settings (guild_id, max_queue_size, verbose_mode, autoplay_seed, delete_timer, cmd_channel, np_message_id, artist_memory, regex_blacklist)
                VALUES (@guild_id, @max_queue_size, @verbose_mode, @autoplay_seed, @delete_timer, @cmd_channel, @np_message_id, @artist_memory, @regex_blacklist)
                ON CONFLICT(guild_id) DO UPDATE SET
                    max_queue_size = excluded.max_queue_size,
                    verbose_mode = excluded.verbose_mode,
                    autoplay_seed = excluded.autoplay_seed,
                    delete_timer = excluded.delete_timer,
                    cmd_channel = excluded.cmd_channel,
                    np_message_id = excluded.np_message_id,
                    artist_memory = excluded.artist_memory,
                    regex_blacklist = excluded.regex_blacklist
            `),
            updateKey: (key) => db.prepare(`UPDATE settings SET ${key} = ? WHERE guild_id = ?`)
        };
    }

    /**
     * Get config for a guild, from cache or DB.
     */
    get(guildId) {
        if (this.cache.has(guildId)) {
            return this.cache.get(guildId);
        }

        let config = this.statements.get.get(guildId);

        if (!config) {
            // Default config
            config = {
                guild_id: guildId,
                max_queue_size: 50,
                verbose_mode: 1, // 1 = Verbose, 0 = Compact
                autoplay_seed: null,
                delete_timer: 0,
                cmd_channel: null,
                np_message_id: null,
                artist_memory: 5,
                regex_blacklist: '\\b(slowed|reverb|nightcore|sped\\s*up|chipmunk|mashup|tiktok|remix|8d|bass\\s*boosted|acoustic|demo|instrumental|karaoke|cover|live)\\b'
            };
            // Save defaults to DB
            this.statements.upsert.run(config);
        }

        this.cache.set(guildId, config);
        return config;
    }

    /**
     * Update a specific setting for a guild.
     */
    set(guildId, key, value) {
        // Update DB
        const stmt = db.prepare(`UPDATE settings SET ${key} = ? WHERE guild_id = ?`);
        stmt.run(value, guildId);

        // Update Cache
        const config = this.get(guildId);
        config[key] = value;
        this.cache.set(guildId, config);
    }

    /**
     * Clear cache for a guild (rarely used).
     */
    clearCache(guildId) {
        this.cache.delete(guildId);
    }
}

// Singleton instance
module.exports = new ConfigManager();
