require('dotenv').config();
const express = require('express');
const session = require('express-session');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const { ChannelType, PermissionsBitField, Client, GatewayIntentBits, Events } = require('discord.js');

const db = require('./lib/db');
const JsonSessionStore = require('./lib/json-session-store');
const { createUserAccountsStore, isValidEmail, normalizeEmail, hashPassword, verifyPassword } = require('./lib/user-accounts');
const { createOtpMailer } = require('./lib/email-otp');
const personalBotGateway = require('./lib/personal-bot-gateway');
const { makeCtx, buildPayload } = require('./lib/message');
const { encryptSecret, decryptSecret, getSessionSecret } = require('./lib/secrets');
const { getServerMetrics, recordHttpRequest } = require('./lib/server-monitor');
const { createProfileCardGif } = require('./lib/profile-card');

const { SESSION_SECRET } = process.env;
const PORT = Number(process.env.PORT) || 3000;
const BASE_URL = (process.env.BASE_URL || `http://localhost:${PORT}`).replace(/\/$/, '');
const ALLOWED = (process.env.ALLOWED_USER_IDS || '').split(',').map((s) => s.trim()).filter(Boolean);
const OWNER_IDS = (process.env.OWNER_USER_IDS || '').split(',').map((s) => s.trim()).filter(Boolean);
const REDIRECT = `${BASE_URL}/auth/callback`;
const hasValue = (value) => !!value && !/^YOUR_/i.test(value);
const sessionSecret = hasValue(SESSION_SECRET) ? SESSION_SECRET : getSessionSecret();
const userAccounts = createUserAccountsStore();
const sendVerificationCode = createOtpMailer();

function makeInviteUrl(clientId, guildId = '') {
  if (!/^\d{17,20}$/.test(String(clientId || ''))) return null;
  if (guildId && !/^\d{17,20}$/.test(String(guildId))) return null;
  const params = new URLSearchParams({
    client_id: clientId,
    permissions: '8',
    scope: 'bot applications.commands',
  });
  if (guildId) {
    params.set('guild_id', guildId);
    params.set('disable_guild_select', 'true');
  }
  return `https://discord.com/oauth2/authorize?${params}`;
}

function makeUserInstallUrl(clientId) {
  if (!/^\d{17,20}$/.test(String(clientId || ''))) return null;
  return `https://discord.com/oauth2/authorize?${new URLSearchParams({
    client_id: clientId,
    scope: 'applications.commands',
    integration_type: '1',
  })}`;
}

async function fetchBotIdentity(token) {
  const response = await fetch('https://discord.com/api/v10/users/@me', {
    headers: { Authorization: `Bot ${token}` },
    signal: AbortSignal.timeout(10000),
  });
  if (response.status === 401) return { error: 'Bot Token salah atau sudah di-reset. Periksa token di Discord Developer Portal.' };
  if (!response.ok) {
    console.error(`Discord gagal memvalidasi Bot Token: HTTP ${response.status}`);
    return { error: 'Discord gagal memvalidasi bot. Coba lagi beberapa saat.', status: 502 };
  }
  return { bot: await response.json() };
}

const UPLOAD_DIR = path.join(__dirname, 'uploads');
fs.mkdirSync(UPLOAD_DIR, { recursive: true });

const app = express();
app.set('trust proxy', 1);
app.use(express.json({ limit: '300kb' }));
app.use(
  session({
    secret: sessionSecret,
    store: new JsonSessionStore(path.join(__dirname, 'data', 'sessions.json')),
    resave: false,
    saveUninitialized: false,
    cookie: { httpOnly: true, sameSite: 'lax', secure: BASE_URL.startsWith('https'), maxAge: 7 * 24 * 3600 * 1000 },
  })
);

app.use((req, res, next) => {
  if (req.path === '/api/owner/health') return next();
  const startedAt = process.hrtime.bigint();
  res.once('finish', () => {
    recordHttpRequest(res.statusCode, Number(process.hrtime.bigint() - startedAt) / 1e6);
  });
  next();
});

app.use(express.static(path.join(__dirname, 'public')));
app.use('/uploads', express.static(UPLOAD_DIR, { maxAge: '7d' }));

/* ---------- Login Discord (OAuth2) ---------- */
app.get('/invite', (req, res) => {
  const personalBot = req.session.user ? db.getPersonalBot(req.session.user.id) : null;
  const clientId = String(req.query.client_id || personalBot?.clientId || '');
  const inviteUrl = makeInviteUrl(clientId, String(req.query.guild_id || ''));
  if (!inviteUrl) return res.status(400).send('Tautan undangan ini tidak lengkap atau sudah lama. Minta pengirim membagikan ulang link langsung Discord dari Pengaturan bot.');
  res.redirect(inviteUrl);
});

app.get('/app-install', (req, res) => {
  const personalBot = req.session.user ? db.getPersonalBot(req.session.user.id) : null;
  const installUrl = makeUserInstallUrl(String(req.query.client_id || personalBot?.clientId || ''));
  if (!installUrl) return res.status(400).send('Tautan pemasangan ini tidak lengkap atau sudah lama. Minta pengirim membagikan ulang link langsung Discord dari Pengaturan bot.');
  res.redirect(installUrl);
});

app.get('/api/auth/status', (req, res) => {
  res.json({
    configured: !!req.session.pendingOAuth,
    clientId: req.session.pendingOAuth?.clientId || '',
    botName: req.session.pendingOAuth?.botName || '',
  });
});

app.post('/auth/setup', async (req, res) => {
  const websiteAccount = req.session.websiteAccountEmail
    ? userAccounts.findByEmail(req.session.websiteAccountEmail)
    : null;
  if (!websiteAccount) return res.status(401).json({ error: 'Daftar atau masuk ke akun website terlebih dahulu.' });
  const clientId = String(req.body?.clientId || '').trim();
  const clientSecret = typeof req.body?.clientSecret === 'string' ? req.body.clientSecret.trim() : '';
  const botToken = typeof req.body?.botToken === 'string' ? req.body.botToken.trim() : '';
  if (!/^\d{17,20}$/.test(clientId)) return res.status(400).json({ error: 'Application ID / Client ID tidak valid' });
  if (clientSecret.length < 16 || clientSecret.length > 256 || /\s/.test(clientSecret)) return res.status(400).json({ error: 'Client Secret tidak valid' });
  if (botToken.length < 20 || botToken.length > 512 || /\s/.test(botToken)) return res.status(400).json({ error: 'Bot Token tidak valid' });

  let encryptedClientSecret;
  let encryptedToken;
  try {
    encryptedClientSecret = encryptSecret(clientSecret);
    encryptedToken = encryptSecret(botToken);
  } catch (error) {
    console.error('Enkripsi konfigurasi bot gagal:', error.message);
    return res.status(503).json({ error: error.message });
  }

  try {
    const result = await fetchBotIdentity(botToken);
    if (result.error) return res.status(result.status || 400).json({ error: result.error });
    if (result.bot.id !== clientId) return res.status(400).json({ error: 'Application ID tidak cocok dengan Bot Token yang dimasukkan' });
    req.session.pendingOAuth = {
      clientId,
      encryptedClientSecret,
      encryptedToken,
      botId: result.bot.id,
      botName: result.bot.global_name || result.bot.username,
      botAvatar: result.bot.avatar,
      setup: true,
    };
    res.json({ ok: true, configured: true, clientId, botName: req.session.pendingOAuth.botName });
  } catch (error) {
    console.error('Tidak dapat memvalidasi kredensial bot dengan Discord:', error.message);
    res.status(502).json({ error: 'Tidak dapat menghubungi Discord untuk memvalidasi bot.' });
  }
});

app.get('/auth/login', (req, res) => {
  const pendingOAuth = req.session.pendingOAuth;
  const clientId = pendingOAuth?.clientId;
  if (!clientId || !pendingOAuth.encryptedClientSecret) return res.status(400).send('Masukkan Client ID, Client Secret, dan Bot Token sebelum login.');
  const state = crypto.randomBytes(16).toString('hex');
  req.session.oauthState = state;
  const q = new URLSearchParams({
    client_id: clientId,
    redirect_uri: REDIRECT,
    response_type: 'code',
    scope: 'identify guilds',
    state,
    prompt: 'none',
  });
  res.redirect(`https://discord.com/oauth2/authorize?${q}`);
});

