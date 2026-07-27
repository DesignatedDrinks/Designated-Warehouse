// Designated Warehouse — tagged Shopify order importer
//
// Routing:
// - Shopify tag "CouriersPlus" -> Orders
// - Shopify tag "Orders_Other" -> Orders_Other
//
// This importer intentionally does not query Shopify's Customer object.
// The recipient name comes from the order shipping address, so read_customers
// is not required. The app still needs read_orders and access to the protected
// order fields used by the warehouse (recipient name and shipping address).
//
// Run installFiveMinuteOrderImportTrigger() once to create the schedule.

var DW_ORDER_IMPORT = {
  COURIERS_TAG: 'CouriersPlus',
  OTHER_TAG: 'Orders_Other',
  ORDERS_SHEET: 'Orders',
  OTHER_SHEET: 'Orders_Other',
  HEADERS: [
    'orderId',
    'customerName',
    'address',
    'itemTitle',
    'variantTitle',
    'qty',
    'picked',
    'notes',
    'imageUrl',
    'deliveryMethod'
  ],
  ORDERS_PAGE_SIZE: 100,
  LINE_ITEMS_PAGE_SIZE: 250
};

/** Imports both tagged order queues into their respective sheets. */
function runAllImports() {
  var tokenResult = ensureShopifyAccessToken_();
  assertRequiredShopifyScope_(tokenResult.scope, 'read_orders');

  var courierOrders = fetchTaggedOpenOrders_(DW_ORDER_IMPORT.COURIERS_TAG);
  var otherOrders = fetchTaggedOpenOrders_(DW_ORDER_IMPORT.OTHER_TAG)
    .filter(function(order) {
      // An order carrying both tags belongs in Courier Plus only.
      return !hasOrderTag_(order, DW_ORDER_IMPORT.COURIERS_TAG);
    });

  var lock = LockService.getScriptLock();
  lock.waitLock(30000);

  try {
    var spreadsheetId = requiredProperty_(DW_CONFIG.WAREHOUSE_SPREADSHEET_ID);
    var ss = SpreadsheetApp.openById(spreadsheetId);

    var courierResult = writeTaggedOrdersToSheet_(
      ss,
      DW_ORDER_IMPORT.ORDERS_SHEET,
      courierOrders,
      DW_ORDER_IMPORT.COURIERS_TAG
    );

    var otherResult = writeTaggedOrdersToSheet_(
      ss,
      DW_ORDER_IMPORT.OTHER_SHEET,
      otherOrders,
      DW_ORDER_IMPORT.OTHER_TAG
    );

    var result = {
      ok: true,
      courierPlus: courierResult,
      ordersOther: otherResult,
      completedAt: new Date().toISOString()
    };

    console.log(JSON.stringify(result));
    return result;
  } finally {
    lock.releaseLock();
  }
}

/** Tests Shopify access and tag matching without writing to the spreadsheet. */
function testTaggedOrderImport() {
  var tokenResult = ensureShopifyAccessToken_();
  assertRequiredShopifyScope_(tokenResult.scope, 'read_orders');

  var courierOrders = fetchTaggedOpenOrders_(DW_ORDER_IMPORT.COURIERS_TAG);
  var otherOrders = fetchTaggedOpenOrders_(DW_ORDER_IMPORT.OTHER_TAG)
    .filter(function(order) {
      return !hasOrderTag_(order, DW_ORDER_IMPORT.COURIERS_TAG);
    });

  var result = {
    ok: true,
    courierPlusOrders: courierOrders.length,
    ordersOtherOrders: otherOrders.length,
    grantedScopes: tokenResult.scope,
    checkedAt: new Date().toISOString()
  };

  console.log(JSON.stringify(result));
  return result;
}

/** Installs exactly one time-driven order import trigger every five minutes. */
function installFiveMinuteOrderImportTrigger() {
  removeOrderImportTriggers_();

  ScriptApp.newTrigger('runAllImports')
    .timeBased()
    .everyMinutes(5)
    .create();

  return 'Order import trigger installed: runAllImports every 5 minutes.';
}

/** Removes stale and duplicate order import triggers only. */
function removeOrderImportTriggers_() {
  var handlerNames = {
    runAllImports: true,
    importTaggedShopifyOrders: true,
    importShopifyOrders: true,
    syncShopifyOrders: true
  };

  ScriptApp.getProjectTriggers().forEach(function(trigger) {
    if (handlerNames[trigger.getHandlerFunction()]) {
      ScriptApp.deleteTrigger(trigger);
    }
  });
}

