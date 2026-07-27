// Designated Warehouse — secure Apps Script backend
//
// Secrets are read from Apps Script Script Properties. Never paste Shopify
// access tokens or API keys into this file or any browser-delivered JavaScript.

var DW_CONFIG = {
  WAREHOUSE_SPREADSHEET_ID: 'WAREHOUSE_SPREADSHEET_ID',
  VARIETY_SPREADSHEET_ID: 'VARIETY_SPREADSHEET_ID',
  SHOPIFY_STORE_DOMAIN: 'SHOPIFY_STORE_DOMAIN',
  SHOPIFY_ADMIN_ACCESS_TOKEN: 'SHOPIFY_ADMIN_ACCESS_TOKEN',
  SHOPIFY_API_VERSION: 'SHOPIFY_API_VERSION',
  ALLOWED_EMAILS: 'ALLOWED_EMAILS'
};

var DW_SHEETS = {
  ORDERS: 'Orders',
  ORDERS_OTHER: 'Orders_Other',
  IMAGE_LOOKUP: 'ImageLookup',
  VARIETY_PACKS: 'Variety Packs'
};

var IMAGE_LOOKUP_COLUMNS = {
  TITLE: 0,
  IMAGE_URL: 1,
  IMAGE_PREVIEW: 2,
  LOC_CODE: 3,
  SHOPIFY_PRODUCT_ID: 4,
  COUNT: 5
};

/**
 * Updates ImageLookup from active Shopify products.
 *
 * Location safety:
 * - locCode is read from column D and copied back unchanged.
 * - Existing rows retain their location even when images or titles change.
 * - Shopify product ID in column E is the primary match key.
 * - Existing title matching is used once to backfill IDs into older rows.
 * - New Shopify products are appended with a blank locCode.
 * - Manual rows that no longer exist in Shopify are never deleted.
 */
