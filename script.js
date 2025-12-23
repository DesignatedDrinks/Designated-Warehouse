/* =========================================================
   CONFIG
   ========================================================= */
const sheetId   = '1xE9SueE6rdDapXr0l8OtP_IryFM-Z6fHFH27_cQ120g';
const sheetName = 'Orders';
const apiKey    = 'AIzaSyA7sSHMaY7i-uxxynKewHLsHxP_dd3TZ4U';

// Orders sheet expects headers in row1 like:
// orderId, customerName, address, itemTitle, variantTitle, qty, picked, notes, imageUrl
const ordersUrl =
  `https://sheets.googleapis.com/v4/spreadsheets/${sheetId}/values/${encodeURIComponent(sheetName)}?alt=json&key=${apiKey}`;

// Optional: image lookup sheet (A=title, B=imageUrl).
const imageLookupUrl =
  `https://sheets.googleapis.com/v4/spreadsheets/${sheetId}/values/${encodeURIComponent('ImageLookup!A2:B')}?alt=json&key=${apiKey}`;

/* =========================================================
   DOM
   ========================================================= */
const $ = id => document.getElementById(id);

/* =========================================================
   STATE
   ========================================================= */
let MODE = 'pack'; // 'picker' or 'pack'
let rawRows = [];
let imageMap = new Map();

let orders = [];         // [{orderId, customerName, address, items:[...] }]
let orderIndex = 0;

let pickQueue = [];      // one-item-at-a-time queue for current order
let pickIndex = 0;

const STORAGE_KEY = 'dw_picked_v1';

/* =========================================================
   UTIL
   ========================================================= */
function safe(s){ return (s ?? '').toString().trim(); }

function normalizeKey(title, variant){
  // Merge duplicates by: title + variant (so different formats do NOT merge)
  const t = safe(title).toLowerCase().replace(/\s+/g,' ').trim();
  const v = safe(variant).toLowerCase().replace(/\s+/g,' ').trim();
  return (t + '|' + v);
}

function firstNameInitial(fullName){
  const n = safe(fullName);
  if(!n) return '—';
  const parts = n.split(/\s+/).filter(Boolean);
  if(parts.length === 1) return parts[0];
  return `${parts[0]} ${parts[parts.length-1][0]}.`;
}

function cityProvince(address){
  // Best effort parse: expects "street, City, Province, Country"
  const a = safe(address);
  if(!a) return '—';
  const parts = a.split(',').map(x => x.trim()).filter(Boolean);
  if(parts.length >= 3) return `${parts[1]}, ${parts[2]}`;
  if(parts.length >= 2) return parts.slice(-2).join(', ');
  return a;
}

function loadPicked(){
  try{
    return JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}');
  }catch(e){ return {}; }
}

function savePicked(obj){
  localStorage.setItem(STORAGE_KEY, JSON.stringify(obj));
}

function setError(msg){
  const box = $('errBox');
  box.innerHTML = msg ? `<div class="error">${msg}</div>` : '';
}

/* =========================================================
   WAREHOUSE LOCATION LOGIC (SIMPLE BUT RELIABLE)
   ========================================================= */
function guessAisle(title){
  const t = safe(title).toUpperCase();
  const ch = (t.match(/[A-Z]/) || ['?'])[0];

  // Aisle 1: A–H, Aisle 2: I–Q, Aisle 3: R–Z
  if(ch >= 'A' && ch <= 'H') return 'Aisle 1';
  if(ch >= 'I' && ch <= 'Q') return 'Aisle 2';
  if(ch >= 'R' && ch <= 'Z') return 'Aisle 3';
  return 'Aisle ?';
}

/* =========================================================
   FETCH + PARSE
   ========================================================= */
async function fetchJson(url){
  const res = await fetch(url);
  if(!res.ok) throw new Error(`Fetch failed: ${res.status}`);
  return res.json();
}

function rowsToObjects(values){
  if(!values || !values.length) return [];
  const headers = values[0].map(h => safe(h));
  const out = [];
  for(let i=1;i<values.length;i++){
    const row = values[i];
    const obj = {};
    headers.forEach((h, idx) => obj[h] = row[idx] ?? '');
    if(safe(obj.orderId) || safe(obj.itemTitle) || safe(obj.customerName)) out.push(obj);
  }
  return out;
}

async function loadImageLookup(){
  try{
    const j = await fetchJson(imageLookupUrl);
    const vals = j.values || [];
    vals.forEach(r=>{
      const k = safe(r[0]);
      const v = safe(r[1]);
      if(k && v) imageMap.set(k.toLowerCase().trim(), v);
    });
  }catch(e){
    // Optional; ignore if missing
  }
}

function resolveImage(item){
  // Priority: row imageUrl -> image lookup by itemTitle -> placeholder
  const direct = safe(item.imageUrl);
  if(direct) return direct;

  const key = safe(item.itemTitle).toLowerCase().trim();
  if(key && imageMap.has(key)) return imageMap.get(key);

  return `data:image/svg+xml;charset=utf-8,` + encodeURIComponent(`
    <svg xmlns="http://www.w3.org/2000/svg" width="300" height="300">
      <rect width="100%" height="100%" fill="#f3f4f6"/>
      <text x="50%" y="48%" text-anchor="middle" font-family="Arial" font-size="18" fill="#6b7280" font-weight="700">NO IMAGE</text>
      <text x="50%" y="58%" text-anchor="middle" font-family="Arial" font-size="12" fill="#9ca3af" font-weight="700">${safe(item.itemTitle).slice(0,22)}</text>
    </svg>
  `);
}

