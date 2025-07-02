let orders = [];
let currentIndex = 0;
const packSizes = [28,24,12,10,8,6,5,4,1];

async function loadSheetData() {
  const sheetId = '1xE9SueE6rdDapXr0l8OtP_IryFM-Z6fHFH27_cQ120g';
  const sheetName = 'Orders';
  const apiKey   = 'AIzaSyA7sSHMaY7i-uxxynKewHLsHxP_dd3TZ4U';
  const url = `https://sheets.googleapis.com/v4/spreadsheets/${sheetId}/values/${sheetName}?alt=json&key=${apiKey}`;

  try {
    const res  = await fetch(url);
    const json = await res.json();
    const rows = json.values || [];
    if (rows.length < 2) throw new Error('No data');

    const body = rows.slice(1);
    const grouped = {};

    body.forEach(r => {
      const [
        orderId, customerName,
        itemTitle, variantTitle,
        qtyStr, picked, notes,
        imageUrl
      ] = r;

      const qty = parseInt(qtyStr,10) || 0;
      const match = variantTitle.match(/(\d+)\s*Pack/i);
      const packSize = match ? parseInt(match[1],10) : 1;
      const cans = qty * packSize;

      if (!grouped[orderId]) {
        grouped[orderId] = {
          orderId,
          customerName,
          notes,
          totalCans: 0,
          items: []
        };
      }

      grouped[orderId].items.push({
        title: itemTitle,
        variant: variantTitle,
        qty, packSize,
        imageUrl
      });
      grouped[orderId].totalCans += cans;
    });

    orders = Object.values(grouped);
    renderOrder();

  } catch (e) {
    document.getElementById('itemsContainer').innerHTML = `<p style="padding:1rem;color:red;">Error loading orders</p>`;
    console.error(e);
  }
}

function calculateBoxBreakdown(totalCans) {
  let leftover = totalCans;
  const result = {};

  packSizes.forEach(size => {
    const count = Math.floor(leftover/size);
    if (count) {
      result[size] = count;
      leftover %= size;
    }
  });

  return result;
}

function renderOrder() {
  const o = orders[currentIndex];
  if (!o) return;

  document.getElementById('orderId').innerText = `Order #${o.orderId}`;
  document.getElementById('customerName').innerText = o.customerName;
  document.getElementById('orderIndex').innerText = `${currentIndex+1} / ${orders.length}`;
  document.getElementById('totalCans').innerText = o.totalCans;

  // Box summary
  const breakdown = calculateBoxBreakdown(o.totalCans);
  let html = '';
  let totalBoxes = 0;
  for (let [size,count] of Object.entries(breakdown)) {
    html += `${count} × ${size}-pack box<br>`;
    totalBoxes += count;
  }
  if (!html) html = '0';
  document.getElementById('boxBreakdown').innerHTML = html + `<strong>Total Boxes: ${totalBoxes}</strong>`;

  // Items
  const itemsHtml = o.items.map(item => `
    <div class="item">
      <img src="${item.imageUrl||''}" alt="${item.title}">
      <div class="details">
        <p><strong>${item.title}</strong></p>
        <p>Variant: ${item.variant}</p>
        <p>Qty: ${item.qty} × ${item.packSize} cans = ${item.qty*item.packSize}</p>
      </div>
    </div>
  `).join('');
  document.getElementById('itemsContainer').innerHTML = itemsHtml;
}

// Navigation
document.getElementById('prevBtn').onclick = () => {
  if (currentIndex>0) { currentIndex--; renderOrder(); }
};
document.getElementById('nextBtn').onclick = () => {
  if (currentIndex<orders.length-1) { currentIndex++; renderOrder(); }
};

loadSheetData();
