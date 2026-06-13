const { SlashCommandBuilder, EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, PermissionFlagsBits } = require('discord.js');
const config = require('../config.js');
const YouTube = require('../src/YouTube.js');
const LanguageManager = require('../src/LanguageManager');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('search')
        .setDescription('Search and select music on YouTube')
        .addStringOption(option =>
            option.setName('query')
                .setDescription('Music name or artist to search')
                .setRequired(true)
        ),

    async execute(interaction) {
        const query = interaction.options.getString('query');
        const guildId = interaction.guild.id;
        const member = interaction.member;
        const guild = interaction.guild;
        const channel = interaction.channel;

        try {
            await interaction.deferReply();

            // Temel kontroller
            const validationResult = await this.validateRequest(interaction, member, guild);
            if (!validationResult.success) {
                return await interaction.editReply({
                    content: validationResult.message
                });
            }

            // Arama yap
            const results = await YouTube.search(query, 9, guildId);

            if (!results || results.length === 0) {
                const noResultsMsg = await LanguageManager.getTranslation(guildId, 'commands.search.no_results');
                return await interaction.editReply({
                    content: noResultsMsg
                });
            }

            // Çalan müzik yoksa arama menüsü göster
            await this.showSearchMenu(interaction, results, query, guildId);

        } catch (error) {
            const errorMsg = await LanguageManager.getTranslation(guildId, 'commands.search.error_search');
            await interaction.editReply({
                content: errorMsg
            });
        }
    },

    async validateRequest(interaction, member, guild) {
        // Ses kanalı kontrolü
        if (!member.voice.channel) {
            const errorMsg = await LanguageManager.getTranslation(guild.id, 'commands.play.voice_channel_required');
            return { success: false, message: errorMsg };
        }

        // İzin kontrolü
        const permissions = member.voice.channel.permissionsFor(guild.members.me);
        if (!permissions.has(PermissionFlagsBits.Connect) || !permissions.has(PermissionFlagsBits.Speak)) {
            const errorMsg = await LanguageManager.getTranslation(guild.id, 'commands.play.no_permissions');
            return { success: false, message: errorMsg };
        }

        // Bot farklı kanalda mı kontrolü
        const botVoiceChannel = guild.members.me.voice.channel;
        if (botVoiceChannel && botVoiceChannel.id !== member.voice.channel.id) {
            const errorMsg = await LanguageManager.getTranslation(guild.id, 'commands.play.same_channel_required');
            return { success: false, message: errorMsg };
        }

        return { success: true };
    },

    async showSearchMenu(interaction, results, query, guildId) {
        // Get translations
        const searchTitle = await LanguageManager.getTranslation(guildId, 'commands.search.title', { query });
        const selectDescription = await LanguageManager.getTranslation(guildId, 'commands.search.select_description');
        const footerText = await LanguageManager.getTranslation(guildId, 'commands.search.footer', { count: results.length });
        const unknownTitle = await LanguageManager.getTranslation(guildId, 'commands.search.unknown_title');
        const unknownChannel = await LanguageManager.getTranslation(guildId, 'commands.search.unknown_channel');
        const unknownDuration = await LanguageManager.getTranslation(guildId, 'commands.search.unknown_duration');

        // Create embed
        const embed = new EmbedBuilder()
            .setTitle(searchTitle)
            .setColor(config.bot.embedColor)
            .setDescription(selectDescription)
            .setFooter({
                text: footerText
            })
            .setTimestamp();

        // Add field for each result
        const maxResults = Math.min(results.length, 9);
        for (let index = 0; index < maxResults; index++) {
            const result = results[index];
            const title = result.title || unknownTitle;
            const uploader = result.artist || unknownChannel;
            const duration = this.formatDuration(result?.duration, unknownDuration);
            const value = await LanguageManager.getTranslation(guildId, 'commands.search.result_line', {
                uploader,
                duration
            });

            embed.addFields({
                name: `${index + 1}. ${title}`,
                value,
                inline: false
            });
        }

        // Create buttons (2 rows, max 4+5 buttons)
        const row1 = new ActionRowBuilder();
        const row2 = new ActionRowBuilder();

        // 9 songs + 1 cancel = 10 buttons max
        let hasSecondRow = false;

        for (let i = 0; i < maxResults; i++) {
            const button = new ButtonBuilder()
                .setCustomId(`search_select_${i}`)
                .setLabel(`${i + 1}`)
                .setStyle(ButtonStyle.Secondary)

            // First 4 buttons in first row, rest in second row (max 5)
            if (i < 4) {
                row1.addComponents(button);
            } else if (i < 9) {
                row2.addComponents(button);
                hasSecondRow = true;
            }
        }

        // Add cancel button - always in first row
        const cancelButtonLabel = await LanguageManager.getTranslation(guildId, 'commands.search.button_cancel');
        const cancelButton = new ButtonBuilder()
            .setCustomId('search_cancel')
            .setLabel(cancelButtonLabel)
            .setStyle(ButtonStyle.Danger)
            .setEmoji('❌');

        row1.addComponents(cancelButton);

        const components = [row1];
        if (hasSecondRow && row2.components.length > 0) {
            components.push(row2);
        }

        // Store search results temporarily
        if (!global.searchResults) global.searchResults = new Map();
        global.searchResults.set(interaction.user.id, {
            query: query,
            results: results,
            timestamp: Date.now()
        });

        // Clean up after 5 minutes
        setTimeout(() => {
            global.searchResults.delete(interaction.user.id);
        }, 5 * 60 * 1000);

        await interaction.editReply({
            embeds: [embed],
            components: components
        });
    },

    formatDuration(seconds, unknownLabel = 'Unknown') {
        if (!seconds || seconds === 0) return unknownLabel;

        const hours = Math.floor(seconds / 3600);
        const minutes = Math.floor((seconds % 3600) / 60);
        const secs = Math.floor(seconds % 60);

        if (hours > 0) {
            return `${hours}:${minutes.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
        } else {
            return `${minutes}:${secs.toString().padStart(2, '0')}`;
        }
    }
    async executePrefix(message, args, client) {
        try {
            const query = args.join(' ');
            if (!query) return message.reply('❌ Vui lòng nhập tên bài hát!');

            const member = message.member;
            const guild = message.guild;
            const guildId = guild.id;

            if (!member.voice.channel) return message.reply('❌ Bạn cần vào voice channel trước!');

            const permissions = member.voice.channel.permissionsFor(guild.members.me);
            if (!permissions.has(PermissionFlagsBits.Connect) || !permissions.has(PermissionFlagsBits.Speak)) {
                return message.reply('❌ Bot không có quyền vào voice channel!');
            }

            const searchMsg = await message.reply('🔍 Đang tìm kiếm...');
            const results = await YouTube.search(query, 9, guildId);

            if (!results || results.length === 0) {
                return searchMsg.edit('❌ Không tìm thấy kết quả!');
            }

            const embed = new EmbedBuilder()
                .setTitle(`🔍 Kết quả: ${query}`)
                .setColor(config.bot.embedColor)
                .setDescription('Chọn bài bằng cách gõ số (1-9) trong 30 giây')
                .setTimestamp();

            const maxResults = Math.min(results.length, 9);
            for (let i = 0; i < maxResults; i++) {
                const r = results[i];
                embed.addFields({
                    name: `${i + 1}. ${r.title}`,
                    value: `${r.artist || 'Unknown'} • ${this.formatDuration(r.duration)}`,
                    inline: false
                });
            }

            await searchMsg.edit({ content: '', embeds: [embed] });

            // Chờ người dùng chọn số
            const filter = m => m.author.id === message.author.id && /^[1-9]$/.test(m.content);
            const collector = message.channel.createMessageCollector({ filter, time: 30000, max: 1 });

            collector.on('collect', async m => {
                const index = parseInt(m.content) - 1;
                if (index >= maxResults) return m.reply('❌ Số không hợp lệ!');

                const selected = results[index];
                await m.reply(`▶️ Đang thêm: **${selected.title}**`);

                let player = client.players.get(guild.id);
                if (!player) {
                    const MusicPlayer = require('../src/MusicPlayer');
                    player = new MusicPlayer(guild, message.channel, member.voice.channel);
                    client.players.set(guild.id, player);
                }
                player.voiceChannel = member.voice.channel;
                player.textChannel = message.channel;

                const MusicEmbedManager = require('../src/MusicEmbedManager');
                if (!client.musicEmbedManager) {
                    client.musicEmbedManager = new MusicEmbedManager(client);
                }

                await client.musicEmbedManager.handleMusicData(
                    guild.id,
                    { success: true, isPlaylist: false, tracks: [selected] },
                    member,
                    message
                );
            });

            collector.on('end', (collected) => {
                if (collected.size === 0) {
                    searchMsg.edit({ content: '⏰ Hết thời gian chọn!', embeds: [] });
                }
            });

        } catch (error) {
            console.error(error);
            message.reply('❌ Có lỗi xảy ra!');
        }
    },
};
