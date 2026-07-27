'use strict';

const CONFIG = Object.freeze({
  warehouseSheetId: '1xE9SueE6rdDapXr0l8OtP_IryFM-Z6fHFH27_cQ120g',
  varietySheetId: '1TtRNmjsgC64jbkptnCdklBf_HqifwE9SQO2JlGrp4Us',
  apiKey: 'AIzaSyA7sSHMaY7i-uxxynKewHLsHxP_dd3TZ4U',
  sheets: { orders: 'Orders', other: 'Orders_Other', lookup: 'ImageLookup', variety: 'Variety Packs' },
  holdMs: 420,
  progressKey: 'designated_warehouse_progress_v3',
  sourceKey: 'designated_warehouse_source_v2'
});

const $ = id => document.getElementById(id);
const state = { source: 'orders', orders: [], filtered: [], orderIndex: 0, itemIndex: 0, lookup: new Map(), variety: new Map(), undo: [], progress: loadProgress(), loading: false };

function safe(value){ return String(value ?? '').trim(); }
function normalize(value){
  return safe(value).normalize('NFKD').replace(/[\u0300-\u036f]/g,'').toLowerCase()
    .replace(/[’‘]/g,"'").replace(/[–—]/g,'-').replace(/&/g,' and ')
    .replace(/\bnon[- ]?alcoholic\b/g,'non alcoholic').replace(/[^a-z0-9]+/g,' ').replace(/\s+/g,' ').trim();
}
function parseQty(value){ const n = Number.parseInt(safe(value).replace(/[^0-9-]/g,''),10); return Number.isFinite(n) ? n : 0; }
function parseBool(value){ return ['true','1','yes','y'].includes(safe(value).toLowerCase()); }
function headerMap(row){ const map = new Map(); row.forEach((value,index)=>{ const key=normalize(value); if(key && !map.has(key)) map.set(key,index); }); return map; }
function col(map, names){ for(const name of names){ const key=normalize(name); if(map.has(key)) return map.get(key); } return -1; }
function sheetUrl(sheetId, sheetName){ return `https://sheets.googleapis.com/v4/spreadsheets/${sheetId}/values/${encodeURIComponent(sheetName)}?alt=json&key=${CONFIG.apiKey}`; }

async function fetchValues(sheetId, sheetName){
  const response = await fetch(sheetUrl(sheetId,sheetName), { cache:'no-store' });
  const text = await response.text();
  if(!response.ok) throw new Error(`Could not load ${sheetName} (${response.status}).`);
  const json = JSON.parse(text);
  return Array.isArray(json.values) ? json.values : [];
}

function loadProgress(){ try { return JSON.parse(localStorage.getItem(CONFIG.progressKey)||'{}'); } catch { return {}; } }
function saveProgress(){ try { localStorage.setItem(CONFIG.progressKey,JSON.stringify(state.progress)); } catch {} }
function progressFor(orderId){ return state.progress[orderId] || (state.progress[orderId]={}); }
function isPicked(orderId,key){ return Boolean(progressFor(orderId)[key]); }
function setPicked(orderId,key,value){ progressFor(orderId)[key]=Boolean(value); saveProgress(); }

function parsePackSize(itemTitle,variantTitle){
  const text=`${safe(itemTitle)} ${safe(variantTitle)}`.toLowerCase();
  if(/\bsingle\b|\b1\s*pack\b|\b1\s*can\b/.test(text)) return 1;
  const match=text.match(/\b(\d{1,2})\s*[- ]?\s*(pack|pk)\b/);
  if(match){ const size=Number(match[1]); return size>0&&size<=60?size:1; }
  return 1;
}

function parseLocation(code){
  const raw=safe(code).toUpperCase();
  const match=raw.match(/^([ABCD])[-\s]?(\d{1,2})(?:\.(5))?$/);
  if(!match) return { raw, label:raw||'NO LOC', sort:[9999,999,999] };
  const aisle=match[1], number=Number(match[2]), half=match[3]?0.5:0;
  if(number<1||number>12) return { raw, label:raw, sort:[9999,number,half] };
  const side=(aisle==='A'||aisle==='C')?0:1;
  const halfOrder=half?1:0;
  const major=(aisle==='A'||aisle==='B')?((number-1)*4)+(side*2)+halfOrder:100+((12-number)*4)+(side*2)+halfOrder;
  return { raw, label:`${aisle}-${String(number).padStart(2,'0')}${half?'.5':''}`, sort:[major,0,0] };
}

