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

    const header = rows[0];
    const body = rows.slice(1);

    const grouped = {};

    body.forEach(row => {
      const [
        orderId,
        customerName,
        itemTitle,
        variantTitle,
        qtyStr,
        picked,
        notes,
        imageUrl
      ] = row;

      const qty = parseInt(qtyStr, 10) || 0;
      const packMatch = variantTitle?.match(/(\d+)\s*Pack/i);
      const packSize = packMatch ? parseInt(packMatch[1], 10) : 1;
      const totalCans = qty * packSize;

      if (!grouped[orderId]) {
        grouped[orderId] = {
          orderId,
          customerName,
          notes,
          items: [],
          totalCans: 0
        };
      }

      grouped[orderId].items.push({
        itemTitle,
        variantTitle,
        qty,
        packSize,
        imageUrl
      });

      grouped[orderId].totalCans += totalCans;
    });

    orders = Object.values(grouped);
    renderOrder();
  } catch (error) {
    document.getElementById('itemsContainer').innerHTML = '<p>Error loading orders.</p>';
    console.error('❌ Fetch error:', error);
  }
}

function calculateBoxes(totalCans) {
  const boxSizes = [28, 24, 12, 10, 8, 6, 5, 4, 1];
  const breakdown = {};
  let remaining = totalCans;

  boxSizes.forEach(size => {
    const count = Math.floor(remaining / size);
    if (count > 0) {
      breakdown[size] = count;
      remaining %= size;
    }
  });

  return breakdown;
}

function renderOrder() {
  const order = orders[currentIndex];
  if (!order) return;

  document.getElementById('orderId').innerText = `Order #${order.orderId}`;
  document.getElementById('customerName').innerText = `Customer Name: ${order.customerName}`;
  document.getElementById('noteText').innerText = order.notes || 'None';
  document.getElementById('totalCans').innerText = order.totalCans;

  const boxBreakdown = calculateBoxes(order.totalCans);
  const breakdownText = Object.entries(boxBreakdown)
    .map(([si]()
