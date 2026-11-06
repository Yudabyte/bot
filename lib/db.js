// Penyimpanan sederhana berbasis file JSON (tanpa database tambahan).
const fs = require('fs');
const path = require('path');

const FILE = path.join(__dirname, '..', 'data', 'db.json');
let data = { guilds: {}, templates: {}, memberStats: {}, economy: {}, commandMessages: { messages: [], cooldownSeconds: 60 }, commandMessagesByUser: {}, personalBots: {}, guildBotOwners: {} };

const DEFAULT_COMMAND_SETTINGS = {
  economy: { dailyReward: 1000, defaultBet: 100, maxBet: 100_000_000_000_000, pairMultiplier: 2, tripleMultiplier: 10 },
  messages: {
    slotTitle: '🎰  PUTARAN SELESAI',
    slotSpinningTitle: '🎰  NEON REELS',
    slotHeading: 'LUCKY SPIN',
    slotBetLabel: '💸 TARUHAN',
    slotBalanceLabel: '💰 SALDO',
    slotPrizeLabel: '🎯 HADIAH',
    slotSpinningFooter: 'Dàxia Arcade • Jangan tutup Discord dulu',
    slotFooter: 'Dàxia Arcade • Semoga beruntung!',
    slotSpinStatus: '🎰 **Dàxia Slot**\n\n`[ {numbers} ]`\n\nMemutar roda {frame}/3…',
    slotJackpot: '🎉 JACKPOT! **+{payout}**',
    slotPair: '✨ Dua angka sama! **+{payout}**',
    slotLoss: '💨 Belum beruntung. **-{bet}**',
    slotRunningMessage: '🎰 Taruhanmu masih berjalan. Tunggu sampai putaran selesai.',
    slotInsufficientBalance: 'Saldo tidak cukup. Saldo kamu **{balance}**, taruhan **{bet}**.',
    slotMaxBetMessage: 'Taruhan maksimum server ini adalah **{maxBet}**.',
    balanceTitle: '💰 Saldo Dàxia',
    balanceDescription: '<@{userId}> memiliki **{balance}**.',
    balanceFooter: 'Saldo Rupiah ini dipakai bersama untuk slot, daily, dan game Dàxia.',
    dailyTitle: '🎁 Daily berhasil diklaim!',
    dailyDescription: '<@{userId}> mendapatkan **{reward}**.',
    dailyBalanceLabel: 'Saldo sekarang',
    dailyNextLabel: 'Klaim berikutnya',
    dailyWaitMessage: '⏳ Bonus daily sudah diambil. Bisa klaim lagi <t:{next}:R>.',
    dailyFooter: 'Kembali besok untuk bonus berikutnya.',
    leaderboardTitle: '🏆 Leaderboard Saldo Rupiah',
    leaderboardEmpty: 'Belum ada saldo yang tercatat.',
    leaderboardFooter: 'Leaderboard dihitung per server.',
    profileAuthor: '{serverName} • Dà xià Profile',
    profileTitle: '✨ Profil {displayName}',
    profileDescription: 'Selamat datang di kartu profil komunitasmu, <@{userId}>.\nAktivitasmu tercatat rapi di **{serverName}**.',
    profileStatusLabel: 'Status sekarang',
    profileDurationLabel: 'Lama di server',
    profileActivityLabel: 'Level aktivitas',
    profileRolesLabel: 'Role yang dimiliki',
    profileRolesValue: '{roles}',
    profileAccountLabel: 'Akun Discord',
    profileStatsLabel: 'Statistik server',
    profileStatusValue: '{status}\nOnline terdeteksi: **{onlineCount}**',
    profileDurationValue: '{duration}\n{joinedDate}',
    profileActivityValue: '**Level {level}**\n{progressBar}\n{messages} pesan tercatat',
    profileAccountValue: 'Dibuat <t:{createdTimestamp}:R>\nID: `{userId}`',
    profileStatsValue: '👥 **{memberCount}** anggota\n💬 **{channelCount}** channel',
    profileLimitedStatsValue: 'Mode user-install aktif\nTambahkan bot untuk statistik server realtime.',
    profileFooter: 'Dà xià • Info komunitas premium',
    helpTitle: '🐉 Pusat Panduan',
    helpDescription: 'Kenali fitur Dàxia dan langsung gunakan command yang kamu perlukan.',
    helpContent: '`/daxia-help` · Profil komunitas, kartu animasi, arcade Rupiah, video terbaru, dan automasi server\n\n📜 PROFIL & MEMBER\n`/infodaxia [user]` · Lihat status, role, level aktivitas, dan info server.\n`/profiledaxia [user]` atau `/daxia profile [user]` · Buka profil member.\nKlik kanan nama member → Apps → Lihat Profil Dàxia.\n\n🪷 KARTU PROFIL ANIMASI\n`/fp [user]` · Buat kartu GIF dengan avatar, saldo, statistik, dan hingga 3 server teraktif. Aktivitas pesan hanya dihitung saat bot aktif dan dapat melihat channel tersebut.\n\n🎰 DÀXIA ARCADE · KHUSUS SERVER\n`/daxia balance` · Cek saldo Rupiah server ini.\n`/daxia daily` · Klaim bonus koin harian.\n`/daxia slot [bet]` · Putar slot; dua angka sama memberi hadiah, tiga angka sama jackpot.\n`/daxia leaderboard` · Lihat 10 saldo tertinggi di server ini.\n\n🎬 YOUTUBE IDEOLOGI AKAL\n`/daxiayt` · Tampilkan video terbaru dari channel YouTube Ideologi Akal beserta link dan pratinjaunya.\n\n📣 PESAN & AUTOMASI\n`/pesan` · Kirim pesan yang disiapkan di dashboard.\nWelcome / goodbye dapat diatur di dashboard; bot perlu izin channel dan Server Members Intent.\n\nMODE & CATATAN\nSaldo arcade terpisah untuk setiap server. Statistik pesan hanya dihitung sejak bot mulai mencatat.',
    helpFooter: '玉龍指南  •  Panduan fitur Dàxia',
  },
  profileCard: {
    title: '社区档案',
    subtitle: 'DÀXIA  /  COMMUNITY PROFILE',
    statsTitle: 'SERVER TERAKTIF  /  JEJAK PESAN',
    periodLabel: '30 HARI TERAKHIR',
    weeklyLabel: 'PESAN • 7 HARI',
    monthlyLabel: 'PESAN • 30 HARI',
    activeDaysLabel: 'HARI AKTIF • 30H',
    serversLabel: 'SERVER TERPANTAU',
    totalLabel: 'TOTAL PESAN',
    balanceLabel: 'SALDO SLOT • SERVER',
    accountLabel: 'AKUN DISCORD',
    firstMessageLabel: 'PESAN PERTAMA',
    lastActiveLabel: 'AKTIF TERAKHIR',
    recentCountPrefix: '30h',
    totalCountPrefix: 'total',
    messagesUnit: 'pesan',
    channelEmpty: 'channel belum tercatat',
    idPrefix: 'ID',
    emptyMessage: 'Belum ada aktivitas pesan yang tercatat oleh bot.',
    trackedFooter: 'Hitungan aktif sejak bot mulai mencatat • isi pesan tidak disimpan • data harian tersimpan tanpa batas',
    noHistoryFooter: 'Riwayat harian dimulai saat bot melihat pesan berikutnya • total lama yang tersedia tetap ditampilkan',
    brand: '东方  •  DÀXIA',
    colors: {
      background: '#16080c',
      accent: '#d4a84f',
      detail: '#e74b3c',
      glow: '#ffd98a',
      slotSpinning: '#7c3aed',
      slotJackpot: '#f59e0b',
      slotPair: '#22c55e',
      slotLoss: '#4c1d95',
      balanceEmbed: '#22c55e',
      dailyEmbed: '#facc15',
      leaderboardEmbed: '#a855f7',
      profileEmbed: '#8b5cf6',
      helpEmbed: '#167c68',
    },
  },
};

