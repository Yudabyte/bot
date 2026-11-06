// Bot Discord: terhubung ke gateway, menjalankan modul welcome & goodbye.
const { Client, GatewayIntentBits, Events, EmbedBuilder, AttachmentBuilder, SlashCommandBuilder, ContextMenuCommandBuilder, ApplicationCommandType, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
const db = require('./lib/db');
const { makeCtx, buildPayload } = require('./lib/message');
const { addPromotionToInteraction } = require('./lib/promotion');
const { createProfileCard, createProfileCardGif } = require('./lib/profile-card');
const { formatRupiah } = require('./lib/currency');
const { CHANNEL_NAME, CHANNEL_URL, getLatestYoutubeVideo } = require('./lib/youtube-feed');

const presenceIntentEnabled = process.env.DISCORD_ENABLE_PRESENCE_INTENT === 'true';
const MAX_BET = 100_000_000_000_000;

const client = new Client({
  // GuildMembers perlu diaktifkan di Developer Portal. GuildPresences hanya
  // dipakai jika intent tersebut memang sudah diaktifkan oleh pemilik bot.
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMembers,
    GatewayIntentBits.GuildMessages,
    ...(presenceIntentEnabled ? [GatewayIntentBits.GuildPresences] : []),
  ],
});

const INFO_GIF = 'https://media.giphy.com/media/8dgihcMeMPRV0VDEvV/giphy.gif';
const FP_ERROR_GIF = 'https://images-ext-1.discordapp.net/external/D1Ma8ELmlGE-dTm87yY5Xx_ZZmEY6QlX1Wx6484vXLQ/https/media.giphy.com/media/8dgihcMeMPRV0VDEvV/giphy.gif';
const INFO_COMMAND = new SlashCommandBuilder()
  .setName('infodaxia')
  .setDescription('Lihat profil, aktivitas, dan statistik member di server ini')
  .addUserOption((option) => option.setName('user').setDescription('Pilih member yang ingin dilihat').setRequired(false))
  // 0 = server install, 1 = user install (seperti aplikasi Discord modern).
  .setIntegrationTypes(0, 1)
  .setContexts(0, 1, 2)
  .toJSON();
const FP_COMMAND = new SlashCommandBuilder()
  .setName('fp')
  .setDescription('Lihat kartu profil dan aktivitas server terpantau')
  .addUserOption((option) => option.setName('user').setDescription('Pilih pengguna (opsional)').setRequired(false))
  .setIntegrationTypes(0, 1)
  .setContexts(0, 1, 2)
  .toJSON();
const PROFILE_COMMAND = new SlashCommandBuilder()
  .setName('profiledaxia')
  .setDescription('Buka profil lengkap member dari server ini')
  .addUserOption((option) => option.setName('user').setDescription('Member yang ingin dilihat').setRequired(false))
  .setIntegrationTypes(0, 1)
  .setContexts(0, 1, 2)
  .toJSON();
const DAXIA_COMMAND = new SlashCommandBuilder()
  .setName('daxia')
  .setDescription('Profil, saldo koin, slot, daily, dan leaderboard komunitas')
  .addSubcommand((command) => command
    .setName('slot')
    .setDescription('Putar tiga angka dan menangkan koin')
    .addIntegerOption((option) => option.setName('bet').setDescription('Taruhan Rupiah (maks. Rp. 100 triliun)').setMinValue(1).setMaxValue(MAX_BET).setRequired(false)))
  .addSubcommand((command) => command.setName('balance').setDescription('Lihat saldo koinmu'))
  .addSubcommand((command) => command.setName('daily').setDescription('Klaim bonus koin harian'))
  .addSubcommand((command) => command.setName('leaderboard').setDescription('Lihat leaderboard anggota terkaya'))
  .addSubcommand((command) => command
    .setName('profile')
    .setDescription('Lihat profil member dari server ini')
    .addUserOption((option) => option.setName('user').setDescription('Member yang ingin dilihat').setRequired(false)))
  .setIntegrationTypes(0, 1)
  .setContexts(0, 1, 2)
  .toJSON();
const PROFILE_CONTEXT_COMMAND = new ContextMenuCommandBuilder()
  .setName('Lihat Profil Dàxia')
  .setType(ApplicationCommandType.User)
  .setIntegrationTypes(0, 1)
  .setContexts(0, 1, 2)
  .toJSON();
const HELP_COMMAND = new SlashCommandBuilder()
  .setName('daxia-help')
  .setDescription('Lihat panduan fitur dan cara kerja Dàxia')
  .setIntegrationTypes(0, 1)
  .setContexts(0, 1, 2)
  .toJSON();
const MESSAGE_COMMAND = new SlashCommandBuilder()
  .setName('pesan')
  .setDescription('Kirim pesan yang diatur di dashboard ke channel ini')
  .setIntegrationTypes(0)
  .setContexts(0)
  .toJSON();
