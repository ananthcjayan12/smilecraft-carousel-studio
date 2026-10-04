// Seeds (or resets) the demo clinic accounts in Cloudflare D1 + R2.
//   node scripts/demo/seed.mjs            upload images and write the database
//   node scripts/demo/seed.mjs --dry-run  print the SQL and upload list only
// Requires wrangler.generated.json (from `npm run cloudflare:prepare`) and CLOUDFLARE_* env.
// Re-running is safe: it wipes only the demo accounts' data and restores the prepared week.
import { readFile, writeFile, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawn } from 'node:child_process';
import { contentContext, contactDetails, checkDraft } from '../../server/v4/content-prompts.mjs';
import { STYLE_REFERENCES } from '../../server/v4/image-prompts.mjs';
import { weekStart } from '../../server/v4/service.mjs';
import { DEMO_CLINICS, ASSET_DIR } from './clinics.mjs';
import { demoImages } from './build-assets.mjs';

export const DEMO_CREDITS = 200;
const q = v => v === null || v === undefined ? 'NULL' : typeof v === 'number' ? String(v) : `'${String(v).replaceAll("'", "''")}'`;
const insert = (table, row) => `INSERT INTO ${table}(${Object.keys(row).join(',')}) VALUES(${Object.values(row).map(q).join(',')});`;
export const demoIds = clinic => ({ account: `demo-acct-${clinic.key}`, user: `demo-user-${clinic.key}`, clinic: `demo-clinic-${clinic.key}` });
const VARIANTS = [['original', 'original.png', 'image/png'], ['preview', 'preview.webp', 'image/webp'], ['thumb', 'thumb.webp', 'image/webp']];

export function seedPlan(manifest, now = new Date()) {
  const sql = [], uploads = [], at = now.toISOString(), week = weekStart(now);
  for (const clinic of DEMO_CLINICS) {
    const ids = demoIds(clinic), A = ids.account, assetId = name => `demo-asset-${clinic.key}-${name}`;
    // Reset: children before parents (D1 enforces foreign keys).
    for (const table of ['v4_jobs', 'v4_usage', 'v4_content', 'v4_weeks', 'v4_styles', 'v4_assets', 'v4_clinics', 'credit_reservations', 'credit_ledger']) sql.push(`DELETE FROM ${table} WHERE account_id=${q(A)};`);
    sql.push(`INSERT OR IGNORE INTO accounts(id,name) VALUES(${q(A)},${q(clinic.name)});`,
      `INSERT OR IGNORE INTO users(id,identity_provider,identity_subject,email) VALUES(${q(ids.user)},'demo',${q(clinic.name)},${q(`demo+${clinic.key}@srshti.local`)});`,
      `INSERT OR IGNORE INTO memberships(account_id,user_id,role) VALUES(${q(A)},${q(ids.user)},'owner');`,
      `INSERT INTO subscriptions(account_id,plan_id,plan_version,status) VALUES(${q(A)},'weekly-content',1,'manual') ON CONFLICT(account_id) DO UPDATE SET plan_id='weekly-content',plan_version=1,status='manual';`,
      insert('credit_ledger', { id: `demo-credit-${clinic.key}`, account_id: A, amount: DEMO_CREDITS, kind: 'manual_plan', source_id: 'demo-seed' }));
    for (const image of demoImages(clinic)) {
      const stats = manifest[`${clinic.key}/${image.name}`];
      if (!stats) throw new Error(`Missing built asset ${clinic.key}/${image.name}. Run node scripts/demo/build-assets.mjs.`);
      const prefix = `${A}/v4/${ids.clinic}/demo/${image.name}`;
      for (const [variant, file, mime] of VARIANTS) uploads.push({ key: `${prefix}/${variant}`, file: join(ASSET_DIR, clinic.key, image.name, file), mime });
      sql.push(insert('v4_assets', { id: assetId(image.name), account_id: A, clinic_id: ids.clinic, mime: 'image/png', original_key: `${prefix}/original`, preview_key: `${prefix}/preview`, thumbnail_key: `${prefix}/thumb`, width: stats.width, height: stats.height, size: stats.size, created_at: at }));
    }
    const styleIds = clinic.styles.map(s => `demo-style-${clinic.key}-${s.key}`);
    const c = { id: ids.clinic, account_id: A, name: clinic.name,
      profile: { website: '', instagram: '', goal: 'Educate existing patients', emphasis: '', ...clinic.profile, language: 'English', confirmed: true, facts: [] },
      brand: { ...clinic.brand, logoAssetId: assetId('logo') },
      styleSelection: { primaryStyleId: styleIds[0], secondaryStyleIds: styleIds.slice(1) } };
    sql.push(insert('v4_clinics', { id: c.id, account_id: A, name: c.name, profile_json: JSON.stringify(c.profile), brand_json: JSON.stringify(c.brand), style_json: JSON.stringify(c.styleSelection), status: 'active', revision: 1, created_at: at, updated_at: at }));
    clinic.styles.forEach((s, i) => sql.push(insert('v4_styles', { id: styleIds[i], account_id: A, clinic_id: c.id, reference_id: STYLE_REFERENCES[i], name: s.name, asset_id: assetId(s.key), status: 'ready', created_at: at })));
    const weekId = `demo-week-${clinic.key}`;
    sql.push(insert('v4_weeks', { id: weekId, account_id: A, clinic_id: c.id, week_start: week, status: clinic.items.some(i => i.live) ? 'planned' : 'ready', created_at: at }));
    clinic.items.forEach((item, position) => {
      // Same style rotation the weekly planner uses: primary first, then supporting styles.
      const styleId = item.type === 'story' ? styleIds[2] : position > 0 ? styleIds[1] : styleIds[0];
      const brief = { origin: 'custom', sourceTopic: item.topic, sourceSummary: item.summary, topic: item.topic, summary: item.summary, language: 'English', angle: 'Custom content', facts: item.facts, sources: item.sources, prohibitedClaims: [], sourceRequirement: '', reviewStatus: 'reviewed', libraryEntry: null, contactKeys: Object.keys(contactDetails(c)) };
      const row = { id: `demo-item-${clinic.key}-${item.key}`, type: item.type, language: 'English', brief };
      const context = contentContext(c, row), contacts = context.business.contacts;
      const frames = item.frames.map((f, i) => ({ heading: f.heading, body: f.body, visualPrompt: f.visualPrompt, position: i + 1, assetId: f.source ? assetId(`${item.key}-${i + 1}`) : '', approved: false, contacts: i === item.frames.length - 1 ? contacts : {} }));
      const problem = checkDraft({ type: item.type, frames, caption: item.caption });
      if (problem) throw new Error(`${clinic.key}/${item.key}: ${problem}`);
      sql.push(insert('v4_content', { id: row.id, account_id: A, clinic_id: c.id, week_id: weekId, position, type: item.type, knowledge_card_id: '', angle_id: '', recipe_id: `${item.type}:custom`, style_id: styleId, topic: item.topic, caption: item.caption, frames_json: JSON.stringify(frames), status: item.live ? 'planned' : 'ready', revision: 2, created_at: new Date(now.getTime() + position).toISOString(), brief_json: JSON.stringify(brief), language: 'English', copy_status: 'approved', validation_json: JSON.stringify({ valid: true, issues: [], at }), copy_approved_at: at, context_json: JSON.stringify(context) }));
    });
  }
  return { sql: sql.join('\n') + '\n', uploads };
}

