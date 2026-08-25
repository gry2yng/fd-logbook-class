// Runs the real bookmarklet code in a fake browser, against a fake Clarity.
// Checks the backward walk, the seam de-duplication, the sort and the renumbering.
import fs from 'node:fs';

const SRC = new URL('../src/get-history.js', import.meta.url).pathname;
const DAY = 864e5;
const HISTORY_DAYS = Number(process.env.HISTORY_DAYS ?? '200');
const ENDS_DAYS_AGO = Number(process.env.ENDS_DAYS_AGO ?? '0');
const now = new Date();
const historyStart = new Date(now - HISTORY_DAYS * DAY);
const historyEnd = new Date(now - ENDS_DAYS_AGO * DAY);
const GAP_FROM = Number(process.env.GAP_FROM ?? '0');   // days ago, start of a sensor-free spell
const GAP_TO   = Number(process.env.GAP_TO ?? '0');     // days ago, end of it
const inGap = (d) => GAP_FROM && d <= new Date(now - GAP_TO*DAY) && d >= new Date(now - GAP_FROM*DAY);

const HEADER = ['Index','Timestamp (YYYY-MM-DDThh:mm:ss)','Event Type','Event Subtype','Patient Info',
  'Device Info','Source Device ID','Glucose Value (mg/dL)','Insulin Value (u)','Carb Value (grams)',
  'Duration (hh:mm:ss)','Glucose Rate of Change (mg/dL/min)','Transmitter Time (Long Integer)','Transmitter ID'];
