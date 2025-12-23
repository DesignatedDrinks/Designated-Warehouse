// =========================================================
// CONFIG
// =========================================================
const sheetId   = '1xE9SueE6rdDapXr0l8OtP_IryFM-Z6fHFH27_cQ120g';
const sheetName = 'Orders';
const apiKey    = 'AIzaSyA7sSHMaY7i-uxxynKewHLsHxP_dd3TZ4U';

const ordersUrl =
  `https://sheets.googleapis.com/v4/spreadsheets/${sheetId}/values/${encodeURIComponent(sheetName)}?alt=json&key=${apiKey}`;

// We will ALSO use the sheet column "imageUrl" directly.
// ImageLookup is optional; left out on purpose to remove variables.

const $ = id => document.getElementById(id);

let MODE = 'pack';
let orders = [];
let orderIndex = 0;
let pickQueue = [];
let pickIndex = 0;

const STORAGE_KEY = 'dw_picked_final_v1';

// =========================================================
// UTILS
// =========================================================
function safe(v){ return (v ?? '').toString().trim(); }

function setError(msg){
  $('errBox').innerHTML = msg ? `<div class="error">${msg}</div>` : '';
}

function normalizeText(s){
  return safe(s).toLowerCase().replace(/[^a-z0-9]+/g,' ').replace(/\s+/g,' ').trim();
}

function normalizeKey(title, variant){
  return normalizeText(title) + '|' + normalizeText(variant);
}

function toIntQty(x){
  const n = parseInt(safe(x).replace(/[^\d-]/g,''), 10);
  return Number.isFinite(n) ? n : 0;
}

function parseBool(x){
  const v = safe(x).toLowerCase();
  return v === 'true' || v === '1' || v === 'yes';
}

function canLabel(n){
  return n === 1 ? '1 can' : `${n} cans`;
}

function firstNameInitial(fullName){
  const n = safe(fullName);
  if(!n) return '—';
  const parts = n.split(/\s+/).filter(Boolean);
  if(parts.length === 1) return parts[0];
  return `${parts[0]} ${parts[parts.length-1][0]}.`;
}

function cityProvince(address){
  const a = safe(address);
  if(!a) return '—';
  const parts = a.split(',').map(x => x.trim()).filter(Boolean);
  if(parts.length >= 3) return `${parts[1]}, ${parts[2]}`;
  if(parts.length >= 2) return parts.slice(-2).join(', ');
  return a;
}

function loadPicked(){
  try { return JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}'); }
  catch { return {}; }
}

function savePicked(obj){
  localStorage.setItem(STORAGE_KEY, JSON.stringify(obj));
}

function guessAisle(title){
  const t = safe(title).toUpperCase();
  const ch = (t.match(/[A-Z]/) || ['?'])[0];
  if(ch >= 'A' && ch <= 'H') return 'Aisle 1';
  if(ch >= 'I' && ch <= 'Q') return 'Aisle 2';
  if(ch >= 'R' && ch <= 'Z') return 'Aisle 3';
  return 'Aisle ?';
}

function placeholderSvg(title){
  const t = safe(title).slice(0,28);
  return `data:image/svg+xml;charset=utf-8,` + encodeURIComponent(`
    <svg xmlns="http://www.w3.org/2000/svg" width="300" height="300">
      <rect width="100%" height="100%" fill="#f3f4f6"/>
      <text x="50%" y="48%" text-anchor="middle" font-family="Arial" font-size="18" fill="#6b7280" font-weight="700">NO IMAGE</text>
      <text x="50%" y="58%" text-anchor="middle" font-family="Arial" font-size="12" fill="#9ca3af" font-weight="700">${t}</text>
    </svg>
  `);
}

function resolveImage(url, title){
  const u = safe(url);
  if(u && u.startsWith('http')) return u;
  return placeholderSvg(title);
}

function escapeHtml(str){
  return (str ?? '').toString()
    .replaceAll('&','&amp;')
    .replaceAll('<','&lt;')
    .replaceAll('>','&gt;')
    .replaceAll('"','&quot;')
    .replaceAll("'","&#039;");
}
function escapeAttr(str){ return escapeHtml(str).replaceAll('"','&quot;'); }

