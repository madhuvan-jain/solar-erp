// Writes public/demo/demo-data.json: the fictional company used for the brochure, as test data
// that Settings → "Demo data (testing only)" can load on a device.
//
//   npm run demo-data
//
// Dates are relative to today; the app moves them forward to the day the data is loaded.
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildData, TODAY } from './brochure/make-brochure.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const OUT = join(ROOT, 'public', 'demo', 'demo-data.json');

// Placeholder owner: the app swaps this id for whoever loads the data. Demo users get no password here.
const ADMIN_ID = '00000000-0000-4000-8000-00000000de00';
const { data, users } = buildData({ id: ADMIN_ID, name: 'Rohit Sinha', email: 'rohit@suryoday.example', role: 'admin', salt: '', hash: '' });
const out = {
  app: 'solar-erp',
  kind: 'demo',
  version: 1,
  generatedOn: TODAY,
  ownerId: ADMIN_ID,
  // Made-up mobile numbers for the demo team (+91 70000 0000x).
  users: users.map(({ id, name, email, role }, i) => ({ id, name, email, role, phone: `+9170000${String(i + 1).padStart(5, '0')}` })),
  data,
};
mkdirSync(dirname(OUT), { recursive: true });
writeFileSync(OUT, JSON.stringify(out));
const total = Object.values(data).reduce((s, l) => s + l.length, 0);
console.log(`✓ ${OUT}: ${total} records in ${Object.keys(data).length} tables, ${users.length} demo users`);
