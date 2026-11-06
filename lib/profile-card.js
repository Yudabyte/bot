const fs = require('fs');
const path = require('path');
const sharp = require('sharp');
const { formatRupiah } = require('./currency');

const WIDTH = 1200;
const HEIGHT = 675;
const AVATAR_SIZE = 200;
const AVATAR_CX = 995;
const AVATAR_CY = 262;
const MAX_IMAGE_BYTES = 8 * 1024 * 1024;
const BANNER_PATH = path.join(__dirname, '..', 'public', 'assets', 'profile-banner.webp');
const IMAGE_HOSTS = new Set(['cdn.discordapp.com', 'media.discordapp.net']);

const SANS = "'Segoe UI', Arial, sans-serif";
const CJK = "'Noto Serif CJK SC', 'Noto Serif SC', 'Source Han Serif SC', 'Songti SC', 'SimSun', 'Microsoft YaHei', serif";

function escapeXml(value) {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&apos;');
}

function truncate(value, maxLength) {
  const text = String(value || '');
  return text.length > maxLength ? `${text.slice(0, maxLength - 1)}…` : text;
}

async function fetchDiscordImage(url, fetchImpl = fetch) {
  const parsedUrl = new URL(url);
  if (parsedUrl.protocol !== 'https:' || !IMAGE_HOSTS.has(parsedUrl.hostname)) {
    throw new Error('URL gambar profil bukan CDN Discord yang diizinkan.');
  }

  let response;
  try {
    response = await fetchImpl(parsedUrl, { signal: AbortSignal.timeout(6000) });
  } catch (error) {
    if (error.name === 'TimeoutError' || error.name === 'AbortError') {
      throw new Error('Pengambilan avatar dari CDN Discord melewati batas 6 detik.', { cause: error });
    }
    throw new Error(`Gagal mengambil avatar dari CDN Discord: ${error.message}`, { cause: error });
  }
  if (!response.ok) throw new Error(`CDN Discord gagal mengambil gambar profil (HTTP ${response.status}).`);
  const contentType = response.headers.get('content-type') || '';
  if (!/^image\/(?:png|jpe?g|webp|gif|avif)$/i.test(contentType)) {
    throw new Error('CDN Discord tidak mengembalikan format gambar yang didukung.');
  }
  const contentLength = Number(response.headers.get('content-length') || 0);
  if (contentLength > MAX_IMAGE_BYTES) throw new Error('Ukuran gambar profil melebihi batas 8 MB.');
  let buffer;
  try {
    buffer = Buffer.from(await response.arrayBuffer());
  } catch (error) {
    if (error.name === 'TimeoutError' || error.name === 'AbortError') {
      throw new Error('Unduhan avatar dari CDN Discord melewati batas 6 detik.', { cause: error });
    }
    throw new Error(`Gagal mengunduh avatar dari CDN Discord: ${error.message}`, { cause: error });
  }
  if (!buffer.length || buffer.length > MAX_IMAGE_BYTES) throw new Error('Ukuran gambar profil tidak valid atau melebihi 8 MB.');
  return buffer;
}

function formatCount(value) {
  return new Intl.NumberFormat('id-ID', { notation: 'compact', maximumFractionDigits: 1 }).format(Math.max(0, Number(value) || 0));
}

function formatLastActive(value) {
  if (!value) return 'Belum tercatat';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return 'Belum tercatat';
  const elapsed = Math.max(0, Date.now() - date.getTime());
  if (elapsed < 60_000) return 'Baru saja';
  if (elapsed < 60 * 60_000) return `${Math.floor(elapsed / 60_000)} mnt lalu`;
  if (elapsed < 24 * 60 * 60_000) return `${Math.floor(elapsed / (60 * 60_000))} jam lalu`;
  return new Intl.DateTimeFormat('id-ID', { day: 'numeric', month: 'short' }).format(date);
}

function formatShortDate(value) {
  if (!value) return 'Belum diketahui';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return 'Belum diketahui';
  return new Intl.DateTimeFormat('id-ID', { day: 'numeric', month: 'short', year: 'numeric' }).format(date);
}

// Awan keberuntungan (祥云) sederhana sebagai ornamen.
function cloud(x, y, scale = 1, opacity = 0.4) {
  return `<g transform="translate(${x} ${y}) scale(${scale})" fill="none" stroke="#e8c77d" stroke-opacity="${opacity}" stroke-width="1.4" stroke-linecap="round">
    <path d="M0 18c-8 0-9-11-1-13c1-9 14-11 18-3c5-8 20-5 20 5c9 0 11 11 2 11z"/>
    <path d="M10 13c2-4 7-4 9-1M24 12c2-3 6-3 8 0"/>
  </g>`;
}

