const { Client, GatewayIntentBits, Events } = require('discord.js');
const db = require('./db');
const { makeCtx, buildPayload } = require('./message');
const { decryptSecret } = require('./secrets');
const { attachBotFeatures, registerPersonalInfoCommands } = require('../bot');

const clients = new Map();
const registeredCommands = new Map();

async function sendMemberMessage(userId, kind, member) {
  if (db.getGuildBotOwner(member.guild.id, kind) !== userId) return;
  const config = db.getGuild(member.guild.id)[kind];
  if (!config?.enabled || !config.channelId) return;

  try {
    const channel = await member.guild.channels.fetch(config.channelId);
    if (!channel?.isTextBased()) return;
    const payload = await buildPayload(config.message, makeCtx({
      guild: member.guild,
      user: member.user,
      member,
      channel,
      client: member.client,
    }));
    await channel.send(payload);
  } catch (error) {
    console.error(`[${kind}] Bot pribadi gagal mengirim pesan di server ${member.guild.id}:`, error.message);
  }
}

async function connectUserBot(userId, token) {
  const nextClient = new Client({
    intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMembers, GatewayIntentBits.GuildMessages],
  });
  let timeout;
  attachBotFeatures(nextClient, userId);

  try {
    const ready = new Promise((resolve, reject) => {
      nextClient.once(Events.ClientReady, resolve);
      nextClient.once(Events.Error, reject);
      nextClient.once(Events.ShardDisconnect, (closeEvent) => {
        if (closeEvent.code === 4014) reject(new Error('Aktifkan Server Members Intent di Discord Developer Portal untuk fitur welcome/goodbye otomatis.'));
      });
      timeout = setTimeout(() => reject(new Error('Waktu koneksi bot habis')), 20000);
    });
    nextClient.on(Events.GuildMemberAdd, (member) => {
      void sendMemberMessage(userId, 'welcome', member);
    });
    nextClient.on(Events.GuildMemberRemove, (member) => {
      void sendMemberMessage(userId, 'goodbye', member);
    });
    nextClient.on(Events.ShardError, (error) => {
      console.error(`Gateway bot pribadi user ${userId} mengalami error:`, error.message);
    });

    await nextClient.login(token);
    await ready;
    registeredCommands.set(userId, await registerPersonalInfoCommands(nextClient, userId));
    const previousClient = clients.get(userId);
    clients.set(userId, nextClient);
    if (previousClient) previousClient.destroy();
    return true;
  } catch (error) {
    registeredCommands.delete(userId);
    nextClient.destroy();
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}

function disconnectUserBot(userId) {
  const currentClient = clients.get(userId);
  if (!currentClient) return;
  clients.delete(userId);
  registeredCommands.delete(userId);
  currentClient.destroy();
}

const isUserBotConnected = (userId) => clients.get(userId)?.isReady() || false;
const areUserBotCommandsRegistered = (userId) => registeredCommands.get(userId) || false;
const getUserBotClient = (userId) => {
  const client = clients.get(userId);
  return client?.isReady() ? client : null;
};

function getConnectionStats() {
  const readyClients = [...clients.values()].filter((client) => client.isReady());
  const configuredBots = db.getPersonalBots().filter(([, config]) => config.encryptedToken).length;
  const pings = readyClients.map((client) => client.ws.ping).filter((ping) => Number.isFinite(ping) && ping >= 0);
  return {
    configured: configuredBots,
    connected: readyClients.length,
    disconnected: Math.max(0, configuredBots - readyClients.length),
    guilds: readyClients.reduce((total, client) => total + client.guilds.cache.size, 0),
    averagePingMs: pings.length
      ? pings.reduce((total, ping) => total + ping, 0) / pings.length
      : null,
  };
}

function connectSavedBots() {
  for (const [userId, config] of db.getPersonalBots()) {
    if (!config.encryptedToken) continue;
    try {
      void connectUserBot(userId, decryptSecret(config.encryptedToken)).catch((error) => {
        console.error(`Bot pribadi user ${userId} gagal tersambung:`, error.message);
      });
    } catch (error) {
      console.error(`Kredensial bot pribadi user ${userId} gagal dibuka:`, error.message);
    }
  }
}

module.exports = {
  connectUserBot,
  disconnectUserBot,
  isUserBotConnected,
  areUserBotCommandsRegistered,
  getUserBotClient,
  getConnectionStats,
  connectSavedBots,
};
