// ———————————————————————————————————————————————
// CONFIG
// ———————————————————————————————————————————————
const sheetId    = '1xE9SueE6rdDapXr0l8OtP_IryFM-Z6fHFH27_cQ120g';
const sheetName  = 'Orders';

// this endpoint returns your sheet as JSONP-style text:
const ordersGvizUrl = 
  `https://docs.google.com/spreadsheets/d/${sheetId}`
  + `/gviz/tq?sheet=${encodeURIComponent(sheetName)}&tqx=out:json`;

// ———————————————————————————————————————————————
// STATE
// ———————————————————————————————————————————————
let orders = [], currentIndex = 0;

// ———————————————————————————————————————————————
// ORDERS MODULE (via gviz feed)
// ———————————————————————————————————————————————
async function loadOrders() {
  try {
    const res  = await fetch(ordersGvizUrl);
    const txt  = await res.text();

    // strip off the leading garbage so we can JSON.parse()
    const json = JSON.parse(
      txt
        .replace(/^[^\(]*\(/, '')
        .replace(/\);?$/, '')
    );

    // rows come in as json.table.rows, each .c is an array of {v: value}
    const rawRows = json.table.rows.map(r =>
      r.c.map(cell => cell && cell.v)
    );

    if (!rawRows.length) throw new Error('no rows');

    // group by orderId (first column)
    const grouped = {};
    rawRows.forEach(r => {
      // [orderId, customerName, address, itemTitle, variantTitle, qty, picked, notes, imageUrl]
      const [
        orderId, customerName, address,
        itemTitle, variantTitle, qtyRaw,
        , notes, imageUrl
      ] = r.concat([]); // ensure length

      const qty = parseInt(qtyRaw,10) || 0;
      // extract “12” from “12-pack”
      const packSize = (variantTitle && variantTitle.match(/(\d+)/) || [1,1])[1];
      const cans = qty * packSize;

      if (!grouped[orderId]) {
        grouped[orderId] = {
          orderId,
          customerName: customerName||'',
          address: address||'',
          notes: notes||'',
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
      `<p style="padding:1rem;text-align:center;opacity:.6">
         Failed to load orders.
       </p>`;
    console.error(err);
  }
}

function calculateBoxes(n) {
  let rem = n, cnt = {24:0,12:0,6:0};
  cnt[24] = Math.floor(rem/24); rem %= 24;
  cnt[12] = Math.floor(rem/12); rem %= 12;
  cnt[6]  = Math.floor(rem/6);  rem %= 6;
  if (rem) cnt[6]++;
  return cnt;
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

  document.getElementById('orderId').textContent        = `Order #${o.orderId}`;
  document.getElementById('customerName').textContent   = o.customerName;
  document.getElementById('customerAddress').textContent= o.address;

  const b = calculateBoxes(o.totalCans), lines = [];
  if (b[24]) lines.push(`${b[24]}×24-pack`);
  if (b[12]) lines.push(`${b[12]}×12-pack`);
  if (b[6 ]) lines.push(`${b[6]}×6-pack`);
  const totalBoxes = b[24]+b[12]+b[6];

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

  document.getElementById('prevBtn').disabled = currentIndex===0;
  document.getElementById('nextBtn').disabled = currentIndex===orders.length-1;
}

// ← / → navigation + swipe
document.getElementById('prevBtn').onclick = () => {
  if (currentIndex>0) { currentIndex--; renderOrder(); }
};
document.getElementById('nextBtn').onclick = () => {
  if (currentIndex<orders.length-1) { currentIndex++; renderOrder(); }
};
let startX=0;
const oc = document.getElementById('order-container');
oc.addEventListener('touchstart', e => startX = e.changedTouches[0].screenX);
oc.addEventListener('touchend',   e => {
  const dx = e.changedTouches[0].screenX - startX;
  if (dx>50 && currentIndex>0)        { currentIndex--; renderOrder(); }
  if (dx<-50 && currentIndex<orders.length-1) { currentIndex++; renderOrder(); }
});

// … hook up your Pack-Picker code here (no changes) …

// kick it off
loadOrders();
