let orders = [];
let currentIndex = 0;

const packSizes = [28, 24, 12, 10, 8, 6, 5, 4, 1];

async function loadSheetData() {
  const sheetId = '1xE9SueE6rdDapXr0l8OtP_IryFM-Z6fHFH27_cQ120g';
  const sheetName = 'Orders';
  const apiKey = 'AIzaSyA7sSHMaY7i-uxxynKewHLsHxP_dd3TZ4U';
  const url = `https://sheets.googleapis.com/v4/spreadsheets/${sheetId}/values/${sheetName}?alt=json&key=${apiKey}`;

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
        title: itemTitle,
        variant: variantTitle,
        fullTitle: itemFullTitle,
        qty: parseInt(qty, 10),
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

  let totalCans = 0;
  let itemsHtml = '';

  order.items.forEach(item => {
    const packQty = getPackQuantity(item.variant);
    const canCount = item.qty * packQty;
    totalCans += canCount;

    itemsHtml += `
      <div class="item-card">
        <img src="${item.imageUrl}" alt="${item.title}" />
        <div>
          <strong>${item.title}</strong><br/>
          Variant: ${item.variant}<br/>
          Quantity: ${item.qty} × ${packQty} cans = ${canCount}
        </div>
      </div>
    `;
  });

  document.getElementById('itemsContainer').innerHTML = itemsHtml;
  document.getElementById('totalCans').innerText = totalCans;
  document.getElementById('boxCalculation').innerHTML = formatBoxBreakdown(totalCans);
}

function getPackQuantity(variant) {
  const match = variant.match(/(\d+)[\s-]*pack/i);
  return match ? parseInt(match[1], 10) : 1;
}

function formatBoxBreakdown(totalCans) {
  let remaining = totalCans;
  let boxSummary = '';
  let totalBoxes = 0;

  packSizes.forEach(size => {
    const count = Math.floor(remaining / size);
    if (count > 0) {
      boxSummary += `${count} × ${size}-pack box<br/>`;
      totalBoxes += count;
      remaining %= size;
    }
  });

  return `<strong>Boxes Required:</strong><br/>${boxSummary}<strong>Total Boxes:</strong> ${totalBoxes}`;
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
