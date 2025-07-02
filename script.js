let orders = [];
let currentIndex = 0;

async function loadSheetData() {
  const sheetId   = '1xE9SueE6rdDapXr0l8OtP_IryFM-Z6fHFH27_cQ120g';
  const sheetName = 'Orders';
  const apiKey    = 'AIzaSyA7sSHMaY7i-uxxynKewHLsHxP_dd3TZ4U';
  const url       = `https://sheets.googleapis.com/v4/spreadsheets/${sheetId}` +
                    `/values/${sheetName}?alt=json&key=${apiKey}`;

  try {
    const res = await fetch(url);
    const json = await res.json();
    const rows = json.values || [];

    if (rows.length < 2) {
      document.getElementById('orderItems').innerHTML = '<p>No orders found.</p>';
      return;
    }

    // Drop header row, then group by orderId
    const body = rows.slice(1);
    const grouped = {};

    body.forEach(row => {
      const orderId      = row[0] || '';
      const customerName = row[1] || '';
      const itemTitle    = row[3] || '';
      const qty          = parseInt(row[5], 10) || 0;
      const notes        = row[7] || '';
      const imageUrl     = row[8] || '';

      if (!grouped[orderId]) {
        grouped[orderId] = { orderId, customerName, notes, items: [] };
      }
      grouped[orderId].items.push({ title: itemTitle, qty, imageUrl });
    });

    orders = Object.values(grouped);
    renderOrder();

  } catch (e) {
    document.getElementById('orderItems').innerHTML =
      '<p style="color:tomato;">Error loading orders</p>';
    console.error(e);
  }
}

function renderOrder() {
  const order = orders[currentIndex];
  if (!order) return;

  document.getElementById('orderId').innerText      = `Order #${order.orderId}`;
  document.getElementById('customerName').innerText = order.customerName;
  document.getElementById('orderNotes').innerText   = order.notes || '';

  const html = order.items.map(item => {
    const src = item.imageUrl || 'https://via.placeholder.com/50?text=?';
    return `
      <div class="item">
        <img src="${src}" alt="${item.title}" />
        <div class="item-details">
          <strong>${item.title}</strong><br>
          ${item.qty} cans
        </div>
      </div>
    `;
  }).join('');

  document.getElementById('orderItems').innerHTML = html;
}

document.getElementById('prevBtn').addEventListener('click', () => {
  if (currentIndex > 0) {
    currentIndex--;
    renderOrder();
  }
});
document.getElementById('nextBtn').addEventListener('click', () => {
  if (currentIndex < orders.length - 1) {
    currentIndex++;
    renderOrder();
  }
});

// load on startup
window.addEventListener('load', loadSheetData);
