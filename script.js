// ─── CONFIG ───
const SHEET_ID    = '1xE9SueE6rdDapXr0l8OtP_IryFM-Z6fHFH27_cQ120g';
const API_KEY     = 'AIzaSyA7sSHMaY7i-uxxynKewHLsHxP_dd3TZ4U';
const ORDERS_TAB  = 'Orders';
const DIRECT_BASE = 'https://designateddrinks.github.io/Designated-Direct';
const PACK_SIZES  = [28,24,12,10,8,6,5,4,1];

// which pack titles get a Pick Pack link
const VARIETY_PACK_NAMES = new Set([
  "Designated Drinks (Non-Alcoholic) Party Pack 24 Pack",
  "Designated Drinks (Non-Alcoholic) Dry February - 28 Pack",
  "Designated Drinks (Non-Alcoholic) IPA Collection 12 Pack",
  "Designated Drinks (Non-Alcoholic) Canadian Classics 12 Pack",
  "Designated Drinks (Non-Alcoholic) Low Calorie Collection 24 Pack",
  "Designated Drinks (Non-Alcoholic) Lager/Pale Ale 12 Pack",
  "Designated Drinks (Non-Alcoholic) Cocktail Mixer 12 Pack",
  "Designated Drinks (Non-Alcoholic) Fall Flavour 12 Pack",
  "Designated Drinks (Non-Alcoholic) DayDrinkin' Sixer",
  "Designated Drinks (Non-Alcoholic) Savour Summer 12 Pack",
  "Designated Drinks (Non-Alcoholic) Hop Water 24 Pack",
  "Designated Drinks (Non-Alcoholic) Debut 12 Pack"
]);

let orders = [], currentIndex = 0;
const container = document.getElementById('orderContainer');

async function loadData() {
  const url = `https://sheets.googleapis.com/v4/spreadsheets/${SHEET_ID}`
            + `/values/${ORDERS_TAB}?alt=json&key=${API_KEY}`;
  try {
    const res  = await fetch(url);
    const json = await res.json();
    const rows = json.values || [];
    if (rows.length < 2) throw new Error('No orders found.');

    const grouped = {};
    rows.slice(1).forEach(r => {
      const [orderId, customerName, itemTitle, variantTitle, qtyStr, , notes, imageUrl] = r;
      const qty      = parseInt(qtyStr,10) || 0;
      const m        = (variantTitle||'').match(/(\d+)\s*Pack/i);
      const packSize = m ? +m[1] : 1;
      const cans     = qty * packSize;

      if (!grouped[orderId]) {
        grouped[orderId] = { orderId, customerName, notes, totalCans:0, items: [] };
      }
      grouped[orderId].items.push({ itemTitle, variantTitle, qty, packSize, imageUrl });
      grouped[orderId].totalCans += cans;
    });

    orders = Object.values(grouped);
    renderOrder();
  } catch (err) {
    console.error(err);
    document.getElementById('itemsContainer').innerHTML =
      `<p style="color:red; padding:1rem;">${err.message}</p>`;
  }
}

function calculateBoxes(totalCans) {
  let rem = totalCans, breakdown = {};
  PACK_SIZES.forEach(size => {
    const cnt = Math.floor(rem/size);
    if (cnt) {
      breakdown[size] = cnt;
      rem %= size;
    }
  });
  return breakdown;
}

function renderOrder() {
  if (!orders.length) return;
  const o = orders[currentIndex];

  // Header & notes
  document.getElementById('orderId').innerText      = `Order #${o.orderId}`;
  document.getElementById('customerName').innerText = o.customerName;
  document.getElementById('orderNotes').innerText   = o.notes || '';

  // Summary
  document.getElementById('totalCans').innerText = o.totalCans;
  const boxes = calculateBoxes(o.totalCans);
  let boxHtml = '', totalBoxes = 0;
  for (let [size,cnt] of Object.entries(boxes)) {
    boxHtml    += `${cnt} × ${size}-pack box<br>`;
    totalBoxes += cnt;
  }
  if (!boxHtml) boxHtml = '0';
  document.getElementById('boxBreakdown').innerHTML =
    boxHtml + `<strong>Total Boxes:</strong> ${totalBoxes}`;

  // Items
  const itemsHtml = o.items.map(item => {
    const totalItemCans = item.qty * item.packSize;
    const pickLink = VARIETY_PACK_NAMES.has(item.itemTitle)
      ? `<a class="pick-link" href="${DIRECT_BASE}?pack=${encodeURIComponent(item.itemTitle)}" target="_blank">Pick Pack</a>`
      : '';
    return `
      <div class="item">
        <img src="${item.imageUrl||''}" alt="${item.itemTitle}">
        <div class="details">
          <p><strong>${item.itemTitle}</strong></p>
          <p>${totalItemCans} cans</p>
          ${pickLink}
        </div>
      </div>
    `;
  }).join('');
  document.getElementById('itemsContainer').innerHTML = itemsHtml;
}

// Prev / Next
document.getElementById('prevBtn').onclick = () => {
  if (currentIndex > 0) { currentIndex--; renderOrder(); }
};
document.getElementById('nextBtn').onclick = () => {
  if (currentIndex < orders.length - 1) { currentIndex++; renderOrder(); }
};

// Swipe detection
let startX = null;
container.addEventListener('touchstart', e => {
  startX = e.touches[0].clientX;
}, {passive:true});

container.addEventListener('touchend', e => {
  if (startX === null) return;
  const diff = e.changedTouches[0].clientX - startX;
  if (diff > 50) {          // swipe right
    if (currentIndex > 0) { currentIndex--; renderOrder(); }
  } else if (diff < -50) {  // swipe left
    if (currentIndex < orders.length - 1) { currentIndex++; renderOrder(); }
  }
  startX = null;
}, {passive:true});

// Init
loadData();
