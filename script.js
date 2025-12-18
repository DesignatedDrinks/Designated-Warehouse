// ———————————————————————————————————————————————
// CONFIG (YOUR APIS)
// ———————————————————————————————————————————————
const sheetId   = '1xE9SueE6rdDapXr0l8OtP_IryFM-Z6fHFH27_cQ120g';
const sheetName = 'Orders';
const apiKey    = 'AIzaSyA7sSHMaY7i-uxxynKewHLsHxP_dd3TZ4U';

const ordersUrl =
  `https://sheets.googleapis.com/v4/spreadsheets/${sheetId}/values/${encodeURIComponent(sheetName)}?alt=json&key=${apiKey}`;

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

let varietyPacksData = [];
let packsLoaded = false;

// ———————————————————————————————————————————————
// VIEW CONTROL
// ———————————————————————————————————————————————
function showView(which) {
  [el.startView, el.pickView, el.completeView, el.packModeView]
    .forEach(v => v.classList.add('hidden'));
  which.classList.remove('hidden');
}

// ———————————————————————————————————————————————
// SAFE HELPERS
// ———————————————————————————————————————————————
function setText(node, value) {
  node.textContent = value ?? '';
}

function placeholderImage(imgEl) {
  imgEl.src = 'https://via.placeholder.com/600x600?text=No+Image';
}

function normalizeKey(s) {
  return String(s || '').trim().toLowerCase();
}

// Placeholder until you provide a real mapping sheet
function guessLocation(title) {
  const t = normalizeKey(title);
  const c = t[0] || 'a';
  const aisle = c < 'h' ? 1 : c < 'p' ? 2 : 3;
  return { label: `AISLE ${aisle}`, sortKey: `A${aisle}` };
}

// ———————————————————————————————————————————————
// DATA: LOAD + PARSE ORDERS
// ———————————————————————————————————————————————
async function loadOrders() {
  try {
    const res = await fetch(ordersUrl);
    const json = await res.json();
    const rows = json.values || [];
    if (rows.length < 2) throw new Error('No orders found');

    const grouped = {};

    for (const r of rows.slice(1)) {
      const [
        orderId,
        customerName,
        address,
        itemTitle,
        variantTitle,
        qtyStr,
        /* picked */,
        notes,
        imageUrl
      ] = r;

      const qty = parseInt(qtyStr, 10) || 0;
      const packSize = (String(variantTitle || '').match(/(\d+)\s*pack/i) || [1, 1])[1];
      const cans = qty * parseInt(packSize, 10);

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

      grouped[orderId].items.push({
        itemTitle: itemTitle || '',
        cans,
        imageUrl: imageUrl || ''
      });

      grouped[orderId].totalCans += cans;
    }

    // stable, predictable sort for pack mode
    const parsedOrders = Object.values(grouped);
    parsedOrders.forEach(o => o.items.sort((a,b) => a.itemTitle.localeCompare(b.itemTitle)));

    orders = parsedOrders;
    packIndex = 0;

    pickQueue = buildPickQueue(orders);
    pickIndex = 0;
    isPicking = false;
    issues = [];

    renderStart();
  } catch (err) {
    console.error(err);
    renderStartError('Failed to load orders. Check sheet access / API key restrictions.');
  }
}

function buildPickQueue(orderList) {
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
          imageUrl: it.imageUrl || '',
          location: guessLocation(it.itemTitle)
        });
      }
    }
  }

  const queue = Array.from(map.values());
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
  el.startError.classList.add('hidden');

  setText(el.dashPending, orders.length);
  const totalCans = pickQueue.reduce((sum, it) => sum + (it.cans || 0), 0);
  setText(el.dashCans, totalCans);

  el.startPickingBtn.disabled = pickQueue.length === 0;
}

function renderStartError(msg) {
  showView(el.startView);
  setText(el.dashPending, '—');
  setText(el.dashCans, '—');

  el.startPickingBtn.disabled = true;
  el.startError.classList.remove('hidden');
  setText(el.startError, msg);
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

  el.pickImage.onerror = () => placeholderImage(el.pickImage);
  if (it.imageUrl) el.pickImage.src = it.imageUrl;
  else placeholderImage(el.pickImage);
}

function confirmPick() {
  pickIndex++;
  renderPick();
}

function openIssueModal() {
  el.issueModal.classList.remove('hidden');
}

function closeIssueModal() {
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

  // clamp
  if (packIndex < 0) packIndex = 0;
  if (packIndex > orders.length - 1) packIndex = orders.length - 1;

  const o = orders[packIndex];

  setText(el.packOrderId, `Order #${o.orderId}`);
  setText(el.packCustomerName, o.customerName);
  setText(el.packCustomerAddress, o.address);

  el.packPrevBtn.disabled = packIndex === 0;
  el.packNextBtn.disabled = packIndex === orders.length - 1;

  const b = calculateBoxes(o.totalCans);
  const lines = [];
  if (b[24]) lines.push(`${b[24]}×24-pack`);
  if (b[12]) lines.push(`${b[12]}×12-pack`);
  if (b[6])  lines.push(`${b[6]}×6-pack`);

  el.packBoxesInfo.innerHTML =
    `<strong>Boxes Required:</strong> ${lines.length ? lines.join(', ') : '—'}<br>` +
    `<strong>Total Cans:</strong> ${o.totalCans}` +
    (o.notes ? `<br><strong>Notes:</strong> ${escapeHtml(o.notes)}` : '');

  // render items list (stable, minimal innerHTML, no inline handlers)
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
    const [tR, vR] = await Promise.all([
      fetch(packTitlesUrl).then(r => r.json()),
      fetch(varietyPacksUrl).then(r => r.json())
    ]);

    const titles = (tR.values || []).map(r => r[0]).filter(Boolean);
    varietyPacksData = vR.values || [];

    // reset dropdown
    el.packDropdown.innerHTML = `<option value="All">All</option>`;
    for (const t of titles) el.packDropdown.add(new Option(t, t));

    displayPacks('All');
  } catch (e) {
    console.error(e);
    el.results.textContent = 'Failed to load packs.';
  }
}

function displayPacks(filter) {
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
    img.src = imgUrl || 'https://via.placeholder.com/50';

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
el.startPickingBtn.addEventListener('click', startPicking);
el.confirmPickBtn.addEventListener('click', confirmPick);

el.issueBtn.addEventListener('click', openIssueModal);
el.closeIssueModalBtn.addEventListener('click', closeIssueModal);

document.querySelectorAll('.modal-option').forEach(btn => {
  btn.addEventListener('click', () => logIssue(btn.getAttribute('data-issue') || 'other'));
});

el.goToPackBtn.addEventListener('click', goPackMode);
el.goPackModeBtn.addEventListener('click', goPackMode);

el.goStartBtn.addEventListener('click', () => showView(el.startView));
el.backToStartBtn.addEventListener('click', () => showView(el.startView));

el.packPrevBtn.addEventListener('click', () => { if (packIndex > 0) { packIndex--; renderPackOrder(); } });
el.packNextBtn.addEventListener('click', () => { if (packIndex < orders.length - 1) { packIndex++; renderPackOrder(); } });

el.openPackPickerBtn.addEventListener('click', async () => {
  el.packPickerPanel.classList.toggle('hidden');

  if (!el.packPickerPanel.classList.contains('hidden')) {
    el.results.textContent = 'Loading packs…';
    await loadPacksOnce();
  }
});

el.packDropdown.addEventListener('change', (e) => displayPacks(e.target.value));

// ———————————————————————————————————————————————
// INIT
// ———————————————————————————————————————————————
showView(el.startView);
loadOrders();
