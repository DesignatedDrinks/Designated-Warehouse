// ———————————————————————————————————————————————
// CONFIG (YOUR APIS)
// ———————————————————————————————————————————————
const sheetId   = '1xE9SueE6rdDapXr0l8OtP_IryFM-Z6fHFH27_cQ120g';
const sheetName = 'Orders';
const apiKey    = 'AIzaSyA7sSHMaY7i-uxxynKewHLsHxP_dd3TZ4U';

const ordersUrl =
  `https://sheets.googleapis.com/v4/spreadsheets/${sheetId}/values/${encodeURIComponent(sheetName)}?alt=json&key=${apiKey}`;

// ImageLookup sheet (A=itemTitle, B=imageUrl)
const imageLookupUrl =
  `https://sheets.googleapis.com/v4/spreadsheets/${sheetId}/values/${encodeURIComponent('ImageLookup!A2:B')}?alt=json&key=${apiKey}`;

// Pack picker sheet
const packsSheetId    = '1TtRNmjsgC64jbkptnCdklBf_HqifwE9SQO2JlGrp4Us';
const packTitlesUrl   = `https://sheets.googleapis.com/v4/spreadsheets/${packsSheetId}/values/${encodeURIComponent('Pack Titles!A2:A')}?key=${apiKey}`;
const varietyPacksUrl = `https://sheets.googleapis.com/v4/spreadsheets/${packsSheetId}/values/${encodeURIComponent('Variety Packs!A2:C1000')}?key=${apiKey}`;

// ———————————————————————————————————————————————
// DOM
// ———————————————————————————————————————————————
const el = {
  // nav
  goStartBtn: document.getElementById('goStartBtn'),
  goPackModeBtn: document.getElementById('goPackModeBtn'),

  // views
  startView: document.getElementById('startView'),
  pickView: document.getElementById('pickView'),
  completeView: document.getElementById('completeView'),
  packModeView: document.getElementById('packModeView'),

  // start
  dashPending: document.getElementById('dash-pending'),
  dashCans: document.getElementById('dash-cans'),
  startPickingBtn: document.getElementById('startPickingBtn'),
  startError: document.getElementById('startError'),

  // pick
  pickLocation: document.getElementById('pickLocation'),
  pickProgress: document.getElementById('pickProgress'),
  pickImage: document.getElementById('pickImage'),
  pickName: document.getElementById('pickName'),
  pickQty: document.getElementById('pickQty'),
  confirmPickBtn: document.getElementById('confirmPickBtn'),
  issueBtn: document.getElementById('issueBtn'),
  issueModal: document.getElementById('issueModal'),
  closeIssueModalBtn: document.getElementById('closeIssueModalBtn'),

  // complete
  pickedCount: document.getElementById('pickedCount'),
  issueCount: document.getElementById('issueCount'),
  goToPackBtn: document.getElementById('goToPackBtn'),

  // pack mode
  backToStartBtn: document.getElementById('backToStartBtn'),
  packPrevBtn: document.getElementById('packPrevBtn'),
  packNextBtn: document.getElementById('packNextBtn'),
  packOrderId: document.getElementById('packOrderId'),
  packCustomerName: document.getElementById('packCustomerName'),
  packCustomerAddress: document.getElementById('packCustomerAddress'),
  packBoxesInfo: document.getElementById('packBoxesInfo'),
  packItemsContainer: document.getElementById('packItemsContainer'),
  openPackPickerBtn: document.getElementById('openPackPickerBtn'),
  packPickerPanel: document.getElementById('packPickerPanel'),
  packDropdown: document.getElementById('packDropdown'),
  results: document.getElementById('results'),
};

// ———————————————————————————————————————————————
// STATE
// ———————————————————————————————————————————————
let orders = [];           // order-centric for pack mode
let packIndex = 0;

let pickQueue = [];        // pick-centric for picker mode
let pickIndex = 0;
let isPicking = false;
let issues = [];

// Variety pack helper data
let varietyPacksData = [];
let packsLoaded = false;

