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
// STATE
// ———————————————————————————————————————————————
let orders = [];               // order-centric (pack mode)
let packIndex = 0;

let pickQueue = [];            // pick-centric (picker mode)
let pickIndex = 0;
let issues = [];
let isPicking = false;

// pack picker data
let varietyPacksData = [];
let packTitles = [];
let packsLoaded = false;

// ———————————————————————————————————————————————
// HELPERS
// ———————————————————————————————————————————————
function $(id) { return document.getElementById(id); }

function safeText(el, txt) {
  if (el) el.textContent = txt ?? '';
}

function showView(idToShow) {
  const views = ['startView', 'pickView', 'completeView', 'packModeView'];
  views.forEach(id => $(id)?.classList.add('hidden'));
  $(idToShow)?.classList.remove('hidden');
}

// Placeholder until you add real SKU→Location mapping
function guessLocation(title) {
  const t = (title || '').trim().toLowerCase();
  const c = t[0] || 'a';
  const aisle = c < 'h' ? 1 : c < 'p' ? 2 : 3;
  return { label: `AISLE ${aisle}`, sortKey: `A${aisle}` };
}

// ———————————————————————————————————————————————
// ORDERS LOAD (used for BOTH picker and pack mode)
// ———————————————————————————————————————————————
async function loadOrders() {
  try {
    const res = await fetch(ordersUrl);
    const json = await res.json();
    const rows = json.values || [];
    if (rows.length < 2) throw new Error('No orders found');

    // group by orderId
    const grouped = {};
    rows.slice(1).forEach(r => {
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

      // original logic: pack size from variantTitle like "28 pack"
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
    });

    // Pack mode wants items A→Z (fine)
    Object.values(grouped).forEach(o => {
      o.items.sort((a, b) => {
        const aw = (a.itemTitle || '').split(' ')[0] || '';
        const bw = (b.itemTitle || '').split(' ')[0] || '';
        return aw.localeCompare(bw);
      });
    });

    orders = Object.values(grouped);
    packIndex = 0;

    // Build pick queue (merge duplicates across all orders)
    pickQueue = buildPickQueueFromOrders(orders);
    pickIndex = 0;
    issues = [];
    isPicking = false;

    renderStartView();
  } catch (err) {
    console.error(err);
    // show start view but disabled
    renderStartView(true);
  }
}

