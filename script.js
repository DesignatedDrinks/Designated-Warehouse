// ———————————————————————————————————————————————
// CONFIG
// ———————————————————————————————————————————————
const sheetId    = '1xE9SueE6rdDapXr0l8OtP_IryFM-Z6fHFH27_cQ120g';
const sheetName  = 'Orders';
const apiKey     = 'AIzaSyA7sSHMaY7i-uxxynKewHLsHxP_dd3TZ4U';
const ordersUrl  =
  `https://sheets.googleapis.com/v4/spreadsheets/${sheetId}/values/${encodeURIComponent(sheetName)}?alt=json&key=${apiKey}`;

let orders       = [];
let currentIndex = 0;

// ———————————————————————————————————————————————
// LOAD & GROUP
// ———————————————————————————————————————————————
async function loadOrders() {
  try {
    const res  = await fetch(ordersUrl);
    const json = await res.json();
    const rows = json.values || [];
    if (rows.length < 2) throw new Error('No orders found');

    // header map → indexes
    const h = rows[0].map(x=>x.trim());
    const idx = {
      orderId:      h.indexOf('orderId'),
      customerName: h.indexOf('customerName'),
      address:      h.indexOf('address'),
      itemTitle:    h.indexOf('itemTitle'),
      variantTitle: h.indexOf('variantTitle'),
      qty:          h.indexOf('qty'),
      notes:        h.indexOf('notes'),
      imageUrl:     h.indexOf('imageUrl')
    };

    // group
    const G = {};
    rows.slice(1).forEach(r => {
      const id    = r[idx.orderId];
      const name  = r[idx.customerName];
      const addr  = r[idx.address];
      const item  = r[idx.itemTitle];
      const variant = r[idx.variantTitle];
      const count = parseInt(r[idx.qty],10) || 0;
      const note = r[idx.notes] || '';
      const img  = r[idx.imageUrl] || '';

      // match “12-pack” or “12 Pack”
      const m = variant.match(/(\d+)[-\s]*pack/i);
      const packSize = m ? parseInt(m[1],10) : 1;
      const cans = count * packSize;

      if (!G[id]) {
        G[id] = { orderId:id, customerName:name, address:addr, notes:note, items:[], totalCans:0 };
      }
      G[id].items.push({ itemTitle:item, cans, imageUrl:img });
      G[id].totalCans += cans;
    });

    orders = Object.values(G);
    currentIndex = 0;
    updateDashboard();
    renderOrder();
  }
  catch(e) {
    console.error(e);
    document.getElementById('order-container').innerHTML =
      `<p style="text-align:center;opacity:.6">Failed to load orders.</p>`;
  }
}

// ———————————————————————————————————————————————
// BOX CALC (24 & 12 only)
// ———————————————————————————————————————————————
function calculateBoxes(n) {
  const full24 = Math.floor(n/24);
  const rem24  = n % 24;
  const full12 = rem24 > 0 ? Math.ceil(rem24/12) : 0;
  return { 24:full24, 12:full12 };
}

// ———————————————————————————————————————————————
// DASHBOARD
// ———————————————————————————————————————————————
function updateDashboard() {
  document.getElementById('dash-pending').textContent = orders.length;
  let sum = 0;
  orders.forEach(o => {
    const b = calculateBoxes(o.totalCans);
    sum += b[24] + b[12];
  });
  document.getElementById('dash-boxes').textContent = sum;
}

// ———————————————————————————————————————————————
// RENDER SINGLE ORDER
// ———————————————————————————————————————————————
function renderOrder() {
  const o = orders[currentIndex];
  if (!o) return;

  // strip extra “#”
  document.getElementById('orderId').textContent =
    `Order #${o.orderId.replace(/^#+/, '')}`;
  document.getElementById('customerName').textContent   = o.customerName;
  document.getElementById('customerAddress').textContent= o.address;

  const b = calculateBoxes(o.totalCans);
  const lines = [];
  if (b[24]) lines.push(`${b[24]}×24-pack`);
  if (b[12]) lines.push(`${b[12]}×12-pack`);
  const totalBoxes = b[24] + b[12];

  document.getElementById('boxesInfo').innerHTML =
    `<strong>Boxes Required:</strong> ${lines.join(', ')}<br>` +
    `<strong>Total Boxes:</strong> ${totalBoxes}<br>` +
    `<strong>Total Cans:</strong> ${o.totalCans}`;

  document.getElementById('itemsContainer').innerHTML =
    o.items.map(it => `
      <div class="item">
        <img src="${it.imageUrl}"
             onerror="this.src='https://via.placeholder.com/60'"
             alt="${it.itemTitle}" />
        <div class="details">
          <p><strong>${it.itemTitle}</strong></p>
          <p>${it.cans} cans</p>
        </div>
      </div>
    `).join('');

  document.getElementById('prevBtn').disabled = currentIndex===0;
  document.getElementById('nextBtn').disabled = currentIndex===orders.length-1;
}

// ———————————————————————————————————————————————
// NAV & SWIPE
// ———————————————————————————————————————————————
document.getElementById('prevBtn').onclick = ()=>{
  if (currentIndex>0) { currentIndex--; renderOrder(); }
};
document.getElementById('nextBtn').onclick = ()=>{
  if (currentIndex<orders.length-1) { currentIndex++; renderOrder(); }
};
let startX=0;
const oc = document.getElementById('order-container');
oc.addEventListener('touchstart', e=> startX=e.changedTouches[0].screenX);
oc.addEventListener('touchend', e=>{
  const dx = e.changedTouches[0].screenX - startX;
  if (dx>50 && currentIndex>0)          { currentIndex--; renderOrder(); }
  else if (dx<-50 && currentIndex<orders.length-1) { currentIndex++; renderOrder(); }
});

// ———————————————————————————————————————————————
// INLINE PACK PICKER
// ———————————————————————————————————————————————
document.getElementById('togglePacksBtn')
  .addEventListener('click', () => {
    document.getElementById('ordersView').classList.add('hidden');
    document.getElementById('packsView').classList.remove('hidden');
    const f = document.getElementById('packFrame');
    if (!f.src) {
      f.src = 'https://designateddrinks.github.io/Designated-Direct/';
    }
  });

document.getElementById('backToOrdersBtn')
  .addEventListener('click', () => {
    document.getElementById('packsView').classList.add('hidden');
    document.getElementById('ordersView').classList.remove('hidden');
  });

// ———————————————————————————————————————————————
// BOOT
// ———————————————————————————————————————————————
loadOrders();