// Image lookup map
let imageLookupMap = new Map(); // normalized title -> url
let imageLookupLoaded = false;

// ———————————————————————————————————————————————
// VIEW CONTROL
// ———————————————————————————————————————————————
function showView(which) {
  [el.startView, el.pickView, el.completeView, el.packModeView]
    .forEach(v => v && v.classList.add('hidden'));
  which && which.classList.remove('hidden');
}

// ———————————————————————————————————————————————
// SAFE HELPERS
// ———————————————————————————————————————————————
function setText(node, value) {
  if (!node) return;
  node.textContent = value ?? '';
}

function placeholderImage(imgEl) {
  if (!imgEl) return;
  imgEl.src = 'https://via.placeholder.com/600x600?text=No+Image';
}

function normalizeKey(s) {
  return String(s || '')
    .trim()
    .toLowerCase()
    .replace(/â€œ|â€/g, '"')
    .replace(/â€™/g, "'")
    .replace(/[–—]/g, '-')
    .replace(/\s+/g, ' ');
}

function escapeHtml(str) {
  return String(str ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');
}

// Placeholder until you provide a real mapping sheet
function guessLocation(title) {
  const t = normalizeKey(title);
  const c = t[0] || 'a';
  const aisle = c < 'h' ? 1 : c < 'p' ? 2 : 3;
  return { label: `AISLE ${aisle}`, sortKey: `A${aisle}` };
}

// ———————————————————————————————————————————————
// IMAGE HELPERS (FIXED FOR PACK MODE + PICKER)
// ———————————————————————————————————————————————
function extractUrlFromImageFormula(cell) {
  const s = String(cell || '').trim();
  if (!s) return '';
  const m = s.match(/=IMAGE\(\s*"(https?:\/\/[^"]+)"\s*/i);
  return m ? m[1] : '';
}

async function loadImageLookupOnce() {
  if (imageLookupLoaded) return;
  imageLookupLoaded = true;

  try {
    const res = await fetch(imageLookupUrl);
    const json = await res.json();
    const rows = json.values || [];

    for (const r of rows) {
      const title = (r[0] || '').trim();
      const url   = (r[1] || '').trim();
      if (!title || !url) continue;
      imageLookupMap.set(normalizeKey(title), url);
    }
  } catch (e) {
    console.error('ImageLookup load failed', e);
    // Keep going — you’ll just see more placeholders.
  }
}

async function resolveImageUrl(itemTitle, sheetCellValue) {
  // Ensure ImageLookup is loaded BEFORE trying lookup
  await loadImageLookupOnce();

  // 1) If Orders sheet cell is =IMAGE("..."), extract URL
  const fromFormula = extractUrlFromImageFormula(sheetCellValue);
  if (fromFormula) return fromFormula;

  // 2) If Orders sheet cell is already a URL, use it
  const direct = String(sheetCellValue || '').trim();
  if (direct.startsWith('http')) return direct;

  // 3) Fallback to ImageLookup (by title)
  const lookup = imageLookupMap.get(normalizeKey(itemTitle));
  return lookup || '';
}

async function setImgSrc(imgEl, url, fallback) {
  if (!imgEl) return;
  imgEl.onerror = () => { imgEl.src = fallback; };
  imgEl.src = url || fallback;
}

// ———————————————————————————————————————————————
// DATA: LOAD + PARSE ORDERS (HEADER-AWARE)
// ———————————————————————————————————————————————
function buildHeaderIndex(headerRow) {
  const idx = {};
  (headerRow || []).forEach((h, i) => {
    const k = normalizeKey(h);
    if (k) idx[k] = i;
  });

  // Common aliases -> canonical
  const pick = (...keys) => keys.find(k => idx[k] !== undefined) ?? null;

  return {
    orderId:        pick('orderid', 'order id', 'order'),
    customerName:   pick('customername', 'customer name', 'customer'),
    address:        pick('address', 'shipping address'),
    itemTitle:      pick('itemtitle', 'item title', 'title', 'product'),
    variantTitle:   pick('varianttitle', 'variant title', 'variant'),
    qty:            pick('qty', 'quantity'),
    picked:         pick('picked'),
    notes:          pick('notes', 'note'),
    imageUrl:       pick('imageurl', 'image url', 'image', 'img'),
  };
}

async function loadOrders() {
  try {
    // Load lookup ASAP
    await loadImageLookupOnce();

    const res = await fetch(ordersUrl);
    const json = await res.json();
    const rows = json.values || [];
    if (rows.length < 2) throw new Error('No orders found');

    const header = rows[0] || [];
    const col = buildHeaderIndex(header);

    // If no recognizable header row, fallback to “old layout”
    const hasHeader = Object.values(col).some(v => v !== null);

    const grouped = {};

    for (const r of rows.slice(1)) {
      // FALLBACKS:
      // If sheet has headers, use them.
      // If not, assume: [orderId, customerName, address, itemTitle, variantTitle, qty, picked, notes, imageUrl]
      const orderId       = hasHeader ? r[col.orderId ?? 0]      : r[0];
      const customerName  = hasHeader ? r[col.customerName ?? 1] : r[1];
      const address       = hasHeader ? r[col.address ?? 2]      : r[2];
      const itemTitle     = hasHeader ? r[col.itemTitle ?? 3]    : r[3];
      const variantTitle  = hasHeader ? r[col.variantTitle ?? 4] : r[4];
      const qtyStr        = hasHeader ? r[col.qty ?? 5]          : r[5];
      const notes         = hasHeader ? r[col.notes ?? 7]        : r[7];
      const imageCell     = hasHeader ? r[col.imageUrl ?? 8]     : r[8];

      const oid = String(orderId || '').trim();
      if (!oid) continue;

      const qty = parseInt(qtyStr, 10) || 0;

      // If variant says “12 pack” etc, multiply.
      // If variant is blank, treat qty as cans.
      const packSizeMatch = String(variantTitle || '').match(/(\d+)\s*pack/i);
      const packSize = packSizeMatch ? parseInt(packSizeMatch[1], 10) : 1;
      const cans = qty * (packSize || 1);

      if (!grouped[oid]) {
        grouped[oid] = {
          orderId: oid,
          customerName: customerName || '',
          address: address || '',
          notes: notes || '',
          items: [],
          totalCans: 0
        };
      }

      const title = itemTitle || '';

      // IMPORTANT:
      // Don’t bake imageUrl permanently here.
      // Store raw cell, resolve at render-time (always fresh).
      grouped[oid].items.push({
        itemTitle: title,
        cans,
        imageCell: imageCell || ''
      });

      grouped[oid].totalCans += cans;
    }

    // stable, predictable sort for pack mode
    const parsedOrders = Object.values(grouped);
    parsedOrders.forEach(o => o.items.sort((a,b) => a.itemTitle.localeCompare(b.itemTitle)));

    orders = parsedOrders;
    packIndex = 0;

    // build pick queue AFTER orders are built
    pickQueue = await buildPickQueue(orders);
    pickIndex = 0;
    isPicking = false;
    issues = [];

    renderStart();
  } catch (err) {
    console.error(err);
    renderStartError('Failed to load orders. Check sheet access / API key restrictions.');
  }
}

async function buildPickQueue(orderList) {
  const map = new Map();

  for (const o of orderList) {
    for (const it of o.items) {
      const key = normalizeKey(it.itemTitle);
      if (!key) continue;

      const existing = map.get(key);
      if (existing) {
        existing.cans += it.cans;
      } else {
        map.set(key, {
          itemTitle: it.itemTitle,
          cans: it.cans,
          imageCell: it.imageCell || '',
          location: guessLocation(it.itemTitle)
        });
      }
    }
  }

  const queue = Array.from(map.values());

  // Resolve images for pick mode now (so picker is instant)
  for (const q of queue) {
    q.imageUrl = await resolveImageUrl(q.itemTitle, q.imageCell);
  }

  queue.sort((a,b) => {
    const la = a.location?.sortKey || '';
    const lb = b.location?.sortKey || '';
    if (la !== lb) return la.localeCompare(lb);
    return a.itemTitle.localeCompare(b.itemTitle);
  });

  return queue;
}

// ———————————————————————————————————————————————
// START VIEW
// ———————————————————————————————————————————————
function renderStart() {
  showView(el.startView);
  el.startError && el.startError.classList.add('hidden');

  setText(el.dashPending, orders.length);
  const totalCans = pickQueue.reduce((sum, it) => sum + (it.cans || 0), 0);
  setText(el.dashCans, totalCans);

  if (el.startPickingBtn) el.startPickingBtn.disabled = pickQueue.length === 0;
}

function renderStartError(msg) {
  showView(el.startView);
  setText(el.dashPending, '—');
  setText(el.dashCans, '—');

  if (el.startPickingBtn) el.startPickingBtn.disabled = true;
  if (el.startError) {
    el.startError.classList.remove('hidden');
    setText(el.startError, msg);
  }
}

// ———————————————————————————————————————————————
// PICK VIEW (SCREEN 2 LOOP)
// ———————————————————————————————————————————————
function startPicking() {
  if (!pickQueue.length) return;
  isPicking = true;
  pickIndex = 0;
  issues = [];
  renderPick();
}

function renderPick() {
  if (!isPicking) return renderStart();

  if (pickIndex >= pickQueue.length) {
    isPicking = false;
    renderComplete();
    return;
  }

  showView(el.pickView);

  const it = pickQueue[pickIndex];

  setText(el.pickLocation, it.location?.label || 'LOCATION');
  setText(el.pickProgress, `${pickIndex + 1} / ${pickQueue.length}`);
  setText(el.pickName, it.itemTitle);
  setText(el.pickQty, `PICK: ${it.cans} CANS`);

  if (el.pickImage) {
    el.pickImage.onerror = () => placeholderImage(el.pickImage);
    el.pickImage.src = it.imageUrl || 'https://via.placeholder.com/600x600?text=No+Image';
  }
}

function confirmPick() {
  pickIndex++;
  renderPick();
}

function openIssueModal() {
  el.issueModal && el.issueModal.classList.remove('hidden');
}

function closeIssueModal() {
  el.issueModal && el.issueModal.classList.add('hidden');
}

function logIssue(type) {
  const it = pickQueue[pickIndex];
  issues.push({
    type,
    itemTitle: it?.itemTitle || '',
    cans: it?.cans || 0,
    at: Date.now()
  });
  closeIssueModal();
  pickIndex++;
  renderPick();
}

// ———————————————————————————————————————————————
// COMPLETE VIEW
// ———————————————————————————————————————————————
function renderComplete() {
  showView(el.completeView);
  setText(el.pickedCount, pickQueue.length);
  setText(el.issueCount, issues.length);
}

// ———————————————————————————————————————————————
// PACK MODE
// ———————————————————————————————————————————————
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

function goPackMode() {
  showView(el.packModeView);
  renderPackOrder();
}

async function renderPackOrder() {
  if (!orders.length) return;

  // clamp
  if (packIndex < 0) packIndex = 0;
  if (packIndex > orders.length - 1) packIndex = orders.length - 1;

  const o = orders[packIndex];

  setText(el.packOrderId, `Order #${o.orderId}`);
  setText(el.packCustomerName, o.customerName);
  setText(el.packCustomerAddress, o.address);

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

  // render items list
  if (!el.packItemsContainer) return;
  el.packItemsContainer.innerHTML = '';
  const frag = document.createDocumentFragment();

  for (const it of o.items) {
    const row = document.createElement('div');
    row.className = 'item';

    const img = document.createElement('img');
    img.alt = it.itemTitle;

    const resolved = await resolveImageUrl(it.itemTitle, it.imageCell || '');

    img.onerror = () => { img.src = 'https://via.placeholder.com/60'; };
    img.src = resolved || 'https://via.placeholder.com/60';

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

  el.packItemsContainer.appendChild(frag);
}

// ———————————————————————————————————————————————
// PACK PICKER (LAZY-LOAD)
// ———————————————————————————————————————————————
async function loadPacksOnce() {
  if (packsLoaded) return;
  packsLoaded = true;

  try {
    const [tR, vR] = await Promise.all([
      fetch(packTitlesUrl).then(r => r.json()),
      fetch(varietyPacksUrl).then(r => r.json())
    ]);

    const titles = (tR.values || []).map(r => r[0]).filter(Boolean);
    varietyPacksData = vR.values || [];

    // reset dropdown
    if (el.packDropdown) {
      el.packDropdown.innerHTML = `<option value="All">All</option>`;
      for (const t of titles) el.packDropdown.add(new Option(t, t));
    }

    await displayPacks('All');
  } catch (e) {
    console.error(e);
    if (el.results) el.results.textContent = 'Failed to load packs.';
  }
}

async function displayPacks(filter) {
  if (!el.results) return;
  el.results.innerHTML = '';

  let list = varietyPacksData;
  if (filter !== 'All') list = list.filter(r => r[0] === filter);

  if (!list.length) {
    el.results.textContent = 'No entries.';
    return;
  }

  const frag = document.createDocumentFragment();

  for (const [pack, beer, imgUrl] of list) {
    const card = document.createElement('div');
    card.className = 'pack-item';

    const img = document.createElement('img');
    img.alt = beer || '';
    img.onerror = () => { img.src = 'https://via.placeholder.com/50'; };

    const resolved =
      (imgUrl && String(imgUrl).trim()) ||
      (await resolveImageUrl(beer || '', ''));

    img.src = resolved || 'https://via.placeholder.com/50';

    const wrap = document.createElement('div');
    const h3 = document.createElement('h3');
    h3.textContent = `${pack || ''} – ${beer || ''}`;

    wrap.appendChild(h3);
    card.appendChild(img);
    card.appendChild(wrap);

    frag.appendChild(card);
  }

  el.results.appendChild(frag);
}

// ———————————————————————————————————————————————
// EVENTS (wired once)
// ———————————————————————————————————————————————
if (el.startPickingBtn) el.startPickingBtn.addEventListener('click', startPicking);
if (el.confirmPickBtn) el.confirmPickBtn.addEventListener('click', confirmPick);

if (el.issueBtn) el.issueBtn.addEventListener('click', openIssueModal);
if (el.closeIssueModalBtn) el.closeIssueModalBtn.addEventListener('click', closeIssueModal);

document.querySelectorAll('.modal-option').forEach(btn => {
  btn.addEventListener('click', () => logIssue(btn.getAttribute('data-issue') || 'other'));
});

if (el.goToPackBtn) el.goToPackBtn.addEventListener('click', goPackMode);
if (el.goPackModeBtn) el.goPackModeBtn.addEventListener('click', goPackMode);

if (el.goStartBtn) el.goStartBtn.addEventListener('click', () => showView(el.startView));
if (el.backToStartBtn) el.backToStartBtn.addEventListener('click', () => showView(el.startView));

if (el.packPrevBtn) el.packPrevBtn.addEventListener('click', async () => {
  if (packIndex > 0) { packIndex--; await renderPackOrder(); }
});
if (el.packNextBtn) el.packNextBtn.addEventListener('click', async () => {
  if (packIndex < orders.length - 1) { packIndex++; await renderPackOrder(); }
});

if (el.openPackPickerBtn) el.openPackPickerBtn.addEventListener('click', async () => {
  if (!el.packPickerPanel) return;
  el.packPickerPanel.classList.toggle('hidden');

  if (!el.packPickerPanel.classList.contains('hidden')) {
    if (el.results) el.results.textContent = 'Loading packs…';
    await loadPacksOnce();
  }
});

if (el.packDropdown) el.packDropdown.addEventListener('change', async (e) => {
  await displayPacks(e.target.value);
});

// ———————————————————————————————————————————————
// INIT
// ———————————————————————————————————————————————
showView(el.startView);
loadOrders();