app.get('/auth/callback', async (req, res) => {
  try {
    const { code, state } = req.query;
    if (!code || !state || state !== req.session.oauthState) return res.status(400).send('Sesi login tidak valid. Coba lagi.');
    delete req.session.oauthState;
    const pendingOAuth = req.session.pendingOAuth;
    const clientId = pendingOAuth?.clientId;
    const clientSecret = pendingOAuth?.encryptedClientSecret
      ? decryptSecret(pendingOAuth.encryptedClientSecret)
      : '';
    if (!clientId || !clientSecret) return res.status(400).send('Konfigurasi login tidak ditemukan. Kembali dan masukkan kredensial aplikasi bot.');

    const tokenRes = await fetch('https://discord.com/api/oauth2/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_id: clientId,
        client_secret: clientSecret,
        grant_type: 'authorization_code',
        code,
        redirect_uri: REDIRECT,
      }),
    });
    const token = await tokenRes.json();
    if (!tokenRes.ok || !token.access_token) return res.status(400).send('Discord menolak Client ID/Secret atau Redirect URI. Pastikan OAuth2 Redirects aplikasi berisi alamat callback website ini.');

    const auth = { Authorization: `Bearer ${token.access_token}` };
    const [user, guilds] = await Promise.all([
      fetch('https://discord.com/api/v10/users/@me', { headers: auth }).then((r) => r.json()),
      fetch('https://discord.com/api/v10/users/@me/guilds', { headers: auth }).then((r) => r.json()),
    ]);
    if (!user.id || !Array.isArray(guilds)) return res.status(502).send('Discord tidak mengembalikan data akun yang valid.');
    if (pendingOAuth?.ownerId && pendingOAuth.ownerId !== user.id) return res.status(403).send('Aplikasi ini sudah ditautkan ke akun Discord lain.');

    if (ALLOWED.length && !ALLOWED.includes(user.id)) return res.status(403).send('Akun ini tidak diizinkan memakai dashboard.');
    // Simpan daftar server yang dapat dikelola user untuk alur undangan server.
    const manageable = guilds
      .filter((g) => g.owner || (BigInt(g.permissions) & 0x8n) || (BigInt(g.permissions) & 0x20n))
      .map((g) => g.id);
    if (pendingOAuth?.setup) {
      const existing = db.getPersonalBotByClientId(clientId);
      if (existing && existing.userId !== user.id) return res.status(409).send('Aplikasi bot ini sudah terhubung ke akun Embed Studio lain.');
      if (req.session.websiteAccountEmail) {
        try {
          userAccounts.linkDiscordAccount(req.session.websiteAccountEmail, {
            id: user.id,
            username: user.global_name || user.username,
            avatar: user.avatar,
          }, manageable, guilds
            .filter((g) => manageable.includes(g.id))
            .map((g) => ({ id: g.id, name: g.name, icon: g.icon, owner: !!g.owner })));
        } catch (error) {
          if (/^(Akun website|Akun Discord)/.test(error.message)) return res.status(409).send(error.message);
          console.error('Gagal menautkan akun website ke Discord:', error.message);
          return res.status(500).send('Akun website gagal ditautkan. Coba lagi atau hubungi pengelola.');
        }
      }
      db.setPersonalBot(user.id, {
        clientId,
        botId: pendingOAuth.botId,
        botName: pendingOAuth.botName,
        botAvatar: pendingOAuth.botAvatar,
        encryptedToken: pendingOAuth.encryptedToken,
        encryptedClientSecret: pendingOAuth.encryptedClientSecret,
      });
      void personalBotGateway.connectUserBot(user.id, decryptSecret(pendingOAuth.encryptedToken)).catch((error) => {
        console.error(`Bot pribadi user ${user.id} gagal tersambung setelah login:`, error.message);
      });
    }

    req.session.user = {
      id: user.id,
      username: user.global_name || user.username,
      avatar: user.avatar
        ? `https://cdn.discordapp.com/avatars/${user.id}/${user.avatar}.png?size=128`
        : 'https://cdn.discordapp.com/embed/avatars/0.png',
    };
    req.session.manageable = manageable;
    req.session.manageableGuilds = guilds
      .filter((g) => manageable.includes(g.id))
      .map((g) => ({ id: g.id, name: g.name, icon: g.icon, owner: !!g.owner }));
    delete req.session.pendingOAuth;
    res.redirect('/');
  } catch (e) {
    console.error('Login Discord gagal:', e.message);
    res.status(500).send('Login Discord gagal. Periksa kembali kredensial aplikasi dan Redirect URI.');
  }
});

app.post('/auth/logout', (req, res) => {
  pendingProfileChanges.delete(req.sessionID);
  req.session.destroy((error) => {
    if (error) {
      console.error('Gagal menghapus sesi saat logout:', error.message);
      return res.status(500).json({ error: 'Logout gagal. Coba lagi.' });
    }
    res.clearCookie('connect.sid');
    res.json({ ok: true });
  });
});

/* ---------- Middleware ---------- */
const auth = (req, res, next) => (req.session.user ? next() : res.status(401).json({ error: 'Belum login' }));
const isOwner = (req) => !!req.session.user && OWNER_IDS.includes(req.session.user.id);
const lastBotCredentialCheck = new Map();
const localLoginAttempts = new Map();
const passwordResetRequests = new Map();
const passwordResetIpAttempts = new Map();
const passwordResetLastSentAt = new Map();
const registrationAttempts = new Map();
const pendingProfileChanges = new Map();
const profileOtpSendAttempts = new Map();
const profileOtpLastSentAt = new Map();

function rateLimitState(map, key, now, windowMs) {
  const current = map.get(key);
  if (!current || current.resetAt <= now) {
    const next = { count: 0, resetAt: now + windowMs };
    map.set(key, next);
    return next;
  }
  return current;
}

app.post('/auth/register', async (req, res) => {
  const email = normalizeEmail(req.body?.email);
  const password = typeof req.body?.password === 'string' ? req.body.password : '';
  const confirmPassword = typeof req.body?.confirmPassword === 'string' ? req.body.confirmPassword : '';

  if (!isValidEmail(email)) return res.status(400).json({ error: 'Format email tidak valid.' });
  if (password.length < 12 || password.length > 256) return res.status(400).json({ error: 'Password harus terdiri dari 12 sampai 256 karakter.' });
  if (password !== confirmPassword) return res.status(400).json({ error: 'Konfirmasi password tidak sama.' });
  if (userAccounts.findByEmail(email)) return res.status(409).json({ error: 'Email sudah terdaftar. Silakan masuk dengan email dan password.' });

  const now = Date.now();
  for (const [ip, attempts] of registrationAttempts) {
    if (attempts.resetAt <= now) registrationAttempts.delete(ip);
  }
  const ipAttempts = rateLimitState(registrationAttempts, req.ip, now, 15 * 60 * 1000);
  if (ipAttempts.count >= 5) return res.status(429).json({ error: 'Terlalu banyak percobaan pendaftaran. Coba lagi dalam 15 menit.' });
  ipAttempts.count += 1;

  try {
    const passwordHash = await hashPassword(password);
    userAccounts.createAccount({ email, passwordHash });
    req.session.regenerate((error) => {
      if (error) {
        console.error('Gagal membuat sesi pendaftaran:', error.message);
        return res.status(500).json({ error: 'Akun berhasil dibuat, tetapi sesi gagal dibuat. Silakan masuk dengan email dan password.' });
      }
      req.session.websiteAccountEmail = email;
      req.session.cookie.maxAge = 30 * 24 * 60 * 60 * 1000;
      req.session.save((saveError) => {
        if (saveError) {
          console.error('Gagal menyimpan sesi pendaftaran:', saveError.message);
          return res.status(500).json({ error: 'Akun berhasil dibuat, tetapi sesi gagal disimpan. Silakan masuk dengan email dan password.' });
        }
        res.json({ ok: true, next: 'bot-setup' });
      });
    });
  } catch (error) {
    if (/Email ini sudah terdaftar/.test(error.message)) return res.status(409).json({ error: 'Email sudah terdaftar. Silakan masuk dengan email dan password.' });
    console.error('Pembuatan akun gagal:', error.message);
    res.status(500).json({ error: 'Akun tidak dapat dibuat. Coba lagi.' });
  }
});