// =========================================================
// FETCH + BUILD
// =========================================================
async function fetchJson(url){
  const res = await fetch(url);
  if(!res.ok) throw new Error(`Fetch failed: ${res.status}`);
  return res.json();
}

function buildHeaderMap(headerRow){
  const map = {};
  headerRow.forEach((h, idx)=>{
    map[normalizeText(h)] = idx;
  });
  return map;
}

function mustHaveHeaders(hmap){
  // EXACTLY your sheet’s headers (normalized)
  const required = [
    'orderid','customername','address','itemtitle','varianttitle','qty','picked','notes','imageurl'
  ];
  const missing = required.filter(k => !(k in hmap));
  if(missing.length){
    throw new Error(`Orders sheet header mismatch. Missing: ${missing.join(', ')}`);
  }
}

function rowToObj(row, hmap){
  const get = key => row[hmap[key]] ?? '';
  const obj = {
    orderId: safe(get('orderid')),
    customerName: safe(get('customername')),
    address: safe(get('address')),
    itemTitle: safe(get('itemtitle')),
    variantTitle: safe(get('varianttitle')),
    qty: toIntQty(get('qty')),
    picked: parseBool(get('picked')),
    notes: safe(get('notes')),
    imageUrl: safe(get('imageurl')),
  };

  // drop garbage / blank rows
  if(!obj.orderId && !obj.itemTitle && !obj.customerName) return null;
  if(normalizeText(obj.itemTitle) === 'itemtitle') return null;

  return obj;
}

function buildOrders(rows){
  const byOrder = new Map();

  for(const r of rows){
    if(!r.orderId) continue;
    if(!byOrder.has(r.orderId)){
      byOrder.set(r.orderId, {
        orderId: r.orderId,
        customerName: r.customerName,
        address: r.address,
        notes: r.notes,
        itemsRaw: []
      });
    }
    byOrder.get(r.orderId).itemsRaw.push(r);
  }

  const out = [];
  for(const o of byOrder.values()){
    const merged = new Map();

    for(const r of o.itemsRaw){
      if(!r.itemTitle) continue;
      if(r.qty <= 0) continue;

      const key = normalizeKey(r.itemTitle, r.variantTitle);

      if(!merged.has(key)){
        merged.set(key, {
          itemTitle: r.itemTitle,
          variantTitle: r.variantTitle,
          qty: 0,
          aisle: guessAisle(r.itemTitle),
          picked: false,
          imageUrl: r.imageUrl
        });
      }

      const it = merged.get(key);
      it.qty += r.qty;

      // keep first real URL we see
      if(!it.imageUrl && r.imageUrl) it.imageUrl = r.imageUrl;
    }

    const items = Array.from(merged.values())
      .map(it => ({
        ...it,
        imageResolved: resolveImage(it.imageUrl, it.itemTitle)
      }))
      .sort((a,b)=>{
        const aa = a.aisle.localeCompare(b.aisle);
        if(aa !== 0) return aa;
        return a.itemTitle.localeCompare(b.itemTitle);
      });

    out.push({
      orderId: o.orderId,
      customerName: o.customerName,
      address: o.address,
      notes: o.notes,
      items
    });
  }

  // stable newest-ish by orderId string
  out.sort((a,b)=> (a.orderId > b.orderId ? -1 : 1));
  return out;
}

function applyPickedState(){
  const picked = loadPicked();
  orders.forEach(o=>{
    const po = picked[o.orderId] || {};
    o.items.forEach(it=>{
      const k = normalizeKey(it.itemTitle, it.variantTitle);
      it.picked = !!po[k];
    });
  });
}

function setItemPicked(orderId, item, val){
  const picked = loadPicked();
  if(!picked[orderId]) picked[orderId] = {};
  const k = normalizeKey(item.itemTitle, item.variantTitle);
  picked[orderId][k] = !!val;
  savePicked(picked);

  const o = orders[orderIndex];
  const target = o.items.find(x => normalizeKey(x.itemTitle,x.variantTitle) === k);
  if(target) target.picked = !!val;
}

// =========================================================
// UI
// =========================================================
function currentOrder(){ return orders[orderIndex]; }

