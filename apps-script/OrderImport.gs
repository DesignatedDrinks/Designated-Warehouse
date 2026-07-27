// Designated Warehouse — tagged Shopify order importer
//
// Routing:
// - Shopify tag "CouriersPlus" -> Orders
// - Shopify tag "Orders_Other" -> Orders_Other
//
// Customer-name priority:
// 1. Shipping recipient name
// 2. Billing name
// 3. "No customer name"
//
// The importer intentionally does not query Shopify's Customer object, so the
// read_customers scope is not required. It does require read_orders and access
// to the protected order fields used for fulfillment.

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

function runAllImports() {
  var tokenResult = ensureShopifyAccessToken_();
  assertRequiredShopifyScope_(tokenResult.scope, 'read_orders');

  var courierOrders = fetchTaggedOpenOrders_(DW_ORDER_IMPORT.COURIERS_TAG);
  var otherOrders = fetchTaggedOpenOrders_(DW_ORDER_IMPORT.OTHER_TAG)
    .filter(function(order) {
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
    ordersOtherNames: otherOrders.slice(0, 10).map(function(order) {
      return {
        orderId: String(order.name || order.id || '').trim(),
        customerName: orderCustomerName_(order)
      };
    }),
    grantedScopes: tokenResult.scope,
    checkedAt: new Date().toISOString()
  };

  console.log(JSON.stringify(result));
  return result;
}

function installFiveMinuteOrderImportTrigger() {
  removeOrderImportTriggers_();

  ScriptApp.newTrigger('runAllImports')
    .timeBased()
    .everyMinutes(5)
    .create();

  return 'Order import trigger installed: runAllImports every 5 minutes.';
}

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
        '      billingAddress {',
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

function writeTaggedOrdersToSheet_(ss, sheetName, orders, routeTag) {
  var sheet = ss.getSheetByName(sheetName) || ss.insertSheet(sheetName);
  ensureOrderSheetSchema_(sheet);

  var pickedByKey = readExistingPickedState_(sheet);
  var rows = [];

  orders.forEach(function(order) {
    var orderId = String(order.name || order.id || '').trim();
    var customerName = orderCustomerName_(order);
    var addressObject = order.shippingAddress || order.billingAddress;
    var address = orderAddress_(addressObject);
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

function orderCustomerName_(order) {
  var shippingName = order.shippingAddress && order.shippingAddress.name
    ? String(order.shippingAddress.name).trim()
    : '';
  var billingName = order.billingAddress && order.billingAddress.name
    ? String(order.billingAddress.name).trim()
    : '';

  return shippingName || billingName || 'No customer name';
}

function orderAddress_(address) {
  if (!address) return 'No shipping or billing address';

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
