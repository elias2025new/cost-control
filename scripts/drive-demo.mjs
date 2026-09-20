/**
 * Drive the demo path over real HTTP, through the actual server actions.
 *
 * This exists because the screens are only trustworthy if the buttons work,
 * and the buttons are React server actions — testable from the domain layer,
 * but not proven until something posts a real form to a running server.
 *
 * It submits the no-JS fallback fields Next renders into every form, which is
 * exactly what the browser posts when the action fires.
 *
 *   node scripts/drive-demo.mjs [baseUrl]
 */

const BASE = process.argv[2] ?? 'http://localhost:3000';

const get = async (path) => {
  const res = await fetch(BASE + path, { redirect: 'follow' });
  return { status: res.status, url: res.url, html: await res.text() };
};

/** Pull the hidden fields Next renders for progressive enhancement. */
function actionFields(html, formIndex = 0) {
  const forms = [...html.matchAll(/<form[\s\S]*?<\/form>/g)].map((m) => m[0]);
  const scope = forms[formIndex] ?? html;
  const fields = {};
  for (const m of scope.matchAll(/<input[^>]*type="hidden"[^>]*>/g)) {
    const name = /name="([^"]+)"/.exec(m[0])?.[1];
    const value = /value="([^"]*)"/.exec(m[0])?.[1] ?? '';
    if (name) fields[name] = decodeHtml(value);
  }
  return fields;
}

const decodeHtml = (s) =>
  s
    .replaceAll('&quot;', '"')
    .replaceAll('&amp;', '&')
    .replaceAll('&lt;', '<')
    .replaceAll('&gt;', '>')
    .replaceAll('&#x27;', "'");

async function submit(path, html, values, formIndex = 0) {
  const fd = new FormData();
  for (const [k, v] of Object.entries(actionFields(html, formIndex))) fd.append(k, v);
  for (const [k, v] of Object.entries(values)) fd.append(k, v);

  const res = await fetch(BASE + path, { method: 'POST', body: fd, redirect: 'follow' });
  return { status: res.status, url: res.url, html: await res.text() };
}

const ok = (label, cond, detail = '') => {
  console.log(`  ${cond ? 'PASS' : 'FAIL'}  ${label}${detail ? ' — ' + detail : ''}`);
  if (!cond) process.exitCode = 1;
};

const strip = (html) =>
  html
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/\s+/g, ' ');

/* ------------------------------------------------------------------------ */

console.log('\nDriving the demo path against', BASE, '\n');

// ---- 1. upload the real file through the upload form ---------------------
console.log('1. Upload the CNET export');
let page = await get('/import');
ok('/import renders', page.status === 200);

const fileBuf = await (await import('node:fs/promises')).readFile('reference/cnet_sales_export.xlsx');
const uploadFd = new FormData();
for (const [k, v] of Object.entries(actionFields(page.html))) uploadFd.append(k, v);
uploadFd.append(
  'file',
  new File([fileBuf], 'cnet_sales_export.xlsx', {
    type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  }),
);
const uploaded = await fetch(BASE + '/import', {
  method: 'POST',
  body: uploadFd,
  redirect: 'follow',
});
const uploadedHtml = await uploaded.text();
ok('upload accepted', uploaded.status === 200, `HTTP ${uploaded.status}`);

// find the import we just created
page = await get('/import');
const importId = [...page.html.matchAll(/\/import\/([0-9a-f-]{36})/g)][0]?.[1];
ok('an import exists', Boolean(importId), importId ?? 'none');

// ---- 2. validation panel -------------------------------------------------
console.log('\n2. Validation panel');
let detail = await get(`/import/${importId}`);
let text = strip(detail.html);
ok('/import/[id] renders', detail.status === 200);
ok('reconciles exactly', text.includes('Reconciles exactly'));
ok('shows the footer subtotal', text.includes('8,928,373.06'));
ok('flags SOFT DRINK with 1,803 units', text.includes('SOFT DRINK') && text.includes('1,803'));
ok('shows the approval chain as inactive', text.includes('Not in this demo'));

// ---- 3. post it ----------------------------------------------------------
console.log('\n3. Post to stock');
const postForm = [...detail.html.matchAll(/<form[\s\S]*?<\/form>/g)].findIndex((m) =>
  m[0].includes('Post to stock'),
);
let posted = await submit(
  `/import/${importId}`,
  detail.html,
  { importId },
  postForm >= 0 ? postForm : 0,
);
ok('posting returns 200', posted.status === 200, `HTTP ${posted.status}`);

