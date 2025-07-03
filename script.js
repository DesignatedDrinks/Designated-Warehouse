// ———————————————————————————————————————————————
// CONFIG
// ———————————————————————————————————————————————
const sheetId   = '1xE9SueE6rdDapXr0l8OtP_IryFM-Z6fHFH27_cQ120g';
const sheetName = 'Orders';
const apiKey    = 'AIzaSyA7sSHMaY7i-uxxynKewHLsHxP_dd3TZ4U';

const ordersUrl = `https://sheets.googleapis.com/v4/spreadsheets/`
  + `${sheetId}/values/${encodeURIComponent(sheetName)}`
  + `?alt=json&key=${apiKey}`;

let orders = [];
let currentIndex = 0;

// ———————————————————————————————————————————————
// ORDERS MODULE
// ———————————————————————————————————————————————
async function loadOrders() {
  try {
    const res  = await fetch(ordersUrl);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const json = await res.json();
    const rows = json.values || [];
    if (rows.length < 2) throw new Error('No orders found');

    // group by orderId
    const grouped = {};
    rows.slice(1).forEach(r => {
      let [
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
      const m   = variantTitle.match(/(\d+)\s*pack/i);
      const packSize = m ? +m[1] : 1;
      const cans = qty * packSize;

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
    document.getElementById('order-container').innerHTML =
      `<p style="text-align:center;opacity:.6">
         Failed to load orders.<br><em>${err.message}</em>
       </p>`;
  }
}

function calculateBoxes(n) {
  let rem = n;
  const cnt = {24:0, 12:0, 6:0};
  cnt[24] = Math.floor(rem/24); rem %= 24;
  cnt[12] = Math.floor(rem/12); rem %= 12;
  cnt[6]  = Math.floor(rem/6);  rem %= 6;
  if (rem>0) cnt[6]++;
  return cnt;
}

function updateDashboard(){
  const pending = orders.length;
  let totalCans = 0, totalBoxes = 0;

  orders.forEach(o => {
    totalCans += o.totalCans;
    const b = calculateBoxes(o.totalCans);
    totalBoxes += b[24] + b[12] + b[6];
  });

  document.getElementById('dash-pending').textContent = pending;
  document.getElementById('dash-boxes').textContent  = totalBoxes;
}

function renderOrder(){
  const o = orders[currentIndex];
  if (!o) return;

  document.getElementById('orderId').textContent        = `Order #${o.orderId}`;
  document.getElementById('customerName').textContent   = o.customerName;
  document.getElementById('customerAddress').textContent= o.address;

  // boxes summary
  const b = calculateBoxes(o.totalCans);
  const lines = [];
  if (b[24]) lines.push(`${b[24]} × 24-pack`);
  if (b[12]) lines.push(`${b[12]} × 12-pack`);
  if (b[6 ]) lines.push(`${b[6]} × 6-pack`);
  const totalBoxes = b[24] + b[12] + b[6];
  document.getElementById('boxesInfo').innerHTML =
    `<strong>Boxes Required:</strong> ${lines.join(', ')}<br>
     <strong>Total Boxes:</strong> ${totalBoxes}`;

  // items
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

  // nav buttons
  document.getElementById('prevBtn').disabled = currentIndex===0;
  document.getElementById('nextBtn').disabled = currentIndex===orders.length-1;
}

// Prev / Next & swipe
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
  if (dx>50 && currentIndex>0)            renderOrder(--currentIndex);
  else if (dx<-50 && currentIndex<orders.length-1) renderOrder(++currentIndex);
});

// Pack-Picker toggle (no changes here)
document.getElementById('togglePacksBtn').onclick = () => {
  document.getElementById('ordersView').classList.add('hidden');
  document.getElementById('packsView').classList.remove('hidden');
  if (!packsLoaded) loadPacks();
};
document.getElementById('backToOrdersBtn').onclick = () => {
  document.getElementById('packsView').classList.add('hidden');
  document.getElementById('ordersView').classList.remove('hidden');
};

// kick it off
loadOrders();
