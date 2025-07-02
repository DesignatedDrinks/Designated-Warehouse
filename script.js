const sheetId   = '1xE9SueE6rdDapXr0l8OtP_IryFM-Z6fHFH27_cQ120g';
const sheetName = 'Orders';
const apiKey    = 'AIzaSyA7sSHMaY7i-uxxynKewHLsHxP_dd3TZ4U';
const url       = `https://sheets.googleapis.com/v4/spreadsheets/
  ${sheetId}/values/${sheetName}?key=${apiKey}`.replace(/\s+/g,'');

let orders = [], idx = 0;

async function loadOrders() {
  try {
    const res  = await fetch(url);
    const js   = await res.json();
    const rows = js.values || [];
    if (rows.length < 2) throw new Error('No data');

    const [hdr, ...data] = rows;
    const mapCol = col => hdr.indexOf(col);

    data.forEach(r => {
      const orderId        = r[mapCol('orderId')];
      const customerName   = r[mapCol('customerName')];
      const address        = r[mapCol('address')];
      const title          = r[mapCol('itemTitle')];
      const variant        = r[mapCol('variantTitle')];
      const qty            = parseInt(r[mapCol('qty')],10) || 0;
      const imageUrl       = r[mapCol('imageUrl')] || '';

      let o = orders.find(o=>o.orderId===orderId);
      if (!o) {
        o = { orderId, customerName, address, items: [], totalCans: 0 };
        orders.push(o);
      }
      // convert variant "4 Pack" → size 4
      const sizeMatch = variant.match(/(\d+)\s*Pack/i);
      const size = sizeMatch ? +sizeMatch[1] : 1;
      o.items.push({ title, qty, size, imageUrl });
      o.totalCans += qty * size;
    });

    render();
  } catch(err) {
    document.getElementById('itemsList').innerHTML =
      `<p style="color:tomato; text-align:center;">Error loading orders</p>`;
    console.error(err);
  }
}

function calculateBoxes(total) {
  const sizes = [24,12,6];
  const result = [];
  let rem = total;
  sizes.forEach(s => {
    const c = Math.floor(rem/s);
    if(c) {
      result.push(`${c} × ${s}-pack box`);
      rem -= c*s;
    }
  });
  return result;
}

function render() {
  if (orders.length===0) return;
  idx = Math.min(Math.max(idx,0),orders.length-1);
  const o = orders[idx];

  // header
  document.getElementById('orderNumber').innerText = o.orderId;
  document.getElementById('customerAddress').innerText = o.address;

  // summary
  const bs = calculateBoxes(o.totalCans);
  document.getElementById('boxSummary').innerHTML =
    `<strong>Boxes Required:</strong><br>${bs.join('<br>')}<br>
     <strong>Total Boxes:</strong> ${bs.length}`;
  document.getElementById('totalCans').innerText = o.totalCans;

  // items
  const container = document.getElementById('itemsList');
  container.innerHTML = o.items.map(item=>`
    <div class="item-card">
      <img src="${item.imageUrl}" alt="${item.title}"/>
      <div class="item-info">
        <div class="title">${item.title}</div>
        <div class="qty">${item.qty * item.size} cans</div>
      </div>
    </div>
  `).join('');
}

function next() {
  idx = Math.min(idx+1, orders.length-1);
  render();
}
function prev() {
  idx = Math.max(idx-1, 0);
  render();
}

// mark complete & next
function completeAndNext() {
  orders.splice(idx,1);
  if (idx >= orders.length) idx = orders.length-1;
  render();
}

// swipe gestures
let startX=0;
document.addEventListener('touchstart', e=> startX=e.touches[0].screenX );
document.addEventListener('touchend', e=>{
  const dx = e.changedTouches[0].screenX - startX;
  if (dx < -50) next();
  if (dx > 50) prev();
});

document.getElementById('nextBtn').addEventListener('click', next);
document.getElementById('prevBtn').addEventListener('click', prev);
document.getElementById('completeBtn').addEventListener('click', completeAndNext);

window.addEventListener('load', loadOrders);
