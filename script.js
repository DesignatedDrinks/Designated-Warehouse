// =========================================================
// CONFIG
// =========================================================
const sheetId   = '1xE9SueE6rdDapXr0l8OtP_IryFM-Z6fHFH27_cQ120g';
const ordersSheetName = 'Orders';
const lookupSheetName = 'ImageLookup';

// IMPORTANT:
// This must match the TAB NAME at the bottom of the spreadsheet.
// If your tab is literally named "Variety Packs" keep it exactly like this.
// If it is "VarietyPacks" (no space) change it to that.
const varietySheetName = 'Variety Packs';

const apiKey    = 'AIzaSyA7sSHMaY7sSHMaY7i-uxxynKewHLsHxP_dd3TZ4U'
  .replace('AIzaSyA7sSHMaY7sSHMaY7','AIzaSyA7sSHMaY7'); // defensive copy/paste glitch guard

const ordersUrl =
  `https://sheets.googleapis.com/v4/spreadsheets/${sheetId}/values/${encodeURIComponent(ordersSheetName)}?alt=json&key=${apiKey}`;

const lookupUrl =
  `https://sheets.googleapis.com/v4/spreadsheets/${sheetId}/values/${encodeURIComponent(lookupSheetName)}?alt=json&key=${apiKey}`;

const varietyUrl =
  `https://sheets.googleapis.com/v4/spreadsheets/${sheetId}/values/${encodeURIComponent(varietySheetName)}?alt=json&key=${apiKey}`;

const $ = (id) => document.getElementById(id);

let orders = [];
let orderIndex = 0;

let queue = [];
let queueIndex = 0;

let undoStack = [];
const STORAGE_KEY = 'dw_picked_queue_v1';

// Holds variety pack rules loaded from the sheet
let VARIETY_MAP = new Map(); // key: normalized pack title, value: [{title, imageUrl, qtyPerPack}...]

// =========================================================
// UTILS
// =========================================================
function safe(v){ return (v ?? '').toString().trim(); }

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

