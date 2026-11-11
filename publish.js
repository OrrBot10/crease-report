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

function encrypt(buf, password) {
  const salt = crypto.randomBytes(16), iv = crypto.randomBytes(12);
  const key = crypto.pbkdf2Sync(password, salt, ITERATIONS, 32, 'sha256');
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  // WebCrypto's AES-GCM expects the auth tag appended to the ciphertext.
  const data = Buffer.concat([cipher.update(buf), cipher.final(), cipher.getAuthTag()]);
  return { iter: ITERATIONS, salt: salt.toString('base64'), iv: iv.toString('base64'), data: data.toString('base64') };
}

function decrypt(enc, password) {
  const key = crypto.pbkdf2Sync(password, Buffer.from(enc.salt, 'base64'), enc.iter, 32, 'sha256');
  const d = Buffer.from(enc.data, 'base64');
  const decipher = crypto.createDecipheriv('aes-256-gcm', key, Buffer.from(enc.iv, 'base64'));
  decipher.setAuthTag(d.subarray(-16));
  return Buffer.concat([decipher.update(d.subarray(0, -16)), decipher.final()]);
}

// The focus goalie's photo rides inside the encrypted data rather than sitting
// in the public repo. A family photo is kept encrypted in the repo
// (npm run set-photo); otherwise the league roster photo is downloaded and cached.
async function photoDataUrl(config) {
  if (config.focusPhotoFile) {
    const file = path.join(__dirname, config.focusPhotoFile);
    try {
      return 'data:image/jpeg;base64,' + decrypt(JSON.parse(fs.readFileSync(file, 'utf8')), sitePassword()).toString('base64');
    } catch (e) {
      console.warn(`Couldn't read ${config.focusPhotoFile} (${e.message}). If the password changed, re-run npm run set-photo. Falling back to the roster photo.`);
    }
  }
  const url = config.focusPhotoUrl;
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

async function publish(out) {
  out.config = { ...out.config, focusPhoto: await photoDataUrl(out.config) };
  const enc = encrypt(Buffer.from(JSON.stringify(out), 'utf8'), sitePassword());
  fs.mkdirSync(path.join(__dirname, 'public'), { recursive: true });
  fs.writeFileSync(path.join(__dirname, 'public', 'data.js'), 'window.ENC = ' + JSON.stringify(enc) + ';\n');
  stampVersion();
}

// GitHub Pages lets browsers cache files for 10 minutes, which can pair a new
// page with an old stylesheet. Stamp asset links with a hash of their contents
// so every update loads fresh copies.
function stampVersion() {
  const pub = path.join(__dirname, 'public');
  const hash = crypto.createHash('sha256');
  for (const f of ['styles.css', 'app.js', 'gate.js', 'data.js']) hash.update(fs.readFileSync(path.join(pub, f)));
  const v = hash.digest('hex').slice(0, 10);
  const index = path.join(pub, 'index.html');
  fs.writeFileSync(index, fs.readFileSync(index, 'utf8').replace(/\?v=[\w-]+/g, '?v=' + v));
}

module.exports = publish;
module.exports.encrypt = encrypt;
module.exports.sitePassword = sitePassword;