function makeOverlay({ displayName, username, userId, createdAt, activity = {}, profileCard = {} }) {
  const escapedName = escapeXml(truncate(displayName, 30));
  const escapedUsername = escapeXml(truncate(username, 28));
  const escapedId = escapeXml(userId);
  const nameSize = Math.max(17, Math.min(30, Math.floor(268 / (Math.max(1, escapedName.length) * 0.6))));
  const numerals = ['壹', '贰', '叁'];
  const defaultLabels = {
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
  };
  const labels = Object.fromEntries(Object.entries(defaultLabels).map(([key, fallback]) => [
    key,
    escapeXml(truncate(profileCard[key] || fallback, 48)),
  ]));
  const validColor = (value, fallback) => /^#[0-9a-f]{6}$/i.test(value || '') ? value : fallback;
  const colors = {
    background: validColor(profileCard.colors?.background, '#16080c'),
    accent: validColor(profileCard.colors?.accent, '#d4a84f'),
    detail: validColor(profileCard.colors?.detail, '#e74b3c'),
  };

  const guilds = Array.isArray(activity.guilds) ? activity.guilds.slice(0, 3) : [];
  const guildRows = guilds.length
    ? guilds.map((guild, index) => {
      const y = 368 + index * 64;
      const name = escapeXml(truncate(guild.guildName || `Server ${guild.guildId}`, 28));
      const activityCount = guild.hasDailyHistory ? formatCount(guild.messagesLast30Days || 0) : '—';
      const totalCount = formatCount(guild.messages || 0);
      const lastActive = escapeXml(formatLastActive(guild.lastActiveAt));
      const channelSummary = guild.channels?.length
        ? guild.channels.slice(0, 2).map((channel) => `#${truncate(channel.name, 18)} ${formatCount(channel.messagesLast30Days)}`).join('  /  ')
        : labels.channelEmpty;
      const activitySummary = guild.hasDailyHistory
        ? `${labels.recentCountPrefix} ${activityCount}  ·  ${labels.totalCountPrefix} ${totalCount}  ·  ${escapeXml(channelSummary)}`
        : `${labels.totalCountPrefix} ${totalCount} ${labels.messagesUnit}  ·  ${escapeXml(channelSummary)}`;
      return `<rect x="70" y="${y}" width="750" height="54" rx="8" fill="#ffffff" fill-opacity="${index % 2 ? '.03' : '.06'}" stroke="#d6b56c" stroke-opacity=".18"/>
        <rect x="82" y="${y + 9}" width="36" height="36" rx="5" fill="url(#vermilion)" stroke="url(#gold)" stroke-width="1.2"/>
        <text x="100" y="${y + 35}" text-anchor="middle" fill="#fff1cf" font-family="${CJK}" font-size="22" font-weight="700">${numerals[index]}</text>
        <text x="132" y="${y + 24}" fill="#fff7e7" font-family="${SANS}" font-size="18" font-weight="700">${name}</text>
        <text x="132" y="${y + 43}" fill="#c7bda8" font-family="${SANS}" font-size="11">${activitySummary}</text>
        <text x="804" y="${y + 24}" text-anchor="end" fill="#e8c77d" font-family="${SANS}" font-size="13" font-weight="700">${lastActive}</text>
        <text x="804" y="${y + 43}" text-anchor="end" fill="#b8aa91" font-family="${SANS}" font-size="9" letter-spacing="1">${labels.lastActiveLabel}</text>`;
    }).join('')
    : `<rect x="70" y="368" width="750" height="54" rx="8" fill="#ffffff" fill-opacity=".05" stroke="#d6b56c" stroke-opacity=".18"/>
       <text x="445" y="401" text-anchor="middle" fill="#c7bda8" font-family="${SANS}" font-size="16">${labels.emptyMessage}</text>`;

  const recentActivity = activity.hasDailyHistory;
  const hasBalance = !(activity.walletBalance === null || activity.walletBalance === undefined);
  const tiles = [
    { col: 0, row: 0, glyph: '周', label: labels.weeklyLabel, value: recentActivity ? formatCount(activity.messagesLast7Days) : '—' },
    { col: 1, row: 0, glyph: '月', label: labels.monthlyLabel, value: recentActivity ? formatCount(activity.messagesLast30Days) : '—' },
    { col: 2, row: 0, glyph: '勤', label: labels.activeDaysLabel, value: recentActivity ? formatCount(activity.activeDaysLast30Days) : '—' },
    { col: 0, row: 1, glyph: '域', label: labels.serversLabel, value: formatCount(activity.guildCount) },
    { col: 1, row: 1, glyph: '总', label: labels.totalLabel, value: formatCount(activity.totalMessages) },
    { col: 2, row: 1, glyph: '金', label: labels.balanceLabel, value: hasBalance ? formatRupiah(activity.walletBalance) : '—' },
  ].map(({ col, row, glyph, label, value }) => {
    const x = 70 + col * 256;
    const y = 136 + row * 92;
    const safeValue = escapeXml(value);
    const valueSize = String(value).length > 8 ? 22 : 30;
    return `<rect x="${x}" y="${y}" width="238" height="78" rx="8" fill="#ffffff" fill-opacity=".055" stroke="#d6b56c" stroke-opacity=".28"/>
      <rect x="${x}" y="${y + 12}" width="3" height="54" fill="url(#vermilion)"/>
      <text x="${x + 222}" y="${y + 68}" text-anchor="end" fill="#e8c77d" fill-opacity=".12" font-family="${CJK}" font-size="58" font-weight="700">${glyph}</text>
      <text x="${x + 18}" y="${y + 26}" fill="#c9bda6" font-family="${SANS}" font-size="10" font-weight="700" letter-spacing="1">${label}</text>
      <text x="${x + 18}" y="${y + 62}" fill="#fff1cf" font-family="${SANS}" font-size="${valueSize}" font-weight="700">${safeValue}</text>`;
  }).join('');

  return Buffer.from(`<svg width="${WIDTH}" height="${HEIGHT}" xmlns="http://www.w3.org/2000/svg">
    <defs>
      <linearGradient id="shade" x1="0" y1="0" x2="1" y2="1">
        <stop offset="0" stop-color="${colors.background}" stop-opacity=".62"/>
        <stop offset=".55" stop-color="#110a10" stop-opacity=".86"/>
        <stop offset="1" stop-color="#080b12" stop-opacity=".95"/>
      </linearGradient>
      <linearGradient id="gold" x1="0" y1="0" x2="1" y2="1">
        <stop offset="0" stop-color="#ffe6a1"/>
        <stop offset=".5" stop-color="${colors.accent}"/>
        <stop offset="1" stop-color="#a66a31"/>
      </linearGradient>
      <linearGradient id="vermilion" x1="0" y1="0" x2="1" y2="1">
        <stop offset="0" stop-color="${colors.detail}"/>
        <stop offset="1" stop-color="#9c202d"/>
      </linearGradient>
      <radialGradient id="glow" cx="${AVATAR_CX}" cy="${AVATAR_CY}" r="230" gradientUnits="userSpaceOnUse">
        <stop offset="0" stop-color="#ffd98a" stop-opacity=".26"/>
        <stop offset="1" stop-color="#ffd98a" stop-opacity="0"/>
      </radialGradient>
      <pattern id="meander" width="16" height="8" patternUnits="userSpaceOnUse">
        <path d="M0 7V1h12v5H4V3.5h5" fill="none" stroke="#e8c77d" stroke-opacity=".55" stroke-width="1"/>
      </pattern>
    </defs>

    <rect width="${WIDTH}" height="${HEIGHT}" fill="url(#shade)"/>
    <rect width="${WIDTH}" height="${HEIGHT}" fill="url(#glow)"/>

    <!-- Bingkai -->
    <rect x="24" y="22" width="1152" height="631" rx="27" fill="#0a0b12" fill-opacity=".36" stroke="url(#gold)" stroke-opacity=".78" stroke-width="2"/>
    <rect x="37" y="35" width="1126" height="605" rx="20" fill="none" stroke="#f4dfb1" stroke-opacity=".2"/>
    <path d="M48 114V48h66M1086 48h66v66M48 561v66h66M1086 627h66v-66" fill="none" stroke="url(#gold)" stroke-width="4"/>
    <rect x="130" y="44" width="940" height="8" fill="url(#meander)"/>
    <rect x="130" y="624" width="940" height="8" fill="url(#meander)"/>

    <!-- Header: stempel + judul tengah -->
    <rect x="64" y="60" width="44" height="44" rx="6" fill="url(#vermilion)" stroke="url(#gold)" stroke-width="1.5"/>
    <text x="86" y="92" text-anchor="middle" fill="#fff1cf" font-family="${CJK}" font-size="28" font-weight="700">大</text>
    <rect x="1092" y="60" width="44" height="44" rx="6" fill="url(#vermilion)" stroke="url(#gold)" stroke-width="1.5"/>
    <text x="1114" y="92" text-anchor="middle" fill="#fff1cf" font-family="${CJK}" font-size="28" font-weight="700">侠</text>

    <path d="M130 78H465M735 78H1070" stroke="url(#gold)" stroke-opacity=".62" stroke-width="1"/>
    <polygon points="470,73 475,78 470,83 465,78" fill="#d4a84f"/>
    <polygon points="730,73 735,78 730,83 725,78" fill="#d4a84f"/>
    <text x="600" y="90" text-anchor="middle" fill="#efcf8a" font-family="${CJK}" font-size="30" font-weight="700" letter-spacing="10">${labels.title}</text>
    <text x="600" y="110" text-anchor="middle" fill="#ddc693" font-family="${SANS}" font-size="12" font-weight="700" letter-spacing="5">${labels.subtitle}</text>

    <!-- Panel kanan: avatar + identitas -->
    <rect x="850" y="128" width="290" height="440" rx="22" fill="#ffffff" fill-opacity=".04" stroke="url(#gold)" stroke-opacity=".5" stroke-width="1.4"/>
    <circle cx="${AVATAR_CX}" cy="${AVATAR_CY}" r="140" fill="none" stroke="#e8c77d" stroke-opacity=".3" stroke-dasharray="2 6"/>
    <circle cx="${AVATAR_CX}" cy="${AVATAR_CY}" r="119" fill="none" stroke="url(#gold)" stroke-width="2"/>
    <circle cx="${AVATAR_CX}" cy="${AVATAR_CY}" r="111" fill="url(#vermilion)" stroke="#f7e3bc" stroke-opacity=".6" stroke-width="2"/>
    <circle cx="${AVATAR_CX}" cy="${AVATAR_CY}" r="99" fill="#0a0b12"/>

    <text x="${AVATAR_CX}" y="418" text-anchor="middle" fill="#fff5df" font-family="${SANS}" font-size="${nameSize}" font-weight="700">${escapedName}</text>
    <text x="${AVATAR_CX}" y="441" text-anchor="middle" fill="#e8c77d" font-family="${SANS}" font-size="15">@${escapedUsername}</text>
    <rect x="870" y="454" width="250" height="26" rx="13" fill="url(#vermilion)" fill-opacity=".72" stroke="#f4dfb1" stroke-opacity=".3"/>
    <text x="${AVATAR_CX}" y="472" text-anchor="middle" fill="#fff1dc" font-family="${SANS}" font-size="11" font-weight="700" letter-spacing="1">${labels.idPrefix}  ${escapedId}</text>

    <path d="M870 497h250" stroke="#f4dfb1" stroke-opacity=".2"/>
    <text x="930" y="516" text-anchor="middle" fill="#c9bda6" font-family="${SANS}" font-size="9" font-weight="700" letter-spacing="1">${labels.accountLabel}</text>
    <text x="930" y="534" text-anchor="middle" fill="#fff1cf" font-family="${SANS}" font-size="12">${escapeXml(formatShortDate(createdAt))}</text>
    <path d="M995 508v34" stroke="#f4dfb1" stroke-opacity=".2"/>
    <text x="1062" y="516" text-anchor="middle" fill="#c9bda6" font-family="${SANS}" font-size="9" font-weight="700" letter-spacing="1">${labels.firstMessageLabel}</text>
    <text x="1062" y="534" text-anchor="middle" fill="#e8c77d" font-family="${SANS}" font-size="12">${escapeXml(formatShortDate(activity.firstSeenAt))}</text>
    ${cloud(866, 540, 0.8, 0.35)}
    ${cloud(1074, 540, 0.8, 0.35)}

    <!-- Panel kiri: statistik -->
    ${tiles}

    <!-- Server teraktif -->
    <polygon points="76,334 82,340 76,346 70,340" fill="url(#vermilion)" stroke="#d4a84f" stroke-width="1"/>
    <text x="92" y="345" fill="#f0d79d" font-family="${SANS}" font-size="14" font-weight="700" letter-spacing="2">${labels.statsTitle}</text>
    <text x="820" y="345" text-anchor="end" fill="#b8aa91" font-family="${SANS}" font-size="11">${labels.periodLabel}</text>
    <path d="M70 355h750" stroke="url(#gold)" stroke-opacity=".5"/>
    ${guildRows}

    <!-- Footer -->
    <path d="M70 596h1060" stroke="#f4dfb1" stroke-opacity=".18"/>
    <text x="70" y="616" fill="#b8aa91" font-family="${SANS}" font-size="11">${recentActivity ? labels.trackedFooter : labels.noHistoryFooter}</text>
    <text x="1130" y="616" text-anchor="end" fill="#e6c981" font-family="${CJK}" font-size="12" letter-spacing="2">${labels.brand}</text>
  </svg>`);
}