function placeholder(title){
  const label=safe(title).slice(0,26).replace(/[<>&]/g,'');
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" width="600" height="600"><rect width="100%" height="100%" fill="#f4f5f7"/><text x="50%" y="48%" text-anchor="middle" font-family="Arial" font-size="28" font-weight="700" fill="#667085">NO IMAGE</text><text x="50%" y="56%" text-anchor="middle" font-family="Arial" font-size="16" fill="#98a2b3">${label}</text></svg>`)}`;
}
function imageFor(url,title){ return /^https?:\/\//i.test(safe(url)) ? safe(url) : placeholder(title); }

function buildLookup(values){
  const map=new Map(); if(values.length<2) return map;
  const headers=headerMap(values[0]);
  const titleCol=col(headers,['itemTitle','item title','title','product']);
  const imageCol=col(headers,['imageUrl','image url','image']);
  const locationCol=col(headers,['locCode','loc code','location','bin']);
  const productIdCol=col(headers,['shopifyProductId','shopify product id','product id']);
  values.slice(1).forEach(row=>{
    const title=safe(row[titleCol]); if(!title) return;
    map.set(normalize(title),{ title,imageUrl:imageCol>=0?safe(row[imageCol]):'',locCode:locationCol>=0?safe(row[locationCol]):'',productId:productIdCol>=0?safe(row[productIdCol]):'' });
  });
  return map;
}

function packKey(title){ return normalize(safe(title).replace(/^.*?\)\s*/,'')); }
function buildVariety(values){
  const map=new Map(); if(values.length<2) return map;
  const headers=headerMap(values[0]);
  const packCol=col(headers,['variety pack name','pack name','pack']);
  const itemCol=col(headers,['beer name','item','title','product']);
  const qtyCol=col(headers,['qty per pack item','qtyperpackitem','qty','quantity']);
  const imageCol=col(headers,['beer image url','image url','imageurl']);
  if(packCol<0||itemCol<0) return map;
  values.slice(1).forEach(row=>{
    const pack=safe(row[packCol]), title=safe(row[itemCol]); if(!pack||!title) return;
    const key=packKey(pack), list=map.get(key)||[];
    list.push({title,qty:Math.max(1,parseQty(row[qtyCol])),imageUrl:imageCol>=0?safe(row[imageCol]):''}); map.set(key,list);
  });
  return map;
}