app.post('/auth/local-login', async (req, res) => {
  const email = String(req.body?.email || '').trim().toLowerCase();
  const password = typeof req.body?.password === 'string' ? req.body.password : '';
  if (!isValidEmail(email) || password.length > 256) {
    return res.status(400).json({ error: 'Masukkan email dan password yang valid.' });
  }
  const attemptKey = req.ip;
  const now = Date.now();
  const attempts = localLoginAttempts.get(attemptKey);
  if (attempts && attempts.resetAt > now && attempts.count >= 10) {
    return res.status(429).json({ error: 'Terlalu banyak percobaan login. Tunggu 15 menit lalu coba lagi.' });
  }
  if (attempts && attempts.resetAt <= now) localLoginAttempts.delete(attemptKey);

  try {
    const account = userAccounts.findByEmail(email);
    if (!account || !(await verifyPassword(password, account.passwordHash))) {
      const current = localLoginAttempts.get(attemptKey);
      localLoginAttempts.set(attemptKey, {
        count: current && current.resetAt > now ? current.count + 1 : 1,
        resetAt: current && current.resetAt > now ? current.resetAt : now + 15 * 60 * 1000,
      });
      return res.status(401).json({ error: 'Email atau password salah.' });
    }
    localLoginAttempts.delete(attemptKey);
    if (account.discordUser?.id && ALLOWED.length && !ALLOWED.includes(account.discordUser.id)) {
      return res.status(403).json({ error: 'Akun Discord ini tidak diizinkan memakai dashboard.' });
    }

    req.session.regenerate((error) => {
      if (error) {
        console.error('Gagal membuat sesi login akun website:', error.message);
        return res.status(500).json({ error: 'Sesi login gagal dibuat. Coba lagi.' });
      }
      req.session.websiteAccountEmail = account.email;
      const hasLinkedBot = account.discordUser?.id && db.getPersonalBot(account.discordUser.id)?.encryptedToken;
      if (hasLinkedBot) {
        req.session.user = account.discordUser;
        req.session.manageable = account.manageable || [];
        req.session.manageableGuilds = account.manageableGuilds || [];
      }
      req.session.cookie.maxAge = req.body?.remember === true ? 30 * 24 * 60 * 60 * 1000 : 24 * 60 * 60 * 1000;
      req.session.save((saveError) => {
        if (saveError) {
          console.error('Gagal menyimpan sesi login akun website:', saveError.message);
          return res.status(500).json({ error: 'Sesi login gagal disimpan. Coba lagi.' });
        }
        res.json({ ok: true, needsBotSetup: !hasLinkedBot });
      });
    });
  } catch (error) {
    console.error('Login akun website gagal:', error.message);
    res.status(500).json({ error: 'Login gagal karena penyimpanan akun tidak dapat dibaca.' });
  }
});

app.post('/auth/password-reset/request', async (req, res) => {
  const email = normalizeEmail(req.body?.email);
  if (!isValidEmail(email)) return res.status(400).json({ error: 'Masukkan alamat email yang valid.' });

  const now = Date.now();
  for (const [pendingEmail, pending] of passwordResetRequests) {
    if (pending.expiresAt <= now) passwordResetRequests.delete(pendingEmail);
  }
  for (const [sentEmail, sentAt] of passwordResetLastSentAt) {
    if (sentAt <= now - 15 * 60 * 1000) passwordResetLastSentAt.delete(sentEmail);
  }
  for (const [ip, attempts] of passwordResetIpAttempts) {
    if (attempts.resetAt <= now) passwordResetIpAttempts.delete(ip);
  }

  const ipAttempts = rateLimitState(passwordResetIpAttempts, req.ip, now, 15 * 60 * 1000);
  if (ipAttempts.count >= 5) {
    return res.status(429).json({ error: 'Terlalu banyak permintaan reset password. Coba lagi dalam 15 menit.' });
  }
  ipAttempts.count += 1;
  const lastSentAt = passwordResetLastSentAt.get(email) || 0;
  if (now - lastSentAt < 60 * 1000) {
    return res.status(429).json({ error: 'Tunggu satu menit sebelum meminta kode reset baru.' });
  }
  const account = userAccounts.findByEmail(email);
  if (account) {
    const code = String(crypto.randomInt(0, 1000000)).padStart(6, '0');
    const salt = crypto.randomBytes(16).toString('hex');
    const codeHash = crypto.createHmac('sha256', sessionSecret)
      .update(`${email}:password-reset:${salt}:${code}`).digest('hex');
    try {
      await sendVerificationCode({
        to: account.email,
        fullName: account.profile?.fullName || 'pengguna',
        code,
        action: 'reset password',
      });
    } catch (error) {
      console.error('Pengiriman OTP reset password gagal:', error.message);
      const missingConfig = error.message.startsWith('Email OTP belum dikonfigurasi.');
      return res.status(missingConfig ? 503 : 502).json({
        error: missingConfig ? error.message : 'Email reset password gagal dikirim. Periksa konfigurasi email server atau coba lagi.',
      });
    }

    passwordResetRequests.set(email, {
      codeHash,
      salt,
      expiresAt: now + 10 * 60 * 1000,
      attempts: 0,
    });
    passwordResetLastSentAt.set(email, now);
  } else {
    passwordResetLastSentAt.set(email, now);
  }

  res.json({
    ok: true,
    message: 'Jika email tersebut terdaftar, kode reset akan dikirim dan berlaku selama 10 menit.',
  });
});

app.post('/auth/password-reset/verify', async (req, res) => {
  const email = normalizeEmail(req.body?.email);
  const code = typeof req.body?.code === 'string' ? req.body.code.trim() : '';
  const password = typeof req.body?.password === 'string' ? req.body.password : '';
  const confirmPassword = typeof req.body?.confirmPassword === 'string' ? req.body.confirmPassword : '';
  if (!isValidEmail(email)) return res.status(400).json({ error: 'Alamat email tidak valid.' });
  if (!/^\d{6}$/.test(code)) return res.status(400).json({ error: 'Masukkan kode OTP 6 digit.' });
  if (password.length < 12 || password.length > 256) {
    return res.status(400).json({ error: 'Password baru harus terdiri dari 12 sampai 256 karakter.' });
  }
  if (password !== confirmPassword) return res.status(400).json({ error: 'Konfirmasi password tidak sama.' });

  const pending = passwordResetRequests.get(email);
  if (!pending || pending.expiresAt <= Date.now()) {
    passwordResetRequests.delete(email);
    return res.status(400).json({ error: 'Kode reset tidak valid atau sudah kedaluwarsa. Minta kode baru.' });
  }

  const expected = Buffer.from(pending.codeHash, 'hex');
  const actual = Buffer.from(crypto.createHmac('sha256', sessionSecret)
    .update(`${email}:password-reset:${pending.salt}:${code}`).digest('hex'), 'hex');
  if (!crypto.timingSafeEqual(expected, actual)) {
    pending.attempts += 1;
    if (pending.attempts >= 5) {
      passwordResetRequests.delete(email);
      return res.status(429).json({ error: 'Terlalu banyak kode yang salah. Minta kode reset baru.' });
    }
    return res.status(400).json({ error: 'Kode OTP salah. Periksa email dan coba lagi.' });
  }

  try {
    const passwordHash = await hashPassword(password);
    const account = userAccounts.findByEmail(email);
    const relinkAfterRecovery = !!account && !account.emailVerifiedAt && !!account.discordUser?.id;
    userAccounts.updatePassword(email, passwordHash);
    passwordResetRequests.delete(email);
    if (relinkAfterRecovery) {
      const discordUserId = userAccounts.unlinkDiscordAccount(email);
      if (discordUserId) {
        personalBotGateway.disconnectUserBot(discordUserId);
        db.removePersonalBot(discordUserId);
      }
      return req.sessionStore.destroyWebsiteAccountSessions(email, (error) => {
        if (error) {
          console.error('Sesi akun tidak dapat dicabut setelah pemulihan password:', error.message);
          return res.status(500).json({ error: 'Password berhasil diubah, tetapi sesi lama gagal dicabut. Hubungi pengelola sebelum melanjutkan.' });
        }
        res.json({ ok: true, message: 'Password berhasil diubah. Masuk kembali dan hubungkan ulang bot untuk melanjutkan.' });
      });
    }
    res.json({ ok: true, message: 'Password berhasil diubah. Silakan masuk dengan password baru.' });
  } catch (error) {
    console.error('Penyimpanan password hasil reset gagal:', error.message);
    res.status(500).json({ error: 'Password baru gagal disimpan. Coba lagi.' });
  }
});

app.post('/api/profile', auth, (req, res) => {
  const fullName = typeof req.body?.fullName === 'string' ? req.body.fullName.trim().replace(/\s+/g, ' ') : '';
  const username = typeof req.body?.username === 'string' ? req.body.username.trim().replace(/\s+/g, ' ') : '';
  const phone = typeof req.body?.phone === 'string' ? req.body.phone.trim() : '';
  if (fullName.length < 2 || fullName.length > 100) return res.status(400).json({ error: 'Nama lengkap harus terdiri dari 2 sampai 100 karakter.' });
  if (username.length < 2 || username.length > 32 || /[\u0000-\u001f\u007f<>]/.test(username)) {
    return res.status(400).json({ error: 'Username harus terdiri dari 2 sampai 32 karakter.' });
  }
  if (!/^\+?[0-9().\-\s]{7,24}$/.test(phone) || phone.replace(/\D/g, '').length < 7 || phone.replace(/\D/g, '').length > 15) {
    return res.status(400).json({ error: 'Masukkan nomor HP yang valid, termasuk kode negara jika diperlukan.' });
  }
  try {
    const account = userAccounts.updateProfile(req.session.user.id, { fullName, username, phone });
    req.session.user.username = username;
    req.session.save((error) => {
      if (error) {
        console.error('Gagal menyimpan sesi setelah mengubah profil:', error.message);
        return res.status(500).json({ error: 'Profil tersimpan tetapi sesi tidak dapat diperbarui. Muat ulang halaman.' });
      }
      res.json({ ok: true, profile: account.profile });
    });
  } catch (error) {
    if (/Profil akun website/.test(error.message)) return res.status(404).json({ error: error.message });
    console.error('Gagal menyimpan profil akun:', error.message);
    res.status(500).json({ error: 'Profil akun gagal disimpan.' });
  }
});

