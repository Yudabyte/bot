const fs = require('fs');
const path = require('path');
const session = require('express-session');

class JsonSessionStore extends session.Store {
  constructor(filePath) {
    super();
    this.filePath = filePath;
    this.sessions = {};
    this.writeChain = Promise.resolve();
    try {
      this.sessions = JSON.parse(fs.readFileSync(filePath, 'utf8'));
      if (!this.sessions || Array.isArray(this.sessions) || typeof this.sessions !== 'object') {
        throw new Error('File sesi harus berisi objek.');
      }
    } catch (error) {
      if (error.code !== 'ENOENT') throw new Error(`Gagal membaca penyimpanan sesi: ${error.message}`);
    }

    this.cleanupTimer = setInterval(() => this.removeExpired(), 60 * 60 * 1000);
    this.cleanupTimer.unref();
  }

  isExpired(value) {
    const expires = value?.cookie?.expires;
    return expires ? Date.parse(expires) <= Date.now() : false;
  }

  get(sessionId, callback) {
    const value = this.sessions[sessionId];
    if (this.isExpired(value)) {
      delete this.sessions[sessionId];
      this.save((error) => callback(error, null));
      return;
    }
    callback(null, value || null);
  }

  set(sessionId, value, callback) {
    this.sessions[sessionId] = value;
    this.save(callback);
  }

  touch(sessionId, value, callback) {
    if (this.sessions[sessionId]) this.sessions[sessionId] = value;
    this.save(callback);
  }

  destroy(sessionId, callback) {
    delete this.sessions[sessionId];
    this.save(callback);
  }

  destroyWebsiteAccountSessions(email, callback) {
    const normalizedEmail = String(email || '').trim().toLowerCase();
    for (const [sessionId, value] of Object.entries(this.sessions)) {
      if (String(value?.websiteAccountEmail || '').trim().toLowerCase() === normalizedEmail) {
        delete this.sessions[sessionId];
      }
    }
    this.save(callback);
  }

  removeExpired() {
    let removed = false;
    for (const [sessionId, value] of Object.entries(this.sessions)) {
      if (this.isExpired(value)) {
        delete this.sessions[sessionId];
        removed = true;
      }
    }
    if (removed) this.save((error) => {
      if (error) console.error('Gagal membersihkan sesi login yang kedaluwarsa:', error.message);
    });
  }

  save(callback) {
    const contents = `${JSON.stringify(this.sessions)}\n`;
    const temporaryFile = `${this.filePath}.${process.pid}.tmp`;
    const operation = this.writeChain.catch(() => {}).then(async () => {
      await fs.promises.mkdir(path.dirname(this.filePath), { recursive: true });
      await fs.promises.writeFile(temporaryFile, contents, { mode: 0o600 });
      await fs.promises.rename(temporaryFile, this.filePath);
    });
    this.writeChain = operation;
    operation.then(
      () => callback?.(null),
      (error) => {
        console.error('Gagal menyimpan sesi login:', error.message);
        callback?.(error);
      }
    );
  }
}

module.exports = JsonSessionStore;