// ---------------------------------------------------------------------------
// Render dasar (statis, ukuran penuh) -> PNG buffer
// ---------------------------------------------------------------------------
async function renderBase(user, { fetchImpl = fetch, bannerPath = BANNER_PATH, activity, profileCard } = {}) {
  if (!user || typeof user.displayAvatarURL !== 'function' || !/^\d{17,20}$/.test(String(user.id || ''))) {
    throw new Error('Data pengguna Discord tidak valid untuk membuat kartu profil.');
  }
  const avatarUrl = user.displayAvatarURL({ size: 256, extension: 'webp', forceStatic: true });
  const [avatarBuffer, bannerBuffer] = await Promise.all([
    fetchDiscordImage(avatarUrl, fetchImpl),
    fs.promises.readFile(bannerPath),
  ]);
  const avatarMask = await sharp(Buffer.from(`<svg width="${AVATAR_SIZE}" height="${AVATAR_SIZE}" xmlns="http://www.w3.org/2000/svg"><circle cx="${AVATAR_SIZE / 2}" cy="${AVATAR_SIZE / 2}" r="${AVATAR_SIZE / 2}" fill="white"/></svg>`))
    .png()
    .toBuffer();
  const avatar = await sharp(avatarBuffer, { limitInputPixels: 40_000_000 })
    .rotate()
    .resize(AVATAR_SIZE, AVATAR_SIZE, { fit: 'cover', position: 'attention' })
    .composite([{ input: avatarMask, blend: 'dest-in' }])
    .png()
    .toBuffer();
  const displayName = user.globalName || user.username || 'Discord User';
  const username = user.username || displayName;
  const overlay = makeOverlay({ displayName, username, userId: String(user.id), createdAt: user.createdTimestamp, activity, profileCard });

  return sharp(bannerBuffer, { limitInputPixels: 40_000_000 })
    .rotate()
    .resize(WIDTH, HEIGHT, { fit: 'cover', position: 'attention' })
    .composite([
      { input: overlay },
      { input: avatar, left: AVATAR_CX - AVATAR_SIZE / 2, top: AVATAR_CY - AVATAR_SIZE / 2 },
    ])
    .png()
    .toBuffer();
}

