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

    const [headers, ...entries] = rows;

    const grouped = {};
    entries.forEach(row => {
      const [
        orderId,
        customerName,
        itemTitle,
        variantTitle,
        itemFullTitle,
        qty,
        picked,
        notes,
        imageUrl
      ] = row;

      if (!grouped[orderId]) {
        grouped[orderId] = {
          orderId,
          customerName,
          notes,
          items: []
        };
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
    document.getElementById('itemsContainer').innerHTML = '<p>Error loading orders.</p>';
    console.error('Fetch error:', error);
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
      <img src="${item.imageUrl}" alt="${item.title}" />
      <label>${item.qty} × ${item.title}</label>
      <input type="checkbox" />
    </div>
  `).join('');

  document.getElementById('itemsContainer').innerHTML = itemsHtml;

  const totalCans = order.items.reduce((sum, item) => sum + item.qty, 0);
  document.getElementById('totalCans').innerText = totalCans;

  const boxCount = Math.ceil(totalCans / 24);
  document.getElementById('boxCount').innerText = boxCount;

  const packSummary = order.items.map(item => `${item.qty} × ${item.title}`).join('<br>');
  document.getElementById('packSummary').innerHTML = packSummary;
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

loadSheetData();
