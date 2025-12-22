// ==================================================
// CONFIG
// ==================================================
const sheetId   = '1xE9SueE6rdDapXr0l8OtP_IryFM-Z6fHFH27_cQ120g';
const sheetName = 'Orders';
const apiKey    = 'AIzaSyA7sSHMaY7i-uxxynKewHLsHxP_dd3TZ4U';

const ordersUrl =
  `https://sheets.googleapis.com/v4/spreadsheets/${sheetId}/values/${encodeURIComponent(sheetName)}?alt=json&key=${apiKey}`;

// ==================================================
// DOM SAFE
// ==================================================
const $ = id => document.getElementById(id);

// ==================================================
// STATE
// ==================================================
let pickQueue = [];
let pickIndex = 0;

// ==================================================
// LOCATION LOGIC (LOCKED TO YOUR DRAWING)
// ==================================================
function guessLocation(title) {
  const raw = String(title || '').trim();
  const L = (raw[0] || '?').toUpperCase();
  const t = raw.toLowerCase();

  // ----------------------------
  // SPECIAL PINNED LOCATIONS
  // ----------------------------
  if (t.includes('harmon')) {
    return {
      label: 'HARMONS',
      sortKey: '00-000-H'
    };
  }

  if (t.includes('templ')) {
    return {
      label: 'TEMPLE (FRONT SKID)',
      sortKey: '00-001-T'
    };
  }

  // ----------------------------
  // PHYSICAL AISLE MAP
  // ----------------------------

  // AISLE 1 — WALL (right wall)
  const A1_WALL = ['B','B','B','B','D','C','C','C'];

  // AISLE 1 — ISLAND (right face)
  // I and J share the SAME physical slot
  const A1_ISLAND = ['O','M','L','IJ','H','G','F','E'];

  // AISLE 2 — LEFT FACE ONLY
  const A2_LEFT = ['P','R','S','T','W'];

  const wallIdx = A1_WALL.indexOf(L);
  const islandIdx = A1_ISLAND.findIndex(x => x.includes(L));
  const a2Idx = A2_LEFT.indexOf(L);

  // ----------------------------
  // AISLE 1 (WALL)
  // ----------------------------
  if (wallIdx !== -1) {
    return {
      label: `AISLE 1 (WALL) — ${L}`,
      sortKey: `01-${String(wallIdx + 1).padStart(3,'0')}-W-${L}`
    };
  }

  // ----------------------------
  // AISLE 1 (ISLAND)
  // ----------------------------
  if (islandIdx !== -1) {
    return {
      label: `AISLE 1 (ISLAND) — ${L}`,
      sortKey: `01-${String(islandIdx + 1).padStart(3,'0')}-I-${L}`
    };
  }

  // ----------------------------
  // AISLE 2
  // ----------------------------
  if (a2Idx !== -1) {
    return {
      label: `AISLE 2 — ${L}`,
      sortKey: `02-${String(a2Idx + 1).padStart(3,'0')}-L-${L}`
    };
  }

  // ----------------------------
  // FALLBACK (SHOULD BE RARE)
  // ----------------------------
  return {
    label: `UNKNOWN — ${L}`,
    sortKey: `99-999-${L}`
  };
}

// ==================================================
// LOAD + BUILD PICK QUEUE
// ==================================================
async function loadOrders() {
  try {
    const res = await fetch(ordersUrl);
    if (!res.ok) throw new Error(`Fetch failed (${res.status})`);

    const json = await res.json();
    const rows = json.values || [];
    if (rows.length < 2) throw new Error('No order rows');

    const header = rows[0].map(h => h.toLowerCase());
    const idx = name => header.indexOf(name);

    const iItem = idx('itemtitle');
    const iQty  = idx('qty');

    const map = new Map();

    for (const r of rows.slice(1)) {
      const title = r[iItem] || '';
      const qty   = parseInt(r[iQty], 10) || 0;
      if (!title || qty <= 0) continue;

      const key = title.toLowerCase();

      if (!map.has(key)) {
        map.set(key, {
          itemTitle: title,
          cans: 0,
          location: guessLocation(title)
        });
      }

      map.get(key).cans += qty;
    }

    pickQueue = Array.from(map.values()).sort(
      (a,b) => a.location.sortKey.localeCompare(b.location.sortKey)
    );

    pickIndex = 0;
    renderStart();
  } catch (err) {
    console.error(err);
    alert('FAILED TO LOAD ORDERS\n' + err.message);
  }
}

// ==================================================
// RENDERING
// ==================================================
function renderStart() {
  setText($('dash-pending'), pickQueue.length);
  setText(
    $('dash-cans'),
    pickQueue.reduce((s,i) => s + i.cans, 0)
  );
}

function renderPick() {
  if (pickIndex >= pickQueue.length) {
    alert('PICKING COMPLETE');
    return;
  }

  const it = pickQueue[pickIndex];

  setText($('pickLocation'), it.location.label);
  setText($('pickProgress'), `${pickIndex + 1} / ${pickQueue.length}`);
  setText($('pickName'), it.itemTitle);
  setText($('pickQty'), `PICK ${it.cans} CANS`);
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
function setText(el, val) {
  if (el) el.textContent = val ?? '';
}

// ==================================================
// INIT
// ==================================================
document.addEventListener('DOMContentLoaded', () => {
  loadOrders();
  $('startPickingBtn')?.addEventListener('click', startPicking);
  $('confirmPickBtn')?.addEventListener('click', confirmPick);
});
