(() => {
  const sheetId = '1xE9SueE6rdDapXr0l8OtP_IryFM-Z6fHFH27_cQ120g';
  const apiKey  = 'AIzaSyA7sSHMaY7i-uxxynKewHLsHxP_dd3TZ4U';

  // Ranges
  const ordersRange   = 'Orders!A1:H1000';
  const lookupRange   = 'ImageLookup!A2:B1000';

  const ordersURL = `https://sheets.googleapis.com/v4/spreadsheets/${sheetId}/values/${encodeURIComponent(ordersRange)}?key=${apiKey}`;
  const lookupURL = `https://sheets.googleapis.com/v4/spreadsheets/${sheetId}/values/${encodeURIComponent(lookupRange)}?key=${apiKey}`;

  let orders = [], currentIndex = 0;

  async function init() {
    try {
      const [oRes, lRes] = await Promise.all([
        fetch(ordersURL).then(r => r.json()),
        fetch(lookupURL).then(r => r.json())
      ]);

      // Build lookup map: lowercase "Title - Variant" → imageURL
      const lookupRows = lRes.values || [];
      const lookupMap = lookupRows.reduce((m, r) => {
        const key = (r[0]||'').toLowerCase().trim();
        if (key) m[key] = r[1] || '';
        return m;
      }, {});

      const rows = oRes.values;
      if (!rows || rows.length < 2) {
        document.getElementById('itemsContainer').innerHTML = '<p>No orders found.</p>';
        return;
      }

      const header = rows[0];
      // find each column index
      const idx = {
        orderId:      header.indexOf('orderId'),
        customer:     header.indexOf('customerName'),
        address:      header.indexOf('address'),
        title:        header.indexOf('itemTitle'),
        variant:      header.indexOf('variantTitle'),
        qty:          header.indexOf('qty'),
        notes:        header.indexOf('notes')
      };

      // group
      const grouped = {};
      rows.slice(1).forEach(r => {
        const id    = r[idx.orderId],
              cust  = r[idx.customer] || '',
              addr  = r[idx.address] || '',
              title = r[idx.title] || '',
              varT  = r[idx.variant] || '',
              qty   = parseInt(r[idx.qty], 10) || 0,
              note  = r[idx.notes] || '';

        if (!grouped[id]) {
          grouped[id] = {
            orderId: id,
            customerName: cust,
            address: addr,
            notes: note,
            items: [],
            totalCans: 0
          };
        }

        // compute pack size from variant (e.g. "12 Pack")
        const m = varT.match(/(\d+)\s*Pack/i);
        const packSize = m ? parseInt(m[1], 10) : 1;
        const fullKey  = (title + (varT? ' - ' + varT:'')).toLowerCase().trim();
        const imgUrl   = lookupMap[fullKey] || '';

        grouped[id].items.push({ title, variant: varT, qty, packSize, imageUrl: imgUrl });
        grouped[id].totalCans += qty * packSize;
      });

      orders = Object.values(grouped);
      renderOrder();
      attachNav();
    } catch (e) {
      console.error(e);
      document.getElementById('itemsContainer').innerHTML = '<p>Error loading orders.</p>';
    }
  }

  function calculateBoxes(total) {
    const sizes = [24, 12, 6];
    const counts = {};
    let rem = total;
    sizes.forEach(sz => {
      const c = Math.floor(rem / sz);
      if (c > 0) {
        counts[sz] = c;
        rem %= sz;
      }
    });
    return counts;
  }

  function renderOrder() {
    const o = orders[currentIndex];
    if (!o) return;
    document.getElementById('orderId').innerText = `Order #${o.orderId}`;
    document.getElementById('customerName').innerText = o.customerName;
    document.getElementById('shippingAddress').innerText = o.address;

    // boxes
    const boxCounts = calculateBoxes(o.totalCans);
    const lines = Object.entries(boxCounts).map(([sz,c])=>`${c} × ${sz}-pack box`);
    const totalBoxes = Object.values(boxCounts).reduce((a,b)=>a+b,0);
    document.getElementById('boxSummary').innerHTML = `
      <strong>Boxes Required:</strong><br>
      ${lines.join('<br>')}<br>
      <strong>Total Boxes:</strong> ${totalBoxes}<br>
      <strong>Total Cans:</strong> ${o.totalCans}
    `;

    // items
    const itemsHtml = o.items.map(it=>{
      const cans = it.qty * it.packSize;
      return `
        <div class="item-card">
          <img src="${it.imageUrl}" alt="${it.title}">
          <div class="item-details">
            <p><strong>${it.title}</strong></p>
            <p>${cans} cans</p>
          </div>
        </div>
      `;
    }).join('');
    document.getElementById('itemsContainer').innerHTML = itemsHtml;

    // nav button state
    document.getElementById('prevBtn').disabled = currentIndex === 0;
    document.getElementById('nextBtn').disabled = currentIndex === orders.length - 1;
  }

  function attachNav() {
    document.getElementById('prevBtn').addEventListener('click', _=>{
      if (currentIndex > 0) { currentIndex--; renderOrder(); }
    });
    document.getElementById('nextBtn').addEventListener('click', _=>{
      if (currentIndex < orders.length - 1) { currentIndex++; renderOrder(); }
    });

    // swipe support
    let xStart = 0;
    const el = document.getElementById('orderContainer');
    el.addEventListener('touchstart', e => xStart = e.changedTouches[0].clientX);
    el.addEventListener('touchend', e => {
      const dx = xStart - e.changedTouches[0].clientX;
      if (dx > 50 && currentIndex < orders.length - 1) {
        currentIndex++; renderOrder();
      } else if (dx < -50 && currentIndex > 0) {
        currentIndex--; renderOrder();
      }
    });
  }

  // kick things off
  init();
})();