const p2 = (n) => String(n).padStart(2, '0');
const naive = (d) => `${d.getFullYear()}-${p2(d.getMonth()+1)}-${p2(d.getDate())}T${p2(d.getHours())}:${p2(d.getMinutes())}:${p2(d.getSeconds())}`;
const q = (v) => '"' + String(v ?? '').replace(/"/g,'""') + '"';

// ── a fake Clarity ────────────────────────────────────────────────────────────
const requests = [];
globalThis.fetch = async (url, init) => {
  const iv = new URLSearchParams(init.body).get('dateInterval');
  const [a, b] = iv.split('/');
  requests.push({ url, iv, fields: [...new URLSearchParams(init.body).keys()] });
  const [sy,sm,sd] = a.split('-').map(Number), [ey,em,ed] = b.split('-').map(Number);
  const lo = new Date(sy,sm-1,sd,0,0,0), hi = new Date(ey,em-1,ed,23,59,59);
  const rows = [HEADER.map(q).join(',')];
  let n = 0, slot = 0;
  // Two metadata rows with no timestamp, exactly as Clarity emits them every time.
  rows.push([q(++n),q(''),q('FirstName'),...Array(11).fill(q(''))].join(','));
  rows.push([q(++n),q(''),q('Device'),q(''),q(''),q('Dexcom G7'),...Array(8).fill(q(''))].join(','));
  for (let t = historyStart.getTime(); t <= historyEnd.getTime(); t += 3*3600e3) {
    const d = new Date(t); slot++;
    if (d < lo || d > hi) continue;
    if (inGap(d)) continue;
    const r = Array(HEADER.length).fill('');
    r[0] = String(++n); r[1] = naive(d);
    if (slot % 9 === 0) { r[2]='Note'; r[13]='ate lunch, then walked'; }   // comma inside a field
    else { r[2]='EGV'; r[7]=String(90 + (slot % 60)); }
    rows.push(r.map(q).join(','));
  }
  return { ok: true, status: 200, text: async () => rows.join('\r\n') + '\r\n' };
};

// ── a fake browser ────────────────────────────────────────────────────────────
const mkPayload = () => Buffer.from(JSON.stringify({
  subjectId: '1819512572995477504', given_name: 'Test', family_name: 'Student',
})).toString('base64url');
const TOKEN = 'eyJhbGciOiJIUzI1NiJ9.' + mkPayload() + '.c2lnbmF0dXJl';

const el = () => ({
  style:{}, children:[], textContent:'', href:'', download:'',
  setAttribute(){}, appendChild(c){ this.children.push(c); }, remove(){},
  click(){ downloaded = true; filename = this.download; }, scrollTop:0, scrollHeight:0,
});
let downloaded = false, panelText = '', filename = '';
const panel = el();
globalThis.document = {
  getElementById: () => null,
  createElement: () => {
    const e = el();
    Object.defineProperty(e, 'textContent', {
      set(v){ panelText = v; }, get(){ return panelText; }, configurable: true,
    });
    return e;
  },
  body: { appendChild(){}, innerText: 'Average glucose 138 mg/dL' },
  addEventListener(){},
};
globalThis.window = globalThis;
globalThis.localStorage = {
  length: 1, key: () => 'clarity_externalSession', getItem: () => TOKEN,
};
globalThis.sessionStorage = { length: 0, key: () => null, getItem: () => null };
let captured = null;
globalThis.URL.createObjectURL = (blob) => { captured = blob; return 'blob:fake'; };
globalThis.URL.revokeObjectURL = () => {};

// ── run it ────────────────────────────────────────────────────────────────────
await eval(fs.readFileSync(SRC, 'utf8'));
await new Promise((r) => setTimeout(r, 300));

let failures = 0;
const check = (label, ok, detail='') => {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${detail ? ` — ${detail}` : ''}`);
  if (!ok) failures++;
};

console.log('\n--- panel the student sees ---');
console.log(panelText);
console.log('\n--- assertions ---');

check('every request carried the name fields',
  requests.every(r => r.fields.includes('firstName') && r.fields.includes('lastName')),
  requests[0].fields.join(','));

if (ENDS_DAYS_AGO > 360) {
  // Silence longer than four empty stretches: it should give up and say so plainly.
  check('gave up rather than looping', requests.length <= 6, `${requests.length} request(s)`);
  check('downloaded nothing', !downloaded && !captured);
  check('explained itself instead of claiming success', /Nothing came back/.test(panelText));
  check('did not claim a file was saved', !/Downloads folder/.test(panelText));
  console.log(`\n${failures === 0 ? '✓ ALL CHECKS PASSED' : `✗ ${failures} CHECK(S) FAILED`}`);
  process.exit(failures ? 1 : 0);
}

if (ENDS_DAYS_AGO > 90) {
  // Newest reading older than the first stretch. This used to come back empty-handed;
  // stepping past empty stretches should now recover the whole record.
  check('stepped past the empty stretches and found the data', downloaded && captured);
  check('reported the empty stretches honestly', /nothing here/.test(panelText));
}

check('walked more than one window', requests.length >= 2, `${requests.length}: ${requests.map(r=>r.iv).join(' | ')}`);
check('a file was downloaded', downloaded && captured, `${captured ? captured.size + ' bytes' : 'nothing'}`);

const csv = await captured.text();
const lines = csv.trim().split('\r\n');
const cells = (l) => l.match(/"([^"]|"")*"/g).map(s => s.slice(1,-1).replace(/""/g,'"'));
const data = lines.slice(1).map(cells);
const stamped = data.filter(r => r[1]);

check('header preserved', lines[0].includes('Timestamp (YYYY-MM-DDThh:mm:ss)'));
check('index renumbered with no gaps',
  data.every((r,i) => Number(r[0]) === i+1), `last index ${data.at(-1)[0]} of ${data.length} rows`);

const stamps = stamped.map(r => r[1]);
check('sorted oldest to newest', stamps.every((s,i) => i===0 || s >= stamps[i-1]), `${stamps[0]} … ${stamps.at(-1)}`);
check('no duplicate rows across the seams',
  new Set(stamps.map((s,i)=>s+'|'+stamped[i][2])).size === stamps.length,
  `${stamps.length} rows, ${new Set(stamps).size} distinct times`);

let expected = Math.floor((historyEnd - historyStart) / (3*3600e3)) + 1;
if (GAP_FROM) expected -= Math.floor(((now - GAP_TO*DAY) - (now - GAP_FROM*DAY)) / (3*3600e3)) + 1;
check('captured the whole record', Math.abs(stamped.length - expected) <= 2, `${stamped.length} of ~${expected}`);
check('reached the start of the record',
  Math.abs(new Date(stamps[0]) - historyStart) < 4*3600e3, `oldest ${stamps[0]}`);
check('metadata rows kept once, not once per window',
  data.filter(r => r[2] === 'Device').length === 1,
  `${data.filter(r => !r[1]).length} untimed rows total`);
check('a field containing a comma survived intact',
  stamped.some(r => r[13] === 'ate lunch, then walked'), '');
check('told the student where the file went', /Downloads folder/.test(panelText));

const hostZone = Intl.DateTimeFormat().resolvedOptions().timeZone;
const tzRow = data.find(r => r[2] === 'Timezone');
check('csv declares the timezone it was recorded in', !!tzRow && tzRow[3] === hostZone, `${tzRow ? tzRow[3] : 'no Timezone row'} vs host ${hostZone}`);
check('timezone row carries no timestamp, so importers skip it', !!tzRow && !tzRow[1]);
check('timezone row appears exactly once', data.filter(r => r[2] === 'Timezone').length === 1);
check('filename carries the timezone', filename.includes(hostZone.replace(/\//g,'-')), filename);
check('the zone is a real IANA name', (() => { try { new Intl.DateTimeFormat('en-US',{timeZone:tzRow[3]}); return true; } catch { return false; } })(), tzRow ? tzRow[3] : '');

console.log(`\n${failures === 0 ? '✓ ALL CHECKS PASSED' : `✗ ${failures} CHECK(S) FAILED`}`);
process.exit(failures ? 1 : 0);