function cloneCommandSettings(settings = DEFAULT_COMMAND_SETTINGS) {
  return {
    economy: { ...DEFAULT_COMMAND_SETTINGS.economy, ...(settings.economy || {}) },
    messages: { ...DEFAULT_COMMAND_SETTINGS.messages, ...(settings.messages || {}) },
    profileCard: {
      ...DEFAULT_COMMAND_SETTINGS.profileCard,
      ...(settings.profileCard || {}),
      colors: { ...DEFAULT_COMMAND_SETTINGS.profileCard.colors, ...(settings.profileCard?.colors || {}) },
    },
  };
}

try {
  if (fs.existsSync(FILE)) data = { ...data, ...JSON.parse(fs.readFileSync(FILE, 'utf8')) };
} catch (e) {
  console.error('Gagal membaca db.json, memulai dari kosong:', e.message);
}

let timer = null;
function save() {
  clearTimeout(timer);
  timer = setTimeout(() => {
    const tmp = FILE + '.tmp';
    fs.mkdirSync(path.dirname(FILE), { recursive: true });
    fs.writeFileSync(tmp, JSON.stringify(data, null, 2));
    fs.renameSync(tmp, FILE);
  }, 100);
}

const defaultMessage = (title, desc) => ({
  content: '',
  embed: {
    enabled: true,
    authorName: '{server.name}',
    authorIcon: '{server.icon}',
    title,
    titleUrl: '',
    description: desc,
    color: '#8b5cf6',
    thumbnail: '{user.avatar}',
    image: '',
    footerText: '{server.name} • {server.memberCount} anggota',
    footerIcon: '',
    timestamp: true,
    fields: [],
  },
  buttons: [],
});

