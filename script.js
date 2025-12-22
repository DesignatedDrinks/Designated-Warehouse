// ———————————————————————————————————————————————
// CONFIG (YOUR APIS)
// ———————————————————————————————————————————————
const sheetId   = '1xE9SueE6rdDapXr0l8OtP_IryFM-Z6fHFH27_cQ120g';
const sheetName = 'Orders';
const apiKey    = 'AIzaSyA7sSHMaY7i-uxxynKewHLsHxP_dd3TZ4U';

const ordersUrl =
  `https://sheets.googleapis.com/v4/spreadsheets/${sheetId}/values/${encodeURIComponent(sheetName)}?alt=json&key=${apiKey}`;

// Image lookup (title -> url) — from the same spreadsheet
const imageLookupUrl =
  `https://sheets.googleapis.com/v4/spreadsheets/${sheetId}/values/${encodeURIComponent('ImageLookup!A2:B')}?alt=json&key=${apiKey}`;

// Pack picker sheet (3 cols: Pack, Beer, ImageUrl)
const packsSheetId    = '1TtRNmjsgC64jbkptnCdklBf_HqifwE9SQO2JlGrp4Us';
const packTitlesUrl   =
  `https://sheets.googleapis.com/v4/spreadsheets/${packsSheetId}/values/${encodeURIComponent('Pack Titles!A2:A')}?alt=json&key=${apiKey}`;
const varietyPacksUrl =
  `https://sheets.googleapis.com/v4/spreadsheets/${packsSheetId}/values/${encodeURIComponent('Variety Packs!A2:C1000')}?alt=json&key=${apiKey}`;

// ———————————————————————————————————————————————
// DOM (NULL SAFE)
// ———————————————————————————————————————————————
const $ = (id) => document.getElementById(id);