// Stop iOS double-tap zoom / focus behavior on rapid taps
function killTapWeirdness(e){
  if(!e) return;
  try { e.preventDefault(); } catch {}
  try { e.stopPropagation(); } catch {}
  const el = e.currentTarget;
  if(el && el.blur) try { el.blur(); } catch {}
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
// PACK SIZE PARSING (packs -> cans)
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
// LOCATION (locCode) SORTING — FINAL RULES
// 1) Aisle B zipper FIRST: B-N-01, B-S-01, B-N-02, B-S-02 ...
// 2) Aisle A SECOND: A-11 → A-01 (descending)
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
// VARIETY PACKS (AUTO-LOADED FROM SHEET: "Variety Packs")
// =========================================================
function mustHaveHeadersVariety(hmap){
  const required = ['variety pack name','beer name','beer image url','qtyperpackitem'];
  const missing = required.filter(k => !(k in hmap));
  if(missing.length) throw new Error(`Variety sheet headers missing: ${missing.join(', ')}`);
}

function buildVarietyMap(values){
  if(!values || values.length < 2) return new Map();

  const header = values[0].map(safe);
  const idx = {};
  header.forEach((h,i)=> idx[normalizeText(h)] = i);

  mustHaveHeadersVariety(idx);

  const out = new Map();

  for(const row of values.slice(1)){
    const packName = safe(row[idx['variety pack name']] ?? '');
    const beerName = safe(row[idx['beer name']] ?? '');
    const beerImg  = safe(row[idx['beer image url']] ?? '');
    const qtyRaw   = row[idx['qtyperpackitem']] ?? '';

    if(!packName || !beerName) continue;

    // Default qtyPerPackItem to 1 if blank/invalid
    let qtyPerPack = toIntQty(qtyRaw);
    if(qtyPerPack <= 0) qtyPerPack = 1;

    const key = normalizeText(packName);

    if(!out.has(key)) out.set(key, []);
    out.get(key).push({
      title: beerName,
      imageUrl: beerImg,
      qtyPerPack
    });
  }

  return out;
}

function expandVarietyPackRow(r){
  const key = normalizeText(r.itemTitle);
  const comps = VARIETY_MAP.get(key);
  if(!comps || !comps.length) return [r];

  const out = [];
  const packCount = Math.max(1, r.units || 1); // number of packs ordered

  for(const c of comps){
    const qtyUnits = (c.qtyPerPack || 1) * packCount;
    if(qtyUnits <= 0) continue;

    out.push({
      ...r,
      itemTitle: c.title,
      variantTitle: 'Single',
      units: qtyUnits,
      packSize: 1,
      cans: qtyUnits,
      imageUrl: c.imageUrl || r.imageUrl
    });
  }

  return out.length ? out : [r];
}

// =========================================================
// PICKED STATE (LOCAL ONLY)
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
// PARSE SHEET HELPERS
// =========================================================
function buildHeaderMap(headerRow){
  const map = {};
  headerRow.forEach((h, idx)=> map[normalizeText(h)] = idx);
  return map;
}

function mustHaveHeadersOrders(hmap){
  const required = ['orderid','customername','address','itemtitle','varianttitle','qty','picked','notes','imageurl'];
  const missing = required.filter(k => !(k in hmap));
  if(missing.length) throw new Error(`Orders headers missing: ${missing.join(', ')}`);
}

function mustHaveHeadersLookup(hmap){
  const required = ['itemtitle','imageurl','loccode'];
  const missing = required.filter(k => !(k in hmap));
  if(missing.length) throw new Error(`ImageLookup headers missing: ${missing.join(', ')}`);
}

function rowToOrderObj(row, hmap){
  const get = key => row[hmap[key]] ?? '';
  const itemTitle = safe(get('itemtitle'));
  const variantTitle = safe(get('varianttitle'));
  const units = toIntQty(get('qty'));
  const packSize = parsePackSize(itemTitle, variantTitle);
  const cans = units * packSize;

  const r = {
    orderId: safe(get('orderid')),
    customerName: safe(get('customername')),
    address: safe(get('address')),
    itemTitle,
    variantTitle,
    units,
    packSize,
    cans,
    picked: parseBool(get('picked')),
    notes: safe(get('notes')),
    imageUrl: safe(get('imageurl')),
  };
  if(!r.orderId && !r.itemTitle && !r.customerName) return null;
  if(normalizeText(r.itemTitle) === 'itemtitle') return null;
  return r;
}

function buildLookupMap(values){
  if(!values || values.length < 2) return new Map();

  const hmap = buildHeaderMap(values[0]);
  mustHaveHeadersLookup(hmap);

  const out = new Map();
  for(const row of values.slice(1)){
    const itemTitle = safe(row[hmap['itemtitle']] ?? '');
    if(!itemTitle) continue;
    const key = itemKeyByTitle(itemTitle);
    const imageUrl = safe(row[hmap['imageurl']] ?? '');
    const locCode  = safe(row[hmap['loccode']] ?? '');
    out.set(key, { imageUrl, locCode, rawTitle: itemTitle });
  }
  return out;
}

// =========================================================
// BUILD ORDERS (JOIN with ImageLookup + VARIETY EXPANSION)
// SORT = LOCATION ONLY (B zipper first, then A descending)
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

  $('progressFill').style.width = `${pct}%`;
  $('progressLeft').textContent = `${picked} picked`;
  $('progressRight').textContent = `${total} total`;
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

// MAIN QTY BUTTON MODE
function setQtyMode(mode, numberText){
  const num = $('curQtyNumber');
  const done = $('curQtyDone');
  if(!num || !done) return;

  if(mode === 'done'){
    num.style.display = 'none';
    done.style.display = 'grid';
  }else{
    done.style.display = 'none';
    num.style.display = 'block';
    num.textContent = numberText ?? '—';
  }
}

function renderCurrent(){
  const o = currentOrder();
  const nextPickBtn = $('btnPickNext');

  if(!o){
    if(nextPickBtn) nextPickBtn.style.visibility = 'visible';
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
    if(nextPickBtn) nextPickBtn.style.visibility = 'hidden';

    $('curTitle').textContent = 'ORDER PICKED';
    $('curSub').innerHTML = `<span class="badge">Grab boxes: ${escapeHtml(boxLabel(totalsForOrder(o).total))}</span>`;
    $('curImg').src = './done.svg';

    setQtyMode('done');

    setNextCard(null,'n1Qty','n1Aisle','n1Img');
    setNextCard(null,'n2Qty','n2Aisle','n2Img');
    return;
  }

  if(nextPickBtn) nextPickBtn.style.visibility = 'visible';

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
// ACTIONS
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

  const q = $('curQtyNumber');
  if(q){
    q.classList.remove('flash');
    void q.offsetWidth;
    q.classList.add('flash');
  }

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

function qtyPillClick(e){
  if(e) killTapWeirdness(e);

  const o = currentOrder();
  if(!o) return;

  rebuildQueue();
  const done = (queue.length === 0);
  if(!done) return;

  nextOrder();
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

    $('btnPickNext')?.addEventListener('pointerdown', (e)=>{
      killTapWeirdness(e);
      pickCurrent();
    }, { passive:false });

    $('tapPickArea')?.addEventListener('pointerdown', (e)=>{
      killTapWeirdness(e);
      pickCurrent();
    }, { passive:false });

    $('next1')?.addEventListener('pointerdown', (e)=>{
      killTapWeirdness(e);
      jumpNext(1);
    }, { passive:false });

    $('next2')?.addEventListener('pointerdown', (e)=>{
      killTapWeirdness(e);
      jumpNext(2);
    }, { passive:false });

    $('curQty')?.addEventListener('pointerdown', (e)=>{
      killTapWeirdness(e);
      qtyPillClick(e);
    }, { passive:false });

    const [ordersJson, lookupJson, varietyJson] = await Promise.all([
      fetchJson(ordersUrl),
      fetchJson(lookupUrl),
      fetchJson(varietyUrl),
    ]);

    const ordersValues = ordersJson.values || [];
    if(ordersValues.length < 2) throw new Error('Orders sheet has no data.');

    const lookupValues = lookupJson.values || [];
    if(lookupValues.length < 2) throw new Error('ImageLookup sheet has no data.');

    const varietyValues = varietyJson.values || [];
    if(varietyValues.length < 2) throw new Error(`Variety sheet "${varietySheetName}" has no data.`);

    // Build maps
    const lookupMap = buildLookupMap(lookupValues);
    VARIETY_MAP = buildVarietyMap(varietyValues);

    // Parse Orders
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