/** Returns open orders carrying the requested tag and at least one unfulfilled item. */
function fetchTaggedOpenOrders_(tag) {
  var orders = [];
  var after = null;
  var searchQuery = 'status:open tag:"' + String(tag).replace(/"/g, '\\"') + '"';

  do {
    var data = shopifyGraphqlRequest_(
      [
        'query TaggedWarehouseOrders($after: String, $query: String!, $orderCount: Int!, $lineItemCount: Int!) {',
        '  orders(first: $orderCount, after: $after, query: $query, sortKey: CREATED_AT, reverse: true) {',
        '    nodes {',
        '      id',
        '      name',
        '      note',
        '      tags',
        '      shippingAddress {',
        '        name',
        '        address1',
        '        address2',
        '        city',
        '        provinceCode',
        '        zip',
        '        country',
        '      }',
        '      shippingLine { title }',
        '      lineItems(first: $lineItemCount) {',
        '        nodes {',
        '          title',
        '          variantTitle',
        '          unfulfilledQuantity',
        '          image { url }',
        '        }',
        '        pageInfo { hasNextPage endCursor }',
        '      }',
        '    }',
        '    pageInfo { hasNextPage endCursor }',
        '  }',
        '}'
      ].join('\n'),
      {
        after: after,
        query: searchQuery,
        orderCount: DW_ORDER_IMPORT.ORDERS_PAGE_SIZE,
        lineItemCount: DW_ORDER_IMPORT.LINE_ITEMS_PAGE_SIZE
      }
    );

    var connection = data.orders;
    var nodes = connection && Array.isArray(connection.nodes) ? connection.nodes : [];

    nodes.forEach(function(order) {
      if (order.lineItems && order.lineItems.pageInfo && order.lineItems.pageInfo.hasNextPage) {
        throw new Error(
          'Order ' + String(order.name || order.id) +
          ' has more than ' + DW_ORDER_IMPORT.LINE_ITEMS_PAGE_SIZE +
          ' line items. Increase the importer limit before continuing.'
        );
      }

      var unfulfilledItems = order.lineItems && Array.isArray(order.lineItems.nodes)
        ? order.lineItems.nodes.filter(function(lineItem) {
            return Number(lineItem.unfulfilledQuantity || 0) > 0;
          })
        : [];

      if (unfulfilledItems.length > 0) {
        order.lineItems.nodes = unfulfilledItems;
        orders.push(order);
      }
    });

    after = connection && connection.pageInfo && connection.pageInfo.hasNextPage
      ? connection.pageInfo.endCursor
      : null;
  } while (after);

  return orders;
}

/** Sends an authenticated Admin GraphQL request and returns its data object. */
function shopifyGraphqlRequest_(query, variables) {
  var properties = PropertiesService.getScriptProperties();
  var storeDomain = requiredProperty_(DW_CONFIG.SHOPIFY_STORE_DOMAIN)
    .replace(/^https?:\/\//i, '')
    .replace(/\/$/, '');
  var apiVersion = String(properties.getProperty(DW_CONFIG.SHOPIFY_API_VERSION) || '2026-07').trim();
  var accessToken = requiredProperty_(DW_CONFIG.SHOPIFY_ADMIN_ACCESS_TOKEN);
  var endpoint = 'https://' + storeDomain + '/admin/api/' + apiVersion + '/graphql.json';

  var response = UrlFetchApp.fetch(endpoint, {
    method: 'post',
    contentType: 'application/json',
    headers: {
      'X-Shopify-Access-Token': accessToken
    },
    payload: JSON.stringify({ query: query, variables: variables || {} }),
    muteHttpExceptions: true
  });

  var status = response.getResponseCode();
  var body = response.getContentText();
  var parsed;

  try {
    parsed = JSON.parse(body);
  } catch (error) {
    throw new Error('Shopify returned invalid JSON for the order import. HTTP ' + status + '.');
  }

  if (status < 200 || status >= 300) {
    throw new Error('Shopify order request failed (' + status + '): ' + sanitizeShopifyAuthError_(body));
  }

  if (parsed.errors && parsed.errors.length) {
    var seen = {};
    var messages = parsed.errors.map(function(error) {
      return error.message || String(error);
    }).filter(function(message) {
      if (seen[message]) return false;
      seen[message] = true;
      return true;
    });

    throw new Error('Shopify GraphQL order import failed: ' + messages.join(' | '));
  }

  if (!parsed.data) {
    throw new Error('Shopify order import returned no data.');
  }

  return parsed.data;
}

/** Rebuilds one queue while preserving picked values for rows that still exist. */
function writeTaggedOrdersToSheet_(ss, sheetName, orders, routeTag) {
  var sheet = ss.getSheetByName(sheetName) || ss.insertSheet(sheetName);
  ensureOrderSheetSchema_(sheet);

  var pickedByKey = readExistingPickedState_(sheet);
  var rows = [];

  orders.forEach(function(order) {
    var orderId = String(order.name || order.id || '').trim();
    var customerName = orderCustomerName_(order);
    var address = orderAddress_(order.shippingAddress);
    var notes = String(order.note || '').trim();
    var deliveryMethod = order.shippingLine && order.shippingLine.title
      ? String(order.shippingLine.title).trim()
      : routeTag;

    order.lineItems.nodes.forEach(function(lineItem) {
      var itemTitle = String(lineItem.title || '').trim();
      var variantTitle = String(lineItem.variantTitle || '').trim();
      var qty = Number(lineItem.unfulfilledQuantity || 0);
      if (!orderId || !itemTitle || qty <= 0) return;

      var key = orderRowKey_(orderId, itemTitle, variantTitle);
      var picked = Object.prototype.hasOwnProperty.call(pickedByKey, key)
        ? Boolean(pickedByKey[key])
        : false;
      var imageUrl = lineItem.image && lineItem.image.url
        ? String(lineItem.image.url).trim()
        : '';

      rows.push([
        orderId,
        customerName,
        address,
        itemTitle,
        variantTitle,
        qty,
        picked,
        notes,
        imageUrl,
        deliveryMethod
      ]);
    });
  });

  sheet.getRange(1, 1, 1, DW_ORDER_IMPORT.HEADERS.length)
    .setValues([DW_ORDER_IMPORT.HEADERS]);

  var existingDataRows = Math.max(sheet.getLastRow() - 1, 0);
  var rowsToClear = Math.max(existingDataRows, rows.length);

  if (rowsToClear > 0) {
    sheet.getRange(2, 1, rowsToClear, DW_ORDER_IMPORT.HEADERS.length).clearContent();
  }

  if (rows.length > 0) {
    // Add validation first, then write booleans so preserved picked values survive.
    sheet.getRange(2, 7, rows.length, 1).insertCheckboxes();
    sheet.getRange(2, 1, rows.length, DW_ORDER_IMPORT.HEADERS.length).setValues(rows);
  }

  sheet.setFrozenRows(1);

  return {
    sheet: sheetName,
    tag: routeTag,
    ordersFound: orders.length,
    rowsWritten: rows.length
  };
}

/** Keeps the order queues on the fixed ten-column schema. */
function ensureOrderSheetSchema_(sheet) {
  var requiredColumns = DW_ORDER_IMPORT.HEADERS.length;
  var maxColumns = sheet.getMaxColumns();

  if (maxColumns < requiredColumns) {
    sheet.insertColumnsAfter(maxColumns, requiredColumns - maxColumns);
  } else if (maxColumns > requiredColumns) {
    sheet.deleteColumns(requiredColumns + 1, maxColumns - requiredColumns);
  }
}

function readExistingPickedState_(sheet) {
  var result = {};
  var values = sheet.getDataRange().getValues();
  if (values.length < 2) return result;

  var headers = orderHeaderMap_(values[0]);
  var orderCol = orderColumn_(headers, ['orderId', 'order id']);
  var itemCol = orderColumn_(headers, ['itemTitle', 'item title']);
  var variantCol = orderColumn_(headers, ['variantTitle', 'variant title']);
  var pickedCol = orderColumn_(headers, ['picked']);

  if (orderCol < 0 || itemCol < 0 || pickedCol < 0) return result;

  values.slice(1).forEach(function(row) {
    var orderId = String(row[orderCol] || '').trim();
    var itemTitle = String(row[itemCol] || '').trim();
    var variantTitle = variantCol >= 0 ? String(row[variantCol] || '').trim() : '';
    if (!orderId || !itemTitle) return;
    result[orderRowKey_(orderId, itemTitle, variantTitle)] = row[pickedCol] === true;
  });

  return result;
}

/** Uses only the recipient name already stored on the order shipping address. */
function orderCustomerName_(order) {
  return order.shippingAddress && order.shippingAddress.name
    ? String(order.shippingAddress.name).trim()
    : 'No customer name';
}

function orderAddress_(address) {
  if (!address) return 'No shipping address';

  var locality = [address.city, address.provinceCode]
    .filter(function(value) { return String(value || '').trim() !== ''; })
    .join(', ');

  return [
    address.address1,
    address.address2,
    locality,
    address.zip,
    address.country
  ].filter(function(value) {
    return String(value || '').trim() !== '';
  }).join(' · ');
}

function hasOrderTag_(order, tag) {
  var target = String(tag || '').trim().toLowerCase();
  return Array.isArray(order.tags) && order.tags.some(function(orderTag) {
    return String(orderTag || '').trim().toLowerCase() === target;
  });
}

function orderRowKey_(orderId, itemTitle, variantTitle) {
  return [orderId, itemTitle, variantTitle]
    .map(function(value) {
      return String(value || '').trim().toLowerCase();
    })
    .join('|');
}

function orderHeaderMap_(row) {
  var map = {};
  row.forEach(function(value, index) {
    var key = String(value || '').trim().toLowerCase().replace(/[^a-z0-9]+/g, '');
    if (key && map[key] === undefined) map[key] = index;
  });
  return map;
}

function orderColumn_(map, names) {
  for (var i = 0; i < names.length; i++) {
    var key = String(names[i] || '').trim().toLowerCase().replace(/[^a-z0-9]+/g, '');
    if (map[key] !== undefined) return map[key];
  }
  return -1;
}
