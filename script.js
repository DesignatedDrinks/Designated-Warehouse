// ==================================================
// CONFIG (YOUR APIS)
// ==================================================
const sheetId   = '1xE9SueE6rdDapXr0l8OtP_IryFM-Z6fHFH27_cQ120g';
const sheetName = 'Orders';
const apiKey    = 'AIzaSyA7sSHMaY7i-uxxynKewHLsHxP_dd3TZ4U';

// Orders range (header + rows)
const ordersUrl =
  `https://sheets.googleapis.com/v4/spreadsheets/${sheetId}/values/${encodeURIComponent(sheetName + '!A1:Z10000')}?alt=json&key=${apiKey}`;

// Image lookup (title -> url) from SAME spreadsheet
const imageLookupUrl =
  `https://sheets.googleapis.com/v4/spreadsheets/${sheetId}/values/${encodeURIComponent('ImageLookup!A2:B')}?alt=json&key=${apiKey}`;

// ==================================================
// DOM SAFE
// ==================================================
const $ = (id) => document.getElementById(id);
const on = (node, evt, fn) => { if (node) node.addEventListener(evt, fn); };

const el = {
  // views
  startView: $('startView'),
  pickView: $('pickView'),
  completeView: $('completeView'),
  packModeView: $('packModeView'),

  // nav buttons (may/may not exist — safe)
  goStartBtn: $('goStartBtn'),
  goPackModeBtn: $('goPackModeBtn'),
  backToStartBtn: $('backToStartBtn'),

  // start dashboard
  dashPending: $('dash-pending'),
  dashCans: $('dash-cans'),
  startPickingBtn: $('startPickingBtn'),
  startError: $('startError'),

  // pick mode
  pickLocation: $('pickLocation'),
  pickProgress: $('pickProgress'),
  pickImage: $('pickImage'),
  pickName: $('pickName'),
  pickQty: $('pickQty'), // if you use .pick-qty class, we support below
  confirmPickBtn: $('confirmPickBtn'),

  // complete
  pickedCount: $('pickedCount'),
  issueCount: $('issueCount'),
  goToPackBtn: $('goToPackBtn'),

  // pack mode
  packPrevBtn: $('packPrevBtn'),
  packNextBtn: $('packNextBtn'),
  packOrderId: $('packOrderId'),
  packCustomerName: $('packCustomerName'),
  packCustomerAddress: $('packCustomerAddress'),
  packBoxesInfo: $('packBoxesInfo'),
  packItemsContainer: $('packItemsContainer'), // if missing we try fallbacks
};

// fallback selectors (in case your HTML differs)
function getPickQtyEl() {
  return el.pickQty || document.querySelector('.pick-qty');
}
function getPackItemsContainer() {
  return el.packItemsContainer || document.querySelector('.items-list') || document.querySelector('#packItems') || null;
}

// ==================================================
// STATE
// ==================================================
let orders = [];          // order-centric (pack mode)
let pickQueue = [];       // aggregated items (pick mode)
let pickIndex = 0;
let packIndex = 0;

let imageMap = new Map(); // normalized title -> imageUrl

// ==================================================
// VIEW CONTROL
// ==================================================
function showView(which) {
  [el.startView, el.pickView, el.completeView, el.packModeView].forEach(v => v?.classList.add('hidden'));
  which?.classList.remove('hidden');
}

// ==================================================
// HELPERS
// ==================================================
function setText(node, value) { if (node) node.textContent = value ?? ''; }

function normalizeKey(s) {
  return String(s || '').trim().toLowerCase();
}

function isLikelyUrl(s) {
  const t = String(s || '').trim();
  return /^https?:\/\//i.test(t) || t.startsWith('//') || /cdn\.shopify\.com/i.test(t);
}

function cleanUrlMaybe(s) {
  const t = String(s || '').trim();
  if (!t) return '';
  if (t.startsWith('//')) return 'https:' + t;
  return t;
}

function placeholderImgUrl(size = 600) {
  return `https://via.placeholder.com/${size}x${size}?text=No+Image`;
}

function safeSetImg(imgEl, url, placeholderSize = 600) {
  if (!imgEl) return;
  imgEl.onerror = () => { imgEl.src = placeholderImgUrl(placeholderSize); };
  imgEl.src = url || placeholderImgUrl(placeholderSize);
}

