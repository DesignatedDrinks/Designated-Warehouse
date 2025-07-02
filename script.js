// script.js

// Firestore config (replace with actual config if needed)
const orders = [];
let currentIndex = 0;

// Example: simulate pulling from Firestore (replace this with Firestore fetch logic)
fetch('https://opensheet.elk.sh/YOUR_GOOGLE_SHEET_URL')
  .then(response => response.json())
  .then(data => {
    const groupedOrders = groupBy(data, 'orderId');
    for (const id in groupedOrders) {
      const order = groupedOrders[id];
      orders.push({
        orderId: id,
        customerName: order[0].customerName,
        notes: order[0].notes,
        items: order.map(item => ({
          title: item.itemFullTitle,
          qty: parseInt(item.qty),
          image: item.imageUrl,
          variant: item.variantTitle
        }))
      });
    }
    renderOrder(0);
  });

function groupBy(arr, key) {
  return arr.reduce((result, obj) => {
    const value = obj[key];
    result[value] = result[value] || [];
    result[value].push(obj);
    return result;
  }, {});
}

function renderOrder(index) {
  const order = orders[index];
  if (!order) return;

  document.getElementById('orderId').textContent = `Order #${order.orderId}`;
  document.getElementById('customerName').textContent = order.customerName;
  document.getElementById('noteText').textContent = order.notes || 'None';

  const itemsContainer = document.getElementById('itemsContainer');
  itemsContainer.innerHTML = '';
  let totalCans = 0;
  const packSummary = {};

  order.items.forEach(item => {
    const multiplier = getCanCount(item.variant);
    const totalQty = item.qty * multiplier;
    totalCans += totalQty;

    packSummary[multiplier] = (packSummary[multiplier] || 0) + item.qty;

    const itemCard = document.createElement('div');
    itemCard.className = 'item-card';
    itemCard.innerHTML = `
      <input type="checkbox" class="item-check" />
      <div class="item-image">
        <img src="${item.image || 'https://via.placeholder.com/80'}" alt="${item.title}">
      </div>
      <div class="item-details">
        <h4>${item.title}</h4>
        <p>${item.variant || ''}</p>
      </div>
      <div class="item-qty">
        <p><span class="qty-number">${totalQty}</span> <span class="qty-text">Cans</span></p>
      </div>
    `;
    itemsContainer.appendChild(itemCard);
  });

  renderSummary(packSummary, totalCans);
  renderBoxes(totalCans);
}

function renderSummary(summaryObj, totalCans) {
  const packSummary = document.getElementById('packSummary');
  packSummary.innerHTML = '';
  Object.keys(summaryObj).sort((a, b) => a - b).forEach(size => {
    const div = document.createElement('div');
    div.className = 'summary-item';
    div.innerHTML = `<span>${size}-Pack:</span><span>${summaryObj[size]}</span>`;
    packSummary.appendChild(div);
  });
  document.getElementById('totalCans').textContent = totalCans;
}

function renderBoxes(cans) {
  const boxDiv = document.getElementById('boxCalculation');
  let boxText = 'Multiple boxes required';
  if (cans <= 12) boxText = '1 x 12-pack box';
  else if (cans <= 24) boxText = '1 x 24-pack box';
  else if (cans <= 36) boxText = '1 x 24-pack box + 1 x 12-pack box';
  else if (cans <= 48) boxText = '2 x 24-pack boxes';
  else if (cans <= 60) boxText = '2 x 24-pack + 1 x 12-pack';
  else if (cans <= 72) boxText = '3 x 24-pack boxes';
  else if (cans <= 84) boxText = '3 x 24-pack + 1 x 12-pack';
  else if (cans <= 96) boxText = '4 x 24-pack boxes';
  else if (cans <= 108) boxText = '4 x 24-pack + 1 x 12-pack';
  else if (cans <= 120) boxText = '5 x 24-pack boxes';
  else if (cans <= 132) boxText = '5 x 24-pack + 1 x 12-pack';
  else if (cans <= 144) boxText = '6 x 24-pack boxes';
  boxDiv.innerHTML = boxText;
}

function getCanCount(variant = '') {
  const v = variant.toLowerCase();
  if (v.includes('28')) return 28;
  if (v.includes('24')) return 24;
  if (v.includes('12')) return 12;
  if (v.includes('10')) return 10;
  if (v.includes('8')) return 8;
  if (v.includes('6')) return 6;
  if (v.includes('5')) return 5;
  if (v.includes('4')) return 4;
  return 1;
}

// Navigation
const prevBtn = document.getElementById('prevBtn');
const nextBtn = document.getElementById('nextBtn');

prevBtn.addEventListener('click', () => {
  if (currentIndex > 0) renderOrder(--currentIndex);
});

nextBtn.addEventListener('click', () => {
  if (currentIndex < orders.length - 1) renderOrder(++currentIndex);
});