function parseOrders(values){
  if(values.length<2) return [];
  const headers=headerMap(values[0]);
  const indexes={
    order:col(headers,['orderId','order id','id']), customer:col(headers,['customerName','customer name','customer']), address:col(headers,['address','shipping address']),
    item:col(headers,['itemTitle','item title','product','title']), variant:col(headers,['variantTitle','variant title','variant']), qty:col(headers,['qty','quantity']),
    picked:col(headers,['picked']), notes:col(headers,['notes','note']), image:col(headers,['imageUrl','image url','image']), delivery:col(headers,['deliveryMethod','delivery method'])
  };
  if(indexes.order<0||indexes.item<0||indexes.qty<0) throw new Error('Orders sheet is missing orderId, itemTitle or qty.');
  const grouped=new Map();
  values.slice(1).forEach(row=>{
    const orderId=safe(row[indexes.order]), itemTitle=safe(row[indexes.item]); if(!orderId||!itemTitle) return;
    if(!grouped.has(orderId)) grouped.set(orderId,{orderId,customerName:safe(row[indexes.customer]),address:safe(row[indexes.address]),notes:safe(row[indexes.notes]),deliveryMethod:safe(row[indexes.delivery]),items:[]});
    const units=Math.max(0,parseQty(row[indexes.qty])); if(!units) return;
    const variantTitle=safe(row[indexes.variant]), packSize=parsePackSize(itemTitle,variantTitle);
    grouped.get(orderId).items.push({itemTitle,variantTitle,units,packSize,cans:units*packSize,imageUrl:safe(row[indexes.image]),sheetPicked:parseBool(row[indexes.picked])});
  });
  return [...grouped.values()].map(expandAndMergeOrder).sort((a,b)=>orderNumber(b.orderId)-orderNumber(a.orderId));
}
function orderNumber(id){ return Number(safe(id).replace(/\D/g,''))||0; }
function expandAndMergeOrder(order){
  const merged=new Map();
  for(const source of order.items){
    const rule=state.variety.get(packKey(source.itemTitle));
    const rows=rule?.length ? rule.map(component=>({...source,itemTitle:component.title,variantTitle:'Single',units:component.qty*source.units,packSize:1,cans:component.qty*source.units,imageUrl:component.imageUrl||source.imageUrl})) : [source];
    for(const row of rows){
      const key=normalize(row.itemTitle), lookup=state.lookup.get(key), loc=parseLocation(lookup?.locCode);
      if(!merged.has(key)) merged.set(key,{key,itemTitle:row.itemTitle,qtyCans:0,locCode:lookup?.locCode||'',locLabel:loc.label,locSort:loc.sort,imageUrl:imageFor(lookup?.imageUrl||row.imageUrl,row.itemTitle),sources:[]});
      const item=merged.get(key); item.qtyCans+=row.cans; item.sources.push({units:row.units,packSize:row.packSize});
    }
  }
  order.items=[...merged.values()].sort((a,b)=>compareSort(a.locSort,b.locSort)||a.itemTitle.localeCompare(b.itemTitle));
  return order;
}
function compareSort(a,b){ for(let i=0;i<Math.max(a.length,b.length);i++){ const diff=(a[i]||0)-(b[i]||0); if(diff) return diff; } return 0; }

function currentOrder(){ return state.filtered[state.orderIndex]||null; }
function unpickedItems(order){ return order ? order.items.filter(item=>!isPicked(order.orderId,item.key)) : []; }
function currentItem(){ return unpickedItems(currentOrder())[state.itemIndex]||null; }
function canLabel(value){ return `${value} ${value===1?'can':'cans'}`; }
function boxLabel(total){ let n=total; const parts=[]; const b24=Math.floor(n/24); if(b24){parts.push(`${b24}×24`);n%=24;} if(n){parts.push(n<=6?'1×6':n<=12?'1×12':'1×24');} return parts.join(' + ')||'0'; }
function sourceBreakdown(sources){ const map=new Map(); sources.forEach(s=>map.set(s.packSize,(map.get(s.packSize)||0)+s.units)); return [...map.entries()].sort((a,b)=>b[0]-a[0]).map(([size,units])=>`${units}×${size}`).join(' + '); }

