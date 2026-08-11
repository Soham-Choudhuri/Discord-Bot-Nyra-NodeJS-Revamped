const { REST, Routes, Collection } = require('discord.js');
const fs = require('fs');
const path = require('path');

async function loadCommands(client) {
    client.commands = new Collection();
    const commandsPath = path.join(__dirname, '..', 'commands');
    const commandFiles = fs.readdirSync(commandsPath).filter(file => file.endsWith('.js'));

    let commandData = [];

    for (const file of commandFiles) {
        try {
            const command = require(path.join(commandsPath, file));

            if (!command.data || !command.execute) {
                console.warn(`⚠️ Command file ${file} is missing 'data' or 'execute'. Skipping.`);
                continue;
            }

            client.commands.set(command.data.name, command);
            commandData.push(command.data.toJSON());
        } catch (error) {
            console.error(`❌ Failed to load command ${file}:`, error.message);
        }
    }

    const rest = new REST({ version: '10' }).setToken(process.env.DISCORD_TOKEN);

    try {
        console.log(`🔄 Syncing ${commandData.length} slash commands with Discord...`);

        await rest.put(
            Routes.applicationCommands(process.env.CLIENT_ID),
            { body: commandData }
        );

        console.log(`✅ Successfully synced ${commandData.length} slash commands.`);
    } catch (error) {
        console.error('❌ Failed to register slash commands:', error);
    } finally {
        // Absolute Memory Optimization: Instantly wipe the REST payloads from the V8 Heap
        commandData.length = 0;
        commandData = null;
        
        if (global.gc) global.gc();
    }
}

module.exports = { loadCommands };