app.post('/api/profile/request-otp', auth, async (req, res) => {
  const purpose = req.body?.purpose;
  const account = userAccounts.findByDiscordId(req.session.user.id);
  if (!account) return res.status(404).json({ error: 'Profil akun website tidak ditemukan.' });
  if (!['email', 'password'].includes(purpose)) return res.status(400).json({ error: 'Jenis perubahan akun tidak valid.' });

  let targetEmail = account.email;
  let passwordHash = null;
  let newPassword = '';
  if (purpose === 'email') {
    targetEmail = normalizeEmail(req.body?.newEmail);
    if (!isValidEmail(targetEmail)) return res.status(400).json({ error: 'Format email baru tidak valid.' });
    if (targetEmail === account.email) return res.status(400).json({ error: 'Email baru sama dengan email akun saat ini.' });
    if (userAccounts.findByEmail(targetEmail)) return res.status(409).json({ error: 'Email ini sudah digunakan oleh akun Embed Studio lain.' });
  } else {
    newPassword = typeof req.body?.password === 'string' ? req.body.password : '';
    const confirmPassword = typeof req.body?.confirmPassword === 'string' ? req.body.confirmPassword : '';
    if (newPassword.length < 12 || newPassword.length > 256) return res.status(400).json({ error: 'Password harus terdiri dari 12 sampai 256 karakter.' });
    if (newPassword !== confirmPassword) return res.status(400).json({ error: 'Konfirmasi password tidak sama.' });
  }

  const now = Date.now();
  for (const [sessionId, pending] of pendingProfileChanges) {
    if (pending.expiresAt <= now) pendingProfileChanges.delete(sessionId);
  }
  for (const [key, sentAt] of profileOtpLastSentAt) {
    if (sentAt <= now - 15 * 60 * 1000) profileOtpLastSentAt.delete(key);
  }
  for (const [ip, attempts] of profileOtpSendAttempts) {
    if (attempts.resetAt <= now) profileOtpSendAttempts.delete(ip);
  }
  const destinationKey = `${purpose}:${targetEmail}`;
  const lastSent = profileOtpLastSentAt.get(destinationKey) || 0;
  if (now - lastSent < 60 * 1000) return res.status(429).json({ error: 'Tunggu satu menit sebelum meminta kode OTP baru.' });
  const ipAttempts = rateLimitState(profileOtpSendAttempts, req.ip, now, 15 * 60 * 1000);
  if (ipAttempts.count >= 5) return res.status(429).json({ error: 'Terlalu banyak permintaan kode OTP. Coba lagi dalam 15 menit.' });
  ipAttempts.count += 1;
  if (purpose === 'password') {
    try {
      passwordHash = await hashPassword(newPassword);
    } catch (error) {
      console.error('Hash password baru gagal dibuat:', error.message);
      return res.status(500).json({ error: 'Permintaan perubahan password gagal diproses.' });
    }
  }

  const code = String(crypto.randomInt(0, 1000000)).padStart(6, '0');
  const salt = crypto.randomBytes(16).toString('hex');
  const codeHash = crypto.createHmac('sha256', sessionSecret)
    .update(`${req.sessionID}:${purpose}:${targetEmail}:${salt}:${code}`).digest('hex');
  try {
    await sendVerificationCode({
      to: targetEmail,
      fullName: account.profile?.fullName || req.session.user.username,
      code,
      action: purpose === 'email' ? 'perubahan email' : 'perubahan password',
    });
    pendingProfileChanges.set(req.sessionID, {
      purpose,
      sourceEmail: account.email,
      targetEmail,
      passwordHash,
      codeHash,
      salt,
      expiresAt: now + 10 * 60 * 1000,
      attempts: 0,
    });
    profileOtpLastSentAt.set(destinationKey, now);
    res.json({
      ok: true,
      destination: purpose === 'email' ? targetEmail : account.email,
      message: purpose === 'email'
        ? 'Kode verifikasi sudah dikirim ke alamat email baru.'
        : 'Kode verifikasi sudah dikirim ke email akun kamu.',
    });
  } catch (error) {
    console.error('Pengiriman OTP perubahan akun gagal:', error.message);
    const missingConfig = error.message.startsWith('Email OTP belum dikonfigurasi.');
    res.status(missingConfig ? 503 : 502).json({
      error: missingConfig ? error.message : 'Email OTP gagal dikirim. Periksa konfigurasi email server atau coba lagi.',
    });
  }
});

app.post('/api/profile/verify-otp', auth, (req, res) => {
  const pending = pendingProfileChanges.get(req.sessionID);
  const code = typeof req.body?.code === 'string' ? req.body.code.trim() : '';
  if (!pending) return res.status(400).json({ error: 'Minta kode OTP baru sebelum memverifikasi perubahan profil.' });
  if (pending.expiresAt <= Date.now()) {
    pendingProfileChanges.delete(req.sessionID);
    return res.status(410).json({ error: 'Kode OTP sudah kedaluwarsa. Minta kode baru.' });
  }
  if (!/^\d{6}$/.test(code)) return res.status(400).json({ error: 'Masukkan kode OTP 6 digit.' });

  const expected = Buffer.from(pending.codeHash, 'hex');
  const actual = crypto.createHmac('sha256', sessionSecret)
    .update(`${req.sessionID}:${pending.purpose}:${pending.targetEmail}:${pending.salt}:${code}`).digest();
  if (!crypto.timingSafeEqual(expected, actual)) {
    pending.attempts += 1;
    if (pending.attempts >= 5) {
      pendingProfileChanges.delete(req.sessionID);
      return res.status(429).json({ error: 'Terlalu banyak kode yang salah. Minta kode OTP baru.' });
    }
    return res.status(400).json({ error: 'Kode OTP salah. Periksa email dan coba lagi.' });
  }

  try {
    const account = userAccounts.findByDiscordId(req.session.user.id);
    if (!account || account.email !== pending.sourceEmail) {
      pendingProfileChanges.delete(req.sessionID);
      return res.status(409).json({ error: 'Akun berubah selama proses verifikasi. Minta kode OTP baru.' });
    }
    let updated;
    if (pending.purpose === 'email') {
      updated = userAccounts.updateEmail(account.email, pending.targetEmail);
      req.session.websiteAccountEmail = updated.email;
    } else {
      updated = userAccounts.updatePassword(account.email, pending.passwordHash);
    }
    pendingProfileChanges.delete(req.sessionID);
    req.session.save((error) => {
      if (error) {
        console.error('Gagal menyimpan sesi setelah perubahan akun:', error.message);
        return res.status(500).json({ error: 'Perubahan berhasil disimpan, tetapi sesi gagal diperbarui. Muat ulang halaman.' });
      }
      res.json({
        ok: true,
        purpose: pending.purpose,
        email: updated.email,
        message: pending.purpose === 'email' ? 'Email berhasil diubah dan diverifikasi.' : 'Password berhasil diubah.',
      });
    });
  } catch (error) {
    if (/Email ini sudah digunakan|tidak ditemukan/.test(error.message)) {
      pendingProfileChanges.delete(req.sessionID);
      return res.status(409).json({ error: error.message });
    }
    console.error('Penerapan perubahan akun gagal:', error.message);
    res.status(500).json({ error: 'Perubahan akun gagal disimpan.' });
  }
});

app.get('/api/auth/account', auth, (req, res) => {
  const account = userAccounts.findByDiscordId(req.session.user.id);
  const avatar = account?.discordUser?.avatar
    ? `https://cdn.discordapp.com/avatars/${req.session.user.id}/${account.discordUser.avatar}.${account.discordUser.avatar.startsWith('a_') ? 'gif' : 'png'}?size=256`
    : `https://cdn.discordapp.com/embed/avatars/${Number(req.session.user.id) % 6}.png`;
  res.json({
    configured: !!account,
    email: account?.email || '',
    profile: account?.profile || null,
    emailVerified: !!account?.emailVerifiedAt,
    discordUsername: account?.discordUser?.username || req.session.user.username,
    avatar,
  });
});

app.get('/api/settings/bot', auth, (req, res) => {
  const personalBot = db.getPersonalBot(req.session.user.id);
  res.json({
    configured: !!personalBot,
    gatewayConnected: personalBotGateway.isUserBotConnected(req.session.user.id),
    commandsRegistered: personalBotGateway.areUserBotCommandsRegistered(req.session.user.id),
    botName: personalBot?.botName || '',
    botId: personalBot?.botId || '',
    clientId: personalBot?.clientId || '',
  });
});

