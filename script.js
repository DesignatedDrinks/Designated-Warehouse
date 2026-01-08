// script.js
// =========================================================
// CONFIG
// =========================================================
const sheetId   = '1xE9SueE6rdDapXr0l8OtP_IryFM-Z6fHFH27_cQ120g';
const ordersSheetName = 'Orders';
const lookupSheetName = 'ImageLookup';

const varietySheetId   = '1TtRNmjsgC64jbkptnCdklBf_HqifwE9SQO2JlGrp4Us';
const varietySheetName = 'Variety Packs';

const apiKey    = 'AIzaSyA7sSHMaY7sSHMaY7i-uxxynKewHLsHxP_dd3TZ4U'
  .replace('AIzaSyA7sSHMaY7sSHMaY7','AIzaSyA7sSHMaY7');

const ordersUrl =
  `https://sheets.googleapis.com/v4/spreadsheets/${sheetId}/values/${encodeURIComponent(ordersSheetName)}?alt=json&key=${apiKey}`;

const lookupUrl =
  `https://sheets.googleapis.com/v4/spreadsheets/${sheetId}/values/${encodeURIComponent(lookupSheetName)}?alt=json&key=${apiKey}`;

const varietyUrl =
  `https://sheets.googleapis.com/v4/spreadsheets/${varietySheetId}/values/${encodeURIComponent(varietySheetName)}?alt=json&key=${apiKey}`;

const $ = (id) => document.getElementById(id);

let orders = [];
let orderIndex = 0;

let queue = [];
let queueIndex = 0;

let undoStack = [];
const STORAGE_KEY = 'dw_picked_queue_v1';

let VARIETY_PACK_MAP = new Map();

// ✅ tap lock (prevents double pick from rapid/ghost taps)
let PICK_LOCKED = false;
let LAST_PICK_TS = 0;
const PICK_LOCK_MS = 350;

// =========================================================
// UTILS
// =========================================================
function safe(v){ return (v ?? '').toString().trim(); }

function canLabel(n){
  const x = Math.abs(parseInt(n, 10) || 0);
  return x === 1 ? 'can' : 'cans';
}

function setError(msg){
  const box = $('errBox');
  if(!box) return;
  box.innerHTML = msg ? `<div class="error">${msg}</div>` : '';
}

function normalizeText(s){
  return safe(s).toLowerCase().replace(/[^a-z0-9]+/g,' ').replace(/\s+/g,' ').trim();
}

function itemKeyByTitle(itemTitle){ return normalizeText(itemTitle); }

function toIntQty(x){
  const n = parseInt(safe(x).replace(/[^\d-]/g,''), 10);
  return Number.isFinite(n) ? n : 0;
}

function parseBool(x){
  const v = safe(x).toLowerCase();
  return v === 'true' || v === '1' || v === 'yes';
}

function escapeHtml(str){
  return (str ?? '').toString()
    .replaceAll('&','&amp;')
    .replaceAll('<','&lt;')
    .replaceAll('>','&gt;')
    .replaceAll('"','&quot;')
    .replaceAll("'","&#039;");
}

function formatCustomerNameHTML(full){
  const n = safe(full);
  if(!n) return '—';
  const parts = n.split(/\s+/).filter(Boolean);
  if(parts.length < 2) return escapeHtml(n);
  const last = parts.pop();
  return `${escapeHtml(parts.join(' '))} <strong>${escapeHtml(last)}</strong>`;
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
  const text = await res.text();
  if(!res.ok){
    throw new Error(`Fetch failed: ${res.status}\n${text}`);
  }
  try { return JSON.parse(text); }
  catch { throw new Error(`Invalid JSON from Sheets API:\n${text.slice(0,500)}`); }
}

