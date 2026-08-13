const queries = require('../database/queries');

const KEY_TO_QUERY_MAP = {
    'max_queue_size': 'updateMaxQueueSize',
    'verbose_mode': 'updateVerboseMode',
    'autoplay_seed': 'updateAutoplaySeed',
    'delete_timer': 'updateDeleteTimer',
    'cmd_channel': 'updateCmdChannel',
    'artist_memory': 'updateArtistMemory',
    'regex_blacklist': 'updateRegexBlacklist'
};

class ConfigManager {
    constructor() {
        // Map<guildId, ConfigObject>
        this.cache = new Map();
    }

    /**
     * Get config for a guild, from cache or DB.
     */
    get(guildId) {
        if (this.cache.has(guildId)) {
            return this.cache.get(guildId);
        }

        let config = queries.getSettings.get(guildId);

        if (!config) {
            // Save defaults to DB natively
            queries.upsertSettings.run(guildId);
            config = queries.getSettings.get(guildId);
        }

        this.cache.set(guildId, config);
        return config;
    }

    /**
     * Update a specific setting for a guild.
     */
    set(guildId, key, value) {
        const stmtName = KEY_TO_QUERY_MAP[key];
        
        if (stmtName && queries[stmtName]) {
            queries[stmtName].run(value, guildId);
        } else {
            console.error(`[ConfigManager] Missing prepared statement for key: ${key}`);
            return;
        }

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
