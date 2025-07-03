// ———————————————————————————————————————————————
// CONFIG
// ———————————————————————————————————————————————
const sheetId       = '1xE9SueE6rdDapXr0l8OtP_IryFM-Z6fHFH27_cQ120g';
const sheetName     = 'Orders';
const apiKey        = 'AIzaSyA7sSHMaY7i-uxxynKewHLsHxP_dd3TZ4U';
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
  // show “loading” placeholder
  document.getElementById('order-container').innerHTML =
    `<p style="text-align:center;opacity:.6">Loading orders…</p>`;

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
      const m   = variantTitle.match(/(\d+)\s*pack/i);
      const packSize = m ? +m[1] : 1;
      const cans     = qty * packSize;

      if (!grouped[orderId]) {
        grouped[orderId] = {
          orderId,
          customerName,
          address,
          notes: notes || '',
          items: [],
          totalCans: 0
        };
      }
      grouped[orderId].items.push({ itemTitle, cans, imageUrl });
      grouped[orderId].totalCans += cans;
    });

    orders = Object.values(grouped);
    currentIndex = 0;
    updateDashboard();
    renderOrder();

  } catch (err) {
    console.error(err);
    document.getElementById('order-container').innerHTML =
      `<p style="text-align:center;opacity:.6">Failed to load orders.</p>`;
  }
}

function calculateBoxes(n) {
  let rem = n, counts = {24:0,12:0,6:0};
  counts[24] = Math.floor(rem/24); rem %=24;
  counts[12] = Math.floor(rem/12); rem %=12;
  counts[6]  = Math.floor(rem/6);  rem %=6;
  if (rem>0) counts[6]++;
  return counts;
}

function updateDashboard() {
  document.getElementById('dash-pending').textContent = orders.length;
  let totalBoxes = 0;
  orders.forEach(o => {
    const b = calculateBoxes(o.totalCans);
    totalBoxes += b[24] + b[12] + b[6];
  });
  document.getElementById('dash-boxes').textContent = totalBoxes;
}

function renderOrder() {
  const o = orders[currentIndex];
  if (!o) return;
  document.getElementById('orderId').textContent        = `Order #${o.orderId}`;
  document.getElementById('customerName').textContent   = o.customerName;
  document.getElementById('customerAddress').textContent= o.address;

  const b = calculateBoxes(o.totalCans),
        lines = [];
  if (b[24]) lines.push(`${b[24]} × 24-pack`);
  if (b[12]) lines.push(`${b[12]} × 12-pack`);
  if (b[6 ]) lines.push(`${b[6]} × 6-pack`);
  document.getElementById('boxesInfo').innerHTML =
    `<strong>Boxes Required:</strong> ${lines.join(', ')}`;

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

// navigation & swipe
document.getElementById('prevBtn').onclick = () => {
  if (currentIndex>0) { currentIndex--; renderOrder(); }
};
document.getElementById('nextBtn').onclick = () => {
  if (currentIndex<orders.length-1) { currentIndex++; renderOrder(); }
};
let startX = 0;
const oc = document.getElementById('order-container');
oc.addEventListener('touchstart', e => startX = e.changedTouches[0].screenX);
oc.addEventListener('touchend', e => {
  const dx = e.changedTouches[0].screenX - startX;
  if (dx > 50 && currentIndex>0)            { currentIndex--; renderOrder(); }
  else if (dx < -50 && currentIndex<orders.length-1) { currentIndex++; renderOrder(); }
});

// ———————————————————————————————————————————————
// PACK PICKER MODULE
// ———————————————————————————————————————————————
async function loadPacks() {
  const results = document.getElementById('results');
  results.textContent = 'Loading packs…';

  try {
    const [ titlesRes, packsRes ] = await Promise.all([
      fetch(packTitlesUrl).then(r=>r.json()),
      fetch(varietyPacksUrl).then(r=>r.json())
    ]);

    // build dropdown
    const dropdown = document.getElementById('packDropdown');
    dropdown.innerHTML = `<option value="All">All</option>`;
    (titlesRes.values||[]).forEach(r => {
      const opt = document.createElement('option');
      opt.value = r[0];
      opt.textContent = r[0];
      dropdown.appendChild(opt);
    });

    varietyPacksData = packsRes.values||[];
    displayPacks('All');
    packsLoaded = true;

  } catch (err) {
    console.error(err);
    results.textContent = 'Failed to load packs.';
  }
}

function displayPacks(filterTitle) {
  const results = document.getElementById('results');
  results.innerHTML = '';
  let list = varietyPacksData;
  if (filterTitle !== 'All') list = list.filter(r=>r[0]===filterTitle);
  if (!list.length) return void(results.textContent='No entries.');
  list.forEach(r => {
    const [packTitle, beerName, beerImageURL] = r;
    const div = document.createElement('div');
    div.className = 'pack-item';
    div.innerHTML = `
      <h3>${packTitle} - ${beerName}</h3>
      <img src="${beerImageURL}" alt="${beerName}" />
    `;
    results.appendChild(div);
  });
}
document.getElementById('packDropdown').addEventListener('change', e => {
  displayPacks(e.target.value);
});

// ———————————————————————————————————————————————
// VIEW TOGGLING
// ———————————————————————————————————————————————
document.getElementById('togglePacksBtn').addEventListener('click', () => {
  document.getElementById('ordersView').classList.add('hidden');
  document.getElementById('packsView' ).classList.remove('hidden');
  if (!packsLoaded) loadPacks();
});
document.getElementById('backToOrdersBtn').addEventListener('click', () => {
  document.getElementById('packsView' ).classList.add('hidden');
  document.getElementById('ordersView').classList.remove('hidden');
});

// ———————————————————————————————————————————————
// START
// ———————————————————————————————————————————————
loadOrders();
