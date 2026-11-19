// Puts your business details into every policy page and store document, the website address and the Android app id.
//   1. Fill go-live/my-details.json
//   2. node scripts/fill-details.mjs --dry-run      (lists what would change, changes nothing)
//   3. node scripts/fill-details.mjs                (changes the files; run it once, before the first deploy)
// "Play package id" can never change once the app is on Google Play; leave it as is unless you want your own.
import { readFileSync, writeFileSync, readdirSync, existsSync, mkdirSync, renameSync, rmSync } from 'node:fs';
import { join, dirname } from 'node:path';

const dry = process.argv.includes('--dry-run');
const details = JSON.parse(readFileSync('go-live/my-details.json', 'utf8'));
const placeholders = Object.entries(details).filter(([k]) => !k.startsWith('_') && k !== 'ownerEmail'); // (ownerEmail: no longer used)
const empty = placeholders.filter(([k, v]) => !String(v).trim() && k !== 'SMS provider name').map(([k]) => k);
if (empty.length && !process.argv.includes('--allow-empty')) {
  console.error(`Fill these in go-live/my-details.json first (or add --allow-empty): ${empty.join(', ')}`);
  process.exit(1);
}
const checks = [
  ['website URL', /^https:\/\/[^\s/]+(\/[^\s]*)?[^/]$/, 'must start with https:// and have no / at the end'],
  ['support email', /^[^@\s]+@[^@\s]+\.[^@\s]+$/, 'must be an email address'],
  ['Demo account email', /^$|^[^@\s]+@[^@\s]+\.[^@\s]+$/, 'must be an email address'],
  ['Play package id', /^[a-z][a-z0-9_]*(\.[a-z][a-z0-9_]*){2,}$/, 'must look like in.yourcompany.app (lower case, at least three parts)'],
];
for (const [k, re, why] of checks) if (String(details[k] || '').trim() && !re.test(String(details[k]).trim())) { console.error(`${k}: ${why}`); process.exit(1); }

const files = [
  ...readdirSync('public').filter((f) => f.endsWith('.html')).map((f) => join('public', f)),
  ...readdirSync('docs/publishing').filter((f) => f.endsWith('.md')).map((f) => join('docs/publishing', f)),
];
let changed = 0;
const write = (file, text) => { changed++; if (!dry) writeFileSync(file, text); };
for (const file of files) {
  if (file.endsWith('docs/publishing/README.md')) continue; // the table explaining the placeholders stays as it is
  let s = readFileSync(file, 'utf8');
  const before = s;
  for (const [k, v] of placeholders) if (String(v).trim()) s = s.split(`[${k}]`).join(String(v).trim());
  if (s !== before) { write(file, s); console.log(`${dry ? 'would update' : 'updated'}  ${file}`); }
}

// The website address, for the Android app's confirm-email and reset-password links.
if (details['website URL']) {
  const f = '.env';
  let s = existsSync(f) ? readFileSync(f, 'utf8') : readFileSync('.env.example', 'utf8');
  s = /^VITE_PUBLIC_URL=.*$/m.test(s) ? s.replace(/^VITE_PUBLIC_URL=.*$/m, `VITE_PUBLIC_URL=${details['website URL'].trim()}`) : s + `\nVITE_PUBLIC_URL=${details['website URL'].trim()}\n`;
  write(f, s); console.log(`${dry ? 'would set' : 'set'}  VITE_PUBLIC_URL in .env (add VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY there yourself)`);
}

// The Android package id and iPhone bundle id (only before the first Play / App Store upload).
const newId = String(details['Play package id'] || '').trim();
const cap = JSON.parse(readFileSync('capacitor.config.json', 'utf8'));
if (newId && newId !== cap.appId) {
  const oldId = cap.appId;
  const edits = [
    ['capacitor.config.json', (s) => s.split(`"${oldId}"`).join(`"${newId}"`)],
    ['android/app/build.gradle', (s) => s.split(`"${oldId}"`).join(`"${newId}"`)],
    ['android/app/src/main/res/values/strings.xml', (s) => s.split(`>${oldId}<`).join(`>${newId}<`)],
    ['android/app/src/main/assets/capacitor.config.json', (s) => s.split(`"${oldId}"`).join(`"${newId}"`)],
    // The iPhone app's bundle id (the same id, so both stores show the same app id).
    ['ios/App/App.xcodeproj/project.pbxproj', (s) => s.split(`PRODUCT_BUNDLE_IDENTIFIER = ${oldId};`).join(`PRODUCT_BUNDLE_IDENTIFIER = ${newId};`)],
  ];
  for (const [f, fn] of edits) if (existsSync(f)) { const s = readFileSync(f, 'utf8'); const t = fn(s); if (t !== s) write(f, t); }
  const oldJava = join('android/app/src/main/java', ...oldId.split('.'), 'MainActivity.java');
  const newJava = join('android/app/src/main/java', ...newId.split('.'), 'MainActivity.java');
  if (existsSync(oldJava)) {
    const src = readFileSync(oldJava, 'utf8').replace(`package ${oldId};`, `package ${newId};`);
    if (!dry) { mkdirSync(dirname(newJava), { recursive: true }); writeFileSync(newJava, src); rmSync(oldJava); }
    changed++;
  }
  console.log(`${dry ? 'would change' : 'changed'}  the Android package id and iPhone bundle id ${oldId} → ${newId}`);
}

// Anything still to fill?
const left = new Set();
for (const file of files) {
  if (file.endsWith('docs/publishing/README.md')) continue;
  const s = existsSync(file) ? readFileSync(file, 'utf8') : '';
  for (const m of s.matchAll(/\[(Legal entity name|Registered address|Grievance Officer name|support email|phone|website URL|Effective date|Jurisdiction city|Lead retention period|Fees and refund terms|Liability cap amount|Copyright year|SMS provider name|Demo account email|Demo account password|Play package id)\]/g)) left.add(`${m[0]} in ${file}`);
}
console.log(`\n${dry ? 'Dry run: nothing changed. ' : ''}${changed} file(s) ${dry ? 'would change' : 'changed'}.`);
if (left.size) console.log(`Still to fill (${dry ? 'after this run' : 'by hand'}):\n  ` + [...left].slice(0, 30).join('\n  '));