const DAXIA_YT_COMMAND = new SlashCommandBuilder()
  .setName('daxiayt')
  .setDescription('Lihat video terbaru dari channel YouTube Ideologi Akal')
  .setIntegrationTypes(0, 1)
  .setContexts(0, 1, 2)
  .toJSON();
const INFO_COMMANDS = [INFO_COMMAND, PROFILE_COMMAND, FP_COMMAND, DAXIA_COMMAND, PROFILE_CONTEXT_COMMAND, HELP_COMMAND, MESSAGE_COMMAND, DAXIA_YT_COMMAND];
const INFO_COMMAND_NAMES = new Set(INFO_COMMANDS.map((command) => command.name));

function formatDuration(joinedAt) {
  if (!joinedAt) return 'Belum diketahui';
  const totalMinutes = Math.max(1, Math.floor((Date.now() - joinedAt.getTime()) / 60000));
  const days = Math.floor(totalMinutes / 1440);
  const hours = Math.floor((totalMinutes % 1440) / 60);
  const minutes = totalMinutes % 60;
  const parts = [];
  if (days) parts.push(`${days} hari`);
  if (hours) parts.push(`${hours} jam`);
  if (!days && !hours) parts.push(`${minutes} menit`);
  return parts.join(' ');
}

function getActivityLevel(messages) {
  const level = Math.max(1, Math.floor(Math.sqrt(messages / 5)) + 1);
  const currentFloor = (level - 1) ** 2 * 5;
  const nextFloor = level ** 2 * 5;
  const progress = Math.max(0, Math.min(10, Math.floor(((messages - currentFloor) / Math.max(1, nextFloor - currentFloor)) * 10)));
  return { level, progress, nextFloor };
}

function statusLabel(status) {
  return ({ online: '🟢 Online', idle: '🌙 Idle', dnd: '⛔ Jangan diganggu', offline: '⚫ Offline' })[status] || '⚫ Offline';
}

function asDate(value) {
  if (!value) return null;
  if (value instanceof Date) return value;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

const activeSlots = new Set();
const SLOT_NUMBERS = ['0', '1', '2', '3', '4', '5', '6', '7', '8', '9'];
const DAY_MS = 24 * 60 * 60 * 1000;
const rupiah = formatRupiah;
function formatCommandText(template, values) {
  return String(template).replace(/\{([\w.]+)\}/g, (match, key) => (
    Object.prototype.hasOwnProperty.call(values, key) ? String(values[key]) : match
  ));
}
function commandColor(value, fallback) {
  return /^#[0-9a-f]{6}$/i.test(value || '') ? Number.parseInt(value.slice(1), 16) : fallback;
}
const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const activeMessageCommands = new Set();
const lastMessageCommandAt = new Map();
const countedMessageIds = new Set();
const featureClients = new Set();

function getProfileActivity(userId) {
  const activity = db.getProfileActivity(userId);
  activity.guilds = activity.guilds.map((entry) => {
    if (entry.guildName) return entry;
    for (const targetClient of featureClients) {
      const guild = targetClient.guilds.cache.get(entry.guildId);
      if (guild) return { ...entry, guildName: guild.name };
    }
    return entry;
  });
  return activity;
}

function slotEmbed(targetClient, numbers, { bet, balance, spinning = false, result = '', outcome = '', settings } = {}) {
  settings ||= db.getCommandSettings('default');
  const text = settings.messages;
  const reel = `╔══════════════════════╗\n║    〔 ${numbers.join(' 〕 〔 ')} 〕    ║\n╚══════════════════════╝`;
  return new EmbedBuilder()
    .setColor(spinning
      ? commandColor(settings.profileCard.colors.slotSpinning, 0x7c3aed)
      : outcome === 'jackpot'
        ? commandColor(settings.profileCard.colors.slotJackpot, 0xf59e0b)
        : outcome === 'pair'
          ? commandColor(settings.profileCard.colors.slotPair, 0x22c55e)
          : commandColor(settings.profileCard.colors.slotLoss, 0x4c1d95))
    .setAuthor({ name: 'DÀXIA ARCADE  •  SLOT ROOM', iconURL: targetClient.user?.displayAvatarURL({ size: 64 }) })
    .setTitle(spinning ? text.slotSpinningTitle : text.slotTitle)
    .setDescription(`**${text.slotHeading}**\n\n\`\`\`\n${reel}\n\`\`\`${result ? `\n${result}` : '\n⏳ Roda sedang berputar…'}`)
    .addFields(
      { name: text.slotBetLabel, value: `**${rupiah(bet)}**`, inline: true },
      { name: text.slotBalanceLabel, value: `**${rupiah(balance)}**`, inline: true },
      { name: text.slotPrizeLabel, value: `**3 sama = ${settings.economy.tripleMultiplier}×**\n**2 sama = ${settings.economy.pairMultiplier}×**`, inline: true },
    )
    .setFooter({ text: spinning ? text.slotSpinningFooter : text.slotFooter })
    .setTimestamp();
}

function slotComponents(bet, spinning) {
  return [new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId('daxia-slot-bet').setLabel(`BET ${Number(bet).toLocaleString('id-ID')}`).setStyle(ButtonStyle.Secondary).setDisabled(true),
    new ButtonBuilder().setCustomId('daxia-slot-state').setLabel(spinning ? '● SPINNING' : '✓ RESULT').setStyle(spinning ? ButtonStyle.Primary : ButtonStyle.Success).setDisabled(true),
  )];
}

