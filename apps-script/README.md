# Designated Warehouse Apps Script backend

This folder prepares Designated Warehouse to move from a legacy Shopify custom app to a modern Shopify **Dev Dashboard app** while fixing automatic product-image synchronization and Shopify credential handling.

## Chosen deployment model

Designated Warehouse will remain a small no-login internal tool:

```text
Warehouse iPad / staff browser
          ↓
Public GitHub Pages URL
          ↓
Google Sheet shared as anyone-with-link viewer
```

This preserves the current one-tap iPad workflow. It is an intentional convenience-versus-privacy tradeoff: anyone who obtains the exact app or Sheet URL could read the order data exposed by the Sheet.

The public frontend must never receive the Shopify Client Secret, Shopify access token or any other privileged credential. Shopify authentication and synchronization run only inside Apps Script.

## What this fixes

1. `ImageLookup` becomes stale when Shopify product images change or new products are added.
2. The current browser Google API key has already been committed publicly and should be rotated.
3. The legacy Shopify custom app relies on a manually copied long-lived Admin API token.
4. Product locations must survive every product and image refresh.

## Public Google Sheets access

The Google Sheet can remain **Anyone with the link — Viewer** by owner choice.

The Google Sheets browser API key is not treated as a secret. Instead, the replacement key should be tightly restricted in Google Cloud:

- Application restriction: **Websites / HTTP referrers**.
- Allow only the exact Designated Warehouse GitHub Pages origin and required localhost origin during testing.
- API restriction: **Google Sheets API only**.
- Set reasonable quota limits and alerts.
- Rotate the old key because it already exists in Git history.

These restrictions reduce key abuse. They do not make the underlying anyone-with-link Sheet private.

## Modern Shopify authentication

The replacement app is created in Shopify's Dev Dashboard and installed on the Designated Drinks store. The app and production store must appear in the same Shopify organization for the client-credentials flow used here.

Apps Script stores these long-lived credentials in **Script Properties**:

- Shopify Client ID
- Shopify Client Secret

`ShopifyDevAppAuth.gs` exchanges those credentials for a short-lived Shopify Admin API access token. The generated token lasts approximately 24 hours, is cached in Script Properties and is automatically replaced before it expires.

No Shopify credential belongs in GitHub Pages, `script.js`, HTML or committed source code.

## Minimum Shopify access

Use the smallest access set that supports the warehouse:

- `read_products` — required for product IDs, titles and images.
- `read_orders` — add only when the legacy order-import process is migrated into the new app.
- Protected customer data fields: **Name** and **Address** — configure only if the order importer writes customer names and shipping addresses into the warehouse Sheet.

Do not request write access, payment data, customer email or customer phone unless a confirmed warehouse feature requires it.

## What `Code.gs` does

- Pulls active products from Shopify Admin GraphQL API.
- Updates existing `ImageLookup` image URLs.
- Appends new Shopify products automatically.
- Preserves every existing `locCode` in column D.
- Adds the stable Shopify product ID in column E so title changes do not disconnect a product from its location.
- Uses title matching only during the first migration to attach IDs to existing rows.
- Never deletes manual or discontinued rows.
- Rebuilds the image preview formula in column C.
- Includes `backupImageLookup()` to make a timestamped backup tab before the first production sync.
- Includes an optional authenticated `getWarehouseData(mode)` method for a future private frontend; the current no-login GitHub Pages frontend does not need to use it.

## What `ShopifyDevAppAuth.gs` does

- Requests a Shopify access token using the Dev Dashboard Client ID and Client Secret.
- Caches the generated token and expiry in Script Properties.
- Reuses a valid token and refreshes it before expiry.
- Uses a script lock to prevent simultaneous token refreshes.
- Verifies that the generated token includes `read_products`.
- Runs image sync through `syncShopifyProductImagesWithDevApp()`.
- Tests authentication without rewriting the Sheet through `testShopifyDevAppConnection()`.
- Installs the authenticated daily trigger through `installDailyImageSyncWithDevApp()`.
- Clears only Shopify token-cache values through `clearCachedShopifyAccessToken()`.

## `ImageLookup` columns

