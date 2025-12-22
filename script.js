// ———————————————————————————————————————————————
// CONFIG (YOUR APIS)
// ———————————————————————————————————————————————
const sheetId   = '1xE9SueE6rdDapXr0l8OtP_IryFM-Z6fHFH27_cQ120g';
const sheetName = 'Orders';
const apiKey    = 'AIzaSyA7sSHMaY7i-uxxynKewHLsHxP_dd3TZ4U';

const ordersUrl =
  `https://sheets.googleapis.com/v4/spreadsheets/${sheetId}/values/${encodeURIComponent(sheetName)}?alt=json&key=${apiKey}`;

// Image lookup (title -> url) — from the same spreadsheet
const imageLookupUrl =
  `https://sheets.googleapis.com/v4/spreadsheets/${sheetId}/values/${encodeURIComponent('ImageLookup!A2:B')}?alt=json&key=${apiKey}`;

// Pack picker sheet (3 cols: Pack, Beer, ImageUrl)
const packsSheetId    = '1TtRNmjsgC64jbkptnCdklBf_HqifwE9SQO2JlGrp4Us';
const varietyPacksUrl =
  `https://sheets.googleapis.com/v4/spreadsheets/${packsSheetId}/values/${encodeURIComponent('VarietyPacks!A2:C')}?alt=json&key=${apiKey}`;

// ———————————————————————————————————————————————
// PICK PATH (YOUR LOOP) — letter-only, derived from your map
// Packing Table → Center Island LEFT face (bottom→top) → Right Wall (top→bottom)
// → Center Island RIGHT face (bottom→top) → back to packing
// ———————————————————————————————————————————————

// NOTE: If a letter appears multiple times on the wall (B, C), it shares the same rank.
// If you later want finer control, we can add a “section” override for specific breweries.
const PICK_LOOP = [
  // Center Island — LEFT face (from packing table upward)
  'W','T','S','R','P','T','H', // (T can represent “Templ”/your T slot; H=Harmons)

  // Right Wall (enter from top, walk down)
  'B','D','C',

  // Center Island — RIGHT face (from bottom upward)
  'C','G','H','I','L','M','N','O'
];

// Build rank map (first occurrence wins)
const LETTER_RANK = (() => {
  const m = new Map();
  let rank = 1;
  for (const ch of PICK_LOOP) {
    if (!m.has(ch)) m.set(ch, rank++);
  }
  return m;
})();

// Optional: force specific breweries/titles to a letter if first-character isn’t what you want.
// Example: { "Templ": "T", "Harmons": "H" } etc.
// Keys can be substrings (case-insensitive).
const LETTER_OVERRIDES = {
  // 'Templ': 'T',
  // 'Harmons': 'H',
};

// ———————————————————————————————————————————————
// HELPERS
// ———————————————————————————————————————————————
function norm(s) {
  return String(s || '').trim();
}

function safeInt(x, fallback = 0) {
  const n = parseInt(String(x || '').trim(), 10);
  return Number.isFinite(n) ? n : fallback;
}

function letterForTitle(title) {
  const t = norm(title);
  if (!t) return '?';

  const lower = t.toLowerCase();
  for (const [k, v] of Object.entries(LETTER_OVERRIDES)) {
    if (lower.includes(k.toLowerCase())) return String(v).toUpperCase();
  }

  // Default rule: first letter of the brewery name (your titles start with brewery/vendor)
  return t[0].toUpperCase();
}

function rankForLetter(ch) {
  return LETTER_RANK.get(ch) ?? 9999; // unknown letters go last
}

function stableSortBy(arr, keyFn) {
  return arr
    .map((v, i) => ({ v, i, k: keyFn(v) }))
    .sort((a, b) => (a.k < b.k ? -1 : a.k > b.k ? 1 : a.i - b.i))
    .map(o => o.v);
}

