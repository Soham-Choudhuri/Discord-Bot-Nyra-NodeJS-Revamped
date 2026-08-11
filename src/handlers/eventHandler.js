const fs = require('fs');
const path = require('path');

/**
 * Dynamically loads all event listeners from src/events/.
 * Each event file must export:
 *   { name: string, once?: boolean, execute: async (...args) => {} }
 */
function loadEvents(client) {
    const eventsPath = path.join(__dirname, '..', 'events');
    const eventFiles = fs.readdirSync(eventsPath).filter(file => file.endsWith('.js'));

    let loadedCount = 0;
    for (const file of eventFiles) {
        try {
            const event = require(path.join(eventsPath, file));

            if (!event.name || !event.execute) {
                console.warn(`⚠️  Event file ${file} is missing 'name' or 'execute'. Skipping.`);
                continue;
            }

            const wrapper = async (...args) => {
                try {
                    await event.execute(...args, client);
                } catch (error) {
                    console.error(`❌ [Event Error] ${event.name}:`, error);
                }
            };

            if (event.once) {
                client.once(event.name, wrapper);
            } else {
                client.on(event.name, wrapper);
            }
            loadedCount++;
        } catch (error) {
            console.error(`Failed to load event ${file}`);
            continue;
        }
    }

    console.log(`📡 Loaded ${loadedCount} event listeners.`);
}

module.exports = { loadEvents };
