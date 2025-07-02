// CONFIG
const SHEET_ID   = '1xE9SueE6rdDapXr0l8OtP_IryFM-Z6fHFH27_cQ120g';
const API_KEY    = 'AIzaSyA7sSHMaY7i-uxxynKewHLsHxP_dd3TZ4U';
const ORDERS_TAB = 'Orders';
const DIRECT_URL = 'https://designateddrinks.github.io/Designated-Direct';

// state
let orders = [], idx = 0;

// elements
const prevBtn   = document.getElementById('prevBtn');
const nextBtn   = document.getElementById('nextBtn');
const jumpIn    = document.getElementById('jumpInput');
const jumpBtn   = document.getElementById('jumpBtn');
const darkTog   = document.getElementById('darkToggle');
const orderIdEl = document.getElementById('orderId');
const custName  = document.getElementById('customerName');
const custAddr  = document.getElementById('customerAddress');
const boxInline = document.getElementById('boxInline');
const mainEl    = document.getElementById('itemsContainer');

// fetch & group
async function loadData() {
  const url = `https://sheets.googleapis.com/v4/spreadsheets/${SHEET_ID}` +
              `/values/${ORDERS_TAB}?alt=json&key=${API_KEY}`;
  const res = await fetch(url).then(r=>r.json());
  const rows = res.values||[];
  if (rows.length<2) return;

  const g = {};
  rows.slice(1).forEach(r=>{
    let [oId,name,address,title,variant,qty,,note,img] = r;
    const q = parseInt(qty,10)||0;
    const m = (variant.match(/(\d+)\s*Pack/i)||[])[1];
    const size = m?+m:1;
    const cans = q*size;
    if (!g[oId]) g[oId]={oId,name,address,note,items:[],total:0};
    g[oId].items.push({title,variant,q,img,cans});
    g[oId].total += cans;
  });
  orders = Object.values(g);
  render();
}

// box logic (Liquid ported)
function boxCalc(n) {
  let lines=[], total=0;
  if (n<=12)       { lines=["1 × 12-pack box"]; total=1; }
  else if (n<=24)  { lines=["1 × 24-pack box"]; total=1; }
  else if (n<=36)  { lines=["1 × 24-pack box","1 × 12-pack box"]; total=2; }
  else if (n<=48)  { lines=["2 × 24-pack boxes"]; total=2; }
  else if (n<=60)  { lines=["2 × 24-pack boxes","1 × 12-pack box"]; total=3; }
  else if (n<=72)  { lines=["3 × 24-pack boxes"]; total=3; }
  else if (n<=84)  { lines=["3 × 24-pack boxes","1 × 12-pack box"]; total=4; }
  else if (n<=96)  { lines=["4 × 24-pack boxes"]; total=4; }
  else if (n<=108) { lines=["4 × 24-pack boxes","1 × 12-pack box"]; total=5; }
  else if (n<=120) { lines=["5 × 24-pack boxes"]; total=5; }
  else if (n<=132) { lines=["5 × 24-pack boxes","1 × 12-pack box"]; total=6; }
  else if (n<=144) { lines=["6 × 24-pack boxes"]; total=6; }
  else             { lines=["Multiple boxes required"]; total="?"; }
  return {lines,total};
}

// render one order
function render() {
  if (!orders.length) return;
  const o = orders[idx];
  orderIdEl.innerText      = `Order #${o.oId}`;
  custName.innerText       = o.name;
  custAddr.innerText       = o.address||'';
  // boxes
  const bc = boxCalc(o.total);
  boxInline.innerHTML = bc.lines.join(' • ') + ` | Total: ${bc.total}`;
  // items
  mainEl.innerHTML = o.items.map(it=>`
    <div class="item-card">
      <img src="${it.img||''}" alt="${it.title}">
      <div class="details">
        <h2>${it.title}</h2>
        <p>${it.cans} cans</p>
        ${ it.title.includes('Designated Drinks') 
            ? `<a class="pick-link" href="${DIRECT_URL}?pack=${encodeURIComponent(it.title)}" target="_blank">Pick Pack</a>`
            : ''
        }
      </div>
    </div>
  `).join('');

  // buttons
  prevBtn.disabled = idx===0;
  nextBtn.disabled = idx===orders.length-1;
}

// navigation
prevBtn.onclick = ()=>{ if(idx>0) idx--,render(); };
nextBtn.onclick = ()=>{ if(idx<orders.length-1) idx++,render(); };
jumpBtn.onclick = ()=>{
  const v = parseInt(jumpIn.value,10)-1;
  if (v>=0&&v<orders.length) { idx=v; render(); }
};
// swipe
let sx=0;
mainEl.addEventListener('touchstart',e=>sx=e.touches[0].clientX,{passive:true});
mainEl.addEventListener('touchend',e=>{
  const d = e.changedTouches[0].clientX - sx;
  if (d>50) prevBtn.click();
  if (d< -50) nextBtn.click();
},{passive:true});
// keyboard
document.addEventListener('keydown',e=>{
  if (e.key==='ArrowLeft') prevBtn.click();
  if (e.key==='ArrowRight') nextBtn.click();
  if (e.key.toLowerCase()==='d') darkTog.click();
  if (e.key.toLowerCase()==='j') jumpIn.focus();
});
// dark mode
darkTog.onclick = ()=>document.body.classList.toggle('dark');

// init
loadData();