// Versi statis (JPEG) -- tetap tersedia sebagai fallback.
async function createProfileCard(user, options = {}) {
  const base = await renderBase(user, options);
  return sharp(base).jpeg({ quality: 86 }).toBuffer();
}

// ---------------------------------------------------------------------------
// Animasi GIF: kilau menyapu, bingkai & cincin avatar berdenyut, kerlip bintang
// ---------------------------------------------------------------------------
const GIF_WIDTH = 960;
const GIF_HEIGHT = Math.round((GIF_WIDTH * HEIGHT) / WIDTH);
const GIF_FRAMES = 16;
const GIF_DELAY_MS = 70;

// [x, y, fase, ukuran]
const SPARKLES = [
  [86, 82, 0.0, 1.0],
  [1114, 82, 0.5, 1.0],
  [352, 150, 0.12, 0.8],
  [760, 128, 0.3, 0.9],
  [905, 170, 0.62, 1.3],
  [1090, 205, 0.2, 1.1],
  [880, 340, 0.45, 1.0],
  [1105, 395, 0.78, 1.2],
  [60, 330, 0.35, 0.8],
  [540, 330, 0.88, 0.8],
  [800, 585, 0.7, 0.9],
  [180, 585, 0.15, 0.9],
];

function sparkle(x, y, strength, size) {
  const s = (0.5 + strength * 1.1) * size;
  return `<g transform="translate(${x} ${y}) scale(${s.toFixed(2)})" opacity="${Math.min(1, strength + 0.1).toFixed(2)}">
    <path d="M0 -12L2.4 -2.4L12 0L2.4 2.4L0 12L-2.4 2.4L-12 0L-2.4 -2.4Z" fill="#fff6d6"/>
    <circle r="3" fill="#ffffff"/>
  </g>`;
}