function escapeHtml(str) {
  return String(str ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');
}

// ==================================================
// LOCATION LOGIC (AISLE-FIRST + LETTER ONLY)
// ==================================================
function guessLocation(title) {
  const raw = String(title || '').trim();
  const L = (raw[0] || '').toUpperCase();
  const t = raw.toLowerCase();

  // Hard pins (your physical exceptions)
  // Keep these in Aisle 1 so they get picked early unless you say otherwise.
  if (t.includes('harmon')) return { aisle: 1, label: 'H', sortKey: '01-00' };
  if (t.includes('templ'))  return { aisle: 1, label: 'T', sortKey: '01-01' };

  // ----------------------------
  // AISLE 1 (both-side picking)
  // ----------------------------

  // Aisle 1 WALL groups: B → D → C
  const A1_WALL = [
    ['B'],
    ['D'],
    ['C'],
  ];

  // Aisle 1 ISLAND groups: O → (M/N) → L → (I/J) → H → G → F → E
  const A1_ISLAND = [
    ['O'],
    ['M','N'],
    ['L'],
    ['I','J'],
    ['H'],
    ['G'],
    ['F'],
    ['E'],
  ];

  // ----------------------------
  // AISLE 2 (one-side picking)
  // ----------------------------
  const A2_ONE_SIDE = [
    ['P'],
    ['R'],
    ['S'],
    ['T'],
    ['U','W'],
  ];

  const rankIn = (groups) => {
    for (let i = 0; i < groups.length; i++) {
      if (groups[i].includes(L)) return i;
    }
    return -1;
  };

  const a1WallRank = rankIn(A1_WALL);
  if (a1WallRank !== -1) {
    return { aisle: 1, label: L, sortKey: `01-10-${String(a1WallRank).padStart(2,'0')}` };
  }

  const a1IslandRank = rankIn(A1_ISLAND);
  if (a1IslandRank !== -1) {
    return { aisle: 1, label: L, sortKey: `01-20-${String(a1IslandRank).padStart(2,'0')}` };
  }

  const a2Rank = rankIn(A2_ONE_SIDE);
  if (a2Rank !== -1) {
    return { aisle: 2, label: L, sortKey: `02-10-${String(a2Rank).padStart(2,'0')}` };
  }

  // Silent fallback: still usable, never show "UNKNOWN"
  return { aisle: 9, label: L || '?', sortKey: '99-99-99' };
}

// ==================================================
// IMAGE LOOKUP LOAD
// ==================================================
async function loadImageLookup() {
  try {
    const res = await fetch(imageLookupUrl);
    if (!res.ok) throw new Error(`ImageLookup fetch failed (${res.status})`);
    const json = await res.json();
    const rows = json.values || [];

    imageMap = new Map(
      rows
        .filter(r => r && r[0] && r[1])
        .map(r => [normalizeKey(r[0]), cleanUrlMaybe(r[1])])
    );
  } catch (e) {
    console.warn('ImageLookup failed (continuing without it):', e);
    imageMap = new Map();
  }
}

function getImageForTitle(itemTitle, fallbackUrlFromOrdersSheet) {
  if (isLikelyUrl(fallbackUrlFromOrdersSheet)) return cleanUrlMaybe(fallbackUrlFromOrdersSheet);
  return imageMap.get(normalizeKey(itemTitle)) || '';
}

// ==================================================
// LOAD + PARSE ORDERS (HEADER-AWARE)
// ==================================================
async function loadOrders() {
  try {
    await loadImageLookup();

    const res = await fetch(ordersUrl);
    if (!res.ok) throw new Error(`Orders fetch failed (${res.status})`);

    const json = await res.json();
    const rows = json.values || [];
    if (rows.length < 2) throw new Error('No order rows found');

    const header = rows[0].map(h => String(h || '').trim().toLowerCase());
    const idx = (name) => header.indexOf(String(name).toLowerCase());

    const iOrderId      = idx('orderid');
    const iCustomerName = idx('customername');
    const iAddress      = idx('address');
    const iItemTitle    = idx('itemtitle');
    const iVariantTitle = idx('varianttitle');
    const iQty          = idx('qty');
    const iPicked       = idx('picked');   // optional
    const iNotes        = idx('notes');    // optional
    const iImageUrl     = idx('imageurl'); // optional
    const iImageAlt     = idx('image');    // optional

    if (iOrderId === -1) throw new Error('Missing required column: orderId');
    if (iItemTitle === -1 || iQty === -1) throw new Error('Missing required columns: itemTitle and qty');

    const grouped = new Map(); // orderId -> order object

    for (const r of rows.slice(1)) {
      const pickedVal = (iPicked >= 0 ? r[iPicked] : '').toString().trim().toLowerCase();
      const isPicked = pickedVal === 'true' || pickedVal === 'yes' || pickedVal === '1';
      if (iPicked >= 0 && isPicked) continue;

      const orderId = (r[iOrderId] || '').toString().trim();
      const itemTitle = (r[iItemTitle] || '').toString().trim();
      const variantTitle = (iVariantTitle >= 0 ? (r[iVariantTitle] || '').toString() : '');
      const qty = parseInt(r[iQty], 10) || 0;

      if (!orderId || !itemTitle || qty <= 0) continue;

      // pack size -> cans
      const packSizeMatch = String(variantTitle || '').match(/(\d+)\s*pack/i);
      const packSize = packSizeMatch ? parseInt(packSizeMatch[1], 10) : 1;
      const cans = qty * (packSize || 1);

      const customerName = (iCustomerName >= 0 ? (r[iCustomerName] || '').toString() : '').trim();
      const address = (iAddress >= 0 ? (r[iAddress] || '').toString() : '').trim();
      const notes = (iNotes >= 0 ? (r[iNotes] || '').toString() : '').trim();

      // image from Orders sheet if present
      const imgFromOrders =
        (iImageUrl >= 0 ? r[iImageUrl] : '') ||
        (iImageAlt >= 0 ? r[iImageAlt] : '');

      const imageUrl = getImageForTitle(itemTitle, imgFromOrders);

      if (!grouped.has(orderId)) {
        grouped.set(orderId, {
          orderId,
          customerName,
          address,
          notes,
          items: [],
          totalCans: 0,
        });
      }

      const o = grouped.get(orderId);
      o.items.push({ itemTitle, cans, imageUrl });
      o.totalCans += cans;
    }

    orders = Array.from(grouped.values());
    orders.forEach(o => o.items.sort((a,b) => a.itemTitle.localeCompare(b.itemTitle)));

    // Build pickQueue (aggregate)
    pickQueue = buildPickQueue(orders);
    pickIndex = 0;
    packIndex = 0;

    renderStart();
  } catch (err) {
    console.error(err);
    renderStartError(err.message);
  }
}

function buildPickQueue(orderList) {
  const map = new Map(); // title -> aggregated

  for (const o of orderList) {
    for (const it of o.items) {
      const key = normalizeKey(it.itemTitle);
      if (!key) continue;

      if (!map.has(key)) {
        map.set(key, {
          itemTitle: it.itemTitle,
          cans: 0,
          imageUrl: it.imageUrl || '',
          location: guessLocation(it.itemTitle),
        });
      }
      const a = map.get(key);
      a.cans += (it.cans || 0);
      if (!a.imageUrl && it.imageUrl) a.imageUrl = it.imageUrl;
    }
  }

  const queue = Array.from(map.values());
  queue.sort((a,b) => {
    const sa = a.location?.sortKey || '';
    const sb = b.location?.sortKey || '';
    if (sa !== sb) return sa.localeCompare(sb);
    return a.itemTitle.localeCompare(b.itemTitle);
  });

  return queue;
}

// ==================================================
// RENDER: START
// ==================================================
function renderStart() {
  showView(el.startView);
  if (el.startError) el.startError.classList.add('hidden');

  setText(el.dashPending, orders.length); // real orders
  setText(el.dashCans, pickQueue.reduce((s, it) => s + (it.cans || 0), 0));
}

function renderStartError(msg) {
  showView(el.startView);
  setText(el.dashPending, '—');
  setText(el.dashCans, '—');
  if (el.startError) {
    el.startError.classList.remove('hidden');
    setText(el.startError, msg);
  } else {
    alert(msg);
  }
}

// ==================================================
// RENDER: PICK MODE
// ==================================================
function startPicking() {
  if (!pickQueue.length) return;
  pickIndex = 0;
  renderPick();
}

function renderPick() {
  const it = pickQueue[pickIndex];
  if (!it) return renderComplete();

  showView(el.pickView);

  setText(el.pickLocation, it.location?.label || '');
  setText(el.pickProgress, `${pickIndex + 1} / ${pickQueue.length}`);
  setText(el.pickName, it.itemTitle);

  const qtyEl = getPickQtyEl();
  if (qtyEl) qtyEl.textContent = `PICK: ${it.cans} CANS`;

  safeSetImg(el.pickImage, it.imageUrl || '', 600);
}

function confirmPick() {
  pickIndex++;
  renderPick();
}

// ==================================================
// COMPLETE
// ==================================================
function renderComplete() {
  showView(el.completeView);
  setText(el.pickedCount, pickQueue.length);
  setText(el.issueCount, 0);
}

// ==================================================
// PACK MODE
// ==================================================
function goPackMode() {
  showView(el.packModeView);
  renderPackOrder();
}

function calculateBoxes(n) {
  if (n <= 6)  return { 24: 0, 12: 0, 6: 1 };
  if (n <= 12) return { 24: 0, 12: 1, 6: 0 };

  let best = { total: Infinity, totalCans: Infinity, counts: { 24: 0, 12: 0, 6: 0 } };

  for (let a = 0; a <= Math.ceil(n / 24); a++) {
    for (let b = 0; b <= Math.ceil(n / 12); b++) {
      for (let c = 0; c <= Math.ceil(n / 6); c++) {
        const totalCans = a * 24 + b * 12 + c * 6;
        const totalBoxes = a + b + c;

        if (totalCans >= n) {
          const better =
            totalBoxes < best.total ||
            (totalBoxes === best.total && totalCans < best.totalCans);

          if (better) {
            best.total = totalBoxes;
            best.totalCans = totalCans;
            best.counts = { 24: a, 12: b, 6: c };
          }
        }
      }
    }
  }
  return best.counts;
}

function renderPackOrder() {
  if (!orders.length) return;

  if (packIndex < 0) packIndex = 0;
  if (packIndex > orders.length - 1) packIndex = orders.length - 1;

  const o = orders[packIndex];

  setText(el.packOrderId, `Order #${o.orderId}`);
  setText(el.packCustomerName, o.customerName || '');
  setText(el.packCustomerAddress, o.address || '');

  if (el.packPrevBtn) el.packPrevBtn.disabled = packIndex === 0;
  if (el.packNextBtn) el.packNextBtn.disabled = packIndex === orders.length - 1;

  const b = calculateBoxes(o.totalCans);
  const lines = [];
  if (b[24]) lines.push(`${b[24]}×24-pack`);
  if (b[12]) lines.push(`${b[12]}×12-pack`);
  if (b[6])  lines.push(`${b[6]}×6-pack`);

  if (el.packBoxesInfo) {
    el.packBoxesInfo.innerHTML =
      `<strong>Boxes Required:</strong> ${lines.length ? lines.join(', ') : '—'}<br>` +
      `<strong>Total Cans:</strong> ${o.totalCans}` +
      (o.notes ? `<br><strong>Notes:</strong> ${escapeHtml(o.notes)}` : '');
  }

  const container = getPackItemsContainer();
  if (!container) return;

  container.innerHTML = '';
  const frag = document.createDocumentFragment();

  for (const it of o.items) {
    const row = document.createElement('div');
    row.className = 'item';

    const img = document.createElement('img');
    img.alt = it.itemTitle || '';
    img.onerror = () => { img.src = placeholderImgUrl(80); };
    img.src = it.imageUrl || placeholderImgUrl(80);

    const details = document.createElement('div');
    details.className = 'details';

    const p1 = document.createElement('p');
    p1.innerHTML = `<strong>${escapeHtml(it.itemTitle)}</strong>`;

    const p2 = document.createElement('p');
    p2.textContent = `${it.cans} cans`;

    details.appendChild(p1);
    details.appendChild(p2);

    row.appendChild(img);
    row.appendChild(details);
    frag.appendChild(row);
  }

  container.appendChild(frag);
}

// ==================================================
// EVENTS (REAL WIRING)
// ==================================================
on(el.startPickingBtn, 'click', startPicking);
on(el.confirmPickBtn, 'click', confirmPick);

on(el.goToPackBtn, 'click', goPackMode);
on(el.goPackModeBtn, 'click', goPackMode);

on(el.goStartBtn, 'click', () => showView(el.startView));
on(el.backToStartBtn, 'click', () => showView(el.startView));

on(el.packPrevBtn, 'click', () => { if (packIndex > 0) { packIndex--; renderPackOrder(); } });
on(el.packNextBtn, 'click', () => { if (packIndex < orders.length - 1) { packIndex++; renderPackOrder(); } });

// ==================================================
// INIT
// ==================================================
showView(el.startView);
loadOrders();
