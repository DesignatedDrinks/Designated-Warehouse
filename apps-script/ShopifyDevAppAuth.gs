// Designated Warehouse — Shopify Dev Dashboard authentication
//
// This file replaces a manually copied legacy custom-app token with Shopify's
// client credentials grant for an app created in the Dev Dashboard.
//
// Required Script Properties:
// - SHOPIFY_STORE_DOMAIN
// - SHOPIFY_CLIENT_ID
// - SHOPIFY_CLIENT_SECRET
//
// The generated 24-hour access token is cached in Script Properties under the
// existing SHOPIFY_ADMIN_ACCESS_TOKEN name so Code.gs can use it without ever
// exposing the Client Secret or requiring a permanent token.

var SHOPIFY_DEV_APP_CONFIG = {
  CLIENT_ID: 'SHOPIFY_CLIENT_ID',
  CLIENT_SECRET: 'SHOPIFY_CLIENT_SECRET',
  TOKEN_PROPERTY: 'SHOPIFY_ADMIN_ACCESS_TOKEN',
  TOKEN_EXPIRY_PROPERTY: 'SHOPIFY_ACCESS_TOKEN_EXPIRES_AT',
  TOKEN_SCOPE_PROPERTY: 'SHOPIFY_ACCESS_TOKEN_SCOPE'
};

/**
 * Safely runs the Shopify image sync using a current Dev Dashboard token.
 * Use this function for manual runs and scheduled triggers.
 */
function syncShopifyProductImagesWithDevApp() {
  ensureShopifyAccessToken_();
  return syncShopifyProductImages();
}

/**
 * Tests the Dev Dashboard credentials and confirms product access.
 * Does not modify ImageLookup.
 */
function testShopifyDevAppConnection() {
  var tokenResult = ensureShopifyAccessToken_();
  var productResult = testShopifyConnection();

  return {
    ok: true,
    tokenRefreshed: tokenResult.refreshed,
    tokenExpiresAt: tokenResult.expiresAt,
    grantedScopes: tokenResult.scope,
    activeProductsFound: productResult.activeProductsFound,
    productsWithImages: productResult.productsWithImages
  };
}

/**
 * Installs one daily trigger for the authenticated image sync.
 * Any legacy direct-sync or duplicate Dev Dashboard triggers are removed.
 */
function installDailyImageSyncWithDevApp() {
  removeImageSyncTriggers();
  removeDevAppImageSyncTriggers_();

  ScriptApp.newTrigger('syncShopifyProductImagesWithDevApp')
    .timeBased()
    .everyDays(1)
    .atHour(3)
    .create();

  return 'Daily Dev Dashboard image sync installed for approximately 3:00 AM in the Apps Script project timezone.';
}

/**
 * Removes the cached short-lived token. The next sync automatically gets a new
 * one from Shopify using the Client ID and Client Secret.
 */
function clearCachedShopifyAccessToken() {
  PropertiesService.getScriptProperties().deleteAllProperties();

  throw new Error(
    'Cancelled for safety: this function would remove unrelated Script Properties. ' +
    'Use clearCachedShopifyAccessTokenSafely() instead.'
  );
}

/** Removes only Shopify-generated token cache values. */
function clearCachedShopifyAccessTokenSafely() {
  var properties = PropertiesService.getScriptProperties();
  properties.deleteProperty(SHOPIFY_DEV_APP_CONFIG.TOKEN_PROPERTY);
  properties.deleteProperty(SHOPIFY_DEV_APP_CONFIG.TOKEN_EXPIRY_PROPERTY);
  properties.deleteProperty(SHOPIFY_DEV_APP_CONFIG.TOKEN_SCOPE_PROPERTY);

  return 'Cached Shopify access token removed. The next Shopify request will generate a fresh token.';
}

