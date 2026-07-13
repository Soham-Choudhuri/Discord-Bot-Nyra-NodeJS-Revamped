const { Events } = require('discord.js');

module.exports = {
    name: Events.ClientReady,
    once: true,
    async execute(client) {
        console.log(`\n🎵 Nyra is online as ${client.user.tag}`);
        console.log(`📊 Serving ${client.guilds.cache.size} guild(s)\n`);

        // Initialize Moonlink-Client Manager
        try {
            client.moonlink.init(client.user.id);
            console.log(`🔗 Moonlink Manager initialized.`);
        } catch (error) {
            console.error(`❌ Failed to initialize Moonlink Manager:`, error);
        }
    },
};
