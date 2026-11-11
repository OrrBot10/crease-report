// Writes public/data.js encrypted with the site password, so the public site
// shows nothing until the password is entered. The password comes from the
// SITE_PASSWORD environment variable (a GitHub Actions secret) or, locally,
// from a .site-password file that is never committed.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const ITERATIONS = 250000;

function sitePassword() {
  if (process.env.SITE_PASSWORD) return process.env.SITE_PASSWORD.trim();
  const file = path.join(__dirname, '.site-password');
  if (fs.existsSync(file)) return fs.readFileSync(file, 'utf8').trim();
  throw new Error('No site password: set SITE_PASSWORD or create a .site-password file.');
}

// The focus goalie's photo rides inside the encrypted data rather than sitting
// in the public repo. It's downloaded from the league roster once and cached.
async function photoDataUrl(url) {
  if (!url) return null;
  const file = path.join(__dirname, 'cache', 'focus-photo.jpg');
  if (!fs.existsSync(file)) {
    const res = await fetch(url);
    if (!res.ok) { console.warn(`Photo download failed (HTTP ${res.status}); continuing without it.`); return null; }
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, Buffer.from(await res.arrayBuffer()));
  }
  return 'data:image/jpeg;base64,' + fs.readFileSync(file).toString('base64');
}

module.exports = async function publish(out) {
  out.config = { ...out.config, focusPhoto: await photoDataUrl(out.config.focusPhotoUrl) };
  const salt = crypto.randomBytes(16), iv = crypto.randomBytes(12);
  const key = crypto.pbkdf2Sync(sitePassword(), salt, ITERATIONS, 32, 'sha256');
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  // WebCrypto's AES-GCM expects the auth tag appended to the ciphertext.
  const data = Buffer.concat([cipher.update(JSON.stringify(out), 'utf8'), cipher.final(), cipher.getAuthTag()]);
  const enc = { iter: ITERATIONS, salt: salt.toString('base64'), iv: iv.toString('base64'), data: data.toString('base64') };
  fs.mkdirSync(path.join(__dirname, 'public'), { recursive: true });
  fs.writeFileSync(path.join(__dirname, 'public', 'data.js'), 'window.ENC = ' + JSON.stringify(enc) + ';\n');
};