function ensureShopifyAccessToken_() {
  var properties = PropertiesService.getScriptProperties();
  var token = String(properties.getProperty(SHOPIFY_DEV_APP_CONFIG.TOKEN_PROPERTY) || '').trim();
  var expiresAt = Number(properties.getProperty(SHOPIFY_DEV_APP_CONFIG.TOKEN_EXPIRY_PROPERTY) || 0);
  var scope = String(properties.getProperty(SHOPIFY_DEV_APP_CONFIG.TOKEN_SCOPE_PROPERTY) || '').trim();
  var now = Date.now();
  var refreshBufferMs = 5 * 60 * 1000;

  if (token && expiresAt > now + refreshBufferMs) {
    return {
      refreshed: false,
      expiresAt: new Date(expiresAt).toISOString(),
      scope: scope
    };
  }

  return requestShopifyAccessToken_();
}

function requestShopifyAccessToken_() {
  var properties = PropertiesService.getScriptProperties();
  var storeDomain = requiredProperty_(DW_CONFIG.SHOPIFY_STORE_DOMAIN)
    .replace(/^https?:\/\//i, '')
    .replace(/\/$/, '');
  var clientId = requiredProperty_(SHOPIFY_DEV_APP_CONFIG.CLIENT_ID);
  var clientSecret = requiredProperty_(SHOPIFY_DEV_APP_CONFIG.CLIENT_SECRET);
  var tokenEndpoint = 'https://' + storeDomain + '/admin/oauth/access_token';

  var formBody = [
    'grant_type=' + encodeURIComponent('client_credentials'),
    'client_id=' + encodeURIComponent(clientId),
    'client_secret=' + encodeURIComponent(clientSecret)
  ].join('&');

  var response = UrlFetchApp.fetch(tokenEndpoint, {
    method: 'post',
    contentType: 'application/x-www-form-urlencoded',
    payload: formBody,
    muteHttpExceptions: true
  });

  var status = response.getResponseCode();
  var body = response.getContentText();

  if (status < 200 || status >= 300) {
    throw new Error(
      'Shopify client-credentials request failed (' + status + '): ' +
      sanitizeShopifyAuthError_(body)
    );
  }

  var parsed;

  try {
    parsed = JSON.parse(body);
  } catch (error) {
    throw new Error('Shopify returned invalid JSON while requesting an access token.');
  }

  var accessToken = String(parsed.access_token || '').trim();
  var expiresInSeconds = Number(parsed.expires_in || 0);
  var scope = String(parsed.scope || '').trim();

  if (!accessToken || !expiresInSeconds) {
    throw new Error('Shopify token response was missing access_token or expires_in.');
  }

  var expiresAt = Date.now() + expiresInSeconds * 1000;
  var cacheValues = {};
  cacheValues[SHOPIFY_DEV_APP_CONFIG.TOKEN_PROPERTY] = accessToken;
  cacheValues[SHOPIFY_DEV_APP_CONFIG.TOKEN_EXPIRY_PROPERTY] = String(expiresAt);
  cacheValues[SHOPIFY_DEV_APP_CONFIG.TOKEN_SCOPE_PROPERTY] = scope;
  properties.setProperties(cacheValues, false);

  return {
    refreshed: true,
    expiresAt: new Date(expiresAt).toISOString(),
    scope: scope
  };
}

function removeDevAppImageSyncTriggers_() {
  ScriptApp.getProjectTriggers().forEach(function(trigger) {
    if (trigger.getHandlerFunction() === 'syncShopifyProductImagesWithDevApp') {
      ScriptApp.deleteTrigger(trigger);
    }
  });
}

function sanitizeShopifyAuthError_(body) {
  var text = String(body || 'Unknown authentication error');

  // Never echo credentials or token-like values into logs or the Apps Script UI.
  return text
    .replace(/shpat_[A-Za-z0-9_-]+/g, '[REDACTED_TOKEN]')
    .replace(/shpua_[A-Za-z0-9_-]+/g, '[REDACTED_TOKEN]')
    .slice(0, 1000);
}
