let orders = [];
let currentIndex = 0;
let chart = null;

// 1) Fetch & group your Shopify orders from Sheets
async function loadSheetData() {
  const sheetId    = '1xE9SueE6rdDapXr0l8OtP_IryFM-Z6fHFH27_cQ120g';
  const sheetName  = 'Orders';
  const apiKey     = 'AIzaSyA7sSHMaY7i-uxxynKewHLsHxP_dd3TZ4U';
  const url        = `https://sheets.googleapis.com/v4/spreadsheets/${sheetId}/values/${sheetName}?alt=json&key=${apiKey}`;

  try {
    const res  = await fetch(url);
    const json = await res.json();
    const rows = json.values || [];

    if (rows.length <= 1) {
      document.getElementById('itemsContainer').innerHTML = '<p>No orders found.</p>';
      return;
    }

    const body = rows.slice(1);
    const grouped = {};

    body.forEach(r => {
      const [
        orderId, customerName, itemTitle,
        variantTitle, /*col4*/, qtyStr,
        /*picked*/, notes, imageUrl, address = ''
      ] = r;

      const qty = parseInt(qtyStr,10) || 0;
      const m   = variantTitle.match(/(\d+)\s*pack/i);
      const packSize = m ? parseInt(m[1],10) : 1;

      if (!grouped[orderId]) {
        grouped[orderId] = {
          orderId,
          customerName,
          customerAddress: address,
          items: [],
          totalCans: 0
        };
      }

      grouped[orderId].items.push({ title: itemTitle, qty, packSize, imageUrl });
      grouped[orderId].totalCans += qty * packSize;
    });

    orders = Object.values(grouped);

    // restore last‐seen index
    const saved = parseInt(localStorage.getItem('lastOrder'),10);
    if (!isNaN(saved) && saved < orders.length) currentIndex = saved;

    initDashboard();
    renderOrder();
  } catch (err) {
    console.error(err);
    document.getElementById('itemsContainer').innerHTML = '<p>Error loading orders.</p>';
  }
}

// 2) Simple box‐calculator (only 24/12/6 packs)
function calculateBoxes(totalCans) {
  const sizes = [24,12,6];
  let rem     = totalCans;
  const counts = {};

  sizes.forEach(sz => {
    const cnt = Math.floor(rem/sz);
    if (cnt>0) {
      counts[sz] = cnt;
      rem %= sz;
    }
  });

  return counts;
}

// 3) Build your stats cards + Chart.js
function initDashboard() {
  const pending   = orders.length;
  const totalCans = orders.reduce((s,o)=>s+o.totalCans,0);
  const totalBoxes = orders.reduce((s,o)=> {
    const bc = calculateBoxes(o.totalCans);
    return s + Object.values(bc).reduce((a,b)=>a+b,0);
  },0);

  document.getElementById('stat-pending').innerText = pending;
  document.getElementById('stat-cans').innerText    = totalCans;
  document.getElementById('stat-boxes').innerText  = totalBoxes;

  // Chart for box‐size distribution
  const ctx = document.getElementById('packChart').getContext('2d');
  const sizes = [6,12,24];
  const data  = sizes.map(sz=>
    orders.reduce((sum,o)=>
      sum + (calculateBoxes(o.totalCans)[sz]||0)
    ,0)
  );

  if (chart) chart.destroy();
  chart = new Chart(ctx, {
    type:'bar',
    data:{
      labels: sizes.map(s=>`${s}-pack`),
      datasets:[{
        data,
        backgroundColor:['#ff6b6b','#66b3ff','#ffbf00']
      }]
    },
    options:{
      plugins:{ legend:{ display:false } },
      scales:{ y:{ display:false } },
      responsive:true
    }
  });
}

// 4) Render a single order
function renderOrder() {
  const o = orders[currentIndex];
  if (!o) return;
  localStorage.setItem('lastOrder', currentIndex);

  // header
  document.getElementById('orderId').innerText = `Order #${o.orderId}`;
  document.getElementById('prevBtn').disabled = currentIndex===0;
  document.getElementById('nextBtn').disabled = currentIndex===orders.length-1;
  document.getElementById('customerAddress').innerText = o.customerAddress;

  // boxes summary
  const bc = calculateBoxes(o.totalCans);
  const lines = Object.entries(bc)
    .map(([size,c])=>`${c} × ${size}-pack box`)
    .join('\n');
  const totalBoxes = Object.values(bc).reduce((a,b)=>a+b,0);
  document.getElementById('boxCalculation').innerHTML =
    `<pre>${lines}</pre><strong>Total Boxes: ${totalBoxes}</strong>`;

  // items list
  document.getElementById('itemsContainer').innerHTML =
    o.items.map(it=>`
      <div class="item">
        <img src="${it.imageUrl}" alt="${it.title}" />
        <div class="item-info">
          <p class="item-title">${it.title}</p>
          <p class="item-qty">${it.qty * it.packSize} cans</p>
        </div>
      </div>
    `).join('');
}

// 5) Navigation & swipe handlers
document.getElementById('prevBtn').onclick = () => {
  if (currentIndex>0) { currentIndex--; renderOrder(); }
};
document.getElementById('nextBtn').onclick = () => {
  if (currentIndex<orders.length-1) { currentIndex++; renderOrder(); }
};
document.getElementById('completeBtn').onclick = () => {
  if (currentIndex<orders.length-1) { currentIndex++; renderOrder(); }
};

let startX = 0;
const container = document.getElementById('orderContainer');
container.addEventListener('touchstart', e => startX = e.changedTouches[0].screenX);
container.addEventListener('touchend', e => {
  const diff = e.changedTouches[0].screenX - startX;
  if (diff>50 && currentIndex>0)        { currentIndex--; renderOrder(); }
  else if (diff< -50 && currentIndex<orders.length-1) { currentIndex++; renderOrder(); }
});

// 6) Kick it all off
window.addEventListener('load', loadSheetData);
