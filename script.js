// ———————————————————————————————————————————————
// CONFIG
// ———————————————————————————————————————————————
const sheetId    = '1xE9SueE6rdDapXr0l8OtP_IryFM-Z6fHFH27_cQ120g';
const sheetName  = 'Orders';
const apiKey     = 'AIzaSyA7sSHMaY7i-uxxynKewHLsHxP_dd3TZ4U';
const ordersUrl  = `https://sheets.googleapis.com/v4/spreadsheets/${sheetId}/values/${encodeURIComponent(sheetName)}?alt=json&key=${apiKey}`;

// Pack Picker sheet (same file or another)
const packsSheetId    = '1TtRNmjsgC64jbkptnCdklBf_HqifwE9SQO2JlGrp4Us';
const packTitlesUrl   = `https://sheets.googleapis.com/v4/spreadsheets/${packsSheetId}/values/${encodeURIComponent('Pack Titles!A2:A')}?key=${apiKey}`;
const varietyPacksUrl = `https://sheets.googleapis.com/v4/spreadsheets/${packsSheetId}/values/${encodeURIComponent('Variety Packs!A2:C1000')}?key=${apiKey}`;

// ———————————————————————————————————————————————
// STATE
// ———————————————————————————————————————————————
let orders = [], currentIndex = 0;
let varietyPacksData = [], packsLoaded = false;

// ———————————————————————————————————————————————
// LOAD & GROUP ORDERS
// ———————————————————————————————————————————————
async function loadOrders() {
  try {
    const res  = await fetch(ordersUrl);
    const js   = await res.json();
    const rows = js.values || [];
    if (rows.length < 2) throw new Error('No orders found');

    // grab header index
    const hdr = rows[0];
    const idx = {
      id:      hdr.indexOf('orderId'),
      name:    hdr.indexOf('customerName'),
      addr:    hdr.indexOf('address'),
      title:   hdr.indexOf('itemTitle'),
      variant: hdr.indexOf('variantTitle'),
      qty:     hdr.indexOf('qty'),
      image:   hdr.indexOf('imageUrl'),
      notes:   hdr.indexOf('notes')
    };

    const G = {};
    for (let i = 1; i < rows.length; i++) {
      const r = rows[i];
      const id    = r[idx.id];
      const name  = r[idx.name];
      const addr  = r[idx.addr];
      const item  = r[idx.title];
      const variant = r[idx.variant];
      const qty   = parseInt(r[idx.qty],10)||0;
      const img   = r[idx.image]||'';
      const note  = r[idx.notes]||'';

      const m = variant.match(/(\d+)\s*pack/i);
      const packSize = m ? +m[1] : 1;
      const cans = qty * packSize;

      if (!G[id]) G[id] = {
        orderId: id.replace(/^#+/,''),     // strip extra #
        customerName: name,
        address: addr,
        notes: note,
        items: [],
        totalCans: 0
      };
      G[id].items.push({ itemTitle: item, cans, imageUrl: img });
      G[id].totalCans += cans;
    }

    orders = Object.values(G);
    currentIndex = 0;
    renderOrder();
    updateDashboard();
  }
  catch(err) {
    console.error(err);
    document.getElementById('order-container').innerHTML =
      `<p style="text-align:center;opacity:.6">Failed to load orders.</p>`;
  }
}

// ———————————————————————————————————————————————
// BOX CALC (only 24 & 12 packs)
// ———————————————————————————————————————————————
function calculateBoxes(totalCans) {
  const c24 = Math.floor(totalCans/24);
  const rem = totalCans%24;
  const c12 = rem>0 ? Math.ceil(rem/12) : 0;
  return { 24:c24, 12:c12 };
}

// ———————————————————————————————————————————————
// DASHBOARD
// ———————————————————————————————————————————————
function updateDashboard() {
  document.getElementById('dash-pending').textContent = orders.length;
  let boxCount=0;
  orders.forEach(o => {
    const b = calculateBoxes(o.totalCans);
    boxCount += b[24]+b[12];
  });
  document.getElementById('dash-boxes').textContent = boxCount;
}

// ———————————————————————————————————————————————
// RENDER ORDER
// ———————————————————————————————————————————————
function renderOrder(){
  const o = orders[currentIndex];
  if (!o) return;
  document.getElementById('orderId').textContent        = `Order #${o.orderId}`;
  document.getElementById('customerName').textContent   = o.customerName;
  document.getElementById('customerAddress').textContent= o.address;

  const b = calculateBoxes(o.totalCans);
  const lines = [];
  if (b[24]) lines.push(`${b[24]}×24-pack`);
  if (b[12]) lines.push(`${b[12]}×12-pack`);
  const totalBoxes = b[24]+b[12];

  document.getElementById('boxesInfo').innerHTML =
    `<strong>Boxes Required:</strong> ${lines.join(', ')}<br>`+
    `<strong>Total Boxes:</strong> ${totalBoxes}<br>`+
    `<strong>Total Cans:</strong> ${o.totalCans}`;

  document.getElementById('itemsContainer').innerHTML =
    o.items.map(it=>`
      <div class="item">
        <img src="${it.imageUrl}"
             onerror="this.src='https://via.placeholder.com/60'"
             alt="${it.itemTitle}">
        <div class="details">
          <p><strong>${it.itemTitle}</strong></p>
          <p>${it.cans} cans</p>
        </div>
      </div>
    `).join('');

  document.getElementById('prevBtn').disabled = (currentIndex===0);
  document.getElementById('nextBtn').disabled = (currentIndex===orders.length-1);
}

// ———————————————————————————————————————————————
// NAV & SWIPE
// ———————————————————————————————————————————————
document.getElementById('prevBtn').onclick = ()=>{ 
  if(currentIndex>0){ currentIndex--; renderOrder(); }
};
document.getElementById('nextBtn').onclick = ()=>{ 
  if(currentIndex<orders.length-1){ currentIndex++; renderOrder(); }
};
let startX=0;
const oc = document.getElementById('order-container');
oc.addEventListener('touchstart', e=> startX=e.changedTouches[0].screenX);
oc.addEventListener('touchend',   e=>{
  const dx = e.changedTouches[0].screenX - startX;
  if (dx>50 && currentIndex>0)        { currentIndex--; renderOrder(); }
  else if (dx<-50 && currentIndex<orders.length-1) { currentIndex++; renderOrder(); }
});

// ———————————————————————————————————————————————
// PACK PICKER TOGGLE + ALPHABETICAL SORT
// ———————————————————————————————————————————————
document.getElementById('togglePacksBtn').onclick = () => {
  // hide orders + dashboard
  document.getElementById('ordersView').classList.add('hidden');
  document.getElementById('dashboard').classList.add('hidden');
  // show packs
  document.getElementById('packsView').classList.remove('hidden');

  const frame = document.getElementById('packFrame');
  if (!frame.src) {
    frame.src = 'https://designateddrinks.github.io/Designated-Direct/';
  }

  // once loaded, fetch & sort the rows in the iframe
  // (we assume the page itself lists products; if you're building a JS UI here,
  // you would instead fetch the Sheets API and render sorted. If you just
  // want the GitHub page in an iframe, sorting must be done in that app.)
};

document.getElementById('backToOrdersBtn').onclick = () => {
  document.getElementById('packsView').classList.add('hidden');
  document.getElementById('ordersView').classList.remove('hidden');
  document.getElementById('dashboard').classList.remove('hidden');
};

// ———————————————————————————————————————————————
// INIT
// ———————————————————————————————————————————————
loadOrders();
