// ==================================================
// CONFIG
// ==================================================
const sheetId   = '1xE9SueE6rdDapXr0l8OtP_IryFM-Z6fHFH27_cQ120g';
const sheetName = 'Orders';
const apiKey    = 'AIzaSyA7sSHMaY7i-uxxynKewHLsHxP_dd3TZ4U';

const ordersUrl =
  `https://sheets.googleapis.com/v4/spreadsheets/${sheetId}/values/${sheetName}!A1:Z10000?alt=json&key=${apiKey}`;

// ==================================================
// DOM SAFE
// ==================================================
const $ = id => document.getElementById(id);

// ==================================================
// STATE
// ==================================================
let orders = [];
let pickQueue = [];
let pickIndex = 0;

// ==================================================
// LOCATION LOGIC (FINAL, QUIET, PHYSICAL)
// ==================================================
function guessLocation(title) {
  const raw = String(title || '').trim();
  const L = (raw[0] || '').toUpperCase();
  const t = raw.toLowerCase();

  // Pinned
  if (t.includes('harmon')) return { label: 'H', sortKey: '00-000' };
  if (t.includes('templ'))  return { label: 'T', sortKey: '00-001' };

  // Physical walk order
  const A1_WALL   = ['B','B','B','B','D','C','C','C'];
  const A1_ISLAND = ['O','MN','L','IJ','H','G','F','E'];
  const A2_LEFT   = ['P','R','S','T','UW'];

  const wallIdx   = A1_WALL.indexOf(L);
  const islandIdx = A1_ISLAND.findIndex(x => x.includes(L));
  const a2Idx     = A2_LEFT.findIndex(x => x.includes(L));

  if (wallIdx !== -1)   return { label: L, sortKey: `01-${wallIdx}` };
  if (islandIdx !== -1) return { label: L, sortKey: `01-${islandIdx}` };
  if (a2Idx !== -1)     return { label: L, sortKey: `02-${a2Idx}` };

  // Silent fallback (never show UNKNOWN)
  return { label: L, sortKey: '99-999' };
}

// ==================================================
// LOAD ORDERS
// ==================================================
async function loadOrders() {
  try {
    const res = await fetch(ordersUrl);
    if (!res.ok) throw new Error(`Fetch failed (${res.status})`);

    const json = await res.json();
    const rows = json.values || [];
    if (rows.length < 2) throw new Error('No data');

    const header = rows[0].map(h => h.toLowerCase());
    const iTitle = header.indexOf('itemtitle');
    const iQty   = header.indexOf('qty');

    const map = new Map();

    for (const r of rows.slice(1)) {
      const title = r[iTitle];
      const qty   = parseInt(r[iQty], 10) || 0;
      if (!title || qty <= 0) continue;

      const key = title.toLowerCase();
      if (!map.has(key)) {
        map.set(key, {
          title,
          qty: 0,
          loc: guessLocation(title)
        });
      }
      map.get(key).qty += qty;
    }

    pickQueue = [...map.values()].sort(
      (a,b) => a.loc.sortKey.localeCompare(b.loc.sortKey)
    );

    renderStart();
  } catch (err) {
    console.error(err);
    alert(err.message);
  }
}

// ==================================================
// RENDER
// ==================================================
function renderStart() {
  setText($('dash-pending'), pickQueue.length);
  setText(
    $('dash-cans'),
    pickQueue.reduce((s,i) => s + i.qty, 0)
  );
}

function renderPick() {
  const it = pickQueue[pickIndex];
  if (!it) return alert('Done');

  setText($('pickLocation'), it.loc.label);
  setText($('pickProgress'), `${pickIndex + 1} / ${pickQueue.length}`);
  setText($('pickName'), it.title);
  setText($('pickQty'), it.qty);
}

// ==================================================
// EVENTS
// ==================================================
function startPicking() {
  pickIndex = 0;
  renderPick();
}

function confirmPick() {
  pickIndex++;
  renderPick();
}

// ==================================================
// HELPERS
// ==================================================
function setText(el, v) {
  if (el) el.textContent = v ?? '';
}

// ==================================================
// INIT
// ==================================================
window.addEventListener('DOMContentLoaded', () => {
  loadOrders();
  $('startPickingBtn')?.addEventListener('click', startPicking);
  $('confirmPickBtn')?.addEventListener('click', confirmPick);
});