function makeFxOverlay(t, profileCard = {}) {
  const TAU = Math.PI * 2;
  const accent = /^#[0-9a-f]{6}$/i.test(profileCard.colors?.glow || '') ? profileCard.colors.glow : '#ffd98a';
  const pulse = 0.5 + 0.5 * Math.sin(TAU * t);
  const sweepX = -260 + t * (WIDTH + 520);
  const stars = SPARKLES.map(([x, y, phase, size]) => {
    const strength = Math.max(0, Math.sin(TAU * (t + phase))) ** 3;
    return strength < 0.03 ? '' : sparkle(x, y, strength, size);
  }).join('');

  return Buffer.from(`<svg width="${GIF_WIDTH}" height="${GIF_HEIGHT}" viewBox="0 0 ${WIDTH} ${HEIGHT}" xmlns="http://www.w3.org/2000/svg">
    <defs>
      <clipPath id="card"><rect x="24" y="22" width="1152" height="631" rx="27"/></clipPath>
      <linearGradient id="sweep" x1="0" y1="0" x2="1" y2="0">
        <stop offset="0" stop-color="#fff2c4" stop-opacity="0"/>
        <stop offset=".5" stop-color="#fff2c4" stop-opacity=".34"/>
        <stop offset="1" stop-color="#fff2c4" stop-opacity="0"/>
      </linearGradient>
      <filter id="blur" x="-20%" y="-20%" width="140%" height="140%"><feGaussianBlur stdDeviation="7"/></filter>
      <filter id="blurSm" x="-30%" y="-30%" width="160%" height="160%"><feGaussianBlur stdDeviation="4"/></filter>
    </defs>

    <g clip-path="url(#card)">
      <g transform="translate(${sweepX.toFixed(1)} 0) skewX(-22)">
        <rect x="0" y="0" width="190" height="${HEIGHT}" fill="url(#sweep)"/>
        <rect x="215" y="0" width="38" height="${HEIGHT}" fill="url(#sweep)" opacity=".6"/>
      </g>
    </g>

    <rect x="24" y="22" width="1152" height="631" rx="27" fill="none" stroke="${accent}" stroke-width="6" stroke-opacity="${(0.18 + 0.32 * pulse).toFixed(2)}" filter="url(#blur)"/>
    <rect x="24" y="22" width="1152" height="631" rx="27" fill="none" stroke="${accent}" stroke-width="2" stroke-opacity="${(0.35 + 0.45 * pulse).toFixed(2)}"/>

    <circle cx="${AVATAR_CX}" cy="${AVATAR_CY}" r="119" fill="none" stroke="${accent}" stroke-width="10" stroke-opacity="${(0.25 + 0.4 * pulse).toFixed(2)}" filter="url(#blurSm)"/>
    <circle cx="${AVATAR_CX}" cy="${AVATAR_CY}" r="119" fill="none" stroke="${accent}" stroke-width="2" stroke-opacity="${(0.4 + 0.5 * pulse).toFixed(2)}"/>
    <circle cx="${AVATAR_CX}" cy="${AVATAR_CY}" r="140" fill="none" stroke="${accent}" stroke-width="2" stroke-opacity=".8" stroke-dasharray="2 6" stroke-dashoffset="${(-t * 16).toFixed(2)}"/>

    ${stars}
  </svg>`);
}

async function createProfileCardGif(user, options = {}) {
  const base = await renderBase(user, options);
  const small = await sharp(base).resize(GIF_WIDTH, GIF_HEIGHT).png().toBuffer();

  const frames = [];
  for (let i = 0; i < GIF_FRAMES; i += 1) {
    frames.push(await sharp(small)
      .composite([{ input: makeFxOverlay(i / GIF_FRAMES, options.profileCard) }])
      .ensureAlpha()
      .raw()
      .toBuffer());
  }

  return sharp(Buffer.concat(frames), {
    raw: { width: GIF_WIDTH, height: GIF_HEIGHT * GIF_FRAMES, channels: 4, pageHeight: GIF_HEIGHT },
  })
    .gif({ delay: new Array(GIF_FRAMES).fill(GIF_DELAY_MS), loop: 0, effort: 7, colours: 256, dither: 0.6 })
    .toBuffer();
}

module.exports = { createProfileCard, createProfileCardGif, fetchDiscordImage, escapeXml };