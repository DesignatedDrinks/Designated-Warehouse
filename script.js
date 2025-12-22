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
let orders = [];
let pickQueue = [];
let pickIndex = 0;
let isPicking = false;

// ==================================================
// LOCATION LOGIC (THIS IS THE HEART)
// ==================================================
function guessLocation(title) {
  const letter = String(title || '?').trim()[0]?.toUpperCase() || '?';

  // AISLE 1 – BOTH SIDES (YOU CAN GRAB BOTH WITHOUT MOVING)
  const AISLE1_WALL = ['B','B','B','D','C','C','C'];
  const AISLE1_ISLAND_RIGHT = ['O','N','M','L','T','H','G','C'];

  // AISLE 2 – ONE SIDE ONLY
  const AISLE2_LEFT = ['P','R','S','T','W','C'];

  const wallIdx   = AISLE1_WALL.indexOf(letter);
  const rightIdx  = AISLE1_ISLAND_RIGHT.indexOf(letter);
  const leftIdx   = AISLE2_LEFT.indexOf(letter);

  let aisle = 9;
  let bay   = 999;
  let side  = 'UNKNOWN';

  if (wallIdx !== -1 || rightIdx !== -1) {
    aisle = 1;
    side  = wallIdx !== -1 ? 'WALL' : 'ISLAND RIGHT';
    bay   = wallIdx !== -1 ? wallIdx + 1 : rightIdx + 1;
  } else if (leftIdx !== -1) {
    aisle = 2;
    side  = 'ISLAND LEFT';
    bay   = leftIdx + 1;
  }

  const sortKey =
    `${String(aisle).padStart(2,'0')}-${String(bay).padStart(3,'0')}-${letter}`;

  return {
    aisle,
    bay,
    side,
    letter,
    label:
      aisle === 1
        ? `AISLE 1 – BAY ${bay} – ${side} – ${letter}`
        : aisle === 2
        ? `AISLE 2 – BAY ${bay} – ${letter}`
        : `UNKNOWN – ${letter}`,
    sortKey
  };
}

// ==================================================
// LOAD ORDERS
// ==================================================
async function loadOrders() {
  try {
    const res = await fetch(ordersUrl);
    if (!res.ok) throw new Error(`Orders fetch failed (${res.status})`);

    const json = await res.json();
    const rows = json.values || [];
    if (rows.length < 2) throw new Error('No order rows');

    const header = rows[0].map(h => h.toLowerCase());
    const idx = name => header.indexOf(name);

    const iOrderId  = idx('orderid');
    const iItem     = idx('itemtitle');
    const iQty      = idx('qty');

    const map = new Map();

    for (const r of rows.slice(1)) {
      const itemTitle = r[iItem] || '';
      const qty       = parseInt(r[iQty], 10) || 0;
      if (!itemTitle || qty <= 0) continue;

      const key = itemTitle.toLowerCase();
      if (!map.has(key)) {
        map.set(key, {
          itemTitle,
          cans: 0,
          location: guessLocation(itemTitle)
        });
      }
      map.get(key).cans += qty;
    }

    pickQueue = Array.from(map.values()).sort(
      (a,b) => a.location.sortKey.localeCompare(b.location.sortKey)
    );

    pickIndex = 0;
    isPicking = false;
    renderStart();
  } catch (err) {
    console.error(err);
    alert('FAILED TO LOAD ORDERS\n\n' + err.message);
  }
}

// ==================================================
// RENDER
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
  setText($('pickProgress'), `${pickIndex+1} / ${pickQueue.length}`);
  setText($('pickName'), it.itemTitle);
  setText($('pickQty'), `PICK ${it.cans} CANS`);
}

// ==================================================
// EVENTS
// ==================================================
function startPicking() {
  isPicking = true;
  pickIndex = 0;
  renderPick();
}

function confirmPick() {
  pickIndex++;
  renderPick();
}

// ==================================================
// SAFE HELPERS
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
