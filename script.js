let orders = [];
let currentIndex = 0;

async function loadSheetData() {
  const sheetId = '1xE9SueE6rdDapXr0l8OtP_IryFM-Z6fHFH27_cQ120g';
  const sheetName = 'Orders';
  const url = `https://sheets.googleapis.com/v4/spreadsheets/${sheetId}/values/${sheetName}?alt=json&key=AIzaSyA7sSHMaY7i-uxxynKewHLsHxP_dd3TZ4U`;

  try {
    const res = await fetch(url);
    const data = await res.json();
    const rows = data.values;

    if (!rows || rows.length <= 1) {
      document.getElementById('itemsContainer').innerHTML = '<p>No orders found.</p>';
      return;
    }

    const body = rows.slice(1);
    const grouped = {};

    body.forEach(row => {
      const [orderId, customerName, itemTitle, variantTitle, itemFullTitle, qty, picked, notes, imageUrl] = row;
      if (!grouped[orderId]) {
        grouped[orderId] = { orderId, customerName, notes, items: [] };
      }
      grouped[orderId].items.push({
        title: itemFullTitle,
        qty: parseInt(qty),
        imageUrl
      });
    });

    orders = Object.values(grouped);
    renderOrder();
  } catch (error) {
    console.error('Error loading sheet:', error);
    document.getElementById('itemsContainer').innerHTML = '<p>Error loading orders.</p>';
  }
}

function renderOrder() {
  const order = orders[currentIndex];
  if (!order) return;

  document.getElementById('orderId').innerText = `Order ${order.orderId}`;
  document.getElementById('customerName').innerText = order.customerName;
  document.getElementById('noteText').innerText = order.notes || 'None';

  const itemsHtml = order.items.map(item => `
    <div class="item">
      <img src="${item.imageUrl}" alt="">
      <label>${item.qty} × ${item.title}</label>
      <input type="checkbox">
    </div>
  `).join('');
  document.getElementById('itemsContainer').innerHTML = itemsHtml;

  const totalCans = order.items.reduce((sum, item) => sum + item.qty, 0);
  document.getElementById('totalCans').innerText = totalCans;
  document.getElementById('boxCalculation').innerHTML = `<strong>Boxes Required:</strong> ${Math.ceil(totalCans / 24)}`;

  document.getElementById('packSummary').innerHTML = order.items
    .map(item => `<div>${item.qty} × ${item.title}</div>`)
    .join('');
}

function prevOrder() {
  if (currentIndex > 0) {
    currentIndex--;
    renderOrder();
  }
}

function nextOrder() {
  if (currentIndex < orders.length - 1) {
    currentIndex++;
    renderOrder();
  }
}

document.getElementById('prevBtn').addEventListener('click', prevOrder);
document.getElementById('nextBtn').addEventListener('click', nextOrder);
document.getElementById('printBtn').addEventListener('click', () => window.print());

loadSheetData();
