/************************************************************
 * 🖼 IMAGE RESOLUTION (SAFE)
 * - Works with:
 *   1) A direct URL in the sheet cell
 *   2) An =IMAGE("url") formula in the sheet cell
 *   3) ImageLookup sheet (itemTitle -> imageUrl)
 ************************************************************/

let imageLookupMap = null;

function normalizeKey(s) {
  return String(s || '')
    .trim()
    .toLowerCase()
    .replace(/â€œ|â€/g, '"')
    .replace(/â€™/g, "'")
    .replace(/[–—]/g, '-')
    .replace(/\s+/g, ' ');
}

function extractUrlFromImageFormula(cell) {
  const s = String(cell || '').trim();
  if (!s) return '';
  const m = s.match(/=IMAGE\(\s*"(https?:\/\/[^"]+)"\s*\)/i);
  return m ? m[1] : '';
}

async function loadImageLookupOnce() {
  if (imageLookupMap) return;
  imageLookupMap = new Map();

  // IMPORTANT: this is your ImageLookup on THE SAME SHEET as Orders (you said column C is for general picker)
  // If ImageLookup lives on a different sheetId, change sheetId below accordingly.
  const url =
    `https://sheets.googleapis.com/v4/spreadsheets/${sheetId}/values/${encodeURIComponent('ImageLookup!A2:B')}?alt=json&key=${apiKey}`;

  try {
    const res = await fetch(url);
    const json = await res.json();
    const rows = json.values || [];
    for (const r of rows) {
      const title = (r[0] || '').trim();
      const img   = (r[1] || '').trim();
      if (!title || !img) continue;
      imageLookupMap.set(normalizeKey(title), img);
    }
  } catch (e) {
    console.error('ImageLookup failed to load', e);
  }
}

async function resolveImageUrl(itemTitle, sheetCellValue) {
  // 1) If cell is =IMAGE("..."), pull the URL out
  const fromFormula = extractUrlFromImageFormula(sheetCellValue);
  if (fromFormula) return fromFormula;

  // 2) If cell is already a URL
  const direct = String(sheetCellValue || '').trim();
  if (direct.startsWith('http')) return direct;

  // 3) Fallback to ImageLookup by itemTitle
  await loadImageLookupOnce();
  const lookup = imageLookupMap?.get(normalizeKey(itemTitle));
  return lookup || '';
}