function calcTotals(order){
  const total = order.items.reduce((s,it)=> s + it.qty, 0);
  const picked = order.items.reduce((s,it)=> s + (it.picked ? it.qty : 0), 0);
  return { total, picked };
}

function boxesRequired(totalCans){
  if(totalCans <= 0) return '0';
  const full24 = Math.floor(totalCans / 24);
  const rem = totalCans % 24;
  const parts = [];
  if(full24) parts.push(`${full24}×24-pack`);
  if(rem) parts.push(`1×${rem}-pack`);
  return parts.join(' + ');
}

function updateOrderStrip(){
  const o = currentOrder();
  if(!o){ $('orderStrip').style.display='none'; return; }
  $('orderStrip').style.display='block';

  const {total,picked} = calcTotals(o);
  const pct = total ? Math.round((picked/total)*100) : 0;

  $('stripNameCity').textContent = `${firstNameInitial(o.customerName)} · ${cityProvince(o.address)}`;
  $('stripMeta').textContent = `#${o.orderId} · ${total} cans · ${boxesRequired(total)}`;
  $('stripPill').textContent = `${pct}%`;

  $('progressFill').style.width = `${pct}%`;
  $('progressLeft').textContent = `${picked} picked`;
  $('progressRight').textContent = `${total} total`;

  $('fullAddress').innerHTML =
    `<div>${escapeHtml(o.customerName || '—')}</div>
     <div class="muted">${escapeHtml(o.address || '—')}</div>`;

  $('kvOrder').textContent = `#${o.orderId}`;
  $('kvBoxes').textContent = boxesRequired(total);
  $('kvCans').textContent = `${total}`;
  $('kvMode').textContent = MODE === 'picker' ? 'Picker' : 'Pack';
}

function buildPickQueue(){
  const o = currentOrder();
  pickQueue = o.items.filter(it => !it.picked);
  pickIndex = 0;
}

function openImgModal(item){
  $('imgModalImg').src = item.imageResolved;
  $('imgModalCap').textContent = item.itemTitle;
  $('imgModal').classList.add('show');
}

