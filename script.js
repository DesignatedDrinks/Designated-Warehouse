// ─── CONFIG ─────────────────────────────────────────────────────────
const sheetId      = '1xE9SueE6rdDapXr0l8OtP_IryFM-Z6fHFH27_cQ120g';
const apiKey       = 'AIzaSyA7sSHMaY7i-uxxynKewHLsHxP_dd3TZ4U';
const ordersRange  = 'Orders!A2:H';        // [orderId,customerName,address,itemTitle,variantTitle,qty,notes,imageUrl]
const lookupRange  = 'ImageLookup!A2:B';   // [itemTitle,imageUrl]

// ─── STATE ──────────────────────────────────────────────────────────
let orders = [], currentIndex = 0;

// ─── FETCH & INIT ───────────────────────────────────────────────────
async function loadData() {
  try {
    const [oRes, lRes] = await Promise.all([
      fetch(`https://sheets.googleapis.com/v4/spreadsheets/${sheetId}/values/${encodeURIComponent(ordersRange)}?key=${apiKey}`),
      fetch(`https://sheets.googleapis.com/v4/spreadsheets/${sheetId}/values/${encodeURIComponent(lookupRange)}?key=${apiKey}`)
    ]);
    const oJson = await oRes.json();
    const lJson = await lRes.json();

    const oRows = oJson.values || [];
    const lRows = lJson.values || [];

    // Build a quick lookup map for images
    const imgMap = {};
    lRows.forEach(r => {
      const [title, url] = r;
      imgMap[title.toLowerCase().trim()] = url;
    });

    // Group orders
    const map = {};
    oRows.forEach(r => {
      const [orderId, customerName, address,
             itemTitle, variantTitle, qtyStr,
             notes] = r;
      const qty = parseInt(qtyStr,10) || 0;
      const packSizeMatch = variantTitle.match(/(\d+)/);
      const packSize = packSizeMatch ? +packSizeMatch[1] : 1;
      const totalUnits = qty * packSize;
      const key = orderId;
      if (!map[key]) {
        map[key] = { orderId, customerName, address, notes, items: [], totalCans:0 };
      }
      map[key].items.push({
        title: itemTitle,
        units: totalUnits,
        imageUrl: imgMap[itemTitle.toLowerCase().trim()] || ''
      });
      map[key].totalCans += totalUnits;
    });

    orders = Object.values(map);
    renderOrder();
  } catch(err) {
    console.error(err);
    document.getElementById('itemsContainer').innerHTML = '<p style="color:#f55;">Error loading orders.</p>';
  }
}

// ─── BOX CALC ────────────────────────────────────────────────────────
function calculateBoxes(total) {
  const sizes = [24,12,6];
  const out = {};
  let rem = total;
  sizes.forEach(sz => {
    const cnt = Math.floor(rem/sz);
    if (cnt>0) {
      out[sz]=cnt;
      rem -= cnt*sz;
    }
  });
  if (rem>0) {
    out[6] = (out[6]||0)+1;
  }
  return out;
}

// ─── RENDER ─────────────────────────────────────────────────────────
function renderOrder() {
  if (!orders.length) {
    document.getElementById('orderId').innerText = 'Loading…';
    return;
  }
  // clamp index
  currentIndex = Math.max(0, Math.min(orders.length-1, currentIndex));
  const o = orders[currentIndex];

  // header
  document.getElementById('orderId').innerText       = `Order ${o.orderId}`;
  document.getElementById('customerName').innerText  = o.customerName;
  document.getElementById('customerAddress').innerText = o.address;

  // box summary
  const bc = calculateBoxes(o.totalCans);
  const lines = Object.entries(bc)
    .map(([sz,c]) => `${c} × ${sz}-pack`)
    .join('\n');
  const totalBoxes = Object.values(bc).reduce((a,b)=>a+b,0);
  document.getElementById('boxSummary').innerText = 
    `Boxes Required:\n${lines}\nTotal Boxes: ${totalBoxes}\nTotal Cans: ${o.totalCans}`;

  // items
  const html = o.items.map(i=>`
    <div class="item-card">
      <img src="${i.imageUrl}" alt="${i.title}">
      <div class="item-details">
        <p>${i.title}</p>
        <p>${i.units} cans</p>
      </div>
    </div>
  `).join('');
  document.getElementById('itemsContainer').innerHTML = html;
}

// ─── NAVIGATION ────────────────────────────────────────────────────
document.getElementById('prevBtn').addEventListener('click', ()=>{ currentIndex--; renderOrder(); });
document.getElementById('nextBtn').addEventListener('click', ()=>{ currentIndex++; renderOrder(); });

// ─── SWIPE SUPPORT ─────────────────────────────────────────────────
let startX=0;
const zone = document.getElementById('swipeZone');
zone.addEventListener('touchstart', e=>{ startX=e.changedTouches[0].screenX; });
zone.addEventListener('touchend',   e=>{
  const dx = e.changedTouches[0].screenX - startX;
  if (dx>50)           { currentIndex--; renderOrder(); }
  else if (dx<-50)     { currentIndex++; renderOrder(); }
});

// ─── AUTO REFRESH ──────────────────────────────────────────────────
loadData();
setInterval(loadData, 5*60*1000);