function spinNumbers() {
  return Array.from({ length: 3 }, () => SLOT_NUMBERS[Math.floor(Math.random() * SLOT_NUMBERS.length)]);
}

async function handleEconomy(interaction, subcommand, targetClient) {
  const guildId = interaction.guildId;
  if (!guildId) return interaction.editReply({ content: 'Fitur koin hanya bisa digunakan di dalam server Discord.' });
  const settings = db.getCommandSettings(guildId);
  const { economy, messages } = settings;
  const userId = interaction.user.id;
  const wallet = db.getWallet(guildId, userId);

  if (subcommand === 'balance') {
    const embed = new EmbedBuilder()
      .setColor(commandColor(settings.profileCard.colors.balanceEmbed, 0x22c55e))
      .setTitle(messages.balanceTitle)
      .setDescription(formatCommandText(messages.balanceDescription, { userId, balance: rupiah(wallet.balance) }))
      .setFooter({ text: messages.balanceFooter });
    return interaction.editReply({ embeds: [embed] });
  }

  if (subcommand === 'daily') {
    const lastClaim = wallet.dailyClaimAt ? new Date(wallet.dailyClaimAt).getTime() : 0;
    const remaining = DAY_MS - (Date.now() - lastClaim);
    if (remaining > 0) {
      const next = Math.floor((Date.now() + remaining) / 1000);
      return interaction.editReply({ content: formatCommandText(messages.dailyWaitMessage, { next }) });
    }
    const updatedBalance = db.changeBalance(guildId, userId, economy.dailyReward);
    const updated = db.updateWallet(guildId, userId, { dailyClaimAt: new Date().toISOString() });
    const embed = new EmbedBuilder()
      .setColor(commandColor(settings.profileCard.colors.dailyEmbed, 0xfacc15))
      .setTitle(messages.dailyTitle)
      .setDescription(formatCommandText(messages.dailyDescription, { userId, reward: rupiah(economy.dailyReward) }))
      .addFields({ name: messages.dailyBalanceLabel, value: `**${rupiah(updatedBalance.balance)}**`, inline: true }, { name: messages.dailyNextLabel, value: '<t:' + Math.floor((Date.now() + DAY_MS) / 1000) + ':R>', inline: true })
      .setFooter({ text: messages.dailyFooter });
    return interaction.editReply({ embeds: [embed] });
  }

  if (subcommand === 'leaderboard') {
    const rows = db.getLeaderboard(guildId, 10);
    const description = rows.length
      ? rows.map((row, index) => `${index < 3 ? ['🥇', '🥈', '🥉'][index] : `**${index + 1}.**`} <@${row.userId}> — **${rupiah(row.balance)}**`).join('\n')
      : messages.leaderboardEmpty;
    const embed = new EmbedBuilder()
      .setColor(commandColor(settings.profileCard.colors.leaderboardEmbed, 0xa855f7))
      .setTitle(messages.leaderboardTitle)
      .setDescription(description)
      .setFooter({ text: messages.leaderboardFooter });
    return interaction.editReply({ embeds: [embed] });
  }

  if (subcommand === 'slot') {
    const bet = interaction.options.getInteger('bet') || economy.defaultBet;
    if (bet > economy.maxBet) return interaction.editReply({ content: formatCommandText(messages.slotMaxBetMessage, { maxBet: rupiah(economy.maxBet) }) });
    const lockKey = `${guildId}:${userId}`;
    if (activeSlots.has(lockKey)) return interaction.editReply({ content: messages.slotRunningMessage });
    if (wallet.balance < bet) {
      return interaction.editReply({ content: formatCommandText(messages.slotInsufficientBalance, { balance: rupiah(wallet.balance), bet: rupiah(bet) }) });
    }
    activeSlots.add(lockKey);
    try {
      db.changeBalance(guildId, userId, -bet);
      let numbers = spinNumbers();
      for (let frame = 0; frame < 3; frame += 1) {
        numbers = spinNumbers();
        await interaction.editReply({ content: formatCommandText(messages.slotSpinStatus, { numbers: numbers.join('  |  '), frame: frame + 1 }) });
        await interaction.editReply({ content: '', embeds: [slotEmbed(targetClient, numbers, { bet, balance: db.getWallet(guildId, userId).balance, spinning: true, settings, guildId })], components: slotComponents(bet, true) });
        await wait(650);
      }
      const [a, b, c] = numbers;
      const polishedTriple = a === b && b === c;
      const polishedPair = a === b || a === c || b === c;
      const polishedPayout = polishedTriple ? bet * economy.tripleMultiplier : polishedPair ? bet * economy.pairMultiplier : 0;
      const polishedUpdated = polishedPayout ? db.changeBalance(guildId, userId, polishedPayout) : db.getWallet(guildId, userId);
      const polishedResult = polishedTriple
        ? formatCommandText(messages.slotJackpot, { payout: rupiah(polishedPayout), bet: rupiah(bet) })
        : polishedPair
          ? formatCommandText(messages.slotPair, { payout: rupiah(polishedPayout), bet: rupiah(bet) })
          : formatCommandText(messages.slotLoss, { payout: rupiah(polishedPayout), bet: rupiah(bet) });
      return interaction.editReply({ content: '', embeds: [slotEmbed(targetClient, numbers, { bet, balance: polishedUpdated.balance, result: polishedResult, outcome: polishedTriple ? 'jackpot' : polishedPair ? 'pair' : 'loss', settings })], components: slotComponents(bet, false) });
    } finally {
      activeSlots.delete(lockKey);
    }
  }
}

