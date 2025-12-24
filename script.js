// =========================================================
// CONFIG
// =========================================================
const sheetId   = '1xE9SueE6rdDapXr0l8OtP_IryFM-Z6fHFH27_cQ120g';
const sheetName = 'Orders';
const apiKey    = 'AIzaSyA7sSHMaY7i-uxxynKewHLsHxP_dd3TZ4U';

const ordersUrl =
  `https://sheets.googleapis.com/v4/spreadsheets/${sheetId}/values/${encodeURIComponent(sheetName)}?alt=json&key=${apiKey}`;

const $ = (id) => document.getElementById(id);

let orders = [];
let orderIndex = 0;

let queue = [];
let queueIndex = 0;

let undoStack = [];
const STORAGE_KEY = 'dw_picked_queue_v1';

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

function firstNameInitial(fullName){
  const n = safe(fullName);
  if(!n) return '—';
  const parts = n.split(/\s+/).filter(Boolean);
  if(parts.length === 1) return parts[0];
  return `${parts[0]} ${parts[parts.length-1]}`; // full last name
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
// BRAND PRIORITY: Harmon first, Temple/Templ last
// =========================================================
function isHarmons(title){
  const t = (title || '').toLowerCase();
  return t.includes("harmon");
}
function isTemple(title){
  const t = (title || '').toLowerCase();
  return t.includes("temple") || t.includes("templ");
}
function brandPriority(title){
  if(isHarmons(title)) return 0;
  if(isTemple(title)) return 2;
  return 1;
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
// AISLE PATH (placeholder)
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
      if(r.cans <= 0) continue;

      const k = itemKeyByTitle(r.itemTitle);

      if(!merged.has(k)){
        const aisle = guessAisle(r.itemTitle);
        merged.set(k, {
          key: k,
          itemTitle: r.itemTitle,
          qtyCans: 0,
          aisle: aisle.aisle,
          aisleSort: aisle.sort,
          imageResolved: resolveImage(r.imageUrl, r.itemTitle),
          sources: []
        });
      }

      const item = merged.get(k);

      if(item.imageResolved.startsWith('data:image') && r.imageUrl && r.imageUrl.startsWith('http')){
        item.imageResolved = r.imageUrl;
      }

      item.qtyCans += r.cans;
      item.sources.push({ units: r.units, packSize: r.packSize, cans: r.cans });
    }

    const items = Array.from(merged.values()).sort((a,b)=>{
      const pa = brandPriority(a.itemTitle);
      const pb = brandPriority(b.itemTitle);
      if(pa !== pb) return pa - pb;

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
    return `
      <div class="listRow ${done ? 'done' : ''}" data-key="${it.key}">
        <div>
          <div class="lTitle">${escapeHtml(it.itemTitle)}</div>
          <div class="lSub">${escapeHtml(it.aisle)}${src}</div>
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
  a.textContent = item.aisle;
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
  $('curSub').innerHTML =
    `<span class="badge">${escapeHtml(cur.aisle)}</span>` +
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

  // Qty pulse feedback
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

// RESET CURRENT ORDER (local-only)
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

// DONE NEXT: red pill click advances order ONLY when done
function qtyPillClick(e){
  if(e) killTapWeirdness(e);

  const o = currentOrder();
  if(!o) return;

  rebuildQueue();
  const done = (queue.length === 0);
  if(!done) return; // ignore during picking

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

    // Fast tap controls (pointerdown) — prevents iOS zoom/focus weirdness
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
    setQtyMode('qty','—');
    $('curImg').src = placeholderSvg('Error');
    setNextCard(null,'n1Qty','n1Aisle','n1Img');
    setNextCard(null,'n2Qty','n2Aisle','n2Img');
  }
}

init();
