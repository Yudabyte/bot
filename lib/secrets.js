const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const ALGORITHM = 'aes-256-gcm';
const KEY_FILE = path.join(__dirname, '..', 'data', 'credential.key');

function getKey() {
  const value = process.env.CREDENTIAL_ENCRYPTION_KEY || '';
  if (value && !value.startsWith('YOUR_')) {
    if (!/^[a-f0-9]{64}$/i.test(value)) {
      throw new Error('CREDENTIAL_ENCRYPTION_KEY harus berupa 64 karakter hexadecimal (32 byte).');
    }
    return Buffer.from(value, 'hex');
  }

  fs.mkdirSync(path.dirname(KEY_FILE), { recursive: true });
  if (!fs.existsSync(KEY_FILE)) {
    const key = crypto.randomBytes(32).toString('hex');
    try {
      fs.writeFileSync(KEY_FILE, `${key}\n`, { flag: 'wx', mode: 0o600 });
    } catch (error) {
      if (error.code !== 'EEXIST') throw error;
    }
  }
  const storedKey = fs.readFileSync(KEY_FILE, 'utf8').trim();
  if (!/^[a-f0-9]{64}$/i.test(storedKey)) {
    throw new Error('Kunci enkripsi lokal data/credential.key tidak valid.');
  }
  return Buffer.from(storedKey, 'hex');
}

function getSessionSecret() {
  const configured = process.env.SESSION_SECRET || '';
  if (configured && !configured.startsWith('YOUR_')) return configured;
  return crypto.createHmac('sha256', getKey()).update('embed-studio-session').digest('hex');
}

function encryptSecret(value) {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv(ALGORITHM, getKey(), iv);
  const encrypted = Buffer.concat([cipher.update(value, 'utf8'), cipher.final()]);
  return {
    iv: iv.toString('hex'),
    tag: cipher.getAuthTag().toString('hex'),
    data: encrypted.toString('hex'),
  };
}

function decryptSecret(value) {
  const decipher = crypto.createDecipheriv(ALGORITHM, getKey(), Buffer.from(value.iv, 'hex'));
  decipher.setAuthTag(Buffer.from(value.tag, 'hex'));
  return Buffer.concat([
    decipher.update(Buffer.from(value.data, 'hex')),
    decipher.final(),
  ]).toString('utf8');
}

module.exports = { encryptSecret, decryptSecret, getSessionSecret };
