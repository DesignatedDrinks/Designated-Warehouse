// =========================================================
// CONFIG
// =========================================================
const sheetId   = '1xE9SueE6rdDapXr0l8OtP_IryFM-Z6fHFH27_cQ120g';
const sheetName = 'Orders';
const apiKey    = 'AIzaSyA7sSHMaY7i-uxxynKewHLsHxP_dd3TZ4U';

const ordersUrl =
  `https://sheets.googleapis.com/v4/spreadsheets/${sheetId}/values/${encodeURIComponent(sheetName)}?alt=json&key=${apiKey}`;

const $ = id => document.getElementById(id);

let orders = [];
let orderIndex = 0;

// queue = unpicked items in aisle order
let queue = [];
let queueIndex = 0;

// Undo stack: { orderId, key, prevValue, prevQueueIndex }
let undoStack = [];

const STORAGE_KEY = 'dw_picked_queue_v1';

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
function itemKey(itemTitle, variantTitle){
  return normalizeText(itemTitle) + '|' + normalizeText(variantTitle);
}

function toIntQty(x){
  const n = parseInt(safe(x).replace(/[^\d-]/g,''), 10);
  return Number.isFinite(n) ? n : 0;
}
function parseBool(x){
  const v = safe(x).toLowerCase();
  return v === 'true' || v === '1' || v === 'yes';
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

function placeholderSvg(title){
  const t = safe(title).slice(0,28);
  return `data:image/svg+xml;charset=utf-8,` + encodeURIComponent(`
    <svg xmlns="http://www.w3.org/2000/svg" width="320" height="320">
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

async function fetchJson(url){
  const res = await fetch(url);
  if(!res.ok) throw new Error(`Fetch failed: ${res.status}`);
  return res.json();
}

// =========================================================
// AISLE PATH (PLACEHOLDER)
// Replace this with your real map when ready.
// =========================================================
function guessAisle(title){
  const t = safe(title).toUpperCase();
  const ch = (t.match(/[A-Z]/) || ['?'])[0];
  if(ch >= 'A' && ch <= 'H') return { aisle:'Aisle 1', sort:1 };
  if(ch >= 'I' && ch <= 'Q') return { aisle:'Aisle 2', sort:2 };
  if(ch >= 'R' && ch <= 'Z') return { aisle:'Aisle 3', sort:3 };
  return { aisle:'Aisle ?', sort:99 };
}

// =========================================================
// PICKED STATE (LOCAL ONLY)
// =========================================================
function loadPicked(){
  try { return JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}'); }
  catch { return {}; }
}
function savePicked(obj){
  localStorage.setItem(STORAGE_KEY, JSON.stringify(obj));
}
function isPicked(orderId, key){
  const p = loadPicked();
  return !!(p[orderId] && p[orderId][key]);
}
function setPicked(orderId, key, val){
  const p = loadPicked();
  if(!p[orderId]) p[orderId] = {};
  p[orderId][key] = !!val;
  savePicked(p);
}

// =========================================================
// BOX BREAKDOWN (24 / 12 / 6)
// =========================================================
function boxBreakdown(totalCans){
  let n = Math.max(0, totalCans|0);
  const out = { b24:0, b12:0, b6:0, loose:0 };

  out.b24 = Math.floor(n / 24);
  n = n % 24;

  if(n === 0) return out;
  if(n <= 6){ out.b6 = 1; out.loose = n; return out; }
  if(n <= 12){ out.b12 = 1; out.loose = n; return out; }
  out.b24 += 1;
  out.loose = n;
  return out;
}
function boxLabel(totalCans){
  const b = boxBreakdown(totalCans);
  const parts = [];
  if(b.b24) parts.push(`${b.b24}×24`);
  if(b.b12) parts.push(`${b.b12}×12`);
  if(b.b6)  parts.push(`${b.b6}×6`);
  if(!parts.length) parts.push('0');
  return parts.join(' + ');
}

// =========================================================
// PARSE SHEET
// =========================================================
function buildHeaderMap(headerRow){
  const map = {};
  headerRow.forEach((h, idx)=> map[normalizeText(h)] = idx);
  return map;
}
function mustHaveHeaders(hmap){
  const required = ['orderid','customername','address','itemtitle','varianttitle','qty','picked','notes','imageurl'];
  const missing = required.filter(k => !(k in hmap));
  if(missing.length) throw new Error(`Sheet headers missing: ${missing.join(', ')}`);
}
function rowToObj(row, hmap){
  const get = key => row[hmap[key]] ?? '';
  const r = {
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
  if(!r.orderId && !r.itemTitle && !r.customerName) return null;
  if(normalizeText(r.itemTitle) === 'itemtitle') return null;
  return r;
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

      const k = itemKey(r.itemTitle, r.variantTitle);
      if(!merged.has(k)){
        const aisle = guessAisle(r.itemTitle);
        merged.set(k, {
          key: k,
          itemTitle: r.itemTitle,
          variantTitle: r.variantTitle,
          qty: 0,
          aisle: aisle.aisle,
          aisleSort: aisle.sort,
          imageResolved: resolveImage(r.imageUrl, r.itemTitle)
        });
      }
      merged.get(k).qty += r.qty;
    }

    const items = Array.from(merged.values()).sort((a,b)=>{
      if(a.aisleSort !== b.aisleSort) return a.aisleSort - b.aisleSort;
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

  // latest first (string compare; fine for Shopify-like numbers)
  out.sort((a,b)=> (a.orderId > b.orderId ? -1 : 1));
  return out;
}

// =========================================================
// QUEUE + RENDER
// =========================================================
function currentOrder(){ return orders[orderIndex]; }

function rebuildQueue(){
  const o = currentOrder();
  if(!o) { queue=[]; queueIndex=0; return; }

  queue = o.items.filter(it => !isPicked(o.orderId, it.key));
  if(queueIndex < 0) queueIndex = 0;
  if(queueIndex > queue.length - 1) queueIndex = Math.max(0, queue.length - 1);
}

function totalsForOrder(o){
  const total = o.items.reduce((s,it)=> s + it.qty, 0);
  const picked = o.items.reduce((s,it)=> s + (isPicked(o.orderId, it.key) ? it.qty : 0), 0);
  return { total, picked };
}

function setOrderBar(){
  const o = currentOrder();
  if(!o){ $('orderCard').style.display='none'; return; }
  $('orderCard').style.display='block';

  const { total, picked } = totalsForOrder(o);
  const pct = total ? Math.round((picked/total)*100) : 0;

  $('whoLine').textContent = `${firstNameInitial(o.customerName)} · ${cityProvince(o.address)}`;
  $('addrLine').textContent = safe(o.address) || '—';
  $('chipOrder').textContent = `##${o.orderId}`;
  $('chipBoxes').textContent = `Boxes: ${boxLabel(total)}`;
  $('chipProgress').textContent = `${pct}%`;

  $('progressFill').style.width = `${pct}%`;
  $('progressLeft').textContent = `${picked} picked`;
  $('progressRight').textContent = `${total} total`;
}

function escapeHtml(str){
  return (str ?? '').toString()
    .replaceAll('&','&amp;')
    .replaceAll('<','&lt;')
    .replaceAll('>','&gt;')
    .replaceAll('"','&quot;')
    .replaceAll("'","&#039;");
}

function renderList(){
  const o = currentOrder();
  if(!o) { $('listBody').innerHTML=''; return; }

  $('listBody').innerHTML = o.items.map((it)=>{
    const done = isPicked(o.orderId, it.key);
    return `
      <div class="listRow ${done ? 'done' : ''}" data-key="${it.key}">
        <div>
          <div class="lTitle">${escapeHtml(it.itemTitle)}</div>
          <div class="lSub">${escapeHtml(it.aisle)}${it.variantTitle ? ' · ' + escapeHtml(it.variantTitle) : ''}</div>
        </div>
        <div class="lQty">${it.qty}</div>
      </div>
    `;
  }).join('');

  $('listBody').querySelectorAll('.listRow').forEach(row=>{
    row.addEventListener('click', ()=>{
      const k = row.getAttribute('data-key');
      const pos = queue.findIndex(q => q.key === k);
      if(pos >= 0){ queueIndex = pos; renderAll(); }
    });
  });
}

function setNextCard(item, titleId, qtyId, aisleId, imgId){
  if(!item){
    $(titleId).textContent = '—';
    $(qtyId).textContent = '—';
    $(aisleId).textContent = '—';
    $(imgId).src = placeholderSvg('—');
    return;
  }
  $(titleId).textContent = item.itemTitle;
  $(qtyId).textContent = item.qty;
  $(aisleId).textContent = item.aisle;
  $(imgId).src = item.imageResolved;
}

function renderCurrent(){
  const o = currentOrder();
  if(!o){
    $('curTitle').textContent = 'No orders found';
    $('curSub').innerHTML = '';
    $('curQty').textContent = '—';
    $('curImg').src = placeholderSvg('No orders');
    setNextCard(null,'n1Title','n1Qty','n1Aisle','n1Img');
    setNextCard(null,'n2Title','n2Qty','n2Aisle','n2Img');
    return;
  }

  rebuildQueue();
  setOrderBar();
  renderList();

  const cur = queue[queueIndex];

  // DONE
  if(!cur){
    $('curTitle').textContent = 'DONE — order picked';
    $('curSub').innerHTML = `<span class="badge">Grab boxes: ${escapeHtml(boxLabel(totalsForOrder(o).total))}</span>`;
    $('curQty').textContent = '✔';
    $('curImg').src = placeholderSvg('DONE');
    setNextCard(null,'n1Title','n1Qty','n1Aisle','n1Img');
    setNextCard(null,'n2Title','n2Qty','n2Aisle','n2Img');
    return;
  }

  $('curTitle').textContent = cur.itemTitle;
  $('curSub').innerHTML =
    `<span class="badge">${escapeHtml(cur.aisle)}</span>` +
    (cur.variantTitle ? `<span class="badge">${escapeHtml(cur.variantTitle)}</span>` : '');

  $('curQty').textContent = cur.qty;
  $('curImg').src = cur.imageResolved;

  setNextCard(queue[queueIndex+1], 'n1Title','n1Qty','n1Aisle','n1Img');
  setNextCard(queue[queueIndex+2], 'n2Title','n2Qty','n2Aisle','n2Img');
}

function renderAll(){
  setError('');
  renderCurrent();
}

// =========================================================
// ACTIONS (ONE TAP PICK, AUTO ADVANCE)
// =========================================================
function pickCurrent(){
  const o = currentOrder();
  if(!o) return;
  rebuildQueue();
  const cur = queue[queueIndex];
  if(!cur) return;

  const prev = isPicked(o.orderId, cur.key);
  const prevIndex = queueIndex;

  setPicked(o.orderId, cur.key, true);
  undoStack.push({ orderId:o.orderId, key:cur.key, prevValue:prev, prevQueueIndex:prevIndex });

  // auto-advance (queue shrinks; same index becomes next)
  renderAll();
}

function skipCurrent(){
  rebuildQueue();
  if(queue.length === 0) return;
  queueIndex = Math.min(queueIndex + 1, queue.length - 1);
  renderAll();
}

function undoLast(){
  const u = undoStack.pop();
  if(!u) return;

  setPicked(u.orderId, u.key, u.prevValue);

  const o = currentOrder();
  if(o && o.orderId === u.orderId){
    rebuildQueue();
    const pos = queue.findIndex(q => q.key === u.key);
    queueIndex = pos >= 0 ? pos : Math.min(u.prevQueueIndex, Math.max(0, queue.length - 1));
  }

  renderAll();
}

function jumpNext(offset){
  rebuildQueue();
  const target = queueIndex + offset;
  if(target >= 0 && target <= queue.length - 1){
    queueIndex = target;
    renderAll();
  }
}

function prevOrder(){
  if(orderIndex > 0){
    orderIndex--;
    queueIndex = 0;
    undoStack = [];
    renderAll();
  }
}
function nextOrder(){
  if(orderIndex < orders.length - 1){
    orderIndex++;
    queueIndex = 0;
    undoStack = [];
    renderAll();
  }
}

// =========================================================
// INIT
// =========================================================
async function init(){
  try{
    // Buttons
    $('btnPicked').addEventListener('click', pickCurrent);
    $('btnSkip').addEventListener('click', skipCurrent);
    $('btnUndo').addEventListener('click', undoLast);
    $('btnPrevOrder').addEventListener('click', prevOrder);
    $('btnNextOrder').addEventListener('click', nextOrder);

    // Tap next cards to jump (optional)
    $('next1').addEventListener('click', ()=> jumpNext(1));
    $('next2').addEventListener('click', ()=> jumpNext(2));

    const j = await fetchJson(ordersUrl);
    const values = j.values || [];
    if(values.length < 2) throw new Error('Orders sheet has no data.');

    const hmap = buildHeaderMap(values[0]);
    mustHaveHeaders(hmap);

    const rows = values.slice(1).map(r => rowToObj(r, hmap)).filter(Boolean);
    orders = buildOrders(rows);

    if(!orders.length){
      setError('No valid orders built. Check orderid + itemTitle + qty columns.');
    }

    renderAll();
  }catch(e){
    setError(e.message);
    $('curTitle').textContent = 'Error';
    $('curSub').textContent = 'Fix the sheet and reload.';
    $('curQty').textContent = '—';
    $('curImg').src = placeholderSvg('Error');
    setNextCard(null,'n1Title','n1Qty','n1Aisle','n1Img');
    setNextCard(null,'n2Title','n2Qty','n2Aisle','n2Img');
  }
}

init();
