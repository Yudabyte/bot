const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { promisify } = require('util');

const scrypt = promisify(crypto.scrypt);
const DEFAULT_FILE = path.join(__dirname, '..', 'loginpengguna.json');
const PASSWORD_BYTES = 64;

function normalizeEmail(email) {
  return String(email || '').trim().toLowerCase();
}

function isValidEmail(email) {
  return email.length <= 254 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

async function hashPassword(password) {
  const salt = crypto.randomBytes(16);
  const hash = await scrypt(password, salt, PASSWORD_BYTES);
  return { salt: salt.toString('hex'), hash: hash.toString('hex') };
}

async function verifyPassword(password, stored) {
  if (!stored || !/^[a-f0-9]{32}$/i.test(stored.salt || '') || !/^[a-f0-9]{128}$/i.test(stored.hash || '')) {
    return false;
  }
  const salt = Buffer.from(stored.salt, 'hex');
  const expected = Buffer.from(stored.hash, 'hex');
  const actual = await scrypt(password, salt, PASSWORD_BYTES);
  return crypto.timingSafeEqual(actual, expected);
}

function createUserAccountsStore(filePath = DEFAULT_FILE) {
  let accounts = {};
  try {
    const contents = fs.readFileSync(filePath, 'utf8');
    if (contents.trim()) {
      accounts = JSON.parse(contents);
    } else {
      console.warn('loginpengguna.json kosong; akun lama tidak dapat dimuat dari file ini.');
    }
    if (!accounts || Array.isArray(accounts) || typeof accounts !== 'object') {
      throw new Error('loginpengguna.json harus berisi objek akun.');
    }
  } catch (error) {
    if (error.code !== 'ENOENT') throw new Error(`Gagal membaca loginpengguna.json: ${error.message}`);
  }

  function persist(nextAccounts) {
    const directory = path.dirname(filePath);
    fs.mkdirSync(directory, { recursive: true });
    const temporaryFile = `${filePath}.${process.pid}.tmp`;
    fs.writeFileSync(temporaryFile, `${JSON.stringify(nextAccounts, null, 2)}\n`, { mode: 0o600 });
    fs.renameSync(temporaryFile, filePath);
    accounts = nextAccounts;
  }

  function findByEmail(email) {
    return accounts[normalizeEmail(email)] || null;
  }

  function findByDiscordId(discordId) {
    return Object.values(accounts).find((account) => account.discordUser?.id === discordId) || null;
  }

  function createAccount({ email, passwordHash, profile, emailVerified = false }) {
    const normalizedEmail = normalizeEmail(email);
    if (!isValidEmail(normalizedEmail)) throw new Error('Format email tidak valid.');
    if (findByEmail(normalizedEmail)) throw new Error('Email ini sudah terdaftar. Silakan masuk.');
    if (!passwordHash || !/^[a-f0-9]{32}$/i.test(passwordHash.salt || '') || !/^[a-f0-9]{128}$/i.test(passwordHash.hash || '')) {
      throw new Error('Hash password tidak valid.');
    }

    const timestamp = new Date().toISOString();
    const defaultName = normalizedEmail.split('@')[0].replace(/[._-]+/g, ' ').slice(0, 100) || 'Pengguna';
    const account = {
      email: normalizedEmail,
      passwordHash,
      profile: {
        fullName: String(profile?.fullName || defaultName).trim(),
        phone: String(profile?.phone || '').trim(),
        username: String(profile?.username || profile?.fullName || defaultName).trim(),
      },
      emailVerifiedAt: emailVerified ? timestamp : null,
      discordUser: null,
      manageable: [],
      manageableGuilds: [],
      createdAt: timestamp,
      updatedAt: timestamp,
    };
    persist({ ...accounts, [normalizedEmail]: account });
    return account;
  }

  function createVerifiedAccount({ email, passwordHash, profile }) {
    return createAccount({ email, passwordHash, profile, emailVerified: true });
  }

  function linkDiscordAccount(email, user, manageable, manageableGuilds) {
    const normalizedEmail = normalizeEmail(email);
    const account = findByEmail(normalizedEmail);
    if (!account) throw new Error('Akun website tidak ditemukan. Masuk kembali untuk melanjutkan.');
    if (!user?.id || !user?.username) throw new Error('Akun Discord aktif tidak ditemukan.');
    if (account.discordUser?.id && account.discordUser.id !== user.id) {
      throw new Error('Akun website ini sudah ditautkan ke akun Discord lain.');
    }
    const existingDiscordAccount = findByDiscordId(user.id);
    if (existingDiscordAccount && existingDiscordAccount.email !== normalizedEmail) {
      throw new Error('Akun Discord ini sudah ditautkan ke akun website lain.');
    }

    const updated = {
      ...account,
      profile: {
        ...(account.profile || {}),
        fullName: account.profile?.fullName || user.username,
        username: account.profile?.username || user.username,
      },
      discordUser: { id: user.id, username: user.username, avatar: user.avatar },
      manageable: Array.isArray(manageable) ? manageable : [],
      manageableGuilds: Array.isArray(manageableGuilds) ? manageableGuilds : [],
      updatedAt: new Date().toISOString(),
    };
    persist({ ...accounts, [normalizedEmail]: updated });
    return updated;
  }

  function unlinkDiscordAccount(email) {
    const normalizedEmail = normalizeEmail(email);
    const account = findByEmail(normalizedEmail);
    if (!account) throw new Error('Akun website tidak ditemukan.');
    const discordUserId = account.discordUser?.id || null;
    const updated = {
      ...account,
      discordUser: null,
      manageable: [],
      manageableGuilds: [],
      updatedAt: new Date().toISOString(),
    };
    persist({ ...accounts, [normalizedEmail]: updated });
    return discordUserId;
  }

  function updateProfile(discordId, profile) {
    const account = findByDiscordId(discordId);
    if (!account) throw new Error('Profil akun website tidak ditemukan.');
    const updated = {
      ...account,
      profile: {
        ...(account.profile || {}),
        fullName: String(profile.fullName).trim(),
        username: String(profile.username).trim(),
        phone: String(profile.phone).trim(),
      },
      updatedAt: new Date().toISOString(),
    };
    persist({ ...accounts, [account.email]: updated });
    return updated;
  }

  function updateEmail(currentEmail, newEmail) {
    const normalizedCurrentEmail = normalizeEmail(currentEmail);
    const normalizedNewEmail = normalizeEmail(newEmail);
    const account = findByEmail(normalizedCurrentEmail);
    if (!account) throw new Error('Akun website tidak ditemukan.');
    if (!isValidEmail(normalizedNewEmail)) throw new Error('Format email tidak valid.');
    if (normalizedCurrentEmail !== normalizedNewEmail && findByEmail(normalizedNewEmail)) {
      throw new Error('Email ini sudah digunakan oleh akun Embed Studio lain.');
    }
    if (normalizedCurrentEmail === normalizedNewEmail) return account;
    const updated = {
      ...account,
      email: normalizedNewEmail,
      emailVerifiedAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    const nextAccounts = { ...accounts, [normalizedNewEmail]: updated };
    delete nextAccounts[normalizedCurrentEmail];
    persist(nextAccounts);
    return updated;
  }

  function updatePassword(email, passwordHash) {
    const normalizedEmail = normalizeEmail(email);
    const account = findByEmail(normalizedEmail);
    if (!account) throw new Error('Akun website tidak ditemukan.');
    if (!passwordHash || !/^[a-f0-9]{32}$/i.test(passwordHash.salt || '') || !/^[a-f0-9]{128}$/i.test(passwordHash.hash || '')) {
      throw new Error('Hash password tidak valid.');
    }
    const updated = { ...account, passwordHash, updatedAt: new Date().toISOString() };
    persist({ ...accounts, [normalizedEmail]: updated });
    return updated;
  }

  return {
    findByEmail,
    findByDiscordId,
    createAccount,
    createVerifiedAccount,
    linkDiscordAccount,
    unlinkDiscordAccount,
    updateProfile,
    updateEmail,
    updatePassword,
  };
}

module.exports = { createUserAccountsStore, normalizeEmail, isValidEmail, hashPassword, verifyPassword };