async function registerInfoCommand(guild, targetClient = client) {
  try {
    const commands = await guild.commands.fetch();
    const existing = commands.filter((command) => INFO_COMMAND_NAMES.has(command.name));
    await Promise.all(existing.map((command) => guild.commands.delete(command.id)));
  } catch (e) {
    console.error(`[slash] gagal membersihkan command lama di ${guild.name}:`, e.message);
  }
}

async function registerInfoCommands(targetClient = client) {
  try {
    await targetClient.application.commands.set(INFO_COMMANDS);
    await Promise.all([...targetClient.guilds.cache.values()].map((guild) => registerInfoCommand(guild, targetClient)));
    console.log('[slash] /infodaxia, /daxia, dan menu profil user terdaftar sebagai global command');
    return true;
  } catch (e) {
    console.error(`[slash] gagal mendaftarkan global command untuk bot ${targetClient.user?.id || 'tidak diketahui'}:`, e.message);
    return false;
  }
}

async function registerPersonalInfoCommands(targetClient, ownerUserId) {
  try {
    const commands = targetClient.application.commands;
    const existing = await commands.fetch();
    for (const commandData of INFO_COMMANDS) {
      const current = existing.find((command) => command.name === commandData.name && command.type === commandData.type);
      if (current) await commands.edit(current.id, commandData);
      else await commands.create(commandData);
    }
    await Promise.all([...targetClient.guilds.cache.values()].map((guild) => registerInfoCommand(guild, targetClient)));
    console.log(`[slash] ${INFO_COMMANDS.length} command tersinkron untuk bot ${targetClient.user?.id} (pemilik akun ${ownerUserId})`);
    return true;
  } catch (error) {
    console.error(`[slash] gagal menyinkronkan command untuk bot ${targetClient.user?.id || 'tidak diketahui'}:`, error.message);
    return false;
  }
}

async function runModule(kind, guild, user, member, targetClient) {
  const cfg = db.getGuild(guild.id)[kind];
  if (!cfg || !cfg.enabled || !cfg.channelId) return;
  const channel = guild.channels.cache.get(cfg.channelId);
  if (!channel || !channel.isTextBased()) return;
  try {
    const payload = await buildPayload(cfg.message, makeCtx({ guild, user, member, channel, client: targetClient }));
    await channel.send(payload);
  } catch (e) {
    console.error(`[${kind}] gagal kirim di ${guild.name}:`, e.message);
  }
}

