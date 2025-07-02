// ─── CONFIG ───
const SHEET_ID   = '1xE9SueE6rdDapXr0l8OtP_IryFM-Z6fHFH27_cQ120g';
const API_KEY    = 'AIzaSyA7sSHMaY7i-uxxynKewHLsHxP_dd3TZ4U';
const ORDERS_TAB = 'Orders';
const PICK_URL   = 'https://designateddrinks.github.io/Designated-Direct/';
const PACK_SIZES = [28,24,12,10,8,6,5,4,1];

let orders = [], currentIndex = 0;

async function loadData() {
  const url = `https://sheets.googleapis.com/v4/spreadsheets/${SHEET_ID}/values/${ORDERS_TAB}?alt=json&key=${API_KEY}`;
  try {
    const res  = await fetch(url);
    const json = await res.json();
    const rows = json.values || [];
    if (rows.length < 2) throw new Error('No orders found');

    const grouped = {};
    rows.slice(1).forEach(r => {
      const [orderId,cust,itemTitle,variantTitle,qtyStr,picked,notes,imageUrl] = r;
      const qty = parseInt(qtyStr,10) || 0;
      const m = (variantTitle||'').match(/(\d+)\s*Pack/i);
      const packSize = m ? parseInt(m[1],10) : 1;
      const cans = qty * packSize;

      if (!grouped[orderId]) {
        grouped[orderId] = { orderId, customerName: cust, notes, totalCans:0, items: [] };
      }
      grouped[orderId].items.push({ itemTitle, variantTitle, qty, packSize, imageUrl });
      grouped[orderId].totalCans += cans;
    });

    orders = Object.values(grouped);
    renderOrder();

  } catch (err) {
    console.error('Error loading orders:', err);
    document.getElementById('itemsContainer').innerHTML =
      `<p style="color:red;padding:1rem;">${err.message}</p>`;
  }
}

function calculateBoxes(totalCans) {
  let rem = totalCans, breakdown = {};
  PACK_SIZES.forEach(size => {
    const cnt = Math.floor(rem/size);
    if (cnt) {
      breakdown[size] = cnt;
      rem %= size;
    }
  });
  return breakdown;
}

function renderOrder() {
  if (!orders.length) return;
  const o = orders[currentIndex];

  // Header & summary
  document.getElementById('orderId').innerText      = `Order #${o.orderId}`;
  document.getElementById('customerName').innerText = o.customerName;
  document.getElementById('orderIndex').innerText   = `${currentIndex+1} / ${orders.length}`;
  document.getElementById('totalCans').innerText    = o.totalCans;

  // Boxes
  const boxes = calculateBoxes(o.totalCans);
  let boxHtml = '', totalBoxes = 0;
  for (let [size,cnt] of Object.entries(boxes)) {
    boxHtml += `${cnt} × ${size}-pack box<br>`;
    totalBoxes += cnt;
  }
  if (!boxHtml) boxHtml = '0';
  document.getElementById('boxBreakdown').innerHTML =
    boxHtml + `<strong>Total Boxes:</strong> ${totalBoxes}`;

  // Items + Pick Pack link on any “Designated” title
  const itemsHtml = o.items.map(item => {
    const isDesignated = /designated/i.test(item.itemTitle);
    const pickLink     = isDesignated
      ? `<a class="pick-link" href="${PICK_URL}" target="_blank">Pick Pack</a>`
      : '';

    return `
      <div class="item">
        <img src="${item.imageUrl||''}" alt="${item.itemTitle}">
        <div class="details">
          <p><strong>${item.itemTitle}</strong></p>
          <p>Variant: ${item.variantTitle}</p>
          <p>Qty: ${item.qty} × ${item.packSize} = ${item.qty*item.packSize} cans</p>
          ${pickLink}
        </div>
      </div>
    `;
  }).join('');

  document.getElementById('itemsContainer').innerHTML = itemsHtml;
}

// Navigation
document.getElementById('prevBtn').onclick = () => {
  if (currentIndex>0) { currentIndex--; renderOrder(); }
};
document.getElementById('nextBtn').onclick = () => {
  if (currentIndex<orders.length-1) { currentIndex++; renderOrder(); }
};

// Initialize
loadData();
