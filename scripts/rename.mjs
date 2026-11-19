// Renames the product everywhere it appears.  Usage:  npm run rename -- "UrjaFlow"
import { readFileSync, writeFileSync } from 'node:fs';

const name = process.argv.slice(2).join(' ').trim();
if (!name || name.length > 30 || /["<>\\]/.test(name)) {
  console.error('Usage: npm run rename -- "New Name"   (max 30 characters, no quotes or < >)');
  process.exit(1);
}

const brandFile = 'src/config/brand.ts';
const brand = readFileSync(brandFile, 'utf8');
const old = brand.match(/name: '([^']*)'/)?.[1];
if (!old) { console.error('Could not find the current name in ' + brandFile); process.exit(1); }
const safe = name.replace(/'/g, "\\'");

writeFileSync(brandFile, brand.replace(/name: '[^']*'/, `name: '${safe}'`));

const html = readFileSync('index.html', 'utf8')
  .replace(/<title>[^<]*<\/title>/, `<title>${name}</title>`)
  .replace(/(apple-mobile-web-app-title" content=")[^"]*/, `$1${name}`);
writeFileSync('index.html', html);

const manifest = JSON.parse(readFileSync('public/manifest.webmanifest', 'utf8'));
manifest.name = `${name} — Solar Business Manager`;
manifest.short_name = name.slice(0, 12);
writeFileSync('public/manifest.webmanifest', JSON.stringify(manifest, null, 2) + '\n');

console.log(`Renamed "${old}" → "${name}". Run "npm run build" and redeploy.`);