detail = await get(`/import/${importId}`);
text = strip(detail.html);
ok('import now shows as posted', text.includes('Post again (no effect)'));
ok('cost coverage reported', /4[0-9]\.\d\d%/.test(text), text.match(/4[0-9]\.\d\d%/)?.[0] ?? '');

// idempotency, through the button
posted = await submit(
  `/import/${importId}`,
  detail.html,
  { importId },
  [...detail.html.matchAll(/<form[\s\S]*?<\/form>/g)].findIndex((m) =>
    m[0].includes('Post again'),
  ),
);
ok('posting twice is accepted and harmless', posted.status === 200);

// ---- 4. ledger -----------------------------------------------------------
console.log('\n4. Stock ledger');
let ledger = await get('/ledger');
ok('/ledger renders', ledger.status === 200);
const stores = [...ledger.html.matchAll(/\/ledger\?store=([0-9a-f-]{36})/g)].map((m) => m[1]);
const kitchen = stores[1];
ledger = await get(`/ledger?store=${kitchen}`);
const beef = /<option value="([0-9a-f-]{36})">Beef, lean minced/.exec(ledger.html)?.[1];
ok('kitchen holds minced beef', Boolean(beef));
const beefLedger = await get(`/ledger?store=${kitchen}&item=${beef}`);
const beefText = strip(beefLedger.html);
ok('shows the sale depletion', beefText.includes('Sale depletion'));
ok('shows the issue in', beefText.includes('Issued in'));
ok('weighted average is 1,125.00', beefText.includes('1,125.00'));

// ---- 5. physical count ---------------------------------------------------
console.log('\n5. Physical count');
let counts = await get('/counts');
ok('/counts renders', counts.status === 200);

const started = await submit('/counts', counts.html, {
  storeId: kitchen,
  countDate: '2026-08-04',
  countedBy: 'Chef A',
});
ok('start count accepted', started.status === 200, `HTTP ${started.status}`);

counts = await get('/counts');
const countId = [...counts.html.matchAll(/\/counts\/([0-9a-f-]{36})/g)][0]?.[1];
ok('a count sheet exists', Boolean(countId), countId ?? 'none');

let sheet = await get(`/counts/${countId}`);
ok('/counts/[id] renders', sheet.status === 200);

// read the theoretical quantities out of the sheet, then count two items short
const lineIds = [...sheet.html.matchAll(/name="qty_([0-9a-f-]{36})"/g)].map((m) => m[1]);
ok('sheet has lines', lineIds.length > 0, `${lineIds.length} lines`);

// find the beef line and count it 5 Kg short of 102
const beefRow = /name="qty_([0-9a-f-]{36})"[^>]*value=""[\s\S]{0,4000}?Beef, lean minced/.exec(
  sheet.html,
);
const entries = {};
// count everything at its theoretical figure, except two we deliberately vary
const theoreticals = [...sheet.html.matchAll(
  /name="qty_([0-9a-f-]{36})"[\s\S]{0,600}?tnum text-ink-600">([\d,.]+)</g,
)];
let varied = 0;
for (const [, lineId] of sheet.html.matchAll(/name="qty_([0-9a-f-]{36})"/g)) {
  entries[`qty_${lineId}`] = '';
}
// simpler and deterministic: pull theoretical from the rendered row order
const rows = [...sheet.html.matchAll(
  /name="qty_([0-9a-f-]{36})"[\s\S]{0,900}?<td class="px-3 py-2 text-right tnum text-ink-600">\s*([\d,.]+)\s*<\/td>/g,
)];

const saveValues = { countId };
const rowRe =
  /<tr[^>]*>[\s\S]*?<div class="text-ink-800">([^<]+)<\/div>[\s\S]*?text-right tnum text-ink-600">([^<]*)<\/td>[\s\S]*?name="qty_([0-9a-f-]{36})"[\s\S]*?<\/tr>/g;
let counted = 0;
for (const m of sheet.html.matchAll(rowRe)) {
  const name = m[1].trim();
  const theoretical = m[2].replace(/,/g, '').trim();
  const lineId = m[3];
  if (!theoretical || theoretical === '—') continue;
  let value = theoretical;
  if (name.startsWith('Beef, lean minced')) value = String(Number(theoretical) - 5); // shortage
  if (name.startsWith('Teff flour')) value = String(Number(theoretical) - 40); // bigger shortage
  saveValues[`qty_${lineId}`] = value;
  saveValues[`note_${lineId}`] = name.startsWith('Beef, lean minced')
    ? 'Five kilos unaccounted for.'
    : '';
  counted += 1;
}
ok('parsed theoretical quantities from the sheet', counted > 0, `${counted} rows`);