app.post('/api/settings/bot', auth, async (req, res) => {
  const clientId = String(req.body?.clientId || '').trim();
  const token = typeof req.body?.token === 'string' ? req.body.token.trim() : '';
  if (!/^\d{17,20}$/.test(clientId)) return res.status(400).json({ error: 'Client ID aplikasi bot tidak valid' });
  if (!token || token.length > 512 || /\s/.test(token)) return res.status(400).json({ error: 'Bot Token tidak valid' });
  const userId = req.session.user.id;
  const elapsed = Date.now() - (lastBotCredentialCheck.get(userId) || 0);
  if (elapsed < 10000) return res.status(429).json({ error: `Tunggu ${Math.ceil((10000 - elapsed) / 1000)} detik sebelum memverifikasi bot lagi.` });
  lastBotCredentialCheck.set(userId, Date.now());

  let encryptedToken;
  try {
    encryptedToken = encryptSecret(token);
  } catch (e) {
    console.error('Enkripsi kredensial bot gagal:', e.message);
    return res.status(503).json({ error: e.message });
  }

  let botUser;
  try {
    const response = await fetch('https://discord.com/api/v10/users/@me', {
      headers: { Authorization: `Bot ${token}` },
      signal: AbortSignal.timeout(10000),
    });
    if (response.status === 401) return res.status(400).json({ error: 'Bot Token salah atau sudah di-reset. Periksa token di Developer Portal.' });
    if (!response.ok) {
      console.error(`Discord gagal memvalidasi Bot Token: HTTP ${response.status}`);
      return res.status(502).json({ error: 'Discord gagal memvalidasi bot. Coba lagi beberapa saat.' });
    }
    botUser = await response.json();
  } catch (e) {
    console.error('Gagal memvalidasi Bot Token dengan Discord:', e.message);
    return res.status(502).json({ error: 'Tidak dapat menghubungi Discord untuk memvalidasi bot.' });
  }
  if (botUser.id !== clientId) return res.status(400).json({ error: 'Client ID tidak cocok dengan Bot Token yang dimasukkan' });

  try {
    const existingBot = db.getPersonalBot(userId);
    db.setPersonalBot(userId, {
      clientId,
      botId: botUser.id,
      botName: botUser.global_name || botUser.username,
      botAvatar: botUser.avatar,
      encryptedToken,
      ...(existingBot?.clientId === clientId && existingBot.encryptedClientSecret
        ? { encryptedClientSecret: existingBot.encryptedClientSecret }
        : {}),
    });
    let gatewayConnected = false;
    try {
      gatewayConnected = await personalBotGateway.connectUserBot(userId, token);
    } catch (error) {
      console.error(`Bot pribadi user ${userId} gagal tersambung:`, error.message);
    }
    res.json({
      ok: true,
      configured: true,
      gatewayConnected,
      commandsRegistered: personalBotGateway.areUserBotCommandsRegistered(userId),
      clientId,
      botId: botUser.id,
      botName: botUser.global_name || botUser.username,
    });
  } catch (e) {
    console.error('Gagal menyimpan konfigurasi bot pribadi:', e.message);
    res.status(503).json({ error: e.message });
  }
});

app.delete('/api/settings/bot', auth, (req, res) => {
  personalBotGateway.disconnectUserBot(req.session.user.id);
  db.removePersonalBot(req.session.user.id);
  res.json({ ok: true });
});

async function guildAccess(req, res, next) {
  const id = req.params.gid;
  const personalBot = db.getPersonalBot(req.session.user.id);
  if (!personalBot?.encryptedToken) return res.status(409).json({ error: 'Hubungkan bot milikmu dari halaman Pengaturan terlebih dahulu.' });
  let personalClient;
  let temporary = false;
  try {
    ({ client: personalClient, temporary } = await getPersonalClient(req.session.user.id));
    const guild = await personalClient.guilds.fetch(id).catch(() => null);
    if (!guild) {
      if (temporary) personalClient.destroy();
      return res.status(409).json({ error: 'Bot milikmu belum diundang ke server ini. Undang bot tersebut terlebih dahulu.' });
    }
    await Promise.all([guild.channels.fetch(), guild.members.fetchMe()]);
    req.discordClient = personalClient;
    req.guild = guild;
    if (temporary) res.once('finish', () => personalClient.destroy());
    next();
  } catch (error) {
    if (personalClient && temporary) personalClient.destroy();
    console.error('Bot pribadi gagal tersambung untuk server:', error.message);
    return res.status(502).json({ error: 'Bot pribadi tidak dapat tersambung. Periksa tokennya di Pengaturan.' });
  }
}

async function getPersonalClient(userId) {
  const connectedClient = personalBotGateway.getUserBotClient(userId);
  if (connectedClient) return { client: connectedClient, temporary: false };

  const personalBot = db.getPersonalBot(userId);
  if (!personalBot?.encryptedToken) throw new Error('Hubungkan bot milikmu dari halaman Pengaturan terlebih dahulu.');
  return {
    client: await loginTemporaryBot(decryptSecret(personalBot.encryptedToken)),
    temporary: true,
  };
}

const textChannels = (guild) =>
  guild.channels.cache
    .filter((c) => c.type === ChannelType.GuildText || c.type === ChannelType.GuildAnnouncement)
    .filter((c) => c.permissionsFor(guild.members.me)?.has([PermissionsBitField.Flags.ViewChannel, PermissionsBitField.Flags.SendMessages]))
    .sort((a, b) => a.rawPosition - b.rawPosition)
    .map((c) => ({ id: c.id, name: c.name }));

/* ---------- API ---------- */
app.get('/api/me', (req, res) => {
  const personalBot = req.session.user ? db.getPersonalBot(req.session.user.id) : null;
  const websiteAccount = req.session.websiteAccountEmail
    ? userAccounts.findByEmail(req.session.websiteAccountEmail)
    : null;
  res.json({
    user: req.session.user ? {
      ...req.session.user,
      username: websiteAccount?.profile?.username || req.session.user.username,
    } : null,
    websiteAccount: websiteAccount ? {
      email: websiteAccount.email,
      profile: websiteAccount.profile || null,
      emailVerified: !!websiteAccount.emailVerifiedAt,
    } : null,
    owner: isOwner(req),
    botName: personalBot?.botName || null,
    botAvatar: personalBot?.botAvatar && personalBot?.botId
      ? `https://cdn.discordapp.com/avatars/${personalBot.botId}/${personalBot.botAvatar}.png?size=128`
      : null,
    botConfigured: !!personalBot?.encryptedToken,
    botGatewayConnected: personalBotGateway.isUserBotConnected(req.session.user?.id),
  });
});

app.get('/api/owner/health', auth, async (req, res) => {
  if (!isOwner(req)) return res.status(403).json({ error: 'Hanya pemilik website yang dapat melihat metrik server.' });
  res.set('Cache-Control', 'no-store');
  try {
    res.json(await getServerMetrics(personalBotGateway.getConnectionStats()));
  } catch (error) {
    console.error('Gagal mengambil metrik kestabilan server:', error.stack || error.message);
    res.status(500).json({ error: 'Metrik server tidak dapat diambil saat ini.' });
  }
});

app.get('/api/guilds', auth, async (req, res) => {
  const personalBot = db.getPersonalBot(req.session.user.id);
  if (!personalBot?.encryptedToken) {
    return res.json({
      guilds: (req.session.manageableGuilds || []).map((guild) => ({
        id: guild.id,
        name: guild.name,
        icon: guild.icon ? `https://cdn.discordapp.com/icons/${guild.id}/${guild.icon}.png?size=128` : null,
        memberCount: null,
        botIn: false,
      })),
      inviteUrl: '',
      shareUrl: '',
      appInstallUrl: '',
      owner: isOwner(req),
    });
  }
  let personalClient;
  let temporary = false;
  try {
    ({ client: personalClient, temporary } = await getPersonalClient(req.session.user.id));
    const list = [];
    for (const g of personalClient.guilds.cache.values()) {
      list.push({ id: g.id, name: g.name, icon: g.iconURL({ size: 128, extension: 'png' }), memberCount: g.memberCount, botIn: true });
    }
    const manageableGuilds = req.session.manageableGuilds || (req.session.manageable || []).map((id) => ({ id, name: 'Server Discord', icon: null }));
    for (const oauthGuild of manageableGuilds) {
      const id = oauthGuild.id;
      if (list.some((item) => item.id === id)) continue;
      const g = personalClient.guilds.cache.get(id);
      if (g) {
        list.push({ id, name: g.name, icon: g.iconURL({ size: 128, extension: 'png' }), memberCount: g.memberCount, botIn: true });
      } else {
        list.push({ id, name: oauthGuild.name, icon: oauthGuild.icon ? `https://cdn.discordapp.com/icons/${id}/${oauthGuild.icon}.png?size=128` : null, memberCount: null, botIn: false, inviteUrl: makeInviteUrl(personalBot.clientId, id) });
      }
    }
    const inviteUrl = makeInviteUrl(personalBot.clientId);
    res.json({
      guilds: list,
      inviteUrl,
      shareUrl: inviteUrl,
      appInstallUrl: makeUserInstallUrl(personalBot.clientId),
      owner: isOwner(req),
    });
  } catch (error) {
    console.error('Gagal memuat server dari bot pribadi:', error.message);
    return res.status(502).json({ error: 'Bot pribadi tidak dapat tersambung. Periksa tokennya di Pengaturan.' });
  } finally {
    if (personalClient && temporary) personalClient.destroy();
  }
});