async function handleMessageCommand(interaction, targetClient, commandOwnerId = null) {
  const userId = interaction.user.id;
  const config = commandOwnerId
    ? db.getCommandMessagesForUser(commandOwnerId)
    : db.getCommandMessagesForUser(userId) || db.getCommandMessages();
  if (!Array.isArray(config?.messages) || !config.messages.length) {
    await interaction.reply({ content: 'Belum ada pesan yang diatur. Atur pesan melalui dashboard atau minta admin bot menyiapkan pesan bersama.', ephemeral: true });
    return;
  }
  const commandKey = `${commandOwnerId || 'shared'}:${userId}`;
  if (activeMessageCommands.has(commandKey)) {
    await interaction.reply({ content: 'Pengiriman pesanmu masih berlangsung. Tunggu sampai selesai.', ephemeral: true });
    return;
  }

  const cooldownMs = config.cooldownSeconds * 1000;
  const remainingMs = cooldownMs - (Date.now() - (lastMessageCommandAt.get(commandKey) || 0));
  if (remainingMs > 0) {
    const availableAt = Math.ceil((Date.now() + remainingMs) / 1000);
    await interaction.reply({ content: `Command masih cooldown. Bisa dipakai lagi <t:${availableAt}:R>.`, ephemeral: true });
    return;
  }

  activeMessageCommands.add(commandKey);
  let sent = 0;
  try {
    const interactionChannel = interaction.channel;
    if (interactionChannel && !interactionChannel.isTextBased()) throw new Error('Gunakan /pesan di channel teks server.');
    const channelId = interaction.channelId || interactionChannel?.id;
    if (!channelId) throw new Error('Jalankan /pesan di channel Discord, bukan di DM pribadi aplikasi.');
    await interaction.deferReply();

    const sourceGuild = interaction.guild;
    const guild = {
      id: interaction.guildId || sourceGuild?.id || 'user-install',
      name: sourceGuild?.name || 'server ini',
      memberCount: sourceGuild?.memberCount || 0,
      iconURL: (...args) => sourceGuild?.iconURL?.(...args) || null,
      emojis: sourceGuild?.emojis || { cache: new Map() },
    };
    const channel = interactionChannel || {
      id: channelId,
      name: 'channel tempat command digunakan',
      isTextBased: () => true,
    };
    const ctx = makeCtx({ guild, user: interaction.user, member: interaction.member, channel, client: targetClient });
    const payloads = [];
    for (const message of config.messages) payloads.push(await buildPayload(message, ctx));

    lastMessageCommandAt.set(commandKey, Date.now());
    await interaction.editReply(payloads[0]);
    sent = 1;
    for (const payload of payloads.slice(1)) {
      await wait(1000);
      await interaction.followUp(payload);
      sent += 1;
    }
  } catch (e) {
    console.error(`[slash] /pesan gagal untuk ${userId}:`, e.stack || e.message);
    const errorMessage = sent
      ? `Pengiriman terhenti setelah ${sent} dari ${config.messages.length} pesan. Coba lagi setelah cooldown.`
      : `Pesan gagal dikirim: ${e.message}`;
    try {
      if (sent) await interaction.followUp({ content: errorMessage, ephemeral: true });
      else if (interaction.deferred) await interaction.editReply({ content: errorMessage });
      else await interaction.reply({ content: errorMessage, ephemeral: true });
    } catch (reportError) {
      console.error(`[slash] gagal melaporkan error /pesan untuk ${userId}:`, reportError.message);
    }
  } finally {
    activeMessageCommands.delete(commandKey);
  }
}