// =========================================================
// PACK SIZE PARSING
// =========================================================
function parsePackSize(itemTitle, variantTitle){
  const s = `${safe(itemTitle)} ${safe(variantTitle)}`.toLowerCase();

  if(/\bsingle\b/.test(s) || /\bcan\b/.test(s) || /\b1 pack\b/.test(s)) return 1;

  const m1 = s.match(/(\d+)\s*[- ]?\s*(pack|pk)\b/);
  if(m1) return clampPack(parseInt(m1[1], 10));

  const m2 = s.match(/\b(\d+)\s*x\s*\d+/);
  if(m2) return clampPack(parseInt(m2[1], 10));

  const m3 = s.match(/\bcase\s*\(\s*(\d+)\s*x/i);
  if(m3) return clampPack(parseInt(m3[1], 10));

  const m4 = safe(variantTitle).trim().match(/^(\d{1,3})$/);
  if(m4) return clampPack(parseInt(m4[1], 10));

  return 1;
}
function clampPack(n){
  if(!Number.isFinite(n) || n <= 0) return 1;
  if(n > 60) return 1;
  return n;
}
function formatSourceBreakdown(sources){
  const map = new Map();
  for(const src of sources){
    const p = src.packSize || 1;
    map.set(p, (map.get(p) || 0) + (src.units || 0));
  }
  const parts = Array.from(map.entries())
    .sort((a,b)=> b[0] - a[0])
    .map(([pack, units]) => `${units}×${pack}`);
  return parts.join(' + ');
}

// =========================================================
// LOCATION SORTING
// =========================================================
function parseLocCode(locCode){
  const s = safe(locCode).toUpperCase();
  if(!s) return null;

  let m = s.match(/^B-([NS])-(\d{1,2})$/);
  if(m){
    const side = m[1];
    const n = parseInt(m[2],10);
    if(!Number.isFinite(n)) return null;
    const sideOrder = (side === 'N') ? 0 : 1;
    return { zone:'B', idx:n, side, sortKey: [1, n, sideOrder] };
  }

  m = s.match(/^A-(\d{1,2})$/);
  if(m){
    const n = parseInt(m[1],10);
    if(!Number.isFinite(n)) return null;
    return { zone:'A', idx:n, side:'', sortKey: [2, -n, 0] };
  }

  return { zone:'?', idx:999, side:'', sortKey: [99, 999, 0] };
}
function locLabel(locCode){
  const s = safe(locCode);
  return s || '—';
}

// =========================================================
// PARSE SHEET HELPERS
// =========================================================
function buildHeaderMap(headerRow){
  const map = {};
  (headerRow || []).forEach((h, idx)=> map[normalizeText(h)] = idx);
  return map;
}

function pickHeader(hmap, candidates){
  for(const c of candidates){
    const k = normalizeText(c);
    if(k in hmap) return hmap[k];
  }
  return null;
}

function mustHaveHeadersOrders(hmap){
  const req = ['orderid','itemtitle','qty'];
  const missing = req.filter(k => !(k in hmap));
  if(missing.length) throw new Error(`Orders sheet missing required headers: ${missing.join(', ')}`);
}

// =========================================================
// VARIETY PACK EXPANSION
// =========================================================
function stripVendorPrefix(title){
  const t = safe(title);
  const m = t.match(/^\s*.*?\)\s*(.+)$/);
  return m ? safe(m[1]) : t;
}

function normalizePackTitle(title){
  let t = safe(title);
  t = stripVendorPrefix(t);
  t = t.replace(/[–—]/g, '-');
  t = t.replace(/(\b\d+\s*pack\b)\s*-\s*\1\b\s*$/i, '$1');
  t = t.replace(/\s*-\s*\d+\s*pack\b\s*$/i, '');
  return normalizeText(t);
}