app.get('/api/guilds/:gid/channels', auth, guildAccess, (req, res) => res.json({ channels: textChannels(req.guild) }));

app.get('/api/guilds/:gid/assets', auth, guildAccess, async (req, res) => {
  try {
    const guild = req.guild;
    await guild.stickers.fetch();
    res.json({
      emojis: guild.emojis.cache
        .filter((emoji) => emoji.available !== false)
        .sort((a, b) => a.name.localeCompare(b.name))
        .map((emoji) => ({
          id: emoji.id,
          name: emoji.name,
          animated: emoji.animated,
          format: `<${emoji.animated ? 'a' : ''}:${emoji.name}:${emoji.id}>`,
          url: emoji.imageURL({ extension: emoji.animated ? 'gif' : 'png', size: 64 }),
        })),
      stickers: guild.stickers.cache
        .filter((sticker) => sticker.available !== false)
        .sort((a, b) => a.name.localeCompare(b.name))
        .map((sticker) => ({ id: sticker.id, name: sticker.name, description: sticker.description || '', format: sticker.format, url: sticker.url })),
    });
  } catch (e) {
    console.error('Gagal mengambil emoji/sticker server:', e.message);
    res.status(502).json({ error: 'Emoji atau sticker server gagal dimuat' });
  }
});

app.post('/api/guilds/:gid/emojis', auth, guildAccess, async (req, res) => {
  const guild = req.guild;
  const manageExpressions = PermissionsBitField.Flags.ManageGuildExpressions || PermissionsBitField.Flags.ManageEmojisAndStickers;
  if (!guild.members.me?.permissions.has(manageExpressions)) {
    return res.status(403).json({ error: 'Bot belum punya izin Manage Expressions / Kelola Ekspresi di server ini' });
  }

  let source = String(req.body?.source || '').trim();
  let name = String(req.body?.name || '').trim();
  const customEmoji = source.match(/^<(a?):([a-zA-Z0-9_]{2,32}):(\d{17,20})>$/);
  if (customEmoji) {
    if (!name) name = customEmoji[2];
    source = `https://cdn.discordapp.com/emojis/${customEmoji[3]}.${customEmoji[1] ? 'gif' : 'png'}?size=256`;
  }
  if (!/^https?:\/\/\S+$/i.test(source)) return res.status(400).json({ error: 'Tempel URL PNG/GIF/WEBP atau format emoji seperti <:nama:id>' });
  name = name.replace(/[^a-zA-Z0-9_]/g, '_').replace(/^_+|_+$/g, '').slice(0, 32);
  if (name.length < 2) return res.status(400).json({ error: 'Nama emoji minimal 2 karakter dan hanya boleh huruf, angka, atau _' });

  try {
    const emoji = await guild.emojis.create({ attachment: source, name, reason: `Ditambahkan dari Embed Studio oleh ${req.session.user.username}` });
    res.json({ ok: true, emoji: { id: emoji.id, name: emoji.name, animated: emoji.animated, format: emoji.toString(), url: emoji.imageURL({ size: 128 }) } });
  } catch (e) {
    const msg = /Maximum number of emojis|maximum number/i.test(e.message)
      ? 'Server sudah mencapai batas emoji untuk boost/level saat ini.'
      : /Invalid Form Body|Unsupported image/i.test(e.message)
        ? 'File tidak valid. Gunakan PNG, GIF, atau WEBP yang bisa diakses publik.'
        : e.message;
    res.status(400).json({ error: msg });
  }
});

app.get('/api/guilds/:gid/settings', auth, guildAccess, (req, res) => res.json(db.getGuild(req.guild.id)));

app.get('/api/guilds/:gid/command-settings', auth, guildAccess, (req, res) => {
  res.json(db.getCommandSettings(req.guild.id));
});

const profilePreviewLastGeneratedAt = new Map();
app.post('/api/guilds/:gid/command-settings/profile-preview', auth, guildAccess, async (req, res) => {
  const now = Date.now();
  for (const [userId, generatedAt] of profilePreviewLastGeneratedAt) {
    if (generatedAt <= now - 60_000) profilePreviewLastGeneratedAt.delete(userId);
  }
  const previous = profilePreviewLastGeneratedAt.get(req.session.user.id) || 0;
  if (now - previous < 3000) {
    return res.status(429).json({ error: `Tunggu ${Math.ceil((3000 - (now - previous)) / 1000)} detik sebelum membuat pratinjau GIF lagi.` });
  }
  profilePreviewLastGeneratedAt.set(req.session.user.id, now);

  const profileCard = req.body?.profileCard;
  const defaults = db.getCommandSettings(req.guild.id).profileCard;
  if (!profileCard || typeof profileCard !== 'object' || Array.isArray(profileCard) || !profileCard.colors || typeof profileCard.colors !== 'object') {
    return res.status(400).json({ error: 'Pengaturan kartu profil untuk pratinjau tidak valid.' });
  }
  const validatedProfileCard = {};
  for (const key of Object.keys(defaults).filter((item) => item !== 'colors')) {
    const value = profileCard[key];
    if (typeof value !== 'string' || value.length > 100) {
      return res.status(400).json({ error: `Teks kartu profil ${key} harus maksimal 100 karakter.` });
    }
    validatedProfileCard[key] = value;
  }
  validatedProfileCard.colors = {};
  for (const key of Object.keys(defaults.colors)) {
    const value = profileCard.colors[key];
    if (typeof value !== 'string' || !/^#[0-9a-f]{6}$/i.test(value)) {
      return res.status(400).json({ error: `Warna kartu profil ${key} tidak valid.` });
    }
    validatedProfileCard.colors[key] = value;
  }

  try {
    const discordUser = req.session.user;
    const user = {
      id: discordUser.id,
      username: discordUser.username,
      globalName: discordUser.username,
      createdTimestamp: Number((BigInt(discordUser.id) >> 22n) + 1420070400000n),
      displayAvatarURL: () => discordUser.avatar,
    };
    const activity = db.getProfileActivity(discordUser.id);
    activity.walletBalance = db.getWallet(req.guild.id, discordUser.id).balance;
    const gif = await createProfileCardGif(user, { activity, profileCard: validatedProfileCard });
    res.set('Content-Type', 'image/gif');
    res.set('Cache-Control', 'no-store');
    res.set('X-Content-Type-Options', 'nosniff');
    res.send(gif);
  } catch (error) {
    console.error('Gagal membuat pratinjau kartu GIF /fp:', error.message);
    res.status(502).json({ error: `Pratinjau GIF /fp gagal dibuat: ${error.message}` });
  }
});

