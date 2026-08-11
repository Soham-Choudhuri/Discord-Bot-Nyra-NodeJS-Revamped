const { Events } = require('discord.js');
const configManager = require('../services/configManager');

module.exports = {
    name: Events.GuildDelete,
    once: false,
    async execute(guild) {
        if (!guild || !guild.id) return;
        
        // 1. Clear cached configuration to prevent memory accumulation over extended uptimes
        configManager.clearCache(guild.id);
        console.log(`🧹 [LRU] Cleared in-memory cache for deleted guild: ${guild.id}`);
    },
};
