// ─── CONFIG ───
const SHEET_ID     = '1xE9SueE6rdDapXr0l8OtP_IryFM-Z6fHFH27_cQ120g';
const API_KEY      = 'AIzaSyA7sSHMaY7i-uxxynKewHLsHxP_dd3TZ4U';
const ORDERS_TAB   = 'Orders';
const VARIETY_TAB  = 'VarietyPacks';
const PICK_BASE    = 'https://designateddrinks.github.io/Designated-Direct';

const PACK_SIZES   = [28,24,12,10,8,6,5,4,1];

let orders = [], currentIndex = 0;
let varietySet = new Set();

async function loadData() {
  const baseURL = `https://sheets.googleapis.com/v4/spreadsheets/${SHEET_ID}/values`;
  const [oRes, vRes] = await Promise.all([
    fetch(`${baseURL}/${ORDERS_TAB}?alt=json&key=${API_KEY}`),
    fetch(`${baseURL}/${VARIETY_TAB}?alt=json&key=${API_KEY}`)
  ]);
  const [oJson, vJson] = await Promise.all([oRes.json(), vRes.json()]);

  // build set of variety-pack names (lowercased)
  (vJson.values||[]).slice(1).forEach(r => {
    if (r[0]) varietySet.add(r[0].toLowerCase().trim());
  });

  // parse orders
  const rows = oJson.values || [];
  if (rows.length < 2) throw new Error('No orders found');
  const grouped = {};

  rows.slice(1).forEach(r => {
    let [orderId,cust,itemTitle,variant,qtyStr,picked,notes,imageUrl] = r;
    const qty = parseInt(qtyStr,10) || 0;
    const m = (variant||'').match(/(\d+)\s*Pack/i);
    const packSize = m ? +m[1] : 1;
    const cans = qty * packSize;

    if (!grouped[orderId]) {
      grouped[orderId] = { orderId, customerName: cust, notes, totalCans:0, items:[] };
    }
    grouped[orderId].items.push({itemTitle,variant,qty,packSize,imageUrl});
    grouped[orderId].totalCans += cans;
  });

  orders = Object.values(grouped);
  renderOrder();
}

function calculateBoxes(totalCans) {
  let rem = totalCans, out = {};
  PACK_SIZES.forEach(sz => {
    const cnt = Math.floor(rem/sz);
    if (cnt) { out[sz]=cnt; rem%=sz; }
  });
  return out;
}

function renderOrder() {
  if (!orders.length) return;
  const o = orders[currentIndex];

  // header fields
  document.getElementById('orderId').innerText      = `Order #${o.orderId}`;
  document.getElementById('customerName').innerText = o.customerName;
  document.getElementById('orderIndex').innerText   = `${currentIndex+1} / ${orders.length}`;
  document.getElementById('totalCans').innerText    = o.totalCans;

  // boxes
  const boxes = calculateBoxes(o.totalCans);
  let html='', totalBoxes=0;
  for (let [sz,cnt] of Object.entries(boxes)) {
    html += `${cnt} × ${sz}-pack box<br>`;
    totalBoxes += cnt;
  }
  if (!html) html='0';
  document.getElementById('boxBreakdown').innerHTML =
    html+`<strong>Total Boxes:</strong> ${totalBoxes}`;

  // items + Pick Pack link
  const itemsHtml = o.items.map(i => {
    const isVar = varietySet.has(i.itemTitle.toLowerCase().trim());
    const link  = isVar 
      ? `<a class="pick-link" href="${PICK_BASE}" target="_blank">Pick Pack</a>` 
      : '';
    return `
      <div class="item">
        <img src="${i.imageUrl||''}" alt="${i.itemTitle}">
        <div class="details">
          <p><strong>${i.itemTitle}</strong></p>
          <p>Variant: ${i.variant}</p>
          <p>Qty: ${i.qty} × ${i.packSize} = ${i.qty*i.packSize} cans</p>
          ${link}
        </div>
      </div>
    `;
  }).join('');

  document.getElementById('itemsContainer').innerHTML = itemsHtml;
}

// navigation
document.getElementById('prevBtn').onclick = () => {
  if (currentIndex>0) { currentIndex--; renderOrder(); }
};
document.getElementById('nextBtn').onclick = () => {
  if (currentIndex<orders.length-1) { currentIndex++; renderOrder(); }
};

// kick off
loadData().catch(err=>{
  console.error(err);
  document.getElementById('itemsContainer').innerHTML =
    `<p style="color:red;padding:1rem;">${err.message}</p>`;
});