function buildPickQueueFromOrders(orderList) {
  const map = new Map();

  for (const o of orderList) {
    for (const it of o.items) {
      const key = (it.itemTitle || '').trim().toLowerCase();
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

  // Sort by aisle (placeholder) then name
  queue.sort((a, b) => {
    const la = a.location?.sortKey || '';
    const lb = b.location?.sortKey || '';
    if (la !== lb) return la.localeCompare(lb);
    return (a.itemTitle || '').localeCompare(b.itemTitle || '');
  });

  return queue;
}

// ———————————————————————————————————————————————
// SCREEN 1 — START
// ———————————————————————————————————————————————
function renderStartView(loadFailed = false) {
  showView('startView');

  const startBtn = $('startPickingBtn');
  const pendingEl = $('dash-pending');
  const cansEl = $('dash-cans');

  if (loadFailed) {
    safeText(pendingEl, '—');
    safeText(cansEl, '—');
    if (startBtn) startBtn.disabled = true;
    return;
  }

  safeText(pendingEl, orders.length);

  const totalCans = pickQueue.reduce((sum, it) => sum + (it.cans || 0), 0);
  safeText(cansEl, totalCans);

  if (startBtn) startBtn.disabled = pickQueue.length === 0;
}

// ———————————————————————————————————————————————
// SCREEN 2 — PICK ITEM LOOP
// ———————————————————————————————————————————————
function renderPickItem() {
  if (!isPicking) return renderStartView();

  if (pickIndex >= pickQueue.length) {
    return renderCompleteView();
  }

  showView('pickView');

  const it = pickQueue[pickIndex];

  safeText($('pickLocation'), it.location?.label || 'LOCATION');
  safeText($('pickName'), it.itemTitle || '');
  safeText($('pickQty'), `PICK: ${it.cans} CANS`);

  const img = $('pickImage');
  if (img) {
    img.src = it.imageUrl || 'https://via.placeholder.com/600x600?text=No+Image';
    img.onerror = () => { img.src = 'https://via.placeholder.com/600x600?text=No+Image'; };
  }
}

// ———————————————————————————————————————————————
// SCREEN 3 — COMPLETE
// ———————————————————————————————————————————————
function renderCompleteView() {
  showView('completeView');
  isPicking = false;

  safeText($('pickedCount'), pickQueue.length);
  safeText($('issueCount'), issues.length);
}

// ———————————————————————————————————————————————
// PACK MODE
// ———————————————————————————————————————————————
function calculateBoxes(n) {
  // Small order rules
  if (n <= 6)  return { 24: 0, 12: 0, 6: 1 };
  if (n <= 12) return { 24: 0, 12: 1, 6: 0 };

  let best = { total: Infinity, totalCans: Infinity, counts: { 24: 0, 12: 0, 6: 0 } };

  for (let a = 0; a <= Math.ceil(n / 24); a++) {
    for (let b = 0; b <= Math.ceil(n / 12); b++) {
      for (let c = 0; c <= Math.ceil(n / 6); c++) {
        const totalCans = a * 24 + b * 12 + c * 6;
        const totalBoxes = a + b + c;

        if (totalCans >= n) {
          const isBetter =
            totalBoxes < best.total ||
            (totalBoxes === best.total && totalCans < best.totalCans);

          if (isBetter) {
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

function renderPackMode() {
  showView('packModeView');

  const wrap = $('packOrders');
  if (!wrap) return;

  if (!orders.length) {
    wrap.innerHTML = `<p style="text-align:center;opacity:.6;margin-top:1rem;">No orders loaded.</p>`;
    return;
  }

  const o = orders[packIndex];
  const b = calculateBoxes(o.totalCans);

  const lines = [];
  if (b[24]) lines.push(`${b[24]}×24-pack`);
  if (b[12]) lines.push(`${b[12]}×12-pack`);
  if (b[6])  lines.push(`${b[6]}×6-pack`);

  wrap.innerHTML = `
    <div class="order-container">
      <div class="order-header">
        <button id="packPrevBtn" class="nav-btn" ${packIndex === 0 ? 'disabled' : ''}>←</button>

        <div class="order-info" style="flex:1;text-align:center;">
          <h2 style="margin-bottom:.25rem;">Order #${escapeHtml(o.orderId)}</h2>
          <div class="customer-name">${escapeHtml(o.customerName)}</div>
          <div class="customer-address">${escapeHtml(o.address)}</div>
        </div>

        <button id="packNextBtn" class="nav-btn" ${packIndex === orders.length - 1 ? 'disabled' : ''}>→</button>
      </div>

      <div class="boxes-info">
        <strong>Boxes Required:</strong> ${lines.length ? lines.join(', ') : '—'}<br>
        <strong>Total Cans:</strong> ${o.totalCans}<br>
        ${o.notes ? `<strong>Notes:</strong> ${escapeHtml(o.notes)}` : ''}
      </div>

      <div class="items-list">
        ${o.items.map(it => `
          <div class="item">
            <img src="${it.imageUrl || ''}" alt="${escapeHtml(it.itemTitle)}"
              onerror="this.src='https://via.placeholder.com/60'" />
            <div class="details">
              <p><strong>${escapeHtml(it.itemTitle)}</strong></p>
              <p>${it.cans} cans</p>
            </div>
          </div>
        `).join('')}
      </div>

      <div style="margin-top:1rem;">
        <button id="openPackPickerBtn" class="nav-btn" style="width:100%;">Open Pack Picker</button>
        <div id="packPickerPanel" class="hidden" style="margin-top:1rem;">
          <div class="filter-container">
            <label for="packDropdown">Select Variety Pack:</label>
            <select id="packDropdown">
              <option value="All">All</option>
            </select>
          </div>
          <div id="results">Loading packs…</div>
        </div>
      </div>
    </div>
  `;

  // Hook up pack nav
  $('packPrevBtn')?.addEventListener('click', () => {
    if (packIndex > 0) { packIndex--; renderPackMode(); }
  });
  $('packNextBtn')?.addEventListener('click', () => {
    if (packIndex < orders.length - 1) { packIndex++; renderPackMode(); }
  });

  // Hook up pack picker panel
  $('openPackPickerBtn')?.addEventListener('click', async () => {
    const panel = $('packPickerPanel');
    if (!panel) return;

    panel.classList.toggle('hidden');

    // lazy-load packs once
    if (!packsLoaded) {
      await loadPacks();
      packsLoaded = true;
    } else {
      // if already loaded, just render current filter
      displayPacks($('packDropdown')?.value || 'All');
    }
  });

  // If dropdown exists (after loadPacks), we wire change handler there.
}

// Simple HTML escaping (prevents random sheet text from breaking DOM)
function escapeHtml(str) {
  return String(str ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');
}

// ———————————————————————————————————————————————
// PACK PICKER MODULE (your API endpoints)
// ———————————————————————————————————————————————
async function loadPacks() {
  try {
    const [tR, vR] = await Promise.all([
      fetch(packTitlesUrl).then(r => r.json()),
      fetch(varietyPacksUrl).then(r => r.json())
    ]);

    packTitles = (tR.values || []).map(r => r[0]).filter(Boolean);
    varietyPacksData = vR.values || [];

    const dd = $('packDropdown');
    if (dd) {
      // reset options
      dd.innerHTML = `<option value="All">All</option>`;
      packTitles.forEach(title => dd.add(new Option(title, title)));

      dd.onchange = e => displayPacks(e.target.value);
    }

    displayPacks('All');
  } catch (e) {
    console.error(e);
    const out = $('results');
    if (out) out.textContent = 'Failed to load packs.';
  }
}

function displayPacks(filter) {
  const out = $('results');
  if (!out) return;

  out.innerHTML = '';

  let list = varietyPacksData;
  if (filter !== 'All') list = list.filter(r => r[0] === filter);

  if (!list.length) {
    out.textContent = 'No entries.';
    return;
  }

  list.forEach(([pack, beer, img]) => {
    out.insertAdjacentHTML('beforeend', `
      <div class="pack-item">
        <img src="${img || ''}" alt="${escapeHtml(beer)}"
          onerror="this.src='https://via.placeholder.com/50'" />
        <div>
          <h3>${escapeHtml(pack)} – ${escapeHtml(beer)}</h3>
        </div>
      </div>
    `);
  });
}

// ———————————————————————————————————————————————
// EVENTS (V3 flow)
// ———————————————————————————————————————————————
$('startPickingBtn')?.addEventListener('click', () => {
  isPicking = true;
  pickIndex = 0;
  issues = [];
  renderPickItem();
});

$('confirmPickBtn')?.addEventListener('click', () => {
  pickIndex++;
  renderPickItem();
});

$('issueBtn')?.addEventListener('click', () => {
  $('issueModal')?.classList.remove('hidden');
});

$('closeIssueModalBtn')?.addEventListener('click', () => {
  $('issueModal')?.classList.add('hidden');
});

document.querySelectorAll('.modal-option').forEach(btn => {
  btn.addEventListener('click', () => {
    const type = btn.getAttribute('data-issue') || 'other';
    const it = pickQueue[pickIndex];

    issues.push({
      type,
      itemTitle: it?.itemTitle || '',
      cans: it?.cans || 0,
      atIndex: pickIndex,
      timestamp: Date.now()
    });

    $('issueModal')?.classList.add('hidden');
    pickIndex++;
    renderPickItem();
  });
});

$('goToPackBtn')?.addEventListener('click', () => {
  renderPackMode();
});

$('goPackModeBtn')?.addEventListener('click', () => {
  renderPackMode();
});

$('backToStartBtn')?.addEventListener('click', () => {
  renderStartView();
});

// ———————————————————————————————————————————————
// INIT
// ———————————————————————————————————————————————
showView('startView');
loadOrders();