| Column | Header | Behaviour |
|---|---|---|
| A | `itemTitle` | Updated from Shopify after the product ID has been attached |
| B | `imageUrl` | Automatically refreshed from Shopify |
| C | `imagePreview` | Automatically rebuilt as an `IMAGE()` formula |
| D | `locCode` | **Never overwritten by synchronization** |
| E | `shopifyProductId` | Stable Shopify ID used to protect the row and location when a title changes |

Brand-new products are appended with a blank `locCode`. Assign their location once; later syncs preserve it.

## Script Properties

In Apps Script, open **Project Settings → Script Properties** and add:

| Property | Value |
|---|---|
| `WAREHOUSE_SPREADSHEET_ID` | `1xE9SueE6rdDapXr0l8OtP_IryFM-Z6fHFH27_cQ120g` |
| `VARIETY_SPREADSHEET_ID` | `1TtRNmjsgC64jbkptnCdklBf_HqifwE9SQO2JlGrp4Us` |
| `SHOPIFY_STORE_DOMAIN` | Permanent `*.myshopify.com` store domain |
| `SHOPIFY_CLIENT_ID` | Client ID from the Shopify Dev Dashboard app |
| `SHOPIFY_CLIENT_SECRET` | Client Secret from the Shopify Dev Dashboard app |
| `SHOPIFY_API_VERSION` | `2026-07` |
| `ALLOWED_EMAILS` | Optional; only needed if the authenticated `getWarehouseData()` method is later used |

The code automatically creates and manages:

- `SHOPIFY_ADMIN_ACCESS_TOKEN`
- `SHOPIFY_ACCESS_TOKEN_EXPIRES_AT`
- `SHOPIFY_ACCESS_TOKEN_SCOPE`

Do not manually populate the generated token properties.

## Shopify Dev Dashboard setup

1. Confirm the Designated Drinks production store appears in the same Shopify organization that will own the app.
2. Create an app named **Designated Warehouse**.
3. Start from **Dev Dashboard**, not a legacy admin-created custom app.
4. Create an app version.
5. Use Shopify's default app-home URL because the warehouse UI is not embedded in Shopify Admin.
6. Select Admin API and webhook version `2026-07`.
7. Add `read_products`.
8. When order-import code is ready to migrate, add `read_orders` and protected customer fields **Name** and **Address**.
9. Release the app version.
10. Install it on the Designated Drinks store.
11. Copy the Client ID and Client Secret into Apps Script Properties.

Do not uninstall the legacy custom app yet. Run the new app in parallel until product sync and order import are verified.

## Apps Script installation

1. Open the Apps Script project connected to the warehouse Sheet, or create a standalone project.
2. Add `Code.gs`.
3. Add `ShopifyDevAppAuth.gs`.
4. Enable **Show appsscript.json manifest file** and copy the included manifest.
5. Add the Script Properties listed above.
6. Run `testShopifyDevAppConnection()` and authorize Google permissions.
7. Confirm returned scopes include `read_products`.
8. Run `backupImageLookup()` once and confirm a timestamped backup tab was created.
9. Run `syncShopifyProductImagesWithDevApp()` once.
10. Spot-check column-D `locCode` values and confirm they did not change.
11. Run `installDailyImageSyncWithDevApp()`.

## Legacy app cutover

1. Keep the legacy app installed and operational.
2. Activate the new Dev Dashboard authentication for product-image sync.
3. Verify at least one automatic token refresh and daily image sync.
4. Open the warehouse spreadsheet's Apps Script editor and locate the functions or triggers that populate `Orders` and `Orders_Other`.
5. Migrate the order-import or webhook code to the new authentication flow.
6. Compare new output against legacy output without allowing duplicate order rows.
7. Only after order import is verified should the legacy custom app be uninstalled and its token revoked.

## Final architecture

```text
No-login warehouse iPad
          ↓
GitHub Pages frontend
          ↓
Anyone-with-link Google Sheet

Apps Script scheduled sync
          ↓
Shopify Dev Dashboard Client ID + Client Secret
          ↓
Automatically refreshed short-lived Admin API token
          ↓
Shopify products and images
```

The public Google Sheet and private Shopify credentials are deliberately separated. Keeping the Sheet public preserves convenience; keeping Shopify credentials server-side prevents the warehouse webpage from controlling or impersonating the Shopify app.