function attachBotFeatures(targetClient, commandOwnerId = null) {
  featureClients.add(targetClient);
  if (!commandOwnerId) {
    targetClient.on(Events.GuildMemberAdd, (member) => runModule('welcome', member.guild, member.user, member, targetClient));
    targetClient.on(Events.GuildMemberRemove, (member) => runModule('goodbye', member.guild, member.user, member, targetClient));
  }

  targetClient.on(Events.GuildCreate, (guild) => registerInfoCommand(guild, targetClient));
  targetClient.on(Events.MessageCreate, (message) => {
    if (!message.guild || message.author.bot || countedMessageIds.has(message.id)) return;
    countedMessageIds.add(message.id);
    if (countedMessageIds.size > 5000) countedMessageIds.delete(countedMessageIds.values().next().value);
    db.incrementMemberMessages(
      message.guild.id,
      message.author.id,
      message.guild.name,
      message.channelId,
      message.channel?.name || message.channelId,
    );
  });

  targetClient.on(Events.InteractionCreate, async (interaction) => {
  const isPhotoProfile = interaction.isChatInputCommand() && interaction.commandName === FP_COMMAND.name;
  if (!isPhotoProfile) addPromotionToInteraction(interaction);
  if (interaction.isChatInputCommand() && interaction.commandName === MESSAGE_COMMAND.name) {
    await handleMessageCommand(interaction, targetClient, commandOwnerId);
    return;
  }
  const isLatestYoutubeCommand = interaction.isChatInputCommand() && interaction.commandName === DAXIA_YT_COMMAND.name;
  if (isLatestYoutubeCommand) {
    let video;
    try {
      await interaction.deferReply();
      video = await getLatestYoutubeVideo();
    } catch (error) {
      console.error('[slash] /daxiayt gagal memuat video terbaru:', error.message);
      const response = {
        content: `Video terbaru ${CHANNEL_NAME} tidak dapat dimuat saat ini. ${error.message}`,
        allowedMentions: { parse: [] },
      };
      if (interaction.deferred || interaction.replied) return interaction.editReply(response);
      return interaction.reply(response);
    }

    if (!video) {
      return interaction.editReply({
        content: `Belum ada video yang tersedia di channel ${CHANNEL_NAME}.`,
        allowedMentions: { parse: [] },
      });
    }

    const embed = new EmbedBuilder()
      .setColor(0xff0000)
      .setAuthor({ name: CHANNEL_NAME, url: CHANNEL_URL })
      .setTitle(video.title)
      .setURL(video.url)
      .setDescription(video.description || `Tonton video terbaru dari ${CHANNEL_NAME}.`)
      .setImage(video.thumbnailUrl)
      .setFooter({ text: 'Video terbaru dari channel YouTube' });
    if (video.publishedAt) embed.setTimestamp(new Date(video.publishedAt));

    return interaction.editReply({
      content: `🎬 Video terbaru ${CHANNEL_NAME}:\n${video.url}`,
      embeds: [embed],
      allowedMentions: { parse: [] },
    });
  }
  const isProfileContext = interaction.isUserContextMenuCommand() && interaction.commandName === PROFILE_CONTEXT_COMMAND.name;
  const isHelpChat = interaction.isChatInputCommand() && interaction.commandName === HELP_COMMAND.name;
  const daxiaSubcommand = interaction.isChatInputCommand() && interaction.commandName === 'daxia' ? interaction.options.getSubcommand() : null;
  const economyCommands = new Set(['slot', 'balance', 'daily', 'leaderboard']);
  const isEconomyChat = interaction.isChatInputCommand() && interaction.commandName === 'daxia' && economyCommands.has(daxiaSubcommand);
  const isProfileChat = interaction.isChatInputCommand() && (['infodaxia', 'profiledaxia'].includes(interaction.commandName) || (interaction.commandName === 'daxia' && daxiaSubcommand === 'profile'));
  if (!isProfileChat && !isProfileContext && !isPhotoProfile && !isHelpChat && !isEconomyChat) return;

  let fallbackUser = interaction.user;
  let profileCardCreated = false;
  try {
    await interaction.deferReply();
    if (isHelpChat) {
      const helpText = db.getCommandSettings(interaction.guildId || 'default').messages;
      const youtubeHelp = `🎬 YOUTUBE IDEOLOGI AKAL\n\`/daxiayt\` · Tampilkan video terbaru dari channel YouTube Ideologi Akal beserta link dan pratinjaunya.`;
      const configuredHelp = helpText.helpContent.includes('/daxiayt')
        ? helpText.helpContent
        : `${helpText.helpContent}\n\n${youtubeHelp}`;
      const helpPrefix = `${helpText.helpDescription}\n\n`;
      const availableContentLength = Math.max(0, 4096 - helpPrefix.length);
      const helpContent = configuredHelp.length <= availableContentLength
        ? configuredHelp
        : `${configuredHelp.slice(0, Math.max(0, availableContentLength - youtubeHelp.length - 2))}\n\n${youtubeHelp}`;
      const helpEmbed = new EmbedBuilder()
        .setColor(commandColor(db.getCommandSettings(interaction.guildId || 'default').profileCard.colors.helpEmbed, 0x167c68))
        .setAuthor({
          name: '東方  •  DÀXIA FIELD GUIDE',
          ...(targetClient.user ? { iconURL: targetClient.user.displayAvatarURL({ size: 128 }) } : {}),
        })
        .setTitle(helpText.helpTitle)
        .setDescription(`${helpPrefix}${helpContent}`)
        .setImage(INFO_GIF)
        .setFooter({ text: helpText.helpFooter })
        .setTimestamp();
      if (targetClient.user) helpEmbed.setThumbnail(targetClient.user.displayAvatarURL({ size: 256 }));
      return interaction.editReply({ embeds: [helpEmbed] });
    }
    if (isPhotoProfile) {
      const user = interaction.options.getUser('user') || interaction.user;
      fallbackUser = user;
      const renderStartedAt = Date.now();
      const activity = getProfileActivity(user.id);
      activity.walletBalance = interaction.guildId ? db.getWallet(interaction.guildId, user.id).balance : null;
      const activityReadyAt = Date.now();
      const profileCard = db.getCommandSettings(interaction.guildId || 'default').profileCard;
      const card = await createProfileCardGif(user, { activity, profileCard });
      const cardFile = () => new AttachmentBuilder(card, { name: 'profile.gif' });
      profileCardCreated = true;
      const renderReadyAt = Date.now();
      console.log(`[slash] /fp data ${activityReadyAt - renderStartedAt} ms; render ${renderReadyAt - activityReadyAt} ms; gambar ${Math.round(card.length / 1024)} KB.`);
      try {
        await interaction.editReply({ files: [cardFile()] });
      } catch (uploadError) {
        if (![50001, 50013].includes(uploadError.code)) throw uploadError;

        console.warn(`[slash] /fp unggah ke channel gagal (${uploadError.code}); mencoba DM ke ${user.id}.`);
        try {
          await user.send({ files: [cardFile()] });
        } catch (dmError) {
          throw new Error(
            `Discord menolak unggah kartu ke channel (kode ${uploadError.code}) dan pengiriman DM juga gagal: ${dmError.message}`,
            { cause: dmError },
          );
        }
        try {
          await interaction.editReply({
            content: 'Kartu profil sudah dikirim lewat DM. Cek pesan pribadi dari bot Dàxia.',
            embeds: [],
            files: [],
            components: [],
          });
        } catch (confirmationError) {
          console.error('[slash] /fp kartu terkirim lewat DM, tetapi konfirmasi interaksi gagal:', confirmationError.stack || confirmationError.message);
        }
        return;
      }
      console.log(`[slash] /fp terkirim dalam ${Date.now() - renderStartedAt} ms total.`);
      return;
    }
    if (isEconomyChat) return handleEconomy(interaction, daxiaSubcommand, targetClient);
    // Pada user-install, interaction.guild kadang kosong. Jika bot juga
    // terpasang di server tersebut, ambil guild lengkap dari guildId/cache.
    const guild = interaction.guild || (interaction.guildId ? targetClient.guilds.cache.get(interaction.guildId) : null);
    const installedInServer = Boolean(guild && targetClient.guilds.cache.has(guild.id));
    const selectedUser = isProfileContext
      ? interaction.targetUser
      : (['infodaxia', 'profiledaxia'].includes(interaction.commandName) || (interaction.commandName === 'daxia' && daxiaSubcommand === 'profile') ? interaction.options.getUser('user') : null);
    const user = selectedUser || interaction.user;
    fallbackUser = user || interaction.user;
    // User-install mengirim member sebagai data API terbatas; jangan memaksa
    // mengambilnya dari cache bot karena bot memang tidak ada di server itu.
    let selectedMember = isProfileContext ? interaction.targetMember : null;
    if (!selectedMember && interaction.isChatInputCommand() && (['infodaxia', 'profiledaxia'].includes(interaction.commandName) || (interaction.commandName === 'daxia' && daxiaSubcommand === 'profile'))) {
      try {
        // Ambil resolved member dari server tempat command dipanggil.
        selectedMember = interaction.options.getMember('user') || null;
      } catch {
        selectedMember = null;
      }
    }
    // Gunakan data yang sudah ada di interaction/cache. Ini aman untuk server
    // yang belum memasukkan bot maupun instalasi aplikasi ke akun pengguna.
    const member = selectedMember || (user.id === interaction.user.id ? interaction.member : null) || (guild ? guild.members.cache.get(user.id) : null);
    const liveMember = guild?.members?.cache?.get(user.id) || null;
    const liveStatus = liveMember?.presence?.status || member?.presence?.status || 'offline';
    const guildId = interaction.guildId || 'user-install';
    const stats = db.getMemberStats(guildId, user.id);
    const messages = Number(stats.messages || 0);
    const activity = getActivityLevel(messages);
    const progressBar = '▰'.repeat(activity.progress) + '▱'.repeat(10 - activity.progress);
    const onlineCount = installedInServer ? guild.members.cache.filter((item) => item.presence && item.presence.status !== 'offline').size : null;
    const roles = installedInServer && member?.roles?.cache
      ? member.roles.cache
        .filter((role) => role.id !== guild.id)
        .sort((a, b) => b.position - a.position)
        .first(6)
        .map((role) => `<@&${role.id}>`)
        .join(' ') || 'Tidak ada role khusus'
      : (Array.isArray(member?.roles) && member.roles.length ? member.roles.slice(0, 6).map((roleId) => `<@&${roleId}>`).join(' ') : 'Data role terbatas pada user-install');
    const joinedAt = asDate(member?.joinedAt || member?.joined_at);
    const joinedTimestamp = joinedAt ? Math.floor(joinedAt.getTime() / 1000) : null;
    const createdTimestamp = Math.floor((user.createdTimestamp || Date.now()) / 1000);
    const serverName = guild?.name || 'server ini';
    const displayName = user.globalName || user.username || 'Discord User';
    const avatarUrl = typeof user.displayAvatarURL === 'function' ? user.displayAvatarURL({ size: 256, extension: 'png' }) : null;
    const serverIcon = typeof guild?.iconURL === 'function' ? guild.iconURL({ size: 128 }) : null;
    const profileSettings = db.getCommandSettings(interaction.guildId || 'default').messages;
    const profileValues = {
      serverName,
      displayName,
      userId: user.id,
      status: statusLabel(liveStatus),
      onlineCount: onlineCount ?? 'terbatas',
      duration: formatDuration(joinedAt),
      joinedDate: joinedTimestamp ? `<t:${joinedTimestamp}:D>` : 'Data terbatas pada user-install',
      level: activity.level,
      progressBar,
      messages,
      roles,
      createdTimestamp,
      memberCount: guild?.memberCount ?? '—',
      channelCount: guild?.channels?.cache?.size ?? '—',
    };
    const embed = new EmbedBuilder()
      .setColor(commandColor(db.getCommandSettings(interaction.guildId || 'default').profileCard.colors.profileEmbed, 0x8b5cf6))
      .setAuthor({ name: formatCommandText(profileSettings.profileAuthor, profileValues), ...(serverIcon ? { iconURL: serverIcon } : {}) })
      .setTitle(formatCommandText(profileSettings.profileTitle, profileValues))
      .setDescription(formatCommandText(profileSettings.profileDescription, profileValues))
      .addFields(
        { name: profileSettings.profileStatusLabel, value: formatCommandText(profileSettings.profileStatusValue, profileValues), inline: true },
        { name: profileSettings.profileDurationLabel, value: formatCommandText(profileSettings.profileDurationValue, profileValues), inline: true },
        { name: profileSettings.profileActivityLabel, value: formatCommandText(profileSettings.profileActivityValue, profileValues), inline: true },
        { name: profileSettings.profileRolesLabel, value: formatCommandText(profileSettings.profileRolesValue || '{roles}', profileValues), inline: false },
        { name: profileSettings.profileAccountLabel, value: formatCommandText(profileSettings.profileAccountValue, profileValues), inline: true },
        { name: profileSettings.profileStatsLabel, value: installedInServer
          ? formatCommandText(profileSettings.profileStatsValue, profileValues)
          : profileSettings.profileLimitedStatsValue, inline: true },
      )
      .setImage(INFO_GIF)
      .setFooter({ text: profileSettings.profileFooter })
      .setTimestamp();

    if (avatarUrl) embed.setThumbnail(avatarUrl);

    await interaction.editReply({ embeds: [embed] });
  } catch (e) {
    console.error(`[slash] /${interaction.commandName} gagal:`, e.stack || e.message);
    if (isPhotoProfile) {
      try {
        const reason = String(e.message || 'Terjadi kesalahan yang tidak diketahui saat membuat atau mengirim kartu profil.').slice(0, 1200);
        const errorEmbed = new EmbedBuilder()
          .setColor(0xef4444)
          .setTitle(profileCardCreated ? 'Kartu foto profil gagal dikirim' : 'Kartu foto profil gagal dibuat')
          .setDescription(reason)
          .setImage(FP_ERROR_GIF);
        return await interaction.editReply({
          content: '',
          embeds: [errorEmbed],
          files: [],
          components: [],
        });
      } catch (reportError) {
        console.error('[slash] /fp gagal mengirim pesan error:', reportError.stack || reportError.message);
        return;
      }
    }
    // Fallback sengaja minim agar profil tetap tampil walaupun data server
    // tambahan ditolak Discord atau format member berbeda pada user-install.
    const name = fallbackUser?.globalName || fallbackUser?.username || 'Discord User';
    const id = fallbackUser?.id || interaction.user?.id || 'tidak diketahui';
    const fallbackEmbed = new EmbedBuilder()
      .setColor(0x8b5cf6)
      .setTitle(`✨ Profil ${name}`)
      .setDescription(`<@${id}>\nProfil dasar berhasil dimuat. Data role/status server dibatasi oleh izin Discord.`)
      .addFields({ name: 'ID Discord', value: `\`${id}\``, inline: true }, { name: 'Cara melihat lengkap', value: 'Pasang Dàxia ke server tersebut agar data member dan statistik server dapat dibaca.', inline: false })
      .setImage(INFO_GIF)
      .setFooter({ text: 'Dàxia • Profil komunitas' });
    if (fallbackUser && typeof fallbackUser.displayAvatarURL === 'function') fallbackEmbed.setThumbnail(fallbackUser.displayAvatarURL({ size: 256, extension: 'png' }));
    if (interaction.deferred || interaction.replied) await interaction.editReply({ embeds: [fallbackEmbed] });
    else await interaction.reply({ embeds: [fallbackEmbed] });
  }
  });
}

attachBotFeatures(client);

function startBot(token) {
  return new Promise((resolve, reject) => {
    client.once(Events.ClientReady, () => {
      console.log(`Bot online sebagai ${client.user.tag}`);
      client.user.setPresence({ activities: [{ name: '/daxia-help • Profil Discord', type: 0 }], status: 'online' });
      registerInfoCommands();
      resolve();
    });
    client.login(token).catch(reject);
  });
}

module.exports = {
  client,
  startBot,
  INFO_COMMANDS,
  FP_COMMAND,
  createProfileCard,
  createProfileCardGif,
  registerPersonalInfoCommands,
  attachBotFeatures,
};