function syncShopifyProductImages() {
  var lock = LockService.getScriptLock();
  lock.waitLock(30000);

  try {
    var spreadsheetId = requiredProperty_(DW_CONFIG.WAREHOUSE_SPREADSHEET_ID);
    var ss = SpreadsheetApp.openById(spreadsheetId);
    var sheet = ss.getSheetByName(DW_SHEETS.IMAGE_LOOKUP);

    if (!sheet) {
      sheet = ss.insertSheet(DW_SHEETS.IMAGE_LOOKUP);
    }

    ensureImageLookupHeader_(sheet);

    var existingRows = readImageLookupRows_(sheet);
    var rowIndexByProductId = {};
    var rowIndexByTitle = {};

    existingRows.forEach(function(row, index) {
      var productId = cleanProductId_(row[IMAGE_LOOKUP_COLUMNS.SHOPIFY_PRODUCT_ID]);
      var titleKey = normalizeTitle_(row[IMAGE_LOOKUP_COLUMNS.TITLE]);

      if (productId && rowIndexByProductId[productId] === undefined) {
        rowIndexByProductId[productId] = index;
      }

      if (titleKey && rowIndexByTitle[titleKey] === undefined) {
        rowIndexByTitle[titleKey] = index;
      }
    });

    var products = fetchAllActiveShopifyProducts_();
    var updatedImages = 0;
    var updatedTitles = 0;
    var productIdsBackfilled = 0;
    var added = 0;
    var skippedWithoutImage = 0;

    products.forEach(function(product) {
      var productId = cleanProductId_(product.id);
      var title = String(product.title || '').trim();
      var imageUrl = String(product.imageUrl || '').trim();
      var titleKey = normalizeTitle_(title);

      if (!productId || !title || !titleKey) return;

      var existingIndex = rowIndexByProductId[productId];

      // Migration fallback: old ImageLookup rows do not yet have Shopify IDs.
      // Match by the current title once, then permanently attach the product ID.
      if (existingIndex === undefined) {
        existingIndex = rowIndexByTitle[titleKey];
      }

      if (existingIndex !== undefined) {
        var row = existingRows[existingIndex];

        // Critical: row[3] (locCode) is deliberately never overwritten.
        if (row[IMAGE_LOOKUP_COLUMNS.TITLE] !== title) {
          var oldTitleKey = normalizeTitle_(row[IMAGE_LOOKUP_COLUMNS.TITLE]);
          row[IMAGE_LOOKUP_COLUMNS.TITLE] = title;
          updatedTitles++;

          if (oldTitleKey && rowIndexByTitle[oldTitleKey] === existingIndex) {
            delete rowIndexByTitle[oldTitleKey];
          }
          rowIndexByTitle[titleKey] = existingIndex;
        }

        if (imageUrl && row[IMAGE_LOOKUP_COLUMNS.IMAGE_URL] !== imageUrl) {
          row[IMAGE_LOOKUP_COLUMNS.IMAGE_URL] = imageUrl;
          updatedImages++;
        }

        if (!cleanProductId_(row[IMAGE_LOOKUP_COLUMNS.SHOPIFY_PRODUCT_ID])) {
          row[IMAGE_LOOKUP_COLUMNS.SHOPIFY_PRODUCT_ID] = productId;
          productIdsBackfilled++;
        }

        rowIndexByProductId[productId] = existingIndex;
      } else {
        if (!imageUrl) {
          skippedWithoutImage++;
        }

        existingRows.push([
          title,
          imageUrl,
          '',
          '', // locCode intentionally blank for brand-new products
          productId
        ]);

        var newIndex = existingRows.length - 1;
        rowIndexByProductId[productId] = newIndex;
        rowIndexByTitle[titleKey] = newIndex;
        added++;
      }
    });

    // Rebuild preview formulas while preserving location and Shopify ID.
    existingRows = existingRows
      .filter(function(row) {
        return String(row[IMAGE_LOOKUP_COLUMNS.TITLE] || '').trim() !== '';
      })
      .map(function(row, index) {
        var sheetRow = index + 2;

        return [
          String(row[IMAGE_LOOKUP_COLUMNS.TITLE] || '').trim(),
          String(row[IMAGE_LOOKUP_COLUMNS.IMAGE_URL] || '').trim(),
          '=IF(B' + sheetRow + '="","",IMAGE(B' + sheetRow + '))',
          String(row[IMAGE_LOOKUP_COLUMNS.LOC_CODE] || '').trim(),
          cleanProductId_(row[IMAGE_LOOKUP_COLUMNS.SHOPIFY_PRODUCT_ID])
        ];
      });

    var previousDataRows = Math.max(sheet.getLastRow() - 1, 0);
    var rowsToClear = Math.max(previousDataRows, existingRows.length);

    if (rowsToClear > 0) {
      sheet
        .getRange(2, 1, rowsToClear, IMAGE_LOOKUP_COLUMNS.COUNT)
        .clearContent();
    }

    if (existingRows.length > 0) {
      sheet
        .getRange(2, 1, existingRows.length, IMAGE_LOOKUP_COLUMNS.COUNT)
        .setValues(existingRows);
    }

    sheet.setFrozenRows(1);

    var result = {
      productsFound: products.length,
      rowsWritten: existingRows.length,
      imageUrlsUpdated: updatedImages,
      productTitlesUpdated: updatedTitles,
      productIdsBackfilled: productIdsBackfilled,
      productsAdded: added,
      productsWithoutImages: skippedWithoutImage,
      locCodesModified: 0,
      completedAt: new Date().toISOString()
    };

    console.log(JSON.stringify(result));
    return result;
  } finally {
    lock.releaseLock();
  }
}

/**
 * Creates a backup of ImageLookup before the first production sync.
 * The copied tab is timestamped and left untouched.
 */