function validateCommandSettings(body, guildId) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) return { error: 'Format pengaturan command tidak valid.' };
  const defaults = db.getCommandSettings(guildId);
  const economy = body.economy;
  const messages = body.messages;
  const profileCard = body.profileCard;
  if (!economy || !messages || !profileCard || !profileCard.colors) return { error: 'Pengaturan command belum lengkap.' };

  const numericRanges = {
    dailyReward: [1, 1_000_000_000_000],
    defaultBet: [1, 100_000_000_000_000],
    maxBet: [1, 100_000_000_000_000],
    pairMultiplier: [1, 100],
    tripleMultiplier: [1, 1000],
  };
  const validatedEconomy = {};
  for (const [key, [min, max]] of Object.entries(numericRanges)) {
    const value = Number(economy[key]);
    if (!Number.isSafeInteger(value) || value < min || value > max) {
      return { error: `Nilai ${key} harus berupa bilangan bulat antara ${min} dan ${max}.` };
    }
    validatedEconomy[key] = value;
  }
  if (validatedEconomy.defaultBet > validatedEconomy.maxBet) {
    return { error: 'Taruhan default tidak boleh melebihi batas taruhan maksimum.' };
  }
  if (validatedEconomy.tripleMultiplier < validatedEconomy.pairMultiplier) {
    return { error: 'Pengali jackpot tiga angka harus minimal sama dengan pengali dua angka.' };
  }
  if (validatedEconomy.maxBet > Math.floor(Number.MAX_SAFE_INTEGER / validatedEconomy.tripleMultiplier)) {
    return { error: 'Batas taruhan terlalu tinggi untuk pengali jackpot; hasilnya harus tetap dalam bilangan Rupiah aman.' };
  }

  const validatedMessages = {};
  const messageLimits = {
    slotTitle: 256, slotSpinningTitle: 256, slotHeading: 256,
    slotBetLabel: 256, slotBalanceLabel: 256, slotPrizeLabel: 256,
    slotSpinningFooter: 2048, slotFooter: 2048, slotSpinStatus: 1800,
    slotJackpot: 900, slotPair: 900, slotLoss: 900,
    slotRunningMessage: 1900, slotInsufficientBalance: 1900, slotMaxBetMessage: 1900,
    balanceTitle: 256, balanceDescription: 3800, balanceFooter: 2048,
    dailyTitle: 256, dailyDescription: 3800, dailyBalanceLabel: 256,
    dailyNextLabel: 256, dailyWaitMessage: 1900, dailyFooter: 2048,
    leaderboardTitle: 256, leaderboardEmpty: 4096, leaderboardFooter: 2048,
    profileAuthor: 156, profileTitle: 224, profileDescription: 3800,
    profileStatusLabel: 256, profileDurationLabel: 256, profileActivityLabel: 256,
    profileRolesLabel: 256, profileAccountLabel: 256, profileStatsLabel: 256,
    profileStatusValue: 900, profileDurationValue: 900, profileActivityValue: 900,
    profileRolesValue: 900, profileAccountValue: 900, profileStatsValue: 900,
    profileLimitedStatsValue: 900, profileFooter: 2048,
    helpTitle: 256, helpDescription: 2048, helpContent: 4096, helpFooter: 2048,
  };
  for (const key of Object.keys(defaults.messages)) {
    const value = messages[key];
    const limit = messageLimits[key] || 1000;
    if (typeof value !== 'string' || value.length > limit) {
      return { error: `Teks ${key} harus berupa teks maksimal ${limit} karakter.` };
    }
    validatedMessages[key] = value.trim();
  }
  if (validatedMessages.helpDescription.length + validatedMessages.helpContent.length + 2 > 4096) {
    return { error: 'Gabungan deskripsi dan konten panduan maksimal 4096 karakter.' };
  }

  const validatedProfileCard = {};
  const cardStringKeys = Object.keys(defaults.profileCard).filter((key) => key !== 'colors');
  for (const key of cardStringKeys) {
    const value = profileCard[key];
    if (typeof value !== 'string' || value.length > 100) {
      return { error: `Label kartu profil ${key} harus berupa teks maksimal 100 karakter.` };
    }
    validatedProfileCard[key] = value.trim();
  }
  validatedProfileCard.colors = {};
  for (const key of Object.keys(defaults.profileCard.colors)) {
    const value = profileCard.colors[key];
    if (typeof value !== 'string' || !/^#[0-9a-f]{6}$/i.test(value)) {
      return { error: `Warna ${key} harus berupa kode HEX, misalnya #d4a84f.` };
    }
    validatedProfileCard.colors[key] = value;
  }
  return {
    config: {
      economy: validatedEconomy,
      messages: validatedMessages,
      profileCard: validatedProfileCard,
    },
  };
}

app.put('/api/guilds/:gid/command-settings', auth, guildAccess, (req, res) => {
  const result = validateCommandSettings(req.body, req.guild.id);
  if (result.error) return res.status(400).json({ error: result.error });
  db.setCommandSettings(req.guild.id, result.config);
  res.json({ ok: true, ...db.getCommandSettings(req.guild.id) });
});

app.put('/api/guilds/:gid/settings/:kind', auth, guildAccess, (req, res) => {
  const { kind } = req.params;
  if (!['welcome', 'goodbye'].includes(kind)) return res.status(404).json({ error: 'Modul tidak dikenal' });
  const { enabled, channelId, message } = req.body || {};
  if (channelId && !textChannels(req.guild).some((c) => c.id === channelId)) return res.status(400).json({ error: 'Channel tidak valid' });
  if (enabled && !channelId) return res.status(400).json({ error: 'Pilih channel dulu sebelum mengaktifkan modul' });
  db.setGuildBotOwner(req.guild.id, kind, req.session.user.id);
  db.setModule(req.guild.id, kind, { enabled: !!enabled, channelId: channelId || '', message: message || {} });
  res.json({ ok: true });
});

app.get('/api/guilds/:gid/templates', auth, guildAccess, (req, res) => res.json({ templates: db.getTemplates(req.guild.id) }));

app.post('/api/guilds/:gid/templates', auth, guildAccess, (req, res) => {
  const { name, message } = req.body || {};
  if (!name || !String(name).trim()) return res.status(400).json({ error: 'Beri nama template' });
  const list = db.getTemplates(req.guild.id);
  if (list.length >= 50) return res.status(400).json({ error: 'Maksimal 50 template per server' });
  list.unshift({ id: crypto.randomBytes(6).toString('hex'), name: String(name).trim().slice(0, 60), message: message || {} });
  db.setTemplates(req.guild.id, list);
  res.json({ templates: list });
});

app.delete('/api/guilds/:gid/templates/:tid', auth, guildAccess, (req, res) => {
  const list = db.getTemplates(req.guild.id).filter((t) => t.id !== req.params.tid);
  db.setTemplates(req.guild.id, list);
  res.json({ templates: list });
});

const lastSend = new Map();
app.post('/api/guilds/:gid/send', auth, guildAccess, async (req, res) => {
  const uid = req.session.user.id;
  if (Date.now() - (lastSend.get(uid) || 0) < 1500) return res.status(429).json({ error: 'Terlalu cepat, tunggu sebentar' });
  lastSend.set(uid, Date.now());

  try {
    const { channelId, message } = req.body || {};
    const channel = req.guild.channels.cache.get(channelId);
    if (!channel || !channel.isTextBased()) return res.status(400).json({ error: 'Pilih channel tujuan' });
    const user = await req.discordClient.users.fetch(uid);
    const member = await req.guild.members.fetch(uid).catch(() => null);
    const payload = await buildPayload(message, makeCtx({ guild: req.guild, user, member, channel, client: req.discordClient }));
    await channel.send(payload);
    res.json({ ok: true });
  } catch (e) {
    const msg = /Missing (Access|Permissions)/i.test(e.message)
      ? 'Bot tidak punya izin di channel itu (butuh Send Messages, Embed Links, Attach Files).'
      : e.message;
    res.status(400).json({ error: msg });
  }
});

const lastDmSend = new Map();
app.post('/api/dm', auth, async (req, res) => {
  if (!isOwner(req)) return res.status(403).json({ error: 'Kirim DM hanya tersedia untuk pemilik bot' });
  const uid = req.session.user.id;
  if (Date.now() - (lastDmSend.get(uid) || 0) < 1500) return res.status(429).json({ error: 'Terlalu cepat, tunggu sebentar' });

  const targetId = String(req.body?.userId || '').trim();
  if (!/^\d{17,20}$/.test(targetId)) return res.status(400).json({ error: 'User ID Discord tidak valid' });
  lastDmSend.set(uid, Date.now());

  let personalClient;
  let temporary = false;
  try {
    const personalBot = db.getPersonalBot(uid);
    if (!personalBot?.encryptedToken) return res.status(409).json({ error: 'Hubungkan bot milikmu dari halaman Pengaturan terlebih dahulu.' });
    ({ client: personalClient, temporary } = await getPersonalClient(uid));
    const target = await personalClient.users.fetch(targetId);
    const guild = personalClient.guilds.cache.get(String(req.body?.guildId || ''));
    const member = guild ? await guild.members.fetch(targetId).catch(() => null) : null;
    const dm = await target.createDM();
    const payload = await buildPayload(req.body?.message, makeCtx({
      guild: guild || { name: 'DM', id: 'dm', memberCount: 0, iconURL: () => null },
      user: target,
      member,
      channel: dm,
      client: personalClient,
    }));
    await dm.send(payload);
    res.json({ ok: true, user: { id: target.id, username: target.username, tag: target.tag } });
  } catch (e) {
    const msg = /Cannot send messages to this user|50007/i.test(e.message)
      ? 'DM gagal: user menutup DM, memblokir bot, atau bot tidak memiliki mutual server dengan user tersebut.'
      : e.message;
    res.status(400).json({ error: msg });
  } finally {
    if (personalClient && temporary) personalClient.destroy();
  }
});

app.post('/api/broadcast', auth, async (req, res) => {
  if (!isOwner(req)) return res.status(403).json({ error: 'Mode broadcast hanya tersedia untuk pemilik bot' });
  const targets = Array.isArray(req.body?.targets) ? req.body.targets.slice(0, 100) : [];
  if (!targets.length) return res.status(400).json({ error: 'Pilih minimal satu server dan channel' });
  const personalBot = db.getPersonalBot(req.session.user.id);
  if (!personalBot?.encryptedToken) return res.status(409).json({ error: 'Hubungkan bot milikmu dari halaman Pengaturan terlebih dahulu.' });
  let personalClient;
  let temporary = false;
  try {
    ({ client: personalClient, temporary } = await getPersonalClient(req.session.user.id));
    const user = await personalClient.users.fetch(req.session.user.id);
    const results = [];
    for (const target of targets) {
      const guild = personalClient.guilds.cache.get(String(target.guildId));
      const channel = guild?.channels.cache.get(String(target.channelId));
      if (!guild || !channel || !channel.isTextBased()) {
        results.push({ guildId: target.guildId, channelId: target.channelId, ok: false, error: 'Server atau channel tidak tersedia untuk bot pribadimu' });
        continue;
      }
      try {
        const member = await guild.members.fetch(user.id).catch(() => null);
        const payload = await buildPayload(req.body.message, makeCtx({ guild, user, member, channel, client: personalClient }));
        await channel.send(payload);
        results.push({ guildId: guild.id, channelId: channel.id, guildName: guild.name, ok: true });
      } catch (e) {
        results.push({ guildId: guild.id, channelId: channel.id, guildName: guild.name, ok: false, error: e.message });
      }
    }
    res.json({ ok: results.some((item) => item.ok), results });
  } catch (error) {
    console.error('Bot pribadi gagal menjalankan broadcast:', error.message);
    res.status(502).json({ error: 'Bot pribadi tidak dapat tersambung atau mengakses tujuan.' });
  } finally {
    if (personalClient && temporary) personalClient.destroy();
  }
});

