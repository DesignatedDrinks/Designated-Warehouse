// ———————————————————————————————————————————————
// CONFIG (YOUR APIS)
// ———————————————————————————————————————————————
const sheetId   = '1xE9SueE6rdDapXr0l8OtP_IryFM-Z6fHFH27_cQ120g';
const sheetName = 'Orders';
const apiKey    = 'AIzaSyA7sSHMaY7i-uxxynKewHLsHxP_dd3TZ4U';

const ordersUrl =
  `https://sheets.googleapis.com/v4/spreadsheets/${sheetId}/values/${encodeURIComponent(sheetName)}?alt=json&key=${apiKey}`;

// Pack picker sheet
const packsSheetId    = '1TtRNmjsgC64jbkptnCdklBf_HqifwE9SQO2JlGrp4Us';
const packTitlesUrl   = `https://sheets.googleapis.com/v4/spreadsheets/${packsSheetId}/values/${encodeURIComponent('Pack Titles!A2:A')}?key=${apiKey}`;
const varietyPacksUrl = `https://sheets.googleapis.com/v4/spreadsheets/${packsSheetId}/values/${encodeURIComponent('Variety Packs!A2:C1000')}?key=${apiKey}`;

// ———————————————————————————————————————————————
// DOM
// ———————————————————————————————————————————————
const el = {
  // nav
  goStartBtn: document.getElementById('goStartBtn'),
  goPackModeBtn: document.getElementById('goPackModeBtn'),

  // views
  startView: document.getElementById('startView'),
  pickView: document.getElementById('pickView'),
  completeView: document.getElementById('completeView'),
  packModeView: document.getElementById('packModeView'),

  // start
  dashPending: document.getElementById('dash-pending'),
  dashCans: document.getElementById('dash-cans'),
  startPickingBtn: document.getElementById('startPickingBtn'),
  startError: document.getElementById('startError'),

  // pick
  pickLocation: document.getElementById('pickLocation'),
  pickProgress: document.getElementById('pickProgress'),
  pickImage: document.getElementById('pickImage'),
  pickName: document.getElementById('pickName'),
  pickQty: document.getElementById('pickQty'),
  confirmPickBtn: document.getElementById('confirmPickBtn'),
  issueBtn: document.getElementById('issueBtn'),
  issueModal: document.getElementById('issueModal'),
  closeIssueModalBtn: document.getElementById('closeIssueModalBtn'),

  // complete
  pickedCount: document.getElementById('pickedCount'),
  issueCount: document.getElementById('issueCount'),
  goToPackBtn: document.getElementById('goToPackBtn'),

  // pack mode
  backToStartBtn: document.getElementById('backToStartBtn'),
  packPrevBtn: document.getElementById('packPrevBtn'),
  packNextBtn: document.getElementById('packNextBtn'),
  packOrderId: document.getElementById('packOrderId'),
  packCustomerName: document.getElementById('packCustomerName'),
  packCustomerAddress: document.getElementById('packCustomerAddress'),
  packBoxesInfo: document.getElementById('packBoxesInfo'),
  packItemsContainer: document.getElementById('packItemsContainer'),
  openPackPickerBtn: document.getElementById('openPackPickerBtn'),
  packPickerPanel: document.getElementById('packPickerPanel'),
  packDropdown: document.getElementById('packDropdown'),
  results: document.getElementById('results'),
};

// ———————————————————————————————————————————————
// STATE
// ———————————————————————————————————————————————
let orders = [];           // order-centric for pack mode
let packIndex = 0;

let pickQueue = [];        // pick-centric for picker mode
let pickIndex = 0;
let isPicking = false;
let issues = [];

let varietyPacksData = [];
let packsLoaded = false;

// ———————————————————————————————————————————————
// VIEW CONTROL
// ———————————————————————————————————————————————
function showView(which) {
  [el.startView, el.pickView, el.completeView, el.packModeView]
    .forEach(v => v.classList.add('hidden'));
  which.classList.remove('hidden');
}

// ———————————————————————————————————————————————
// SAFE HELPERS
// ———————————————————————————————————————————————
function setText(node, value) {
  node.textContent = value ?? '';
}

function placeholderImage(imgEl) {
  imgEl.src = 'https://via.placeholder.com/600x600?text=No+Image';
}

function normalizeKey(s) {
  return String(s || '').trim().toLowerCase();
}

// Placeholder until you provide a real mapping sheet
function guessLocation(title) {
  const t = normalizeKey(title);
  const c = t[0] || 'a';
  const aisle = c < 'h' ? 1 : c < 'p' ? 2 : 3;
  return { label: `AISLE ${aisle}`, sortKey: `A${aisle}` };
}

// ———————————————————————————————————————————————
// DATA: LOAD + PARSE ORDERS
// ———————————————————————————————————————————————
async function loadOrders() {
  try {
    const res = await fetch(ordersUrl);
    const json = await res.json();
    const rows = json.values || [];
    if (rows.length < 2) throw new Error('No orders found');

    const grouped = {};

    for (const r of rows.slice(1)) {
      const [
        orderId,
        customerName,
        address,
        itemTitle,
        variantTitle,
        qtyStr,
        /* picked */,
        notes,
        imageUrl
      ] = r;

      const qty = parseInt(qtyStr, 10) || 0;
      const packSize = (String(variantTitle || '').match(/(\d+)\s*pack/i) || [1, 1])[1];
      const cans = qty * parseInt(packSize, 10);

      if (!grouped[orderId]) {
        grouped[orderId] = {
          orderId,
          customerName: customerName || '',
          address: address || '',
          notes: notes || '',
          items: [],
          totalCans: 0
        };
      }

      grouped[orderId].items.push({
        itemTitle: itemTitle || '',
        cans,
        imageUrl: imageUrl || ''
      });

      grouped[orderId].totalCans += cans;
    }

    // stable, predictable sort for pack mode
    const parsedOrders = Object.values(grouped);
    parsedOrders.forEach(o => o.items.sort((a,b) => a.itemTitle.localeCompare(b.itemTitle)));

    orders = parsedOrders;
    packIndex = 0;

    pickQueue = buildPickQueue(orders);
    pickIndex = 0;
    isPicking = false;
    issues = [];

    renderStart();
  } catch (err) {
    console.error(err);
    renderStartError('Failed to load orders. Check sheet acc
