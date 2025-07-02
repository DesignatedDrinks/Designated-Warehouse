let orders = [], currentIndex = 0, imageLookup = []; 

// ➤ CONFIG
const sheetId   = '1xE9SueE6rdDapXr0l8OtP_IryFM-Z6fHFH27_cQ120g';
const apiKey    = 'AIzaSyA7sSHMaY7i-uxxynKewHLsHxP_dd3TZ4U';
const ordersRange      = 'Orders!A2:H';
const lookupRange      = 'ImageLookup!A2:B';

// ▶️ Fetch & initialize
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
    imageLookup = lRows;

    // Group orders by orderId
    const map = {};
    oRows.forEach(row => {
      const [
        orderId, customerName, address,
        itemTitle, variantTitle, qtyStr,
        notes
      ] = row;
      const qty = parseInt(qtyStr, 10) || 0;
      const sizeMatch = variantTitle.match(/(\d+)/);
      const packSize  = sizeMatch ? parseInt(sizeMatch[1],10) : 1;
      const totalUnits = qty * packSize;

      // Find image URL for this itemTitle
      const match = lRows.find(l => l[0].toLowerCase().trim() === itemTitle.toLowerCase().trim());
      const imageUrl = match ? match[1] : '';

      if (!map[orderId]) {
        map[orderId] = {
          orderId,
          customerName,
          address,
          notes,
          items: [],
          totalCans: 0
        };
      }
      map[orderId].items.push({itemTitle, totalUnits, imageUrl});
      map[orderId].totalCans += totalUnits;
    });

    orders = Object.values(map);
    renderOrder();
  } catch (err) {
    console.error(err);
    document.getElementById('itemsContainer').innerHTML = '<p style="color:#f55;">Error loading orders.</p>';
  }
}

// ➤ Greedy box calculation (24,12,6)
function calculateBoxes(totalCans) {
  const sizes = [24,12,6];
  const counts = {};
  let rem = totalCans;
  sizes.forEach(sz => {
    const cnt = Math.floor(rem/sz);
    if (cnt) {
      counts[sz] = cnt;
      rem -= cnt*sz;
    }
  });
  if (rem>0) {
    // whatever remains goes into one extra 6-pack
    counts[6] = (counts[6]||0) + 1;
  }
  return counts;
}

// ➤ Render current order
function renderOrder() {
  if (!orders.length) {
    document.getElementById('orderId').innerText = 'Loading…';
    return;
  }
  currentIndex = Math.max(0, Math.min(currentIndex, orders.length-1));
  const o = orders[currentIndex];

  // Header
  document.getElementById('orderId').innerText       = `Order ${o.orderId}`;
  document.getElementById('customerName').innerText  = o.customerName;
  document.getElementById('customerAddress').innerText = o.address;

  // Box summary
  const boxCounts = calculateBoxes(o.totalCans);
  const lines = Object.entries(boxCounts)
    .map(([sz,c]) => `${c} × ${sz}-pack`)
    .join('\n');
  const totalBoxes = Object.values(boxCounts).reduce((a,b)=>a+b, 0);
  document.getElementById('boxSummary').innerHTML = `
    <strong>Boxes Required:</strong><br>
    ${lines}<br>
    <strong>Total Boxes:</strong> ${totalBoxes}<br>
    <strong>Total Cans:</strong> ${o.totalCans}
  `;

  // Items list
  const html = o.items.map(item => `
    <div class="item-card">
      <img src="${item.imageUrl}" alt="${item.itemTitle}">
      <div class="item-details">
        <p>${item.itemTitle}</p>
        <p>${item.totalUnits} cans</p>
      </div>
    </div>
  `).join('');
  document.getElementById('itemsContainer').innerHTML = html;
}

// ➤ Navigation handlers
document.getElementById('prevBtn').addEventListener('click', () => {
  currentIndex--;
  renderOrder();
});
document.getElementById('nextBtn').addEventListener('click', () => {
  currentIndex++;
  renderOrder();
});

// ➤ Swipe support
let startX = 0;
document.querySelector('.container').addEventListener('touchstart', e => {
  startX = e.changedTouches[0].screenX;
});
document.querySelector('.container').addEventListener('touchend', e => {
  const dx = e.changedTouches[0].screenX - startX;
  if (dx > 50)      { currentIndex--; renderOrder(); }
  else if (dx < -50){ currentIndex++; renderOrder(); }
});

// ➤ Auto-refresh every 5 minutes
loadData();
setInterval(loadData, 5 * 60 * 1000);
