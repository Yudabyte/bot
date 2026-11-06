const nodemailer = require('nodemailer');

function createOtpMailer({ env = process.env, createTransport = nodemailer.createTransport } = {}) {
  return async function sendVerificationCode({ to, fullName, code, action = 'verifikasi email' }) {
    const host = String(env.SMTP_HOST || '').trim();
    const port = Number(env.SMTP_PORT || 587);
    const user = String(env.SMTP_USER || '').trim();
    const password = String(env.SMTP_PASS || '');
    const from = String(env.EMAIL_FROM || '').trim();
    const secure = String(env.SMTP_SECURE || (port === 465 ? 'true' : 'false')).toLowerCase() === 'true';

    if (!host || !from || !user || !password || !Number.isInteger(port) || port < 1 || port > 65535) {
      throw new Error('Email OTP belum dikonfigurasi. Atur SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS, dan EMAIL_FROM pada konfigurasi server.');
    }

    const transporter = createTransport({
      host,
      port,
      secure,
      auth: { user, pass: password },
    });
    const textName = String(fullName || 'pengguna').replace(/[\r\n]+/g, ' ');
    const htmlName = textName.replace(/[&<>"]/g, (character) => ({
      '&': '&amp;',
      '<': '&lt;',
      '>': '&gt;',
      '"': '&quot;',
    })[character]);
    await transporter.sendMail({
      from,
      to,
      subject: `Kode OTP ${action} Embed Studio`,
      text: `Halo ${textName},\n\nKode OTP untuk ${action} akun Embed Studio kamu: ${code}\n\nKode berlaku selama 10 menit. Jangan bagikan kode ini kepada siapa pun.`,
      html: `<p>Halo ${htmlName},</p><p>Kode OTP untuk ${action} akun Embed Studio kamu:</p><p style="font-size:28px;font-weight:bold;letter-spacing:8px">${code}</p><p>Kode berlaku selama 10 menit. Jangan bagikan kode ini kepada siapa pun.</p>`,
    });
  };
}

module.exports = { createOtpMailer };