function setStatus(text,type='ok'){ const el=$('connectionStatus'); el.textContent=text; el.className=`statusPill ${type}`; }
function showError(message){ $('errBox').innerHTML=message?`<div class="errorBox">${escapeHtml(message)}</div>`:''; }
function escapeHtml(value){ return safe(value).replace(/[&<>'"]/g,char=>({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[char])); }

function syncOrderList(){
  state.filtered=state.orders.slice();
  state.orderIndex=Math.min(state.orderIndex,Math.max(0,state.filtered.length-1));
  state.itemIndex=0;
  populateOrderSelect();
  render();
}
function populateOrderSelect(){
  const select=$('orderSelect'); select.innerHTML='';
  state.filtered.forEach((order,index)=>{ const option=document.createElement('option'); option.value=String(index); option.textContent=order.orderId; select.append(option); });
  select.value=String(state.orderIndex);
}

function render(){
  const order=currentOrder(), hasOrder=Boolean(order);
  $('orderSummary').hidden=!hasOrder; $('picker').hidden=!hasOrder; $('emptyState').hidden=hasOrder;
  $('btnPrevOrder').disabled=!hasOrder||state.orderIndex<=0; $('btnNextOrder').disabled=!hasOrder||state.orderIndex>=state.filtered.length-1;
  if(!hasOrder) return;
  $('orderSelect').value=String(state.orderIndex);
  $('whoLine').textContent=order.customerName||'No customer name'; $('addrLine').textContent=order.address||'No shipping address';
  $('noteLine').hidden=!order.notes; $('noteLine').textContent=order.notes;
  const total=order.items.reduce((sum,item)=>sum+item.qtyCans,0), picked=order.items.reduce((sum,item)=>sum+(isPicked(order.orderId,item.key)?item.qtyCans:0),0), pct=total?Math.round(picked/total*100):0;
  $('chipOrder').textContent=order.orderId; $('chipTotalCans').textContent=String(total); $('chipBoxes').textContent=boxLabel(total); $('chipProgress').textContent=`${pct}%`;
  $('progressFill').style.width=`${pct}%`; $('progressRight').textContent=`${canLabel(picked)} of ${canLabel(total)} picked`;
  renderCurrent(); renderNext(); renderList();
}

function renderCurrent(){
  const order=currentOrder(), queue=unpickedItems(order), item=queue[state.itemIndex];
  if(!item){
    $('curTitle').textContent='Order complete'; $('curSub').textContent='Everything in this order is picked.'; $('locationBadge').textContent='DONE';
    $('curQtyNumber').hidden=true; $('curQtyDone').hidden=false; $('curImg').src=placeholder('Order complete'); $('missingLocation').hidden=true; $('remainingLabel').textContent='0 remaining'; return;
  }
  $('curQtyNumber').hidden=false; $('curQtyDone').hidden=true; $('curQtyNumber').textContent=String(item.qtyCans); $('curTitle').textContent=item.itemTitle;
  $('curSub').textContent=`${sourceBreakdown(item.sources)} • ${canLabel(item.qtyCans)}`; $('locationBadge').textContent=item.locLabel;
  $('curImg').src=item.imageUrl; $('curImg').onerror=()=>{ $('curImg').src=placeholder(item.itemTitle); };
  $('missingLocation').hidden=Boolean(item.locCode); $('remainingLabel').textContent=`${queue.length} remaining`;
}
function renderNext(){
  const queue=unpickedItems(currentOrder()), next=[queue[state.itemIndex+1],queue[state.itemIndex+2]];
  next.forEach((item,index)=>{
    const n=index+1; $(`n${n}Qty`).textContent=item?String(item.qtyCans):'—'; $(`n${n}Aisle`).textContent=item?item.locLabel:'—';
    const img=$(`n${n}Img`); img.src=item?item.imageUrl:placeholder(''); img.onerror=()=>{img.src=placeholder(item?.itemTitle||'');};
  });
}
function renderList(){
  const order=currentOrder(), body=$('listBody'); body.innerHTML=''; if(!order) return;
  const current=currentItem();
  order.items.forEach(item=>{
    const button=document.createElement('button'); button.type='button'; button.className=`listRow${isPicked(order.orderId,item.key)?' done':''}${current?.key===item.key?' current':''}`;
    button.innerHTML=`<span class="listLocation">${escapeHtml(item.locLabel)}</span><span><span class="listTitle">${escapeHtml(item.itemTitle)}</span><span class="listMeta">${escapeHtml(sourceBreakdown(item.sources))}</span></span><span class="listQty">${item.qtyCans}</span>`;
    button.addEventListener('click',()=>{ if(isPicked(order.orderId,item.key)) return; const queue=unpickedItems(order); state.itemIndex=Math.max(0,queue.findIndex(x=>x.key===item.key)); render(); window.scrollTo({top:0,behavior:'smooth'}); }); body.append(button);
  });
}

function moveOrder(delta){ if(!state.filtered.length) return; state.orderIndex=Math.max(0,Math.min(state.filtered.length-1,state.orderIndex+delta)); state.itemIndex=0; render(); }
function markCurrentPicked(){ const order=currentOrder(), item=currentItem(); if(!order||!item) return; state.undo.push({orderId:order.orderId,key:item.key}); setPicked(order.orderId,item.key,true); state.itemIndex=0; render(); }
function skipItem(){ const queue=unpickedItems(currentOrder()); if(queue.length<2) return; state.itemIndex=(state.itemIndex+1)%queue.length; render(); }
function undoLast(){ const action=state.undo.pop(); if(!action) return; setPicked(action.orderId,action.key,false); const orderIndex=state.filtered.findIndex(o=>o.orderId===action.orderId); if(orderIndex>=0) state.orderIndex=orderIndex; state.itemIndex=0; render(); }
function resetOrder(){ const order=currentOrder(); if(!order) return; if(!confirm(`Reset picked progress for ${order.orderId}?`)) return; state.progress[order.orderId]={}; saveProgress(); state.itemIndex=0; render(); }

function wireHold(){
  const button=$('curQty'), fill=$('holdFill'); let timer=null, start=0, frame=null;
  const cancel=()=>{ if(timer) clearTimeout(timer); timer=null; if(frame) cancelAnimationFrame(frame); frame=null; fill.style.transform='scaleX(0)'; };
  const tick=()=>{ const pct=Math.min(1,(performance.now()-start)/CONFIG.holdMs); fill.style.transform=`scaleX(${pct})`; if(pct<1) frame=requestAnimationFrame(tick); };
  const begin=event=>{ event.preventDefault(); if(!currentItem()) return; cancel(); start=performance.now(); frame=requestAnimationFrame(tick); timer=setTimeout(()=>{ cancel(); markCurrentPicked(); },CONFIG.holdMs); };
  button.addEventListener('pointerdown',begin); ['pointerup','pointerleave','pointercancel'].forEach(type=>button.addEventListener(type,cancel));
}

async function loadAll(){
  if(state.loading) return; state.loading=true; setStatus('Loading','loading'); showError(''); $('btnRefresh').disabled=true;
  try{
    const sourceName=CONFIG.sheets[state.source];
    const [lookupValues,varietyValues,orderValues]=await Promise.all([
      fetchValues(CONFIG.warehouseSheetId,CONFIG.sheets.lookup), fetchValues(CONFIG.varietySheetId,CONFIG.sheets.variety), fetchValues(CONFIG.warehouseSheetId,sourceName)
    ]);
    state.lookup=buildLookup(lookupValues); state.variety=buildVariety(varietyValues); state.orders=parseOrders(orderValues); state.orderIndex=0; state.itemIndex=0; state.undo=[];
    syncOrderList(); setStatus(`${state.orders.length} orders`,'ok'); $('lastUpdated').textContent=`Updated ${new Date().toLocaleTimeString([], {hour:'numeric',minute:'2-digit'})}`;
  }catch(error){ console.error(error); setStatus('Load failed','error'); showError(error.message||'Warehouse data could not be loaded.'); state.orders=[]; state.filtered=[]; render(); }
  finally{ state.loading=false; $('btnRefresh').disabled=false; }
}

function setSource(source){
  state.source=source==='other'?'other':'orders'; try{localStorage.setItem(CONFIG.sourceKey,state.source);}catch{}
  $('tabOrders').classList.toggle('active',state.source==='orders'); $('tabOther').classList.toggle('active',state.source==='other'); loadAll();
}
function wireEvents(){
  $('tabOrders').addEventListener('click',()=>setSource('orders')); $('tabOther').addEventListener('click',()=>setSource('other'));
  $('btnRefresh').addEventListener('click',loadAll);
  $('btnPrevOrder').addEventListener('click',()=>moveOrder(-1)); $('btnNextOrder').addEventListener('click',()=>moveOrder(1));
  $('orderSelect').addEventListener('change',event=>{state.orderIndex=Number(event.target.value)||0;state.itemIndex=0;render();});
  $('btnSkip').addEventListener('click',skipItem); $('btnUndo').addEventListener('click',undoLast); $('btnResetOrder').addEventListener('click',resetOrder); wireHold();
  document.addEventListener('keydown',event=>{ if(event.target.matches('select')) return; if(event.key==='ArrowLeft') moveOrder(-1); if(event.key==='ArrowRight') moveOrder(1); if(event.key.toLowerCase()==='s') skipItem(); });
}

(function init(){
  try{state.source=localStorage.getItem(CONFIG.sourceKey)==='other'?'other':'orders';}catch{}
  wireEvents(); $('tabOrders').classList.toggle('active',state.source==='orders'); $('tabOther').classList.toggle('active',state.source==='other'); loadAll();
})();