/* =========================================================
   NORMALIZE (MERGE DUPLICATES SAFELY)
   ========================================================= */
function buildOrders(rows){
  const byOrder = new Map();

  rows.forEach(r=>{
    const orderId = safe(r.orderId);
    if(!orderId) return;

    if(!byOrder.has(orderId)){
      byOrder.set(orderId, {
        orderId,
        customerName: safe(r.customerName),
        address: safe(r.address),
        notes: safe(r.notes),
        itemsRaw: []
      });
    }
    byOrder.get(orderId).itemsRaw.push(r);
  });

  const out = [];
  for(const o of byOrder.values()){
    const merged = new Map();

    o.itemsRaw.forEach(r=>{
      const title = safe(r.itemTitle);
      const variant = safe(r.variantTitle);
      const qty = Number(r.qty || 0) || 0;
      const key = normalizeKey(title, variant);

      if(!merged.has(key)){
        merged.set(key, {
          itemTitle: title,
          variantTitle: variant,
          qty: 0,
          imageUrl: safe(r.imageUrl),
          aisle: guessAisle(title),
          picked: false
        });
      }

      const it = merged.get(key);
      it.qty += qty;

      if(!it.imageUrl && safe(r.imageUrl)) it.imageUrl = safe(r.imageUrl);
    });

    const items = Array.from(merged.values())
      .filter(x => x.qty > 0)
      .map(x => ({ ...x, imageResolved: resolveImage(x) }))
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

  out.sort((a,b)=> (a.orderId > b.orderId ? -1 : 1));
  return out;
}

/* =========================================================
   PICKED STATE (LOCAL)
   ========================================================= */
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

/* =========================================================
   UI RENDER
   ========================================================= */
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
  let parts = [];
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
    `<div>${safe(o.customerName) || '—'}</div>
     <div class="muted">${safe(o.address) || '—'}</div>`;

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

function render(){
  setError('');

  const o = currentOrder();
  if(!o){
    $('panelTitle').textContent = 'No orders found';
    $('panelSub').textContent = '';
    $('panelBody').innerHTML = `<div class="empty">Your sheet returned no valid orders.</div>`;
    $('navRow').style.display='none';
    $('orderStrip').style.display='none';
    return;
  }

  updateOrderStrip();

  if(MODE === 'picker'){
    $('panelTitle').textContent = 'Picker Mode';
    $('navRow').style.display = 'flex';

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
          <button class="btn btnWide danger" id="btnSkipPick">SKIP (leave unpicked)</button>
        </div>
      </div>
    `;

    $('pickerImg').addEventListener('click', ()=> openImgModal(it));
    $('btnConfirmPick').addEventListener('click', ()=>{
      setItemPicked(o.orderId, it, true);
      render();
    });
    $('btnSkipPick').addEventListener('click', ()=>{
      if(pickIndex < pickQueue.length - 1) pickIndex++;
      else pickIndex = 0;
      render();
    });

  } else {
    $('panelTitle').textContent = 'Pack Mode';
    const {total,picked} = calcTotals(o);
    $('panelSub').textContent = `Order ${orderIndex+1}/${orders.length} · ${picked}/${total} cans picked`;
    $('navRow').style.display = 'flex';

    const rows = o.items.map(it=>{
      const done = it.picked ? 'done' : '';
      const label = it.picked ? 'PICKED' : `${it.qty} cans`;
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

    $('panelBody').innerHTML = rows || `<div class="empty">No items found for this order.</div>`;

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

/* =========================================================
   IMAGE MODAL
   ========================================================= */
function openImgModal(item){
  $('imgModalImg').src = item.imageResolved;
  $('imgModalCap').textContent = item.itemTitle;
  $('imgModal').classList.add('show');
}

$('imgModal').addEventListener('click', (e)=>{
  if(e.target.id === 'imgModal') $('imgModal').classList.remove('show');
});

/* =========================================================
   ORDER STRIP TOGGLE
   ========================================================= */
$('orderStripTop').addEventListener('click', ()=>{
  const d = $('orderStripDetail');
  const open = d.classList.toggle('show');
  $('stripCaret').textContent = open ? '▴' : '▾';
});

/* =========================================================
   HTML ESCAPE
   ========================================================= */
function escapeHtml(str){
  return (str ?? '').toString()
    .replaceAll('&','&amp;')
    .replaceAll('<','&lt;')
    .replaceAll('>','&gt;')
    .replaceAll('"','&quot;')
    .replaceAll("'","&#039;");
}
function escapeAttr(str){ return escapeHtml(str).replaceAll('"','&quot;'); }

/* =========================================================
   INIT
   ========================================================= */
async function init(){
  try{
    $('btnPicker').addEventListener('click', ()=> setMode('picker'));
    $('btnPack').addEventListener('click', ()=> setMode('pack'));

    // Start in Pack Mode (safer)
    $('btnPicker').classList.add('secondary');

    await loadImageLookup();

    const j = await fetchJson(ordersUrl);
    rawRows = rowsToObjects(j.values || []);
    orders = buildOrders(rawRows);

    applyPickedState();

    if(!orders.length){
      setError('No orders found. Confirm your Orders sheet headers + data.');
    }

    setMode('pack');
  }catch(e){
    setError(`Error loading sheet. ${e.message}`);
    $('panelTitle').textContent = 'Error';
    $('panelBody').innerHTML = `<div class="empty">Could not load data.</div>`;
  }
}

init();