function backupImageLookup() {
  var spreadsheetId = requiredProperty_(DW_CONFIG.WAREHOUSE_SPREADSHEET_ID);
  var ss = SpreadsheetApp.openById(spreadsheetId);
  var source = ss.getSheetByName(DW_SHEETS.IMAGE_LOOKUP);

  if (!source) {
    throw new Error('Missing sheet: ' + DW_SHEETS.IMAGE_LOOKUP);
  }

  var timezone = ss.getSpreadsheetTimeZone() || Session.getScriptTimeZone() || 'America/Toronto';
  var timestamp = Utilities.formatDate(new Date(), timezone, 'yyyyMMdd-HHmmss');
  var copy = source.copyTo(ss).setName('ImageLookup Backup ' + timestamp);

  return {
    backupSheetName: copy.getName(),
    rowsCopied: source.getLastRow(),
    completedAt: new Date().toISOString()
  };
}

/** Creates one daily trigger. Existing duplicate triggers are removed first. */
function installDailyImageSync() {
  removeImageSyncTriggers();

  ScriptApp.newTrigger('syncShopifyProductImages')
    .timeBased()
    .everyDays(1)
    .atHour(3)
    .create();

  return 'Daily image sync installed for approximately 3:00 AM in the Apps Script project timezone.';
}

/** Removes all triggers that run syncShopifyProductImages. */
function removeImageSyncTriggers() {
  ScriptApp.getProjectTriggers().forEach(function(trigger) {
    if (trigger.getHandlerFunction() === 'syncShopifyProductImages') {
      ScriptApp.deleteTrigger(trigger);
    }
  });
}

/** Tests the Shopify credentials without writing to the spreadsheet. */
function testShopifyConnection() {
  var products = fetchAllActiveShopifyProducts_();

  return {
    ok: true,
    activeProductsFound: products.length,
    productsWithImages: products.filter(function(product) {
      return Boolean(product.imageUrl);
    }).length
  };
}

/**
 * Server-side data method for an Apps Script-hosted frontend.
 * Call this with google.script.run, not from a public unauthenticated endpoint.
 */
function getWarehouseData(mode) {
  assertAllowedUser_();

  var warehouseId = requiredProperty_(DW_CONFIG.WAREHOUSE_SPREADSHEET_ID);
  var varietyId = requiredProperty_(DW_CONFIG.VARIETY_SPREADSHEET_ID);
  var orderSheetName = String(mode || '').toLowerCase() === 'other'
    ? DW_SHEETS.ORDERS_OTHER
    : DW_SHEETS.ORDERS;

  var warehouse = SpreadsheetApp.openById(warehouseId);
  var variety = SpreadsheetApp.openById(varietyId);

  return {
    orders: getSheetValues_(warehouse, orderSheetName),
    imageLookup: getSheetValues_(warehouse, DW_SHEETS.IMAGE_LOOKUP),
    varietyPacks: getSheetValues_(variety, DW_SHEETS.VARIETY_PACKS)
  };
}

