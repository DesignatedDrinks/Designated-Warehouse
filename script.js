// ==================================================
// CONFIG
// ==================================================
const sheetId   = '1xE9SueE6rdDapXr0l8OtP_IryFM-Z6fHFH27_cQ120g';
const sheetName = 'Orders';
const apiKey    = 'AIzaSyA7sSHMaY7i-uxxynKewHLsHxP_dd3TZ4U';

const ordersUrl =
  `https://sheets.googleapis.com/v4/spreadsheets/${sheetId}/values/${encodeURIComponent(sheetName)}!A1:Z10000?alt=json&key=${apiKey}`;

// ==================================================
// DOM SAFE (ID OR CLASS)
// ==================================================
const byId = (id) => document.getElementById(id);
const q = (sel) => document.querySelector(sel);

// “Smart” getter: try ID first, then fallback selector
function getEl(id, fallbackSelector) {
  return byId(id) || (fallbackSelector ? q(fallbackSelector) : null);
}

// ==================================================
// STATE
// ==================================================
let orders = [];     // order-centric
let pickQueue = [];  // item-centric
let pickIndex = 0;

// ==================================================
// VIEW CONTROL
// ==================================================
function showView(viewId) {
  const views = ['startView', 'pickView', 'completeView', 'packModeView'];
  views.forEach(id => byId(id)?.classList.add('hidden'));
  byId(viewId)?.classList.remove('hidden');
}

// ==================================================
// LOCATION LOGIC (QUIET + YOUR WALK ORDER)
// ==================================================
function guessLocation(title) {
  const raw = String(title || '').trim();
  const L = (raw[0] || '').toUpperCase();
  const t = raw.toLowerCase();

  // Pinned exceptions
  if (t.includes('harmon')) return { label: 'H', sortKey: '00-00' };
  if (t.includes('templ'))  return { label: 'T', sortKey: '00-01' };

  // Groups in physical walk order
  const A1_WALL_GROUPS = [['B'], ['D'], ['C']];
  const A1_ISLAND_GROUPS = [['O'], ['M','N'], ['L'], ['I','J'], ['H'], ['G'], ['F'], ['E']];
  const A2_LEFT_GROUPS = [['P'], ['R'], ['S'], ['T'], ['U','W']];

  const rankIn = (groups) => {
    for (let i = 0; i < groups.length; i++) {
      if (groups[i].includes(L)) return i;
    }
    return -1;
  };

  const wallRank   = rankIn(A1_WALL_GROUPS);
  const islandRank = rankIn(A1_ISLAND_GROUPS);
  const a2Rank     = rankIn(A2_LEFT_GROUPS);

  if (wallRank !== -1)   return { label: L, sortKey: `01-0${wallRank}` };
  if (islandRank !== -1) return { label: L, sortKey: `01-1${islandRank}` };
  if (a2Rank !== -1)     return { label: L, sortKey: `02-0${a2Rank}` };

  return { label: L || '?', sortKey: '99-99' };
}

// ==================================================
// LOAD + PARSE
// ==================================================
async function loadOrders() {
  try {
    const res = await fetch(ordersUrl);
    if (!res.ok) throw new Error(`Fetch failed (${res.status})`);

    const json = await res.json();
    const rows = json.values || [];
    if (rows.length < 2) throw new Error('No data');

    const header = rows[0].map(h => String(h || '').trim().toLowerCase());
    const idx = (name) => header.indexOf(String(name).toLowerCase());

    const iOrderId  = idx('orderid');
    const iTitle    = idx('itemtitle');
    const iQty      = idx('qty');
    const iPicked   = idx('picked'); // optional

    if (iTitle === -1 || iQty === -1) {
      throw new Error('Missing required columns: itemTitle and qty');
    }

    // Build orders (pending only if picked column exists)
    const orderMap = new Map();

    for (const r of rows.slice(1)) {
      const pickedVal = (iPicked >= 0 ? r[iPicked] : '').toString().trim().toLowerCase();
      const isPicked = pickedVal === 'true' || pickedVal === 'yes' || pickedVal === '1';
      if (iPicked >= 0 && isPicked) continue;

      const orderId = (iOrderId >= 0 ? r[iOrderId] : '').toString().trim() || 'NO_ORDER_ID';
      const title = (r[iTitle] || '').toString().trim();
      const qty = parseInt(r[iQty], 10) || 0;
      if (!title || qty <= 0) continue;

      if (!orderMap.has(orderId)) orderMap.set(orderId, { orderId, items: [] });
      orderMap.get(orderId).items.push({ title, qty });
    }

    orders = Array.from(orderMap.values());

    // Build pickQueue (aggregate by title)
    const itemAgg = new Map();
    for (const o of orders) {
      for (const it of o.items) {
        const key = it.title.toLowerCase();
        if (!itemAgg.has(key)) {
          itemAgg.set(key, { title: it.title, qty: 0, loc: guessLocation(it.title) });
        }
        itemAgg.get(key).qty += it.qty;
      }
    }

    pickQueue = Array.from(itemAgg.values()).sort((a, b) => {
      const sa = a.loc?.sortKey || '';
      const sb = b.loc?.sortKey || '';
      if (sa !== sb) return sa.localeCompare(sb);
      return a.title.localeCompare(b.title);
    });

    pickIndex = 0;
    renderStart();
  } catch (err) {
    console.error(err);
    const startError = byId('startError');
    if (startError) {
      startError.classList.remove('hidden');
      startError.textContent = err.message;
    } else {
      alert(err.message);
    }
  }
}

// ==================================================
// RENDER
// ==================================================
function setText(el, v) {
  if (el) el.textContent = v ?? '';
}

function renderStart() {
  showView('startView');

  // ✅ Orders count (not SKU count)
  setText(byId('dash-pending'), orders.length);

  // ✅ Total items/cans to pick
  const total = pickQueue.reduce((s, i) => s + (i.qty || 0), 0);
  setText(byId('dash-cans'), total);
}

function renderPick() {
  const it = pickQueue[pickIndex];

  if (!it) {
    showView('completeView');
    setText(byId('pickedCount'), pickQueue.length);
    setText(byId('issueCount'), 0);
    return;
  }

  showView('pickView');

  setText(byId('pickLocation'), it.loc?.label || '');
  setText(byId('pickProgress'), `${pickIndex + 1} / ${pickQueue.length}`);
  setText(byId('pickName'), it.title);

  // Works if pickQty is ID or .pick-qty class
  const qtyEl = getEl('pickQty', '.pick-qty');
  if (qtyEl) qtyEl.textContent = it.qty;
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
// INIT
// ==================================================
window.addEventListener('DOMContentLoaded', () => {
  // Bind buttons (ID-based, matches your HTML)
  byId('startPickingBtn')?.addEventListener('click', startPicking);
  byId('confirmPickBtn')?.addEventListener('click', confirmPick);

  // Default view
  showView('startView');

  // Load data
  loadOrders();
});
