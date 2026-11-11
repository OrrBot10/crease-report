// Encrypts a (cropped) JPG with the site password and saves it as the
// spotlight photo: npm run set-photo -- path/to/photo.jpg
// Re-run this if the site password changes.
const fs = require('fs');
const path = require('path');
const { encrypt, sitePassword } = require('./publish');

const src = process.argv[2];
if (!src || !fs.existsSync(src)) {
  console.error('Usage: npm run set-photo -- path/to/photo.jpg');
  process.exit(1);
}
const rel = 'assets/focus-photo.enc.json';
fs.mkdirSync(path.join(__dirname, 'assets'), { recursive: true });
fs.writeFileSync(path.join(__dirname, rel), JSON.stringify(encrypt(fs.readFileSync(src), sitePassword())));
const configFile = path.join(__dirname, 'config.json');
const config = JSON.parse(fs.readFileSync(configFile, 'utf8'));
config.focusPhotoFile = rel;
fs.writeFileSync(configFile, JSON.stringify(config, null, 2) + '\n');
console.log(`Saved encrypted photo to ${rel}. Run npm run analyze to rebuild the site.`);
