// ———————————————————————————————————————————————
// CONFIG
// ———————————————————————————————————————————————
const sheetId       = '1xE9SueE6rdDapXr0l8OtP_IryFM-Z6fHFH27_cQ120g';
const sheetName     = 'Orders';
const apiKey        = 'AIzaSyA7sSHMaY7i-uxxynKewHLsHxP_dd3TZ4U';

// ← backticks so ${sheetId} and ${apiKey} resolve
const ordersUrl     = `https://sheets.googleapis.com/v4/spreadsheets/${sheetId}/values/${encodeURIComponent(sheetName)}?alt=json&key=${apiKey}`;

const packsSheetId    = '1TtRNmjsgC64jbkptnCdklBf_HqifwE9SQO2JlGrp4Us';
const packTitlesUrl   = `https://sheets.googleapis.com/v4/spreadsheets/${packsSheetId}/values/${encodeURIComponent('Pack Titles!A2:A')}?key=${apiKey}`;
const varietyPacksUrl = `https://sheets.googleapis.com/v4/spreadsheets/${packsSheetId}/values/${encodeURIComponent('Variety Packs!A2:C1000')}?key=${apiKey}`;

// ———————————————————————————————————————————————
// STATE
// ———————————————————————————————————————————————
let orders = [], currentIndex = 0;
let varietyPacksData = [], packsLoaded = false;

// ———————————————————————————————————————————————
// ORDERS MODULE
// ———————————————————————————————————————————————
async function loadOrders() {
  try {
    const res  = await fetch(ordersUrl);
    const json = await res.json();
    const rows = json.values || [];
    if (rows.length < 2) throw new Error('No orders found');

    // group rows by orderId
    const grouped = {};
    rows.slice(1).forEach(r => {
      const [ orderId, customerName, address, itemTitle, variantTitle, qtyStr, , notes, imageUrl ] = r;
      const qty = parseInt(qtyStr, 10) || 0;
      const packSize = (variantTitle.match(/(\d+)\s*pack/i) || [1,1])[1];
      const cans = qty * packSize;

      if (!grouped[orderId]) {
        grouped[orderId] = { orderId, customerName, address, notes: notes||'', items: [], totalCans: 0 };
      }
      grouped[orderId].items.push({ itemTitle, cans, imageUrl });
      grouped[orderId].totalCans += cans;
    });

    orders = Object.values(grouped);
    currentIndex = 0;
    updateDashboard();
    renderOrder();

  } catch (err) {
    document.getElementById('order-container').innerHTML =
      `<p style="padding:1rem;text-align:center;opacity:.6">Failed to load orders.</p>`;
    console.error(err);
  }
}

function calculateBoxes(n) {
  let rem = n, counts = {24:0,12:0,6:0};
  counts[24] = Math.floor(rem/24); rem %= 24;
  counts[12] = Math.floor(rem/12); rem %= 12;
  counts[6]  = Math.floor(rem/6);  rem %= 6;
  if (rem) counts[6]++;
  return counts;
}

function updateDashboard() {
  const pending = orders.length;
  let totalBoxes = 0;
  orders.forEach(o => {
    const b = calculateBoxes(o.totalCans);
    totalBoxes += b[24] + b[12] + b[6];
  });
  document.getElementById('dash-pending').textContent = pending;
  document.getElementById('dash-boxes').textContent  = totalBoxes;
}

function renderOrder() {
  const o = orders[currentIndex];
  if (!o) return;

  document.getElementById('orderId').textContent         = `Order #${o.orderId}`;
  document.getElementById('customerName').textContent    = o.customerName;
  document.getElementById('customerAddress').textContent = o.address;

  const b = calculateBoxes(o.totalCans), lines = [];
  if (b[24]) lines.push(`${b[24]}×24-pack`);
  if (b[12]) lines.push(`${b[12]}×12-pack`);
  if (b[6 ]) lines.push(`${b[6]}×6-pack`);
  const totalBoxes = b[24] + b[12] + b[6];

  document.getElementById('boxesInfo').innerHTML =
    `<strong>Boxes Required:</strong> ${lines.join(', ')}<br>` +
    `<strong>Total Boxes:</strong> ${totalBoxes}`;

  document.getElementById('itemsContainer').innerHTML =
    o.items.map(it => `
      <div class="item">
        <img src="${it.imageUrl||''}"
             onerror="this.src='https://via.placeholder.com/50'"
             alt="${it.itemTitle}" />
        <div class="details">
          <p><strong>${it.itemTitle}</strong></p>
          <p>${it.cans} cans</p>
        </div>
      </div>
    `).join('');

  document.getElementById('prevBtn').disabled = currentIndex === 0;
  document.getElementById('nextBtn').disabled = currentIndex === orders.length - 1;
}

// ← arrows & swipe
document.getElementById('prevBtn').onclick = () => {
  if (currentIndex > 0) { currentIndex--; renderOrder(); }
};
document.getElementById('nextBtn').onclick = () => {
  if (currentIndex < orders.length - 1) { currentIndex++; renderOrder(); }
};
let startX = 0;
const oc = document.getElementById('order-container');
oc.addEventListener('touchstart', e => startX = e.changedTouches[0].screenX);
oc.addEventListener('touchend', e => {
  const dx = e.changedTouches[0].screenX - startX;
  if (dx > 50 && currentIndex>0)        { currentIndex--; renderOrder(); }
  else if (dx < -50 && currentIndex<orders.length-1) { currentIndex++; renderOrder(); }
});

// ———————————————————————————————————————————————
// PACK PICKER MODULE
// ———————————————————————————————————————————————
async function loadPacks() {
  try {
    const [tRes, pRes] = await Promise.all([
      fetch(packTitlesUrl).then(r=>r.json()),
      fetch(varietyPacksUrl).then(r=>r.json())
    ]);
    const dd = document.getElementById('packDropdown');
    tRes.values?.forEach(r => {
      const opt = document.createElement('option');
      opt.value = r[0]; opt.textContent = r[0];
      dd.appendChild(opt);
    });
    varietyPacksData = pRes.values||[];
    displayPacks('All');
    packsLoaded = true;
  } catch (e) {
    document.getElementById('results').textContent = 'Failed to load packs.';
  }
}

function displayPacks(filterTitle) {
  const out = document.getElementById('results');
  out.innerHTML = '';
  let list = varietyPacksData;
  if (filterTitle !== 'All') list = list.filter(r=>r[0]===filterTitle);
  if (!list.length) return out.textContent = 'No entries.';
  list.forEach(r => {
    const [packTitle, beerName, beerImageURL] = r;
    const div = document.createElement('div');
    div.className = 'pack-item';
    div.innerHTML = `
      <h3>${packTitle} - ${beerName}</h3>
      <img src="${beerImageURL}" alt="${beerName}" />
    `;
    out.appendChild(div);
  });
}
document.getElementById('packDropdown').addEventListener('change', e => displayPacks(e.target.value));

// ———————————————————————————————————————————————
// VIEW TOGGLING
// ———————————————————————————————————————————————
document.getElementById('togglePacksBtn').onclick = () => {
  document.getElementById('ordersView').classList.add('hidden');
  document.getElementById('packsView').classList.remove('hidden');
  if (!packsLoaded) loadPacks();
};
document.getElementById('backToOrdersBtn').onclick = () => {
  document.getElementById('packsView').classList.add('hidden');
  document.getElementById('ordersView').classList.remove('hidden');
};

// ———————————————————————————————————————————————
// INIT
// ———————————————————————————————————————————————
loadOrders();
