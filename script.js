// ———————————————————————————————————————————————
// CONFIG
// ———————————————————————————————————————————————
const sheetId   = '1xE9SueE6rdDapXr0l8OtP_IryFM-Z6fHFH27_cQ120g';
const sheetName = 'Orders';
const apiKey    = 'AIzaSyA7sSHMaY7i-uxxynKewHLsHxP_dd3TZ4U';
const ordersUrl = `https://sheets.googleapis.com/v4/spreadsheets/${sheetId}/values/${encodeURIComponent(sheetName)}?alt=json&key=${apiKey}`;

// Pack picker sheet
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

    // group by orderId
    const grouped = {};
    rows.slice(1).forEach(r => {
      const [orderId, customerName, address, itemTitle, variantTitle, qtyStr, , notes, imageUrl] = r;
      const qty = parseInt(qtyStr,10) || 0;
      const packSize = (variantTitle.match(/(\d+)\s*pack/i)||[1,1])[1];
      const cans = qty * packSize;

      if (!grouped[orderId]) {
        grouped[orderId] = { orderId, customerName, address, notes: notes||'', items: [], totalCans:0 };
      }
      grouped[orderId].items.push({ itemTitle, cans, imageUrl });
      grouped[orderId].totalCans += cans;
    });

    // sort each order’s items A→Z by first word
    Object.values(grouped).forEach(o=>{
      o.items.sort((a,b)=>{
        return a.itemTitle.split(' ')[0]
               .localeCompare(b.itemTitle.split(' ')[0]);
      });
    });

    orders = Object.values(grouped);
    currentIndex = 0;
    updateDashboard();
    renderOrder();
  } catch(err) {
    document.getElementById('order-container').innerHTML =
      `<p style="text-align:center;opacity:.6">Failed to load orders.</p>`;
    console.error(err);
  }
}

function calculateBoxes(n) {
  let rem = n;
  const counts = {24: 0, 12: 0, 6: 0};

  // Use as many 24-pack boxes as possible
  counts[24] = Math.floor(rem / 24);
  rem %= 24;

  // Prefer 1×12 over 2×6 if possible
  if (rem >= 12) {
    counts[12] = 1;
    rem -= 12;
  }

  // Use 6-pack boxes for any remaining cans
  if (rem > 0) {
    counts[6] = Math.ceil(rem / 6);
  }

  return counts;
}


function updateDashboard(){
  const pending = orders.length;
  let totalBoxes=0;
  orders.forEach(o=>{
    const b = calculateBoxes(o.totalCans);
    totalBoxes += b[24] + b[12];
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

  const b = calculateBoxes(o.totalCans);
  const lines = [];
  if (b[24]) lines.push(`${b[24]}×24-pack`);
  if (b[12]) lines.push(`${b[12]}×12-pack`);
  const totalBoxes = b[24]+b[12];

  document.getElementById('boxesInfo').innerHTML =
    `<strong>Boxes Required:</strong> ${lines.join(', ')}<br>` +
    `<strong>Total Boxes:</strong> ${totalBoxes}<br>` +
    `<strong>Total Cans:</strong> ${o.totalCans}`;

  document.getElementById('itemsContainer').innerHTML =
    o.items.map(it=>
      `<div class="item">
         <img src="${it.imageUrl||''}" alt="${it.itemTitle}"
              onerror="this.src='https://via.placeholder.com/60'" />
         <div class="details">
           <p><strong>${it.itemTitle}</strong></p>
           <p>${it.cans} cans</p>
         </div>
       </div>`).join('');

  document.getElementById('prevBtn').disabled = currentIndex===0;
  document.getElementById('nextBtn').disabled = currentIndex===orders.length-1;
}

// navigation & swipe
document.getElementById('prevBtn').onclick = ()=> {
  if (currentIndex>0) { currentIndex--; renderOrder(); }
};
document.getElementById('nextBtn').onclick = ()=> {
  if (currentIndex<orders.length-1) { currentIndex++; renderOrder(); }
};
let startX=0;
const oc = document.getElementById('order-container');
oc.addEventListener('touchstart', e=> startX = e.changedTouches[0].screenX);
oc.addEventListener('touchend', e=>{
  const dx = e.changedTouches[0].screenX - startX;
  if (dx>50 && currentIndex>0)        { currentIndex--; renderOrder(); }
  else if (dx<-50 && currentIndex<orders.length-1) { currentIndex++; renderOrder(); }
});

// ———————————————————————————————————————————————
// PACK PICKER MODULE
// ———————————————————————————————————————————————
async function loadPacks() {
  try {
    const [tR, vR] = await Promise.all([
      fetch(packTitlesUrl).then(r=>r.json()),
      fetch(varietyPacksUrl).then(r=>r.json())
    ]);
    const dd = document.getElementById('packDropdown');
    tR.values?.forEach(row=>{
      const opt = new Option(row[0], row[0]);
      dd.add(opt);
    });
    varietyPacksData = vR.values||[];
    displayPacks('All');
    packsLoaded = true;
  } catch(e){
    document.getElementById('results').textContent = 'Failed to load packs.';
    console.error(e);
  }
}
function displayPacks(filter){
  const out = document.getElementById('results');
  out.innerHTML = '';
  let list = varietyPacksData;
  if (filter!=='All') list = list.filter(r=>r[0]===filter);
  if (!list.length) return out.textContent='No entries.';
  list.forEach(([pack,beer,img])=>{
    out.insertAdjacentHTML('beforeend',
      `<div class="pack-item">
         <img src="${img}" alt="${beer}" />
         <div>
           <h3>${pack} – ${beer}</h3>
         </div>
       </div>`);
  });
}
document.getElementById('packDropdown').onchange = e=> displayPacks(e.target.value);

// ———————————————————————————————————————————————
// VIEW TOGGLING
// ———————————————————————————————————————————————
document.getElementById('togglePacksBtn').onclick = ()=>{
  document.getElementById('ordersView').classList.add('hidden');
  document.getElementById('packsView').classList.remove('hidden');
  if (!packsLoaded) loadPacks();
};
document.getElementById('backToOrdersBtn').onclick = ()=>{
  document.getElementById('packsView').classList.add('hidden');
  document.getElementById('ordersView').classList.remove('hidden');
};

// initial load
loadOrders();