function buildVarietyPackMap(values){
  const out = new Map();
  if(!values || values.length < 2) return out;

  const hmap = buildHeaderMap(values[0]);
  const colPack = pickHeader(hmap, ['variety pack name','varietypackname','pack name','pack']);
  const colBeer = pickHeader(hmap, ['beer name','beername','item','title','product']);
  const colQty  = pickHeader(hmap, ['qtyperpackitem','qty per pack item','qty','quantity','per pack qty','perpack']);

  if(colPack == null || colBeer == null){
    console.warn('Variety Packs: required headers not found. No expansion will occur.');
    return out;
  }

  for(const row of values.slice(1)){
    const packTitleRaw = safe(row[colPack] ?? '');
    const beerTitle = safe(row[colBeer] ?? '');
    if(!packTitleRaw || !beerTitle) continue;

    let qty = 1;
    if(colQty != null){
      const q = toIntQty(row[colQty]);
      qty = Number.isFinite(q) && q > 0 ? q : 1;
    }

    const keyPack = normalizePackTitle(packTitleRaw);
    const record = out.get(keyPack) || { packTitle: packTitleRaw, components: [] };
    record.packTitle = record.packTitle || packTitleRaw;
    record.components.push({ title: beerTitle, qty });
    out.set(keyPack, record);
  }

  return out;
}

function findVarietyPackRule(itemTitle){
  return VARIETY_PACK_MAP.get(normalizePackTitle(itemTitle)) || null;
}

function expandVarietyPackRow(r){
  const rule = findVarietyPackRule(r.itemTitle);
  if(!rule) return [r];

  const out = [];
  const packCount = Math.max(1, r.units || 1);

  for(const c of (rule.components || [])){
    const perPack = Math.max(1, toIntQty(c.qty));
    const qtyUnits = perPack * packCount;
    if(qtyUnits <= 0) continue;

    out.push({
      ...r,
      itemTitle: c.title,
      variantTitle: 'Single',
      units: qtyUnits,
      packSize: 1,
      cans: qtyUnits,
    });
  }

  return out.length ? out : [r];
}

// =========================================================
// ORDERS ROW PARSING
// =========================================================
function rowToOrderObj(row, hmap){
  const idxOrderId = pickHeader(hmap, ['orderid','order id','id']);
  const idxCust    = pickHeader(hmap, ['customername','customer name','customer']);
  const idxAddr    = pickHeader(hmap, ['address','shipping address','ship address']);
  const idxItem    = pickHeader(hmap, ['itemtitle','item title','title','product']);
  const idxVar     = pickHeader(hmap, ['varianttitle','variant title','variant']);
  const idxQty     = pickHeader(hmap, ['qty','quantity','q']);
  const idxPicked  = pickHeader(hmap, ['picked','is picked']);
  const idxNotes   = pickHeader(hmap, ['notes','note']);
  const idxImg     = pickHeader(hmap, ['imageurl','image url','img']);

  const itemTitle = safe(row[idxItem] ?? '');
  const variantTitle = safe(row[idxVar] ?? '');
  const units = toIntQty(row[idxQty] ?? '');
  const packSize = parsePackSize(itemTitle, variantTitle);
  const cans = units * packSize;

  const r = {
    orderId: safe(row[idxOrderId] ?? ''),
    customerName: safe(row[idxCust] ?? ''),
    address: safe(row[idxAddr] ?? ''),
    itemTitle,
    variantTitle,
    units,
    packSize,
    cans,
    picked: parseBool(row[idxPicked] ?? ''),
    notes: safe(row[idxNotes] ?? ''),
    imageUrl: safe(row[idxImg] ?? ''),
  };

  if(!r.orderId && !r.itemTitle && !r.customerName) return null;
  if(normalizeText(r.itemTitle) === 'itemtitle') return null;
  return r;
}

function buildLookupMap(values){
  if(!values || values.length < 2) return new Map();

  const hmap = buildHeaderMap(values[0]);
  const idxTitle = pickHeader(hmap, ['itemtitle','item title','title','product']);
  const idxImg   = pickHeader(hmap, ['imageurl','image url','img','beer image url']);
  const idxLoc   = pickHeader(hmap, ['loccode','loc code','location','bin','aisle']);

  if(idxTitle == null){
    throw new Error('ImageLookup sheet missing required header: itemTitle');
  }

  const out = new Map();
  for(const row of values.slice(1)){
    const itemTitle = safe(row[idxTitle] ?? '');
    if(!itemTitle) continue;

    const key = itemKeyByTitle(itemTitle);
    const imageUrl = idxImg != null ? safe(row[idxImg] ?? '') : '';
    const locCode  = idxLoc != null ? safe(row[idxLoc] ?? '') : '';

    out.set(key, { imageUrl, locCode, rawTitle: itemTitle });
  }
  return out;
}