const el = {
  // nav
  goStartBtn: $('goStartBtn'),
  goPackModeBtn: $('goPackModeBtn'),

  // views
  startView: $('startView'),
  pickView: $('pickView'),
  completeView: $('completeView'),
  packModeView: $('packModeView'),

  // start
  dashPending: $('dash-pending'),
  dashCans: $('dash-cans'),
  startPickingBtn: $('startPickingBtn'),
  startError: $('startError'),

  // pick
  pickLocation: $('pickLocation'),
  pickProgress: $('pickProgress'),
  pickImage: $('pickImage'),
  pickName: $('pickName'),
  pickQty: $('pickQty'),
  confirmPickBtn: $('confirmPickBtn'),
  issueBtn: $('issueBtn'),
  issueModal: $('issueModal'),
  closeIssueModalBtn: $('closeIssueModalBtn'),

  // complete
  pickedCount: $('pickedCount'),
  issueCount: $('issueCount'),
  goToPackBtn: $('goToPackBtn'),

  // pack mode
  backToStartBtn: $('backToStartBtn'),
  packPrevBtn: $('packPrevBtn'),
  packNextBtn: $('packNextBtn'),
  packOrderId: $('packOrderId'),
  packCustomerName: $('packCustomerName'),
  packCustomerAddress: $('packCustomerAddress'),
  packBoxesInfo: $('packBoxesInfo'),
  packItemsContainer: $('packItemsContainer'),
  openPackPickerBtn: $('openPackPickerBtn'),
  packPickerPanel: $('packPickerPanel'),
  packDropdown: $('packDropdown'),
  results: $('results'),
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

let varietyPacksData = [];
let packsLoaded = false;

let imageMap = new Map();  // itemTitle(normalized) -> imageUrl

// NEW: pack title -> component beers
let packMap = new Map();   // packTitle(normalized) -> [{ beerTitle, imageUrl }]

// ———————————————————————————————————————————————
// VIEW CONTROL
// ———————————————————————————————————————————————
function showView(which) {
  const all = [el.startView, el.pickView, el.completeView, el.packModeView].filter(Boolean);
  all.forEach(v => v.classList.add('hidden'));
  if (which) which.classList.remove('hidden');
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
  return String(s || '').trim().toLowerCase();
}

function isLikelyUrl(s) {
  const t = String(s || '').trim();
  return /^https?:\/\//i.test(t) || /^\/\/cdn\./i.test(t) || /cdn\.shopify\.com/i.test(t);
}

function cleanUrlMaybe(s) {
  const t = String(s || '').trim();
  if (!t) return '';
  if (t.startsWith('//')) return 'https:' + t;
  return t;
}

// Null-safe event binder so your app never dies on a missing ID
function on(elm, event, handler) {
  if (!elm) return;
  elm.addEventListener(event, handler);
}

// ———————————————————————————————————————————————
// LOCATION (YOUR REAL PICK LOOP) — LETTER-ONLY
// Center Island LEFT → Right Wall → Center Island RIGHT
// ———————————————————————————————————————————————
function guessLocation(title) {
  const t = String(title || '').trim();
  const letter = (t[0] || '?').toUpperCase();

  // If the same letter exists in multiple physical locations (ex: C),
  // you MUST override by matching a substring of the title.
  // Add rules ONLY when needed.
  const TITLE_SEGMENT_OVERRIDES = [
    // Example:
    // { contains: 'Chilly Ones', segment: 'WALL' },
    // { contains: 'Collective Arts', segment: 'ISLAND_RIGHT' },
  ];

  const lower = t.toLowerCase();
  let forcedSegment = null;
  for (const rule of TITLE_SEGMENT_OVERRIDES) {
    if (lower.includes(String(rule.contains).toLowerCase())) {
      forcedSegment = rule.segment;
      break;
    }
  }

  // Segment 1: Center Island LEFT (from packing table upward)
  const LEFT = ['W','T','S','R','P','H']; // Templ=T, Harmons=H

  // Segment 2: Right Wall (top→bottom path)
  const WALL = ['B','D','C'];

  // Segment 3: Center Island RIGHT (from bottom upward)
  const RIGHT = ['C','G','H','I','L','M','N','O'];

  const seg =
    forcedSegment ||
    (LEFT.includes(letter) ? 'ISLAND_LEFT' :
     WALL.includes(letter) ? 'WALL' :
     RIGHT.includes(letter) ? 'ISLAND_RIGHT' :
     'UNKNOWN');

  const rankIn = (arr) => {
    const idx = arr.indexOf(letter);
    return idx === -1 ? 999 : idx + 1;
  };

  let segRank = 9;
  let inRank  = 999;

  if (seg === 'ISLAND_LEFT')  { segRank = 1; inRank = rankIn(LEFT); }
  if (seg === 'WALL')         { segRank = 2; inRank = rankIn(WALL); }
  if (seg === 'ISLAND_RIGHT') { segRank = 3; inRank = rankIn(RIGHT); }

  const sortKey = `${String(segRank).padStart(2,'0')}-${String(inRank).padStart(3,'0')}-${letter}`;
  return { label: `${seg.replace('_',' ')} – ${letter}`, sortKey };
}

// ———————————————————————————————————————————————
// IMAGE LOOKUP LOAD
// ———————————————————————————————————————————————
async function loadImageLookup() {
  try {
    const res = await fetch(imageLookupUrl);
    if (!res.ok) {
      const body = await res.text();
      throw new Error(`ImageLookup fetch failed ${res.status}: ${body}`);
    }
    const json = await res.json();
    const rows = json.values || [];

    imageMap = new Map(
      rows
        .filter(r => r && r[0] && r[1])
        .map(r => [normalizeKey(r[0]), cleanUrlMaybe(r[1])])
    );
  } catch (e) {
    console.warn('⚠️ ImageLookup failed to load (continuing without it).', e);
    imageMap = new Map();
  }
}

function getImageForTitle(itemTitle, fallbackFromOrdersSheet) {
  if (isLikelyUrl(fallbackFromOrdersSheet)) return cleanUrlMaybe(fallbackFromOrdersSheet);
  const key = normalizeKey(itemTitle);
  return imageMap.get(key) || '';
}

// ———————————————————————————————————————————————
// VARIETY PACK MAP (Pack -> Beer rows)  ✅ now prints real Google errors
// ———————————————————————————————————————————————
async function loadVarietyPackMap() {
  try {
    const res = await fetch(varietyPacksUrl);

    // If Google returns 400/403/etc, read the body and throw a useful error
    if (!res.ok) {
      const body = await res.text();
      throw new Error(`VarietyPacks fetch failed ${res.status}: ${body}`);
    }

    const json = await res.json();
    const rows = json.values || [];

    const m = new Map();

    for (const r of rows) {
      const packTitle = String(r?.[0] || '').trim();
      const beerTitle = String(r?.[1] || '').trim();
      const imgUrl    = cleanUrlMaybe(r?.[2] || '');

      if (!packTitle || !beerTitle) continue;

      const key = normalizeKey(packTitle);
      if (!m.has(key)) m.set(key, []);
      m.get(key).push({ beerTitle, imageUrl: imgUrl });
    }

    packMap = m;
    console.log(`✅ Loaded Variety Pack map: ${packMap.size} packs`);
  } catch (e) {
    console.warn('⚠️ Variety pack map failed (continuing without pack explosion).', e);
    packMap = new Map();
  }
}

// ———————————————————————————————————————————————
// DATA: LOAD + PARSE ORDERS (HEADER-AWARE + FALLBACKS)
// ———————————————————————————————————————————————
async function loadOrders() {
  try {
    // Load enrichers first
    await loadImageLookup();
    await loadVarietyPackMap(); // ✅ NEW

    const res = await fetch(ordersUrl);
    if (!res.ok) {
      const body = await res.text();
      throw new Error(`Orders fetch failed ${res.status}: ${body}`);
    }

    const json = await res.json();
    const rows = json.values || [];
    if (rows.length < 2) throw new Error('No orders found');

    // Header-aware mapping (works even if columns move)
    const header = rows[0].map(h => normalizeKey(h));
    const idx = (name) => header.indexOf(normalizeKey(name));

    const iOrderId       = idx('orderid');
    const iCustomerName  = idx('customername');
    const iAddress       = idx('address');
    const iItemTitle     = idx('itemtitle');
    const iVariantTitle  = idx('varianttitle');
    const iQty           = idx('qty');
    const iNotes         = idx('notes');
    const iImageUrlA     = idx('imageurl');
    const iImageUrlB     = idx('image');      // some people name it "image"

    const grouped = {};

    for (const r of rows.slice(1)) {
      const orderId = (iOrderId >= 0 ? r[iOrderId] : r[0]) || '';
      const itemTitle = (iItemTitle >= 0 ? r[iItemTitle] : r[3] || r[1]) || '';
      const variantTitle = (iVariantTitle >= 0 ? r[iVariantTitle] : r[4]) || '';
      const qtyRaw = (iQty >= 0 ? r[iQty] : r[5] || r[2]) || 0;

      let imageFromSheet = '';
      if (iImageUrlA >= 0) imageFromSheet = r[iImageUrlA] || '';
      else if (iImageUrlB >= 0) imageFromSheet = r[iImageUrlB] || '';
      else if (r.length === 3 && isLikelyUrl(r[2])) imageFromSheet = r[2] || '';
      else if (r.length >= 9 && isLikelyUrl(r[8])) imageFromSheet = r[8] || '';

      const qty = parseInt(qtyRaw, 10) || 0;

      const packSizeMatch = String(variantTitle || '').match(/(\d+)\s*pack/i);
      const packSize = packSizeMatch ? parseInt(packSizeMatch[1], 10) : 1;
      const cans = qty * (packSize || 1);

      const customerName = (iCustomerName >= 0 ? r[iCustomerName] : r[1]) || '';
      const address = (iAddress >= 0 ? r[iAddress] : r[2]) || '';
      const notes = (iNotes >= 0 ? r[iNotes] : r[7]) || '';

      if (!grouped[orderId]) {
        grouped[orderId] = {
          orderId,
          customerName: customerName || '',
          address: address || '',
          notes: notes || '',
          items: [],
          totalCans: 0
        };
      }

      const resolvedImageUrl = getImageForTitle(itemTitle, imageFromSheet);

      grouped[orderId].items.push({
        itemTitle: itemTitle || '',
        cans,
        imageUrl: resolvedImageUrl
      });

      grouped[orderId].totalCans += cans;
    }

    const parsedOrders = Object.values(grouped);
    parsedOrders.forEach(o => o.items.sort((a,b) => a.itemTitle.localeCompare(b.itemTitle)));

    orders = parsedOrders;
    packIndex = 0;

    pickQueue = buildPickQueue(orders); // ✅ explodes packs + sorts by loop
    pickIndex = 0;
    isPicking = false;
    issues = [];

    renderStart();
  } catch (err) {
    console.error(err);
    renderStartError(`Failed to load orders. ${err.message || ''}`);
  }
}

// ———————————————————————————————————————————————
// PICK QUEUE: EXPLODE PACKS + MERGE + SORT BY YOUR LOOP
// ———————————————————————————————————————————————
function buildPickQueue(orderList) {
  const map = new Map();

  for (const o of orderList) {
    for (const it of o.items) {
      const rawTitle = String(it.itemTitle || '').trim();
      if (!rawTitle) continue;

      // PACK EXPLOSION
      const packKey = normalizeKey(rawTitle);
      const packItems = packMap.get(packKey);

      if (packItems && packItems.length) {
        // IMPORTANT:
        // This assumes your Variety Packs sheet lists EACH CAN as a row.
        // If it lists each beer only once, you'll undercount (data issue).
        for (const p of packItems) {
          const beerTitle = String(p.beerTitle || '').trim();
          if (!beerTitle) continue;

          const key = normalizeKey(beerTitle);
          const addCans = 1;

          const existing = map.get(key);
          if (existing) {
            existing.cans += addCans;
            if (!existing.imageUrl && p.imageUrl) existing.imageUrl = p.imageUrl;
          } else {
            const img = p.imageUrl || getImageForTitle(beerTitle, '');
            map.set(key, {
              itemTitle: beerTitle,
              cans: addCans,
              imageUrl: img || '',
              location: guessLocation(beerTitle)
            });
          }
        }
        continue;
      }

      // NORMAL ITEM
      const key = normalizeKey(rawTitle);
      const existing = map.get(key);

      if (existing) {
        existing.cans += it.cans;
        if (!existing.imageUrl && it.imageUrl) existing.imageUrl = it.imageUrl;
      } else {
        map.set(key, {
          itemTitle: rawTitle,
          cans: it.cans,
          imageUrl: it.imageUrl || '',
          location: guessLocation(rawTitle)
        });
      }
    }
  }

  const queue = Array.from(map.values());

  // Sort by your real loop order
  queue.sort((a,b) => {
    const la = a.location?.sortKey || '99-999-?';
    const lb = b.location?.sortKey || '99-999-?';
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
  if (el.startError) el.startError.classList.add('hidden');

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
// PICK VIEW
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
    if (it.imageUrl) el.pickImage.src = it.imageUrl;
    else placeholderImage(el.pickImage);
  }
}

function confirmPick() {
  pickIndex++;
  renderPick();
}

function openIssueModal() {
  if (!el.issueModal) return;
  el.issueModal.classList.remove('hidden');
}

function closeIssueModal() {
  if (!el.issueModal) return;
  el.issueModal.classList.add('hidden');
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

function renderPackOrder() {
  if (!orders.length) return;

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

  if (!el.packItemsContainer) return;
  el.packItemsContainer.innerHTML = '';
  const frag = document.createDocumentFragment();

  for (const it of o.items) {
    const row = document.createElement('div');
    row.className = 'item';

    const img = document.createElement('img');
    img.alt = it.itemTitle;
    img.onerror = () => { img.src = 'https://via.placeholder.com/60'; };
    img.src = it.imageUrl || 'https://via.placeholder.com/60';

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

function escapeHtml(str) {
  return String(str ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');
}

// ———————————————————————————————————————————————
// PACK PICKER (LAZY-LOAD)
// ———————————————————————————————————————————————
async function loadPacksOnce() {
  if (packsLoaded) return;
  packsLoaded = true;

  try {
    const [tRes, vRes] = await Promise.all([
      fetch(packTitlesUrl),
      fetch(varietyPacksUrl)
    ]);

    if (!tRes.ok) throw new Error(`PackTitles fetch failed ${tRes.status}: ${await tRes.text()}`);
    if (!vRes.ok) throw new Error(`VarietyPacks fetch failed ${vRes.status}: ${await vRes.text()}`);

    const tR = await tRes.json();
    const vR = await vRes.json();

    const titles = (tR.values || []).map(r => r[0]).filter(Boolean);
    varietyPacksData = vR.values || [];

    if (el.packDropdown) {
      el.packDropdown.innerHTML = `<option value="All">All</option>`;
      for (const t of titles) el.packDropdown.add(new Option(t, t));
    }

    displayPacks('All');
  } catch (e) {
    console.error(e);
    if (el.results) el.results.textContent = 'Failed to load packs.';
  }
}

function displayPacks(filter) {
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
    img.src = cleanUrlMaybe(imgUrl) || 'https://via.placeholder.com/50';

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
// EVENTS (wired once) — NULL SAFE
// ———————————————————————————————————————————————
on(el.startPickingBtn, 'click', startPicking);
on(el.confirmPickBtn, 'click', confirmPick);

on(el.issueBtn, 'click', openIssueModal);
on(el.closeIssueModalBtn, 'click', closeIssueModal);

document.querySelectorAll('.modal-option').forEach(btn => {
  btn.addEventListener('click', () => logIssue(btn.getAttribute('data-issue') || 'other'));
});

on(el.goToPackBtn, 'click', goPackMode);
on(el.goPackModeBtn, 'click', goPackMode);

on(el.goStartBtn, 'click', () => showView(el.startView));
on(el.backToStartBtn, 'click', () => showView(el.startView));

on(el.packPrevBtn, 'click', () => {
  if (packIndex > 0) { packIndex--; renderPackOrder(); }
});
on(el.packNextBtn, 'click', () => {
  if (packIndex < orders.length - 1) { packIndex++; renderPackOrder(); }
});

on(el.openPackPickerBtn, 'click', async () => {
  if (!el.packPickerPanel) return;
  el.packPickerPanel.classList.toggle('hidden');

  if (!el.packPickerPanel.classList.contains('hidden')) {
    if (el.results) el.results.textContent = 'Loading packs…';
    await loadPacksOnce();
  }
});

on(el.packDropdown, 'change', (e) => displayPacks(e.target.value));

// ———————————————————————————————————————————————
// INIT
// ———————————————————————————————————————————————
showView(el.startView);
loadOrders();
