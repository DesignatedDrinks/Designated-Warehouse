// ———————————————————————————————————————————————
// CONFIG
// ———————————————————————————————————————————————
const sheetId   = '1xE9SueE6rdDapXr0l8OtP_IryFM-Z6fHFH27_cQ120g';
const sheetName = 'Orders';
const apiKey    = 'AIzaSyA7sSHMaY7i-uxxynKewHLsHxP_dd3TZ4U';

// 🔑 IMPORTANT: force columns A:I so imageUrl is never dropped
const ordersUrl =
  `https://sheets.googleapis.com/v4/spreadsheets/${sheetId}/values/${encodeURIComponent(sheetName + '!A:I')}?alt=json&key=${apiKey}`;

// ———————————————————————————————————————————————
// DOM
// ———————————————————————————————————————————————
const el = {
  startView: document.getElementById('startView'),
  pickView: document.getElementById('pickView'),
  completeView: document.getElementById('completeView'),

  dashPending: document.getElementById('dash-pending'),
  dashCans: document.getElementById('dash-cans'),
  startPickingBtn: document.getElementById('startPickingBtn'),
  startError: document.getElementById('startError'),

  pickLocation: document.getElementById('pickLocation'),
  pickProgress: document.getElementById('pickProgress'),
  pickImage: document.getElementById('pickImage'),
  pickName: document.getElementById('pickName'),
  pickQty: document.getElementById('pickQty'),
  confirmPickBtn: document.getElementById('confirmPickBtn'),

  pickedCount: document.getElementById('pickedCount'),
};

// ———————————————————————————————————————————————
// STATE
// ———————————————————————————————————————————————
let orders = [];
let pickQueue = [];
let pickIndex = 0;
let isPicking = false;

// ———————————————————————————————————————————————
// HELPERS
// ———————————————————————————————————————————————
function showView(view) {
  [el.startView, el.pickView, el.completeView].forEach(v => v.classList.add('hidden'));
  view.classList.remove('hidden');
}

function placeholder(img) {
  img.src = 'https://via.placeholder.com/600x600?text=No+Image';
}

function normalize(s) {
  return String(s || '').trim().toLowerCase();
}

function guessLocation(title) {
  const c = normalize(title)[0] || 'a';
  const aisle = c < 'h' ? 1 : c < 'p' ? 2 : 3;
  return { label: `AISLE ${aisle}`, sortKey: `A${aisle}` };
}

// ———————————————————————————————————————————————
// LOAD ORDERS
// ———————————————————————————————————————————————
async function loadOrders() {
  try {
    const res = await fetch(ordersUrl);
    const json = await res.json();
    const rows = json.values || [];
    if (rows.length < 2) throw new Error('No data');

    const map = new Map();

    for (const r of rows.slice(1)) {
      const [
        orderId,
        customerName,
        address,
        itemTitle,
        variantTitle,
        qtyStr,
        picked,
        notes,
        imageUrl
      ] = r;

      const qty = parseInt(qtyStr, 10) || 0;
      const packSize = (String(variantTitle || '').match(/(\d+)\s*pack/i) || [1, 1])[1];
      const cans = qty * parseInt(packSize, 10);

      const key = normalize(itemTitle);
      if (!map.has(key)) {
        map.set(key, {
          itemTitle,
          cans,
          imageUrl: imageUrl || '',
          location: guessLocation(itemTitle)
        });
      } else {
        map.get(key).cans += cans;
      }
    }

    pickQueue = Array.from(map.values()).sort((a,b) => {
      if (a.location.sortKey !== b.location.sortKey)
        return a.location.sortKey.localeCompare(b.location.sortKey);
      return a.itemTitle.localeCompare(b.itemTitle);
    });

    renderStart();
  } catch (e) {
    el.startError.textContent = 'Failed to load orders';
    el.startError.classList.remove('hidden');
  }
}

// ———————————————————————————————————————————————
// START VIEW
// ———————————————————————————————————————————————
function renderStart() {
  showView(el.startView);
  el.dashPending.textContent = pickQueue.length;
  el.dashCans.textContent = pickQueue.reduce((s,i)=>s+i.cans,0);
  el.startPickingBtn.disabled = pickQueue.length === 0;
}

// ———————————————————————————————————————————————
// PICKING
// ———————————————————————————————————————————————
function startPicking() {
  isPicking = true;
  pickIndex = 0;
  renderPick();
}

function renderPick() {
  if (pickIndex >= pickQueue.length) {
    isPicking = false;
    showView(el.completeView);
    el.pickedCount.textContent = pickQueue.length;
    return;
  }

  showView(el.pickView);

  const it = pickQueue[pickIndex];

  el.pickLocation.textContent = it.location.label;
  el.pickProgress.textContent = `${pickIndex + 1} / ${pickQueue.length}`;
  el.pickName.textContent = it.itemTitle;
  el.pickQty.textContent = `PICK: ${it.cans} CANS`;

  el.pickImage.onerror = () => placeholder(el.pickImage);
  el.pickImage.src =
    it.imageUrl && it.imageUrl.startsWith('http')
      ? it.imageUrl
      : 'https://via.placeholder.com/600x600?text=No+Image';

  console.log('🖼 IMAGE:', it.itemTitle, it.imageUrl);
}

function confirmPick() {
  pickIndex++;
  renderPick();
}

// ———————————————————————————————————————————————
// EVENTS
// ———————————————————————————————————————————————
el.startPickingBtn.addEventListener('click', startPicking);
el.confirmPickBtn.addEventListener('click', confirmPick);

// ———————————————————————————————————————————————
// INIT
// ———————————————————————————————————————————————
showView(el.startView);
loadOrders();