// =========================================================
// PICKED STATE (LOCAL)
// =========================================================
function loadPicked(){
  try { return JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}'); }
  catch { return {}; }
}
function savePicked(obj){ localStorage.setItem(STORAGE_KEY, JSON.stringify(obj)); }
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
  const out = { b24:0, b12:0, b6:0 };

  out.b24 = Math.floor(n / 24);
  n = n % 24;

  if(n === 0) return out;

  if(n <= 6){ out.b6 = 1; return out; }
  if(n <= 12){ out.b12 = 1; return out; }

  out.b24 += 1;
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
// BUILD ORDERS
// =========================================================
function buildOrders(rows, lookupMap){
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

    for(const r0 of o.itemsRaw){
      const expandedRows = expandVarietyPackRow(r0);

      for(const r of expandedRows){
        if(!r.itemTitle) continue;
        if(r.cans <= 0) continue;

        const k = itemKeyByTitle(r.itemTitle);
        const lu = lookupMap.get(k);

        if(!merged.has(k)){
          const loc = lu?.locCode ? parseLocCode(lu.locCode) : null;

          const imgCandidate = lu?.imageUrl || r.imageUrl;
          const imgResolved = resolveImage(imgCandidate, r.itemTitle);

          merged.set(k, {
            key: k,
            itemTitle: r.itemTitle,
            qtyCans: 0,
            locCode: lu?.locCode || '',
            locSort: loc?.sortKey || [99,999,0],
            imageResolved: imgResolved,
            sources: []
          });
        }

        const item = merged.get(k);

        const candidate = (lookupMap.get(k)?.imageUrl || r.imageUrl || '');
        if(item.imageResolved.startsWith('data:image') && safe(candidate).startsWith('http')){
          item.imageResolved = candidate;
        }

        item.qtyCans += r.cans;
        item.sources.push({ units: r.units, packSize: r.packSize, cans: r.cans });
      }
    }

    const items = Array.from(merged.values()).sort((a,b)=>{
      const as = a.locSort, bs = b.locSort;
      for(let i=0;i<Math.max(as.length, bs.length);i++){
        const av = as[i] ?? 0;
        const bv = bs[i] ?? 0;
        if(av !== bv) return av - bv;
      }
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
  const total = o.items.reduce((s,it)=> s + it.qtyCans, 0);
  const picked = o.items.reduce((s,it)=> s + (isPicked(o.orderId, it.key) ? it.qtyCans : 0), 0);
  return { total, picked };
}

function setOrderBar(){
  const o = currentOrder();
  const card = $('orderCard');
  if(!card) return;

  if(!o){ card.style.display='none'; return; }
  card.style.display='block';

  const { total, picked } = totalsForOrder(o);
  const pct = total ? Math.round((picked/total)*100) : 0;

  $('whoLine').innerHTML = `${formatCustomerNameHTML(o.customerName)} · ${escapeHtml(cityProvince(o.address))}`;
  $('addrLine').textContent = safe(o.address) || '—';
  $('chipOrder').textContent = `#${o.orderId}`;
  $('chipBoxes').textContent = `Boxes: ${boxLabel(total)}`;
  $('chipProgress').textContent = `${pct}%`;

  // ✅ BIG totals
  $('bigPicked').textContent = `${picked}`;
  $('bigPickedUnit').textContent = canLabel(picked);
  $('bigTotal').textContent = `${total}`;
  $('bigTotalUnit').textContent = canLabel(total);

  // ✅ also update small progress line (now bigger in CSS)
  $('progressFill').style.width = `${pct}%`;
  $('progressLeft').textContent = `${picked} ${canLabel(picked)} picked`;
  $('progressRight').textContent = `${total} ${canLabel(total)} total`;
}

function renderList(){
  const o = currentOrder();
  const body = $('listBody');
  if(!body) return;

  if(!o){ body.innerHTML=''; return; }

  body.innerHTML = o.items.map((it)=>{
    const done = isPicked(o.orderId, it.key);
    const src = it.sources?.length ? ` · ${escapeHtml(formatSourceBreakdown(it.sources))}` : '';
    const loc = it.locCode ? ` · <strong>${escapeHtml(locLabel(it.locCode))}</strong>` : '';
    return `
      <div class="listRow ${done ? 'done' : ''}" data-key="${it.key}">
        <div>
          <div class="lTitle">${escapeHtml(it.itemTitle)}</div>
          <div class="lSub">${loc}${src}</div>
        </div>
        <div class="lQty">${it.qtyCans}</div>
      </div>
    `;
  }).join('');

  // ✅ list click does NOT pick. It only jumps.
  body.querySelectorAll('.listRow').forEach(row=>{
    row.addEventListener('click', ()=>{
      const k = row.getAttribute('data-key');
      const pos = queue.findIndex(q => q.key === k);
      if(pos >= 0){ queueIndex = pos; renderAll(); }
    });
  });
}

function setNextCard(item, qtyId, aisleId, imgId){
  const q = $(qtyId), a = $(aisleId), im = $(imgId);
  if(!q || !a || !im) return;

  if(!item){
    q.textContent = '—';
    a.textContent = '—';
    im.src = placeholderSvg('—');
    return;
  }
  q.textContent = `${item.qtyCans}`;
  a.textContent = item.locCode ? locLabel(item.locCode) : '—';
  im.src = item.imageResolved;
}

function setQtyMode(mode, numberText){
  const num = $('curQtyNumber');
  const unit = $('curQtyUnit');
  const done = $('curQtyDone');
  if(!num || !done || !unit) return;

  if(mode === 'done'){
    num.style.display = 'none';
    unit.style.display = 'none';
    done.style.display = 'grid';
  }else{
    done.style.display = 'none';
    num.style.display = 'block';
    unit.style.display = 'block';
    num.textContent = numberText ?? '—';

    const n = parseInt(numberText, 10);
    unit.textContent = canLabel(n);
  }
}

function renderCurrent(){
  const o = currentOrder();
  const pickBtn = $('btnPickNext');

  if(!o){
    if(pickBtn) pickBtn.style.visibility = 'visible';
    $('curTitle').textContent = 'No orders found';
    $('curSub').textContent = '';
    setQtyMode('qty', '—');
    $('curImg').src = placeholderSvg('No orders');
    setNextCard(null,'n1Qty','n1Aisle','n1Img');
    setNextCard(null,'n2Qty','n2Aisle','n2Img');
    return;
  }

  rebuildQueue();
  setOrderBar();
  renderList();

  const cur = queue[queueIndex];

  if(!cur){
    if(pickBtn) pickBtn.style.visibility = 'hidden';

    $('curTitle').textContent = 'ORDER PICKED';
    $('curSub').innerHTML = `<span class="badge">Grab boxes: ${escapeHtml(boxLabel(totalsForOrder(o).total))}</span>`;
    $('curImg').src = './done.svg';

    setQtyMode('done');
    setNextCard(null,'n1Qty','n1Aisle','n1Img');
    setNextCard(null,'n2Qty','n2Aisle','n2Img');
    return;
  }

  if(pickBtn) pickBtn.style.visibility = 'visible';

  $('curTitle').textContent = cur.itemTitle;

  const srcText = cur.sources?.length ? formatSourceBreakdown(cur.sources) : '';
  const locText = cur.locCode ? locLabel(cur.locCode) : '—';

  $('curSub').innerHTML =
    `<span class="badge">${escapeHtml(locText)}</span>` +
    (srcText ? `<span class="badge">${escapeHtml(srcText)}</span>` : '');

  setQtyMode('qty', cur.qtyCans);
  $('curImg').src = cur.imageResolved;

  setNextCard(queue[queueIndex+1], 'n1Qty','n1Aisle','n1Img');
  setNextCard(queue[queueIndex+2], 'n2Qty','n2Aisle','n2Img');
}

function renderAll(){
  setError('');
  renderCurrent();
}

// =========================================================
// ACTIONS (ONLY Pick button advances)
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

  renderAll();
}

// ✅ tap-safe wrapper: prevents double picks from ghost taps / rapid taps
function guardedPick(){
  const now = Date.now();
  if(PICK_LOCKED) return;
  if(now - LAST_PICK_TS < PICK_LOCK_MS) return;

  PICK_LOCKED = true;
  LAST_PICK_TS = now;

  const btn = $('btnPickNext');
  if(btn) btn.disabled = true;

  try{ pickCurrent(); }
  finally{
    setTimeout(()=>{
      PICK_LOCKED = false;
      if(btn) btn.disabled = false;
    }, PICK_LOCK_MS);
  }
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

function resetThisOrder(){
  const o = currentOrder();
  if(!o) return;

  const { total, picked } = totalsForOrder(o);
  const ok = confirm(
    `Reset picked progress for Order #${o.orderId}?\n\nCustomer: ${o.customerName}\nPicked: ${picked}/${total}\n\nThis clears picked status on this device only (does not change the sheet).`
  );
  if(!ok) return;

  const p = loadPicked();
  delete p[o.orderId];
  savePicked(p);

  undoStack = [];
  queueIndex = 0;

  renderAll();
  try { window.scrollTo({ top: 0, behavior: 'smooth' }); } catch {}
}

// =========================================================
// INIT
// =========================================================
async function init(){
  try{
    $('btnSkip')?.addEventListener('click', skipCurrent);
    $('btnUndo')?.addEventListener('click', undoLast);
    $('btnPrevOrder')?.addEventListener('click', prevOrder);
    $('btnNextOrder')?.addEventListener('click', nextOrder);
    $('btnResetOrder')?.addEventListener('click', resetThisOrder);

    // ✅ ONLY PICK BUTTON advances (no other tap advances anything)
    $('btnPickNext')?.addEventListener('click', guardedPick);

    // ✅ Load all 3 sheets
    const [ordersJson, lookupJson, varietyJson] = await Promise.all([
      fetchJson(ordersUrl),
      fetchJson(lookupUrl),
      fetchJson(varietyUrl),
    ]);

    const ordersValues = ordersJson.values || [];
    if(ordersValues.length < 2) throw new Error('Orders sheet has no data.');

    const lookupValues = lookupJson.values || [];
    if(lookupValues.length < 2) console.warn('ImageLookup sheet has no data (continuing).');

    const varietyValues = varietyJson.values || [];
    if(varietyValues.length >= 2){
      VARIETY_PACK_MAP = buildVarietyPackMap(varietyValues);
      console.log('Variety packs loaded:', VARIETY_PACK_MAP.size);
    }else{
      VARIETY_PACK_MAP = new Map();
      console.warn('Variety Packs sheet has no data (continuing without expansion).');
    }

    const lookupMap = (lookupValues.length >= 2) ? buildLookupMap(lookupValues) : new Map();

    const hmap = buildHeaderMap(ordersValues[0]);
    mustHaveHeadersOrders(hmap);

    const rows = ordersValues.slice(1).map(r => rowToOrderObj(r, hmap)).filter(Boolean);
    orders = buildOrders(rows, lookupMap);

    if(!orders.length){
      setError('No valid orders built. Check orderId + itemTitle + qty columns.');
    }

    renderAll();
  }catch(e){
    setError(e.message);
    $('curTitle').textContent = 'Error';
    $('curSub').textContent = 'Fix the sheet and reload.';
    setQtyMode('qty','—');
    $('curImg').src = placeholderSvg('Error');
    setNextCard(null,'n1Qty','n1Aisle','n1Img');
    setNextCard(null,'n2Qty','n2Aisle','n2Img');
  }
}

init();