function getGuild(id) {
  if (!data.guilds[id]) {
    data.guilds[id] = {
      welcome: {
        enabled: false,
        channelId: '',
        message: defaultMessage('Selamat datang di {server.name}!', 'Halo {user.mention}, senang kamu bergabung.\nJangan lupa baca aturan server ya.'),
      },
      goodbye: {
        enabled: false,
        channelId: '',
        message: defaultMessage('Sampai jumpa, {user.name}', '{user.name} telah meninggalkan {server.name}.'),
      },
      commands: cloneCommandSettings(),
    };
  } else {
    data.guilds[id].commands = cloneCommandSettings(data.guilds[id].commands);
  }
  return data.guilds[id];
}

function getCommandSettings(guildId) {
  return getGuild(guildId).commands;
}

function setCommandSettings(guildId, settings) {
  getGuild(guildId).commands = cloneCommandSettings(settings);
  save();
}

function setModule(id, kind, value) {
  getGuild(id)[kind] = value;
  save();
}

const getTemplates = (guildId) => data.templates[guildId] || [];

function setTemplates(guildId, list) {
  data.templates[guildId] = list;
  save();
}

function getCommandMessages() {
  const config = data.commandMessages || {};
  return {
    messages: Array.isArray(config.messages) ? config.messages : [],
    cooldownSeconds: Number.isInteger(config.cooldownSeconds) ? config.cooldownSeconds : 60,
    targetChannelId: typeof config.targetChannelId === 'string' ? config.targetChannelId : '',
  };
}

function setCommandMessages(config) {
  data.commandMessages = config;
  save();
}

function getCommandMessagesForUser(userId) {
  data.commandMessagesByUser ||= {};
  return data.commandMessagesByUser[userId] || null;
}

function setCommandMessagesForUser(userId, config) {
  data.commandMessagesByUser ||= {};
  data.commandMessagesByUser[userId] = config;
  save();
}

function getPersonalBot(userId) {
  data.personalBots ||= {};
  return data.personalBots[userId] || null;
}

function getPersonalBots() {
  data.personalBots ||= {};
  return Object.entries(data.personalBots);
}

function getGuildBotOwner(guildId, kind) {
  data.guildBotOwners ||= {};
  return data.guildBotOwners[guildId]?.[kind] || null;
}

function setGuildBotOwner(guildId, kind, userId) {
  data.guildBotOwners ||= {};
  data.guildBotOwners[guildId] ||= {};
  data.guildBotOwners[guildId][kind] = userId;
  save();
}

function getPersonalBotByClientId(clientId) {
  data.personalBots ||= {};
  const match = Object.entries(data.personalBots).find(([, config]) => config.clientId === clientId);
  return match ? { userId: match[0], ...match[1] } : null;
}