const once = (args, env) => new Promise((resolve, reject) => {
  const child = spawn('npx', ['--no-install', 'wrangler', ...args], { stdio: ['ignore', 'pipe', 'pipe'], env });
  let output = ''; child.stdout.on('data', d => output += d); child.stderr.on('data', d => output += d);
  child.on('close', code => code === 0 ? resolve(output) : reject(new Error(`wrangler ${args.slice(0, 3).join(' ')} failed:\n${output.slice(-1500)}`)));
});
// Wrangler network calls fail transiently; every step here is idempotent, so retry.
async function npx(args, env = process.env) {
  for (let attempt = 1; ; attempt++) {
    try { return await once(args, env); }
    catch (error) { if (attempt === 6) throw error; await new Promise(r => setTimeout(r, 3000 * attempt)); }
  }
}

async function main() {
  const dryRun = process.argv.includes('--dry-run');
  const manifest = JSON.parse(await readFile(join(ASSET_DIR, 'manifest.json'), 'utf8'));
  const { sql, uploads } = seedPlan(manifest);
  if (dryRun) { process.stdout.write(sql); console.error(`\n${uploads.length} R2 uploads planned.`); return; }
  const config = JSON.parse(await readFile('wrangler.generated.json', 'utf8')), bucket = config.r2_buckets[0].bucket_name;
  let done = 0; const queue = [...uploads];
  await Promise.all(Array.from({ length: 3 }, async () => {
    for (let u; (u = queue.shift());) {
      await npx(['r2', 'object', 'put', `${bucket}/${u.key}`, '--file', u.file, '--content-type', u.mime, '--remote', '--config', 'wrangler.generated.json']);
      if (++done % 15 === 0 || done === uploads.length) console.log(`Uploaded ${done}/${uploads.length} images`);
    }
  }));
  const dir = await mkdtemp(join(tmpdir(), 'demo-seed-'));
  try {
    await writeFile(join(dir, 'seed.sql'), sql);
    await npx(['d1', 'execute', 'DB', '--remote', '--yes', '--file', join(dir, 'seed.sql'), '--config', 'wrangler.generated.json']);
  } finally { await rm(dir, { recursive: true, force: true }); }
  console.log(`Demo clinics ready: ${DEMO_CLINICS.map(c => c.name).join(', ')} (${DEMO_CREDITS} credits each).`);
}

if (process.argv[1]?.endsWith('/seed.mjs')) main().catch(error => { console.error(error.message); process.exitCode = 1; });