function render(){
  setError('');

  const o = currentOrder();
  if(!o){
    $('panelTitle').textContent = 'No orders found';
    $('panelSub').textContent = '';
    $('panelBody').innerHTML = `<div class="empty">No valid orders in sheet.</div>`;
    $('navRow').style.display='none';
    $('orderStrip').style.display='none';
    return;
  }

  updateOrderStrip();
  $('navRow').style.display = 'flex';

  if(MODE === 'picker'){
    $('panelTitle').textContent = 'Picker Mode';

    buildPickQueue();

    if(pickQueue.length === 0){
      $('panelSub').textContent = `Order ${orderIndex+1} / ${orders.length}`;
      $('panelBody').innerHTML = `
        <div class="pickerCard">
          <div class="bigQty">
            <div class="num">DONE</div>
            <div class="lbl">ORDER PICKED</div>
          </div>
          <div class="titleBlock">
            <div class="name">Everything is picked for this order.</div>
            <div class="sub"><span class="tag">Switch to Pack Mode to box it.</span></div>
          </div>
          <div class="confirmRow">
            <button class="btn btnWide" id="goPack">Go to Pack Mode</button>
          </div>
        </div>
      `;
      $('goPack').addEventListener('click', ()=> setMode('pack'));
      return;
    }

    const it = pickQueue[pickIndex];
    const left = pickQueue.length - pickIndex;
    $('panelSub').textContent = `Order ${orderIndex+1}/${orders.length} · ${left} picks left`;

    $('panelBody').innerHTML = `
      <div class="pickerCard">
        <div class="bigQty">
          <div class="num">${it.qty}</div>
          <div class="lbl">CANS</div>
        </div>

        <div class="imgBox">
          <img id="pickerImg" src="${it.imageResolved}" alt="${escapeHtml(it.itemTitle)}">
        </div>

        <div class="titleBlock">
          <div class="name">${escapeHtml(it.itemTitle)}</div>
          <div class="sub">
            <span class="tag">${escapeHtml(it.aisle)}</span>
            ${it.variantTitle ? `<span class="tag">${escapeHtml(it.variantTitle)}</span>` : ''}
          </div>
        </div>

        <div class="confirmRow">
          <button class="btn btnWide ok" id="btnConfirmPick">CONFIRM PICK</button>
          <button class="btn btnWide danger" id="btnSkipPick">SKIP</button>
        </div>
      </div>
    `;

    $('pickerImg').addEventListener('click', ()=> openImgModal(it));
    $('btnConfirmPick').addEventListener('click', ()=>{
      setItemPicked(o.orderId, it, true);
      render();
    });
    $('btnSkipPick').addEventListener('click', ()=>{
      pickIndex = Math.min(pickIndex + 1, pickQueue.length - 1);
      render();
    });

  } else {
    $('panelTitle').textContent = 'Pack Mode';

    const {total,picked} = calcTotals(o);
    $('panelSub').textContent = `Order ${orderIndex+1}/${orders.length} · ${picked}/${total} cans picked`;

    const rowsHtml = o.items.map(it=>{
      const done = it.picked ? 'done' : '';
      const label = it.picked ? 'PICKED' : canLabel(it.qty);
      return `
        <div class="row" data-key="${escapeAttr(normalizeKey(it.itemTitle,it.variantTitle))}">
          <div class="thumb"><img src="${it.imageResolved}" alt="${escapeHtml(it.itemTitle)}"></div>
          <div>
            <div class="rTitle">${escapeHtml(it.itemTitle)}</div>
            <div class="rSub">
              <span class="tag">${escapeHtml(it.aisle)}</span>
              ${it.variantTitle ? `<span class="tag">${escapeHtml(it.variantTitle)}</span>` : ''}
            </div>
          </div>
          <button class="qtyBtn ${done}" data-action="toggle">${escapeHtml(label)}</button>
        </div>
      `;
    }).join('');

    $('panelBody').innerHTML = rowsHtml || `<div class="empty">No items found.</div>`;

    $('panelBody').querySelectorAll('.row').forEach(row=>{
      const k = row.getAttribute('data-key');
      const it = o.items.find(x => normalizeKey(x.itemTitle,x.variantTitle) === k);
      if(!it) return;

      row.querySelector('img').addEventListener('click', ()=> openImgModal(it));
      row.querySelector('[data-action="toggle"]').addEventListener('click', ()=>{
        setItemPicked(o.orderId, it, !it.picked);
        render();
      });
    });
  }

  $('btnPrev').onclick = ()=> { if(orderIndex>0){ orderIndex--; render(); } };
  $('btnNext').onclick = ()=> { if(orderIndex<orders.length-1){ orderIndex++; render(); } };
}

function setMode(m){
  MODE = m;
  $('btnPicker').classList.toggle('secondary', MODE !== 'picker');
  $('btnPack').classList.toggle('secondary', MODE !== 'pack');
  render();
}

// Modal close
$('imgModal').addEventListener('click', (e)=>{
  if(e.target.id === 'imgModal') $('imgModal').classList.remove('show');
});

// Strip toggle
$('orderStripTop').addEventListener('click', ()=>{
  const d = $('orderStripDetail');
  const open = d.classList.toggle('show');
  $('stripCaret').textContent = open ? '▴' : '▾';
});

// =========================================================
// INIT
// =========================================================
async function init(){
  try{
    $('btnPicker').addEventListener('click', ()=> setMode('picker'));
    $('btnPack').addEventListener('click', ()=> setMode('pack'));
    $('btnPicker').classList.add('secondary');

    const j = await fetchJson(ordersUrl);
    const values = j.values || [];
    if(values.length < 2) throw new Error('Orders sheet has no data.');

    const headerRow = values[0];
    const hmap = buildHeaderMap(headerRow);
    mustHaveHeaders(hmap);

    const rows = values.slice(1)
      .map(r => rowToObj(r, hmap))
      .filter(Boolean);

    orders = buildOrders(rows);
    applyPickedState();

    if(!orders.length){
      setError('No valid orders built. Check orderid + itemTitle + qty columns.');
    }

    setMode('pack');
  }catch(e){
    setError(e.message);
    $('panelTitle').textContent = 'Error';
    $('panelBody').innerHTML = `<div class="empty">Fix sheet headers/data and reload.</div>`;
    $('navRow').style.display='none';
  }
}

init();
