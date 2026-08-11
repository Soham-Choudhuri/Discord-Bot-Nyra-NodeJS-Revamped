const { SlashCommandBuilder, MessageFlags } = require('discord.js');
const { getVoiceConnection } = require('@discordjs/voice');
const configManager = require('../services/configManager');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('leave')
        .setDescription('Disconnect the bot from the voice channel'),

    async execute(interaction, client) {
        await interaction.deferReply({ flags: [MessageFlags.Ephemeral] });
        
        const player = client.moonlink.players.get(interaction.guildId);

        // Check if the bot is even in a voice channel
        const botVoice = interaction.guild.members.cache.get(client.user.id)?.voice?.channel;
        if (!botVoice && !player) {
            return interaction.editReply({
                content: '❌ I\'m not in a voice channel.',
            });
        }

        // Clean up Autoplay history if it exists
        if (player) {
            const autoplayManager = player.get('autoplayManager');
            if (autoplayManager) autoplayManager.playedIds.clear();
            player.set('favoritesQueue', null);
            player.set('autoplayManager', null);
            player.set('artistHistory', []);

            // This natively stops music, clears the queue, and disconnects the VC
            await player.destroy("Command triggered by user");
            
            const activePlayers = client.moonlink.players.all.filter(p => p.playing && p.guildId !== interaction.guildId);
            if (activePlayers.length === 0) client.user.setActivity();
        } else if (botVoice) {
            // Failsafe: if Discord thinks it's connected but Lavalink doesn't
            const connection = getVoiceConnection(interaction.guildId);
            if (connection) connection.destroy();
        }

        // Delete NP Message
        const config = configManager.get(interaction.guildId);
        if (config.np_message_id) {
            const channelId = player ? (player.textChannelId || player.voiceChannelId) : null;
            const textChannel = channelId ? client.channels.cache.get(channelId) : null;
            if (textChannel) {
                textChannel.messages.fetch(config.np_message_id).then(msg => {
                    if (msg && msg.deletable) msg.delete();
                }).catch(() => {});
            }
            configManager.set(interaction.guildId, 'np_message_id', null);
        }

        await interaction.editReply({ content: '👋 Stopped playback and disconnected from the voice channel.' });
    },
};