function setPersonalBot(userId, config) {
  data.personalBots ||= {};
  data.personalBots[userId] = config;
  save();
}

function removePersonalBot(userId) {
  data.personalBots ||= {};
  delete data.personalBots[userId];
  save();
}

function getMemberStats(guildId, userId) {
  return data.memberStats?.[guildId]?.[userId] || { messages: 0, firstSeenAt: null, lastMessageAt: null };
}

function incrementMemberMessages(guildId, userId, guildName, channelId, channelName) {
  data.memberStats ||= {};
  data.memberStats[guildId] ||= {};
  const current = getMemberStats(guildId, userId);
  const now = new Date();
  const nowIso = now.toISOString();
  const today = nowIso.slice(0, 10);
  const dailyMessages = { ...(current.dailyMessages || {}) };
  dailyMessages[today] = Number(dailyMessages[today] || 0) + 1;
  const channels = { ...(current.channels || {}) };
  if (channelId) {
    const currentChannel = channels[channelId] || { messages: 0, dailyMessages: {} };
    const channelDailyMessages = { ...(currentChannel.dailyMessages || {}) };
    channelDailyMessages[today] = Number(channelDailyMessages[today] || 0) + 1;
    channels[channelId] = {
      messages: Number(currentChannel.messages || 0) + 1,
      dailyMessages: channelDailyMessages,
      name: String(channelName || currentChannel.name || channelId).slice(0, 100),
      lastMessageAt: nowIso,
    };
  }
  data.memberStats[guildId][userId] = {
    messages: Number(current.messages || 0) + 1,
    firstSeenAt: current.firstSeenAt || nowIso,
    trackingStartedAt: current.trackingStartedAt || nowIso,
    lastMessageAt: nowIso,
    guildName: String(guildName || current.guildName || '').slice(0, 100),
    dailyMessages,
    channels,
  };
  save();
}

function getProfileActivity(userId, now = new Date()) {
  const activityDates = Array.from({ length: 30 }, (_, index) => new Date(now.getTime() - (29 - index) * 24 * 60 * 60 * 1000).toISOString().slice(0, 10));
  const weekDate = activityDates[23];
  const activeDates = new Set();
  let totalMessages = 0;
  let messagesLast7Days = 0;
  let messagesLast30Days = 0;
  let firstSeenAt = null;
  let lastActiveAt = null;
  let trackingStartedAt = null;
  let hasDailyHistory = false;

  const guilds = Object.entries(data.memberStats || {}).flatMap(([guildId, members]) => {
    const stats = members?.[userId];
    if (!stats) return [];

    const dailyMessages = stats.dailyMessages && typeof stats.dailyMessages === 'object' ? stats.dailyMessages : {};
    if (Object.keys(dailyMessages).length) hasDailyHistory = true;
    let guildMessagesLast7Days = 0;
    let guildMessagesLast30Days = 0;
    for (const date of activityDates) {
      const count = Math.max(0, Number(dailyMessages[date]) || 0);
      if (!count) continue;
      guildMessagesLast30Days += count;
      activeDates.add(date);
      if (date >= weekDate) guildMessagesLast7Days += count;
    }

    const guildFirstSeenAt = stats.firstSeenAt || null;
    const guildLastActiveAt = stats.lastMessageAt || null;
    const guildTrackingStartedAt = stats.trackingStartedAt || null;
    if (guildFirstSeenAt && (!firstSeenAt || new Date(guildFirstSeenAt) < new Date(firstSeenAt))) firstSeenAt = guildFirstSeenAt;
    if (guildLastActiveAt && (!lastActiveAt || new Date(guildLastActiveAt) > new Date(lastActiveAt))) lastActiveAt = guildLastActiveAt;
    if (guildTrackingStartedAt && (!trackingStartedAt || new Date(guildTrackingStartedAt) < new Date(trackingStartedAt))) trackingStartedAt = guildTrackingStartedAt;

    const messages = Math.max(0, Number(stats.messages) || 0);
    const channels = Object.entries(stats.channels || {}).flatMap(([channelId, channel]) => {
      if (!channel || typeof channel !== 'object') return [];
      const channelDailyMessages = channel.dailyMessages && typeof channel.dailyMessages === 'object' ? channel.dailyMessages : {};
      let channelMessagesLast30Days = 0;
      for (const date of activityDates) channelMessagesLast30Days += Math.max(0, Number(channelDailyMessages[date]) || 0);
      return [{
        channelId,
        name: String(channel.name || channelId),
        messages: Math.max(0, Number(channel.messages) || 0),
        messagesLast30Days: channelMessagesLast30Days,
        lastMessageAt: channel.lastMessageAt || null,
      }];
    }).sort((a, b) => b.messagesLast30Days - a.messagesLast30Days || b.messages - a.messages).slice(0, 3);
    totalMessages += messages;
    messagesLast7Days += guildMessagesLast7Days;
    messagesLast30Days += guildMessagesLast30Days;
    return [{
      guildId,
      guildName: String(stats.guildName || ''),
      messages,
      messagesLast7Days: guildMessagesLast7Days,
      messagesLast30Days: guildMessagesLast30Days,
      firstSeenAt: guildFirstSeenAt,
      lastActiveAt: guildLastActiveAt,
      hasDailyHistory: Object.keys(dailyMessages).length > 0,
      channels,
    }];
  }).sort((a, b) => b.messagesLast30Days - a.messagesLast30Days || b.messages - a.messages);

  return {
    guilds,
    guildCount: guilds.length,
    totalMessages,
    messagesLast7Days,
    messagesLast30Days,
    activeDaysLast30Days: activeDates.size,
    firstSeenAt,
    lastActiveAt,
    trackingStartedAt,
    hasDailyHistory,
  };
}

