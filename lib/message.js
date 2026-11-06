// Mengubah pesan dari dashboard menjadi payload Discord + mengganti variabel.
const fs = require('fs');
const path = require('path');
const { AttachmentBuilder } = require('discord.js');
const { addPromotionLinks } = require('./promotion');

const UPLOAD_DIR = path.join(__dirname, '..', 'uploads');
const TZ = process.env.TIMEZONE || 'Asia/Jakarta';

function makeCtx({ guild, user, channel, client, member }) {
  const now = new Date();
  const roleList = member?.roles?.cache
    ? [...member.roles.cache.values()].filter((role) => role.id !== guild.id && !role.managed).sort((a, b) => b.position - a.position)
    : [];
  return {
    guild,
    'server.name': guild.name,
    'server.id': guild.id,
    'server.memberCount': String(guild.memberCount),
    'server.icon': guild.iconURL({ size: 256, extension: 'png' }) || '',
    'user.name': user.username,
    'user.mention': `<@${user.id}>`,
    'user.id': user.id,
    'user.avatar': user.displayAvatarURL({ size: 256, extension: 'png' }),
    'user.roles': roleList.map((role) => `<@&${role.id}>`).join(' ') || 'Tidak ada role khusus',
    'user.roleNames': roleList.map((role) => role.name).join(', ') || 'Tidak ada role khusus',
    'user.highestRole': roleList[0] ? `<@&${roleList[0].id}>` : 'Tidak ada role khusus',
    'channel.name': channel ? channel.name : '',
    'channel.mention': channel ? `<#${channel.id}>` : '',
    'bot.name': client.user ? client.user.username : '',
    date: now.toLocaleDateString('id-ID', { timeZone: TZ, day: 'numeric', month: 'long', year: 'numeric' }),
    time: now.toLocaleTimeString('id-ID', { timeZone: TZ, hour: '2-digit', minute: '2-digit' }),
  };
}

const vars = (str, ctx) =>
  typeof str === 'string' ? str.replace(/\{([a-zA-Z.]+)\}/g, (m, k) => (k in ctx ? ctx[k] : m)) : '';

const cut = (s, n) => (s.length > n ? s.slice(0, n - 1) + '…' : s);
const isUrl = (s) => /^(https?:\/\/|attachment:\/\/)/i.test(s);

async function buildPayload(message, ctx) {
  message = message || {};
  const files = new Map();

  // Gambar hasil unggah ("/uploads/xxx.png") dikirim sebagai lampiran agar selalu bisa tampil.
  const img = (value) => {
    const v = vars(value, ctx).trim();
    if (!v) return undefined;
    if (v.startsWith('/uploads/')) {
      const name = path.basename(v);
      const full = path.join(UPLOAD_DIR, name);
      if (!fs.existsSync(full)) return undefined;
      if (!files.has(name)) files.set(name, new AttachmentBuilder(full, { name }));
      return `attachment://${name}`;
    }
    return isUrl(v) ? v : undefined;
  };
  const link = (value) => {
    const v = vars(value, ctx).trim();
    return /^https?:\/\//i.test(v) ? v : undefined;
  };

  const content = cut(vars(message.content, ctx), 2000);
  const embeds = [];
  const e = message.embed;

  if (e && e.enabled) {
    const embed = {};
    const title = vars(e.title, ctx);
    const description = vars(e.description, ctx);
    if (title) embed.title = cut(title, 256);
    if (description) embed.description = cut(description, 4096);
    if (title && link(e.titleUrl)) embed.url = link(e.titleUrl);
    if (/^#?[0-9a-f]{6}$/i.test(e.color || '')) embed.color = parseInt(e.color.replace('#', ''), 16);

    const authorName = vars(e.authorName, ctx);
    if (authorName) embed.author = { name: cut(authorName, 256), icon_url: img(e.authorIcon) };

    const thumb = img(e.thumbnail);
    if (thumb) embed.thumbnail = { url: thumb };
    const image = img(e.image);
    if (image) embed.image = { url: image };

    const footerText = vars(e.footerText, ctx);
    if (footerText) embed.footer = { text: cut(footerText, 2048), icon_url: img(e.footerIcon) };
    if (e.timestamp) embed.timestamp = new Date().toISOString();

    const fields = (Array.isArray(e.fields) ? e.fields : [])
      .map((f) => ({ name: cut(vars(f.name, ctx), 256), value: cut(vars(f.value, ctx), 1024), inline: !!f.inline }))
      .filter((f) => f.name && f.value)
      .slice(0, 25);
    if (fields.length) embed.fields = fields;

    if (Object.keys(embed).length) embeds.push(embed);
  }

  const media = (Array.isArray(message.media) ? message.media : [])
    .map((item) => ({ url: vars(item && item.url, ctx).trim(), position: item && item.position || 'message' }))
    .filter((item) => item.url && (/^https?:\/\//i.test(item.url) || item.url.startsWith('/uploads/')))
    .slice(0, 10);
  for (const item of media) {
    const image = img(item.url);
    if (!image) continue;
    const mainEmbed = embeds[0];
    if (mainEmbed && item.position === 'thumbnail' && !mainEmbed.thumbnail) mainEmbed.thumbnail = { url: image };
    else if (mainEmbed && item.position === 'image' && !mainEmbed.image) mainEmbed.image = { url: image };
    else embeds.push({ image: { url: image } });
  }

  const stickers = (Array.isArray(message.stickers) ? message.stickers : [])
    .map((sticker) => String(sticker && sticker.id ? sticker.id : sticker))
    .filter(Boolean)
    .slice(0, 3);

  const buttons = (Array.isArray(message.buttons) ? message.buttons : [])
    .map((b) => {
      const button = { label: cut(vars(b.label, ctx), 80), url: link(b.url) };
      const requested = b && b.emoji && b.emoji.id ? ctx.guild?.emojis.cache.get(String(b.emoji.id)) : null;
      if (requested && requested.available !== false) button.emoji = { id: requested.id, name: requested.name, animated: requested.animated };
      return button;
    })
    .filter((b) => b.label && b.url)
    .slice(0, 5);

  if (!content && !embeds.length && !stickers.length) throw new Error('Pesan masih kosong. Isi teks, media, sticker, atau aktifkan embed.');

  const payload = {
    content: content || undefined,
    embeds,
    files: [...files.values()],
    stickers,
    // @everyone/@here tidak akan pernah ikut terpicu.
    allowedMentions: { parse: ['users', 'roles'] },
  };
  if (buttons.length) {
    payload.components = [
      { type: 1, components: buttons.map((b) => ({ type: 2, style: 5, label: b.label, url: b.url, ...(b.emoji ? { emoji: b.emoji } : {}) })) },
    ];
  }
  return addPromotionLinks(payload);
}

module.exports = { makeCtx, buildPayload };
