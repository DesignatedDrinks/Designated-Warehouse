// Designated Warehouse — PIN-protected locCode maintenance endpoint
//
// Setup:
// 1. Add this file to the bound Apps Script project.
// 2. Run generateLocCodeAdminPin() once and save the returned PIN.
// 3. Deploy the Apps Script project as a Web app that executes as you.
// 4. Paste the /exec URL into the warehouse app's hidden maintenance panel.
//
// This endpoint updates ONLY ImageLookup column D (locCode).

var DW_LOC_ADMIN = {
  SPREADSHEET_PROPERTY: 'WAREHOUSE_SPREADSHEET_ID',
  PIN_PROPERTY: 'LOC_CODE_ADMIN_PIN',
  SHEET_NAME: 'ImageLookup',
  TITLE_COLUMN: 1,
  LOCATION_COLUMN: 4,
  PRODUCT_ID_COLUMN: 5
};

/** Health check for the deployed web app. */
function doGet() {
  return locCodeJsonResponse_({
    ok: true,
    service: 'Designated Warehouse locCode editor',
    configured: Boolean(PropertiesService.getScriptProperties().getProperty(DW_LOC_ADMIN.PIN_PROPERTY))
  });
}

/** Handles a PIN-protected locCode update from the warehouse app. */
function doPost(e) {
  try {
    var payload = parseLocCodePayload_(e);
    if (String(payload.action || '') !== 'updateLocCode') {
      throw new Error('Unsupported maintenance action.');
    }

    var properties = PropertiesService.getScriptProperties();
    var expectedPin = String(properties.getProperty(DW_LOC_ADMIN.PIN_PROPERTY) || '').trim();
    var suppliedPin = String(payload.pin || '').trim();

    if (!expectedPin) {
      throw new Error('LOC_CODE_ADMIN_PIN has not been configured.');
    }
    if (!constantTimeEqual_(suppliedPin, expectedPin)) {
      throw new Error('Incorrect maintenance PIN.');
    }

    var canonicalLocCode = canonicalLocCode_(payload.locCode);
    var productId = String(payload.productId || '').trim();
    var itemTitle = String(payload.itemTitle || '').trim();

    if (!productId && !itemTitle) {
      throw new Error('A Shopify product ID or item title is required.');
    }

    var spreadsheetId = String(properties.getProperty(DW_LOC_ADMIN.SPREADSHEET_PROPERTY) || '').trim();
    if (!spreadsheetId) {
      throw new Error('WAREHOUSE_SPREADSHEET_ID has not been configured.');
    }

    var lock = LockService.getScriptLock();
    lock.waitLock(30000);
    try {
      var sheet = SpreadsheetApp.openById(spreadsheetId).getSheetByName(DW_LOC_ADMIN.SHEET_NAME);
      if (!sheet) throw new Error('ImageLookup sheet was not found.');

      var row = findImageLookupRow_(sheet, productId, itemTitle);
      if (row < 2) throw new Error('The product could not be found in ImageLookup.');

      // Critical safety rule: update column D only.
      sheet.getRange(row, DW_LOC_ADMIN.LOCATION_COLUMN).setValue(canonicalLocCode);
      SpreadsheetApp.flush();

      return locCodeJsonResponse_({
        ok: true,
        row: row,
        itemTitle: String(sheet.getRange(row, DW_LOC_ADMIN.TITLE_COLUMN).getDisplayValue() || '').trim(),
        productId: String(sheet.getRange(row, DW_LOC_ADMIN.PRODUCT_ID_COLUMN).getDisplayValue() || '').trim(),
        locCode: canonicalLocCode,
        updatedAt: new Date().toISOString()
      });
    } finally {
      lock.releaseLock();
    }
  } catch (error) {
    return locCodeJsonResponse_({
      ok: false,
      error: error && error.message ? error.message : String(error)
    });
  }
}

/** Generates and stores a new six-digit maintenance PIN. */
function generateLocCodeAdminPin() {
  var pin = String(Math.floor(100000 + Math.random() * 900000));
  PropertiesService.getScriptProperties().setProperty(DW_LOC_ADMIN.PIN_PROPERTY, pin);
  console.log('Warehouse locCode maintenance PIN: ' + pin);
  return pin;
}

function parseLocCodePayload_(e) {
  var text = e && e.postData && e.postData.contents ? String(e.postData.contents) : '';
  if (text) {
    try {
      return JSON.parse(text);
    } catch (ignored) {}
  }

  if (e && e.parameter && e.parameter.payload) {
    try {
      return JSON.parse(String(e.parameter.payload));
    } catch (ignoredAgain) {}
  }

  return e && e.parameter ? e.parameter : {};
}

function findImageLookupRow_(sheet, productId, itemTitle) {
  var lastRow = sheet.getLastRow();
  if (lastRow < 2) return -1;

  var rowCount = lastRow - 1;
  var values = sheet.getRange(2, 1, rowCount, DW_LOC_ADMIN.PRODUCT_ID_COLUMN).getDisplayValues();
  var targetProductId = String(productId || '').trim();
  var targetTitle = normalizeLocTitle_(itemTitle);

  if (targetProductId) {
    for (var i = 0; i < values.length; i++) {
      if (String(values[i][DW_LOC_ADMIN.PRODUCT_ID_COLUMN - 1] || '').trim() === targetProductId) {
        return i + 2;
      }
    }
  }

  if (targetTitle) {
    for (var j = 0; j < values.length; j++) {
      if (normalizeLocTitle_(values[j][DW_LOC_ADMIN.TITLE_COLUMN - 1]) === targetTitle) {
        return j + 2;
      }
    }
  }

  return -1;
}

function canonicalLocCode_(value) {
  var raw = String(value || '').trim().toUpperCase();
  if (!raw) return '';

  var match = raw.match(/^([ABCD])[-\s]?(\d{1,2})(?:\.(5))?$/);
  if (!match) {
    throw new Error('Use a warehouse location such as A-01, B-06.5, C-12 or leave it blank.');
  }

  var number = Number(match[2]);
  if (number < 1 || number > 12) {
    throw new Error('Warehouse location numbers must be from 1 to 12.');
  }

  return match[1] + '-' + String(number).padStart(2, '0') + (match[3] ? '.5' : '');
}

function normalizeLocTitle_(value) {
  return String(value || '')
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[’‘]/g, "'")
    .replace(/[–—]/g, '-')
    .replace(/&/g, ' and ')
    .replace(/\bnon[- ]?alcoholic\b/g, 'non alcoholic')
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function constantTimeEqual_(left, right) {
  left = String(left || '');
  right = String(right || '');
  var mismatch = left.length ^ right.length;
  var length = Math.max(left.length, right.length);

  for (var i = 0; i < length; i++) {
    mismatch |= (left.charCodeAt(i) || 0) ^ (right.charCodeAt(i) || 0);
  }
  return mismatch === 0;
}

function locCodeJsonResponse_(payload) {
  return ContentService
    .createTextOutput(JSON.stringify(payload))
    .setMimeType(ContentService.MimeType.JSON);
}
