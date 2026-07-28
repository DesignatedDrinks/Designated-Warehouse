// Designated Warehouse — safe locCode inheritance for renamed Shopify products
//
// Why this exists:
// Shopify title changes can cause syncShopifyProductImages() to append a new
// ImageLookup row with a Shopify product ID but a blank locCode. The older row
// can still contain the correct location. This repair copies a location only
// when the product image matches rows with exactly one distinct nonblank
// location. New or ambiguous products remain blank for manual placement.

var DW_LOCATION_REPAIR = {
  SHEET_NAME: 'ImageLookup',
  TITLE_COLUMN: 1,
  IMAGE_COLUMN: 2,
  LOCATION_COLUMN: 4,
  PRODUCT_ID_COLUMN: 5,
  COLUMN_COUNT: 5
};

/**
 * Fills blank ImageLookup locCodes using a unique exact Shopify image match.
 * This never overwrites a nonblank location and never guesses when matching
 * rows contain different locations.
 */
function repairBlankLocCodesFromMatchingImages() {
  var spreadsheetId = requiredProperty_(DW_CONFIG.WAREHOUSE_SPREADSHEET_ID);
  var lock = LockService.getScriptLock();
  lock.waitLock(30000);

  try {
    var ss = SpreadsheetApp.openById(spreadsheetId);
    var sheet = ss.getSheetByName(DW_LOCATION_REPAIR.SHEET_NAME);
    if (!sheet) throw new Error('Missing sheet: ' + DW_LOCATION_REPAIR.SHEET_NAME);

    var lastRow = sheet.getLastRow();
    if (lastRow < 2) {
      return { ok: true, rowsChecked: 0, locationsRestored: 0, ambiguousImagesSkipped: 0 };
    }

    var rowCount = lastRow - 1;
    var values = sheet
      .getRange(2, 1, rowCount, DW_LOCATION_REPAIR.COLUMN_COUNT)
      .getDisplayValues();

    var locationsByImage = {};
    var ambiguousImages = {};

    values.forEach(function(row) {
      var imageKey = normalizeLocationImageUrl_(row[DW_LOCATION_REPAIR.IMAGE_COLUMN - 1]);
      var locCode = String(row[DW_LOCATION_REPAIR.LOCATION_COLUMN - 1] || '').trim();
      if (!imageKey || !locCode) return;

      if (locationsByImage[imageKey] && locationsByImage[imageKey] !== locCode) {
        ambiguousImages[imageKey] = true;
      } else {
        locationsByImage[imageKey] = locCode;
      }
    });

    var updates = [];
    values.forEach(function(row, index) {
      var currentLocation = String(row[DW_LOCATION_REPAIR.LOCATION_COLUMN - 1] || '').trim();
      if (currentLocation) return;

      var imageKey = normalizeLocationImageUrl_(row[DW_LOCATION_REPAIR.IMAGE_COLUMN - 1]);
      if (!imageKey || ambiguousImages[imageKey] || !locationsByImage[imageKey]) return;

      updates.push({
        row: index + 2,
        locCode: locationsByImage[imageKey],
        itemTitle: String(row[DW_LOCATION_REPAIR.TITLE_COLUMN - 1] || '').trim(),
        productId: String(row[DW_LOCATION_REPAIR.PRODUCT_ID_COLUMN - 1] || '').trim()
      });
    });

    updates.forEach(function(update) {
      sheet
        .getRange(update.row, DW_LOCATION_REPAIR.LOCATION_COLUMN)
        .setValue(update.locCode);
    });

    if (updates.length) SpreadsheetApp.flush();

    var result = {
      ok: true,
      rowsChecked: values.length,
      locationsRestored: updates.length,
      ambiguousImagesSkipped: Object.keys(ambiguousImages).length,
      restored: updates,
      completedAt: new Date().toISOString()
    };

    console.log(JSON.stringify(result));
    return result;
  } finally {
    lock.releaseLock();
  }
}

/** Runs authenticated product sync, then safely restores renamed locations. */
function syncShopifyProductsAndRepairLocations() {
  ensureShopifyAccessToken_();
  var productSync = syncShopifyProductImages();
  var locationRepair = repairBlankLocCodesFromMatchingImages();

  return {
    ok: true,
    productSync: productSync,
    locationRepair: locationRepair,
    completedAt: new Date().toISOString()
  };
}

/**
 * Replaces legacy daily product-image triggers with one combined daily sync.
 * Run this once after adding this file to the Apps Script project.
 */
function installDailyProductAndLocationSync() {
  var handlers = {
    syncShopifyProductImages: true,
    syncShopifyProductImagesWithDevApp: true,
    syncShopifyProductsAndRepairLocations: true
  };

  ScriptApp.getProjectTriggers().forEach(function(trigger) {
    if (handlers[trigger.getHandlerFunction()]) {
      ScriptApp.deleteTrigger(trigger);
    }
  });

  ScriptApp.newTrigger('syncShopifyProductsAndRepairLocations')
    .timeBased()
    .everyDays(1)
    .atHour(3)
    .create();

  return 'Daily Shopify product and location repair installed for approximately 3:00 AM.';
}

function normalizeLocationImageUrl_(value) {
  var url = String(value || '').trim();
  if (!url) return '';

  return url
    .replace(/[?#].*$/, '')
    .toLowerCase();
}