// ———————————————————————————————————————————————
// DATA LOADERS
// ———————————————————————————————————————————————
async function fetchSheetValues(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Fetch failed: ${res.status} ${res.statusText}`);
  const data = await res.json();
  return data.values || [];
}

async function loadImageLookup() {
  const rows = await fetchSheetValues(imageLookupUrl);
  const map = new Map();
  for (const r of rows) {
    const title = norm(r[0]);
    const url   = norm(r[1]);
    if (title) map.set(title, url);
  }
  return map;
}

async function loadVarietyPackMap() {
  // VarietyPacks!A2:C => [PackTitle, BeerTitle, ImageUrl]
  const rows = await fetchSheetValues(varietyPacksUrl);
  const packMap = new Map();

  for (const r of rows) {
    const packTitle = norm(r[0]);
    const beerTitle = norm(r[1]);
    const imgUrl    = norm(r[2]);

    if (!packTitle || !beerTitle) continue;

    if (!packMap.has(packTitle)) packMap.set(packTitle, []);
    packMap.get(packTitle).push({ title: beerTitle, imageUrl: imgUrl });
  }

  return packMap;
}

// ———————————————————————————————————————————————
// ORDER PARSING (from your Orders sheet)
// Expected columns: orderId, customerName, address, itemTitle, variantTitle, qty, picked, notes, imageUrl
// If your sheet differs, update the header mapping below.
// ———————————————————————————————————————————————
function parseOrders(rows) {
  if (!rows.length) return [];

  const header = rows[0].map(h => norm(h));
  const idx = (name) => header.findIndex(h => h.toLowerCase() === name.toLowerCase());

  const iOrderId   = idx('orderId');
  const iCustomer  = idx('customerName');
  const iAddress   = idx('address');
  const iItemTitle = idx('itemTitle');
  const iVariant   = idx('variantTitle');
  const iQty       = idx('qty');
  const iPicked    = idx('picked');
  const iNotes     = idx('notes');
  const iImageUrl  = idx('imageUrl');

  const itemsByOrder = new Map();

  for (let r = 1; r < rows.length; r++) {
    const row = rows[r];

    const orderId   = norm(row[iOrderId]);
    if (!orderId) continue;

    const customer  = norm(row[iCustomer]);
    const address   = norm(row[iAddress]);
    const itemTitle = norm(row[iItemTitle]);
    const variant   = norm(row[iVariant]);
    const qty       = safeInt(row[iQty], 1);
    const picked    = norm(row[iPicked]).toLowerCase() === 'true' || norm(row[iPicked]).toLowerCase() === 'yes';
    const notes     = norm(row[iNotes]);
    const imageUrl  = norm(row[iImageUrl]);

    if (!itemsByOrder.has(orderId)) {
      itemsByOrder.set(orderId, {
        orderId,
        customerName: customer,
        address,
        notes: '',
        picked: false,
        items: []
      });
    }

    const o = itemsByOrder.get(orderId);
    if (notes && !o.notes) o.notes = notes;
    if (picked) o.picked = true;

    if (itemTitle) {
      o.items.push({
        title: itemTitle,
        variantTitle: variant,
        qty,
        picked,
        imageUrl
      });
    }
  }

  return Array.from(itemsByOrder.values());
}

// ———————————————————————————————————————————————
// VARIETY PACK EXPLOSION + PICK SORT
// ———————————————————————————————————————————————
function expandVarietyPacks(orderItems, packMap, imageLookupMap) {
  const out = [];

  for (const it of orderItems) {
    const title = norm(it.title);
    const qty   = safeInt(it.qty, 1);

    // If this line item is a pack that exists in the pack map,
    // replace it with its component beers * qty.
    const packItems = packMap.get(title);

    if (packItems && packItems.length) {
      for (let n = 0; n < qty; n++) {
        for (const p of packItems) {
          const beerTitle = norm(p.title);
          const imgUrl = norm(p.imageUrl) || imageLookupMap.get(beerTitle) || '';
          out.push({
            title: beerTitle,
            qty: 1,
            fromPack: title,
            imageUrl: imgUrl
          });
        }
      }
      continue;
    }

    // Normal item: keep as is, but fill imageUrl if missing
    const img = norm(it.imageUrl) || imageLookupMap.get(title) || '';
    out.push({
      title,
      qty,
      fromPack: null,
      imageUrl: img
    });
  }

  // Merge same titles into one line (reduces noise)
  const merged = new Map();
  for (const x of out) {
    const key = x.title;
    if (!merged.has(key)) merged.set(key, { ...x });
    else merged.get(key).qty += x.qty;
  }
  return Array.from(merged.values());
}

function sortForYourPickPath(items) {
  // Attach letter + rank
  const enriched = items.map(it => {
    const letter = letterForTitle(it.title);
    const rank   = rankForLetter(letter);
    return { ...it, letter, rank };
  });

  // Sort by rank, then by letter, then by title
  return stableSortBy(enriched, (x) =>
    `${String(x.rank).padStart(4,'0')}|${x.letter}|${x.title.toLowerCase()}`
  );
}

// ———————————————————————————————————————————————
// MAIN LOAD
// ———————————————————————————————————————————————
async function loadAndRender() {
  try {
    // Load everything in parallel
    const [ordersRaw, imageLookupMap, packMap] = await Promise.all([
      fetchSheetValues(ordersUrl),
      loadImageLookup(),
      loadVarietyPackMap()
    ]);

    const orders = parseOrders(ordersRaw);

    // For each order: explode packs, then sort to your loop
    for (const o of orders) {
      const expanded = expandVarietyPacks(o.items, packMap, imageLookupMap);
      o.pickItems = sortForYourPickPath(expanded);
    }

    // TODO: hook into your existing render function
    // If you already have renderOrders(orders), use that and swap it to use o.pickItems.
    renderOrders(orders);

  } catch (err) {
    console.error(err);
    const el = document.getElementById('app') || document.body;
    el.innerHTML = `<div style="padding:16px;font-family:system-ui;color:#b00020">
      <b>Load error:</b> ${String(err.message || err)}
    </div>`;
  }
}

// ———————————————————————————————————————————————
// RENDER (KEEP YOUR EXISTING UI IF YOU HAVE ONE)
// Replace this with your current rendering code.
// The key: use order.pickItems (already exploded + sorted)
// ———————————————————————————————————————————————
function renderOrders(orders) {
  const root = document.getElementById('app') || document.body;
  root.innerHTML = '';

  for (const o of orders) {
    const card = document.createElement('div');
    card.style.border = '1px solid #ddd';
    card.style.borderRadius = '10px';
    card.style.padding = '12px';
    card.style.margin = '10px 0';
    card.style.fontFamily = 'system-ui';

    const h = document.createElement('div');
    h.innerHTML = `<b>Order:</b> ${o.orderId} &nbsp; <b>${o.customerName || ''}</b>`;
    card.appendChild(h);

    const list = document.createElement('div');
    list.style.marginTop = '10px';

    for (const it of (o.pickItems || [])) {
      const row = document.createElement('div');
      row.style.display = 'flex';
      row.style.gap = '10px';
      row.style.alignItems = 'center';
      row.style.padding = '6px 0';
      row.style.borderBottom = '1px dashed #eee';

      const img = document.createElement('img');
      img.src = it.imageUrl || '';
      img.alt = it.title;
      img.style.width = '44px';
      img.style.height = '44px';
      img.style.objectFit = 'cover';
      img.style.borderRadius = '8px';
      img.style.background = '#f3f3f3';

      const txt = document.createElement('div');
      const packNote = it.fromPack ? ` <span style="color:#777">(from ${it.fromPack})</span>` : '';
      const unknown = it.rank === 9999 ? ` <span style="color:#b00020">[UNMAPPED ${it.letter}]</span>` : '';
      txt.innerHTML = `<div><b>${it.qty}×</b> ${it.title}${packNote}${unknown}</div>
                       <div style="color:#666;font-size:12px;">Letter: <b>${it.letter}</b></div>`;

      row.appendChild(img);
      row.appendChild(txt);
      list.appendChild(row);
    }

    card.appendChild(list);
    root.appendChild(card);
  }
}

// Kick it off
loadAndRender();