const DEFAULT_BALANCE = 0;
const OWNER_USER_ID = '1110287979525701632';
const OWNER_STARTING_BALANCE = 100_000_000_000_000;

function getWallet(guildId, userId) {
  data.economy ||= {};
  data.economy[guildId] ||= {};
  const current = data.economy[guildId][userId];
  if (!current) {
    data.economy[guildId][userId] = {
      balance: userId === OWNER_USER_ID ? OWNER_STARTING_BALANCE : DEFAULT_BALANCE,
      dailyClaimAt: null,
      ...(userId === OWNER_USER_ID ? { ownerStartingBalanceGranted: true } : {}),
    };
    save();
  } else if (userId === OWNER_USER_ID && current.ownerStartingBalanceGranted !== true) {
    data.economy[guildId][userId] = {
      ...current,
      balance: OWNER_STARTING_BALANCE,
      ownerStartingBalanceGranted: true,
    };
    save();
  }
  return data.economy[guildId][userId];
}

function updateWallet(guildId, userId, patch) {
  const wallet = getWallet(guildId, userId);
  data.economy[guildId][userId] = { ...wallet, ...patch };
  save();
  return data.economy[guildId][userId];
}

function changeBalance(guildId, userId, amount) {
  if (!Number.isSafeInteger(amount)) throw new Error('Perubahan saldo harus berupa bilangan Rupiah aman.');
  const wallet = getWallet(guildId, userId);
  const balance = Math.max(0, Math.min(Number.MAX_SAFE_INTEGER, Number(wallet.balance || 0) + amount));
  return updateWallet(guildId, userId, { balance });
}

function getLeaderboard(guildId, limit = 10) {
  return Object.entries(data.economy?.[guildId] || {})
    .map(([userId, wallet]) => ({ userId, balance: Number(wallet.balance || 0) }))
    .sort((a, b) => b.balance - a.balance)
    .slice(0, limit);
}

module.exports = {
  getGuild,
  getCommandSettings,
  setCommandSettings,
  setModule,
  getTemplates,
  setTemplates,
  getCommandMessages,
  setCommandMessages,
  getCommandMessagesForUser,
  setCommandMessagesForUser,
  getPersonalBot,
  getPersonalBots,
  getGuildBotOwner,
  setGuildBotOwner,
  getPersonalBotByClientId,
  setPersonalBot,
  removePersonalBot,
  getMemberStats,
  incrementMemberMessages,
  getProfileActivity,
  getWallet,
  updateWallet,
  changeBalance,
  getLeaderboard,
  defaultMessage,
};