app.get('/api/command-messages', auth, (req, res) => {
  const userConfig = db.getCommandMessagesForUser(req.session.user.id);
  res.json(userConfig || (isOwner(req) ? db.getCommandMessages() : { messages: [], cooldownSeconds: 60, targetChannelId: '' }));
});

function validateCommandMessageConfig(body) {
  const messages = body?.messages;
  const cooldownSeconds = Number(body?.cooldownSeconds);
  const targetChannelId = String(body?.targetChannelId || '').trim();
  if (!Array.isArray(messages) || messages.length < 1 || messages.length > 5) {
    return { error: 'Atur minimal 1 dan maksimal 5 pesan' };
  }
  if (messages.some((message) => !message || typeof message !== 'object' || Array.isArray(message))) {
    return { error: 'Format pesan tidak valid' };
  }
  if (!Number.isInteger(cooldownSeconds) || cooldownSeconds < 5 || cooldownSeconds > 86400) {
    return { error: 'Cooldown harus antara 5 detik dan 24 jam' };
  }
  if (targetChannelId && !/^\d{17,20}$/.test(targetChannelId)) {
    return { error: 'ID channel Discord tidak valid' };
  }
  return { config: { messages, cooldownSeconds, targetChannelId } };
}

function channelSendError(error, channelId, usingPersonalBot = false) {
  const code = Number(error.code);
  if (code === 50001) {
    if (usingPersonalBot) return `Bot pribadimu tidak dapat mengakses channel ${channelId}. Pastikan bot sudah diundang ke server tujuan dan memiliki izin melihat serta mengirim pesan.`;
    return `Bot tidak dapat mengakses channel ${channelId}. Pengaturan sudah disimpan. Jika bot tidak dipasang di server itu, jalankan /pesan langsung di channel tujuan; command membalas lewat interaksi Discord.`;
  }
  if (code === 50013) {
    return 'Bot tidak memiliki izin yang diperlukan di channel tujuan. Berikan izin Lihat Channel, Kirim Pesan, Embed Links, dan Attach Files sesuai isi pesan.';
  }
  if (code === 10003) return 'Channel tidak ditemukan. Periksa kembali ID channel atau pastikan channel belum dihapus.';
  return error.message || 'Gagal mengirim pesan ke channel tujuan';
}

async function loginTemporaryBot(token) {
  const temporaryClient = new Client({ intents: [GatewayIntentBits.Guilds] });
  let timeout;
  try {
    const ready = new Promise((resolve, reject) => {
      temporaryClient.once(Events.ClientReady, resolve);
      temporaryClient.once(Events.Error, reject);
      timeout = setTimeout(() => reject(new Error('Waktu koneksi bot habis')), 15000);
    });
    await temporaryClient.login(token);
    await ready;
    return temporaryClient;
  } catch (error) {
    temporaryClient.destroy();
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}

app.put('/api/command-messages', auth, (req, res) => {
  const result = validateCommandMessageConfig(req.body);
  if (result.error) return res.status(400).json({ error: result.error });
  db.setCommandMessagesForUser(req.session.user.id, result.config);
  if (isOwner(req)) db.setCommandMessages(result.config);
  res.json({ ok: true, ...result.config });
});

const lastConfiguredMessageSend = new Map();
const activeConfiguredMessageSend = new Set();
app.post('/api/command-messages/send', auth, async (req, res) => {
  const result = validateCommandMessageConfig(req.body);
  if (result.error) return res.status(400).json({ error: result.error });
  const { config } = result;
  if (!config.targetChannelId) return res.status(400).json({ error: 'Tempel ID channel tujuan terlebih dahulu' });

  const uid = req.session.user.id;
  if (activeConfiguredMessageSend.has(uid)) return res.status(429).json({ error: 'Pengiriman pesanmu masih berlangsung' });
  const remainingMs = config.cooldownSeconds * 1000 - (Date.now() - (lastConfiguredMessageSend.get(uid) || 0));
  if (remainingMs > 0) {
    return res.status(429).json({
      error: `Cooldown aktif. Coba lagi dalam ${Math.ceil(remainingMs / 1000)} detik.`,
      retryAfterSeconds: Math.ceil(remainingMs / 1000),
    });
  }

  activeConfiguredMessageSend.add(uid);
  let sendClient = null;
  let temporary = false;
  let personalToken = null;
  let sent = 0;
  try {
    db.setCommandMessagesForUser(uid, config);
    if (isOwner(req)) db.setCommandMessages(config);

    const personalBot = db.getPersonalBot(uid);
    if (!personalBot?.encryptedToken) {
      return res.status(409).json({ error: 'Hubungkan bot milikmu dari halaman Pengaturan sebelum mengirim pesan.' });
    }
    personalToken = decryptSecret(personalBot.encryptedToken);
    ({ client: sendClient, temporary } = await getPersonalClient(uid));

    const channel = await sendClient.channels.fetch(config.targetChannelId);
    if (!channel || !channel.guild || ![ChannelType.GuildText, ChannelType.GuildAnnouncement].includes(channel.type)) {
      return res.status(400).json({ error: 'ID harus menunjuk ke channel teks atau pengumuman server' });
    }
    await channel.guild.members.fetchMe();
    const botMember = channel.guild.members.me;
    if (!botMember || !channel.permissionsFor(botMember)?.has([PermissionsBitField.Flags.ViewChannel, PermissionsBitField.Flags.SendMessages])) {
      return res.status(403).json({ error: 'Bot harus ada di server tujuan dan memiliki izin melihat channel serta mengirim pesan' });
    }

    const user = await sendClient.users.fetch(uid);
    const member = await channel.guild.members.fetch(uid).catch(() => null);
    const ctx = makeCtx({ guild: channel.guild, user, member, channel, client: sendClient });
    const payloads = [];
    for (const message of config.messages) payloads.push(await buildPayload(message, ctx));

    lastConfiguredMessageSend.set(uid, Date.now());
    for (const payload of payloads) {
      if (sent) await new Promise((resolve) => setTimeout(resolve, 1000));
      await channel.send(payload);
      sent += 1;
    }
    return res.json({ ok: true, sent, channelName: channel.name });
  } catch (e) {
    const safeMessage = personalToken ? String(e.message || 'Kesalahan bot pribadi').replaceAll(personalToken, '[TOKEN DIHAPUS]') : e.message;
    console.error(`[send] gagal mengirim ke channel ${config.targetChannelId}:`, safeMessage);
    const safeError = { code: e.code, message: safeMessage };
    const error = sent
      ? `Pengiriman terhenti setelah ${sent} dari ${config.messages.length} pesan: ${safeMessage}`
      : channelSendError(safeError, config.targetChannelId, !!personalToken);
    return res.status(400).json({ error, sent });
  } finally {
    if (sendClient && temporary) sendClient.destroy();
    activeConfiguredMessageSend.delete(uid);
  }
});

const upload = multer({
  storage: multer.diskStorage({
    destination: UPLOAD_DIR,
    filename: (req, file, cb) => cb(null, crypto.randomBytes(12).toString('hex') + path.extname(file.originalname).toLowerCase()),
  }),
  limits: { fileSize: 8 * 1024 * 1024 },
  fileFilter: (req, file, cb) => cb(null, /\.(png|jpe?g|webp|gif)$/i.test(file.originalname) && /^image\//.test(file.mimetype)),
});

app.post('/api/upload', auth, (req, res) => {
  upload.single('file')(req, res, (err) => {
    if (err) return res.status(400).json({ error: err.code === 'LIMIT_FILE_SIZE' ? 'Ukuran maksimal 8 MB' : err.message });
    if (!req.file) return res.status(400).json({ error: 'Hanya gambar PNG, JPG, WEBP, atau GIF' });
    res.json({ url: `/uploads/${req.file.filename}` });
  });
});

/* ---------- Jalankan ---------- */
app.listen(PORT, () => {
  console.log(`Dashboard siap di ${BASE_URL}`);
  personalBotGateway.connectSavedBots();
});