const saveFormIdx = [...sheet.html.matchAll(/<form[\s\S]*?<\/form>/g)].findIndex((m) =>
  m[0].includes('Save entries'),
);
const saved = await submit(`/counts/${countId}`, sheet.html, saveValues, saveFormIdx);
ok('save entries accepted', saved.status === 200, `HTTP ${saved.status}`);

sheet = await get(`/counts/${countId}`);
const postCountIdx = [...sheet.html.matchAll(/<form[\s\S]*?<\/form>/g)].findIndex((m) =>
  m[0].includes('Post count'),
);
const postedCount = await submit(`/counts/${countId}`, sheet.html, { countId }, postCountIdx);
ok('post count accepted', postedCount.status === 200, `HTTP ${postedCount.status}`);

sheet = await get(`/counts/${countId}`);
ok('count now shows as posted', strip(sheet.html).includes('Posted'));

// ---- 6. variance ---------------------------------------------------------
console.log('\n6. Variance report');
const variance = await get('/variance');
const vText = strip(variance.html);
ok('/variance renders', variance.status === 200);
ok('lists the beef shortage', vText.includes('Beef, lean minced'));
ok('lists the teff shortage', vText.includes('Teff flour'));
ok('grades something INVESTIGATE or REVIEW', /INVESTIGATE|REVIEW/.test(vText));
ok('carries the reason through', vText.includes('Five kilos unaccounted for'));

// ---- 7. dashboard --------------------------------------------------------
console.log('\n7. Dashboard');
const dash = await get('/dashboard');
const dText = strip(dash.html);
ok('/dashboard renders', dash.status === 200);
ok('food cost shown separately', dText.includes('Food cost'));
ok('beverage cost shown separately', dText.includes('Beverage cost'));
ok('food and beverage differ', /27\.\d\d%/.test(dText) && /22\.\d\d%/.test(dText));
ok('top sellers present', dText.includes('Top sellers by quantity'));
ok('coverage curve present', dText.includes('Recipes needed'));

// ---- 8. change an ingredient cost, prior period unchanged ----------------
console.log('\n8. Change an ingredient cost');
let recipes = await get('/recipes?before=2026-07-15&after=2026-08-15');
ok('/recipes renders', recipes.status === 200);

const kitfoBefore = /Yeajet Kitfo[\s\S]{0,600}?tnum text-ink-700">([\d,.]+)</.exec(recipes.html)?.[1];
ok('Yeajet Kitfo costs 407.18 on 15 July', kitfoBefore === '407.18', kitfoBefore ?? 'not found');

const butterId = /<option value="([0-9a-f-]{36})">Butter \(kibe\)/.exec(recipes.html)?.[1];
ok('found the butter ingredient', Boolean(butterId));

const costForm = [...recipes.html.matchAll(/<form[\s\S]*?<\/form>/g)].findIndex((m) =>
  m[0].includes('Record new cost'),
);
const changed = await submit(
  '/recipes?before=2026-07-15&after=2026-08-15',
  recipes.html,
  {
    itemId: butterId,
    cost: '1150.00',
    effectiveFrom: '2026-08-01',
    note: 'supplier increase',
  },
  costForm,
);
ok('cost change accepted', changed.status === 200, `HTTP ${changed.status}`);

recipes = await get('/recipes?before=2026-07-15&after=2026-08-15');
const rText = strip(recipes.html);
const row = /Yeajet Kitfo[\s\S]{0,900}?<\/tr>/.exec(recipes.html)?.[0] ?? '';
const figures = [...row.matchAll(/tnum[^"]*">\s*(\+?[\d,.]+)\s*</g)].map((m) => m[1]);

ok('15 July still reads 407.18', figures[0] === '407.18', figures[0] ?? 'not found');
ok('15 August now reads 415.51', figures[1] === '415.51', figures[1] ?? 'not found');
ok('the change is shown as +8.33', figures[2] === '+8.33', figures[2] ?? 'not found');
ok('Fillet Tibes moved too', rText.includes('456.47'));
ok(
  'the banner reads correctly',
  /\d+ recipes cost differently|1 recipe costs differently/.test(rText),
  /\d+ recipes? costs? differently/.exec(rText)?.[0] ?? 'not found',
);

// the history really keeps both versions
const hist = await get(`/recipes?before=2026-07-15&after=2026-08-15&item=${butterId}`);
const hText = strip(hist.html);
ok('cost history shows the old version closed', hText.includes('900.00') && hText.includes('1,150.00'));
ok('and the new one marked current', hText.includes('current'));

console.log(
  `\n${process.exitCode ? 'SOME CHECKS FAILED' : 'All checks passed'}\n`,
);
