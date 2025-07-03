// ———————————————————————————————————————————————
// CONFIG – using gviz JSON feed (no API key needed)
// ———————————————————————————————————————————————
const sheetId      = '1xE9SueE6rdDapXr0l8OtP_IryFM-Z6fHFH27_cQ120g';
const sheetName    = 'Orders';
const ordersGviz   = `https://docs.google.com/spreadsheets/d/${sheetId}/gviz/tq`
                   + `?sheet=${encodeURIComponent(sheetName)}&tqx=out:json`;

// Pack-picker sheet (unchanged)
const packsSheetId    = '1TtRNmjsgC64jbkptnCdklBf_HqifwE9SQO2JlGrp4Us';
const packTitlesUrl   = `https://sheets.googleapis.com/v4/spreadsheets/${packsSheetId}`
                      + `/values/${encodeURIComponent('Pack Titles!A2:A')}?key=YOUR_API_KEY`;
const varietyPacksUrl = `https://sheets.googleapis.com/v4/spreadsheets/${packsSheetId}`
                      + `/values/${encodeURIComponent('Variety Packs!A2:C1000')}?key=YOUR_API_KEY`;

// ———————————————————————————————————————————————
// STATE
// ———————————————————————————————————————————————
let orders = [], currentIndex = 0;
let varietyPacksData = [], packsLoaded = false;

// ———————————————————————————————————————————————
// ORDERS MODULE (via gviz feed)
// ———————————————————————————————————————————————
async function loadOrders() {
  try {
    const res  = await fetch(ordersGviz);
    const txt  = await res.text();
    const json = JSON.parse(txt.replace(/^[^\(]*\(/, '').replace(/\);?$/, ''));

    const raw = json.table.rows.map(r => (r.c||[]).map(c=>c&&c.v));
    // raw: array of [ orderId, customerName, address, itemTitle, variantTitle, qty, picked, notes, imageUrl ]

    const grouped = {};
    raw.forEach(r => {
      let [orderId, customerName, address,
           itemTitle, variantTitle, qtyRaw,
           , notes, imageUrl] = r.concat([]);
      const qty = parseInt(qtyRaw,10)||0;
      // only 24 & 12-pack boxes
      const packSize = (variantTitle.match(/(\d+)/)||[1,1])[1];
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
  const cnt = {24:0,12:0};
  cnt[24] = Math.floor(n/24);
  const rem = n - cnt[24]*24;
  cnt[12] = Math.ceil(rem/12);
  return cnt;
}

function updateDashboard() {
  const pending = orders.length;
  let totalBoxes = 0;
  orders.forEach(o => {
    const b = calculateBoxes(o.totalCans);
    totalBoxes += b[24] + b[12];
  });
  document.getElementById('dash-pending').textContent = pending;
  document.getElementById('dash-boxes').textContent  = totalBoxes;
}

function renderOrder() {
  const o = orders[currentIndex];
  if (!o) return;

  // strip any leading '#' then re-prefix exactly one
  const id = o.orderId.replace(/^#/, '');
  document.getElementById('orderId').textContent        = `Order #${id}`;
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
        <img src="${it.imageUrl||''}"
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

// ← → & swipe
document.getElementById('prevBtn').onclick = ()=>{
  if(currentIndex>0){ currentIndex--; renderOrder(); }
};
document.getElementById('nextBtn').onclick = ()=>{
  if(currentIndex<orders.length-1){ currentIndex++; renderOrder(); }
};
let startX=0;
const oc = document.getElementById('order-container');
oc.addEventListener('touchstart', e=> startX=e.changedTouches[0].screenX);
oc.addEventListener('touchend', e=>{
  const dx = e.changedTouches[0].screenX - startX;
  if (dx>50 && currentIndex>0)        { currentIndex--; renderOrder(); }
  if (dx<-50 && currentIndex<orders.length-1) { currentIndex++; renderOrder(); }
});

// ———————————————————————————————————————————————
// PACK PICKER MODULE & VIEW TOGGLE (unchanged from before)
// ———————————————————————————————————————————————
async function loadPacks() {
  const [tRes, pRes] = await Promise.all([
    fetch(packTitlesUrl).then(r=>r.json()),
    fetch(varietyPacksUrl).then(r=>r.json())
  ]);
  const dd = document.getElementById('packDropdown');
  tRes.values?.forEach(r=>{
    const opt = new Option(r[0], r[0]);
    dd.add(opt);
  });
  varietyPacksData = pRes.values||[];
  displayPacks('All');
  packsLoaded = true;
}
function displayPacks(filter) {
  const res = document.getElementById('results');
  res.innerHTML = '';
  let arr = varietyPacksData;
  if (filter!=='All') arr = arr.filter(r=>r[0]===filter);
  if (!arr.length) return res.textContent='No entries.';
  arr.forEach(r=>{
    const [t,n,img] = r;
    const div = document.createElement('div');
    div.className = 'pack-item';
    div.innerHTML = `<h3>${t} - ${n}</h3><img src="${img}" alt="${n}"/>`;
    res.appendChild(div);
  });
}
document.getElementById('packDropdown')
        .addEventListener('change', e=>displayPacks(e.target.value));
document.getElementById('togglePacksBtn').onclick = ()=>{
  document.getElementById('ordersView').classList.add('hidden');
  document.getElementById('packsView').classList.remove('hidden');
  if (!packsLoaded) loadPacks();
};
document.getElementById('backToOrdersBtn').onclick = ()=>{
  document.getElementById('packsView').classList.add('hidden');
  document.getElementById('ordersView').classList.remove('hidden');
};

// kick it all off
loadOrders();