function fetchAllActiveShopifyProducts_() {
  var storeDomain = requiredProperty_(DW_CONFIG.SHOPIFY_STORE_DOMAIN)
    .replace(/^https?:\/\//i, '')
    .replace(/\/$/, '');
  var accessToken = requiredProperty_(DW_CONFIG.SHOPIFY_ADMIN_ACCESS_TOKEN);
  var apiVersion = optionalProperty_(DW_CONFIG.SHOPIFY_API_VERSION, '2026-07');
  var endpoint = 'https://' + storeDomain + '/admin/api/' + apiVersion + '/graphql.json';

  var query = [
    'query WarehouseProducts($after: String) {',
    '  products(first: 100, after: $after, query: "status:active") {',
    '    pageInfo { hasNextPage endCursor }',
    '    nodes {',
    '      id',
    '      title',
    '      media(first: 1) {',
    '        nodes {',
    '          preview { image { url } }',
    '        }',
    '      }',
    '    }',
    '  }',
    '}'
  ].join('\n');

  var products = [];
  var after = null;

  do {
    var response = UrlFetchApp.fetch(endpoint, {
      method: 'post',
      contentType: 'application/json',
      headers: {
        'X-Shopify-Access-Token': accessToken
      },
      payload: JSON.stringify({
        query: query,
        variables: { after: after }
      }),
      muteHttpExceptions: true
    });

    var status = response.getResponseCode();
    var body = response.getContentText();

    if (status < 200 || status >= 300) {
      throw new Error('Shopify request failed (' + status + '): ' + body.slice(0, 1000));
    }

    var parsed = JSON.parse(body);

    if (parsed.errors && parsed.errors.length) {
      throw new Error('Shopify GraphQL error: ' + JSON.stringify(parsed.errors));
    }

    var connection = parsed && parsed.data && parsed.data.products;

    if (!connection) {
      throw new Error('Shopify response did not contain data.products.');
    }

    connection.nodes.forEach(function(node) {
      var imageUrl = '';
      var mediaNodes = node && node.media && node.media.nodes;
      var firstMedia = mediaNodes && mediaNodes.length ? mediaNodes[0] : null;

      if (firstMedia && firstMedia.preview && firstMedia.preview.image) {
        imageUrl = firstMedia.preview.image.url || '';
      }

      products.push({
        id: node.id || '',
        title: node.title || '',
        imageUrl: imageUrl
      });
    });

    after = connection.pageInfo && connection.pageInfo.hasNextPage
      ? connection.pageInfo.endCursor
      : null;
  } while (after);

  return products;
}

function readImageLookupRows_(sheet) {
  var lastRow = sheet.getLastRow();
  if (lastRow < 2) return [];

  return sheet
    .getRange(2, 1, lastRow - 1, IMAGE_LOOKUP_COLUMNS.COUNT)
    .getDisplayValues()
    .map(function(row) {
      return [
        row[IMAGE_LOOKUP_COLUMNS.TITLE],
        row[IMAGE_LOOKUP_COLUMNS.IMAGE_URL],
        row[IMAGE_LOOKUP_COLUMNS.IMAGE_PREVIEW],
        row[IMAGE_LOOKUP_COLUMNS.LOC_CODE],
        row[IMAGE_LOOKUP_COLUMNS.SHOPIFY_PRODUCT_ID]
      ];
    });
}

function ensureImageLookupHeader_(sheet) {
  var expected = [
    'itemTitle',
    'imageUrl',
    'imagePreview',
    'locCode',
    'shopifyProductId'
  ];

  var current = sheet
    .getRange(1, 1, 1, IMAGE_LOOKUP_COLUMNS.COUNT)
    .getDisplayValues()[0];

  var needsHeader = expected.some(function(value, index) {
    return String(current[index] || '').trim() !== value;
  });

  if (needsHeader) {
    sheet
      .getRange(1, 1, 1, IMAGE_LOOKUP_COLUMNS.COUNT)
      .setValues([expected]);
  }
}

function getSheetValues_(spreadsheet, sheetName) {
  var sheet = spreadsheet.getSheetByName(sheetName);
  if (!sheet) throw new Error('Missing sheet: ' + sheetName);

  var lastRow = sheet.getLastRow();
  var lastColumn = sheet.getLastColumn();
  if (!lastRow || !lastColumn) return [];

  return sheet.getRange(1, 1, lastRow, lastColumn).getDisplayValues();
}

function assertAllowedUser_() {
  var allowed = optionalProperty_(DW_CONFIG.ALLOWED_EMAILS, '')
    .split(',')
    .map(function(email) { return email.trim().toLowerCase(); })
    .filter(Boolean);

  if (!allowed.length) {
    throw new Error('ALLOWED_EMAILS is not configured in Script Properties.');
  }

  var currentEmail = String(Session.getActiveUser().getEmail() || '').toLowerCase();

  if (!currentEmail || allowed.indexOf(currentEmail) === -1) {
    throw new Error('Access denied.');
  }
}

function cleanProductId_(value) {
  return String(value || '').trim();
}

function normalizeTitle_(value) {
  return String(value || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function requiredProperty_(name) {
  var value = PropertiesService.getScriptProperties().getProperty(name);

  if (!value) {
    throw new Error('Missing Script Property: ' + name);
  }

  return value.trim();
}

function optionalProperty_(name, fallback) {
  var value = PropertiesService.getScriptProperties().getProperty(name);
  return value ? value.trim() : fallback;
}
