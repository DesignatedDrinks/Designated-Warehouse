# Designated Warehouse Apps Script backend

This folder prepares Designated Warehouse to move from a legacy Shopify custom app to a modern Shopify **Dev Dashboard app** while also fixing the image-sync and credential-exposure problems.

## What this fixes

1. `ImageLookup` is manually maintained and becomes stale when Shopify product images change or new products are added.
2. The current public `script.js` contains a Google API key. Browser JavaScript cannot keep an API key, token, password, or Client Secret private.
3. The legacy Shopify custom app relies on a manually copied long-lived Admin API token.
4. Product locations must survive every product/image refresh.

## Important security finding

The current Google Sheet contains customer names and shipping addresses and is shared as **Anyone with the link — Viewer**. The GitHub Pages frontend reads the Sheet directly from the browser.

Hiding the API key alone does not secure the data. The production app should not directly expose the Sheet to a public browser. Restrict the Sheet and run data access through an authenticated Apps Script-hosted app or another authenticated backend.

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
- `read_orders` — add this only when the legacy order-import process is migrated into the new app.
- Protected customer data fields: **Name** and **Address** — configure these only if the order importer writes customer names and shipping addresses into the warehouse Sheet.

Do not request write access, payment data, customer email or customer phone unless a confirmed warehouse feature actually requires it.

## What `Code.gs` does

- Pulls active products from Shopify Admin GraphQL API.
- Updates existing `ImageLookup` image URLs.
- Appends new Shopify products automatically.
- Preserves every existing `locCode` in column D.
- Adds the stable Shopify product ID in column E so product-title changes do not disconnect a product from its warehouse location.
- Uses title matching only during the first migration to attach IDs to existing rows.
- Never deletes manual or discontinued rows.
- Rebuilds the image preview formula in column C.
- Includes `backupImageLookup()` to make a timestamped backup tab before the first production sync.
- Provides a server-side `getWarehouseData(mode)` function for a future authenticated frontend.
- Restricts server-side warehouse data to emails listed in `ALLOWED_EMAILS`.

## What `ShopifyDevAppAuth.gs` does

- Requests a Shopify access token using the Dev Dashboard Client ID and Client Secret.
- Caches the generated token and its expiry in Script Properties.
- Reuses a valid token and refreshes it before expiry.
- Uses a script lock to prevent simultaneous token refreshes.
- Verifies that the generated token includes `read_products`.
- Runs the product image sync through `syncShopifyProductImagesWithDevApp()`.
- Tests authentication without rewriting the Sheet through `testShopifyDevAppConnection()`.
- Installs the correct authenticated daily trigger through `installDailyImageSyncWithDevApp()`.
- Clears only Shopify token-cache values through `clearCachedShopifyAccessToken()`.

## `ImageLookup` columns

| Column | Header | Behaviour |
|---|---|---|
| A | `itemTitle` | Updated from Shopify after the product ID has been attached |
| B | `imageUrl` | Automatically refreshed from Shopify |
| C | `imagePreview` | Automatically rebuilt as an `IMAGE()` formula |
| D | `locCode` | **Never overwritten by synchronization** |
| E | `shopifyProductId` | Stable Shopify ID used to protect the row/location when a title changes |

Brand-new products are appended with a blank `locCode`. Assign their location once; later syncs preserve it.

## Script Properties

In Apps Script, open **Project Settings → Script Properties** and add:

| Property | Value |
|---|---|
| `WAREHOUSE_SPREADSHEET_ID` | `1xE9SueE6rdDapXr0l8OtP_IryFM-Z6fHFH27_cQ120g` |
| `VARIETY_SPREADSHEET_ID` | `1TtRNmjsgC64jbkptnCdklBf_HqifwE9SQO2JlGrp4Us` |
| `SHOPIFY_STORE_DOMAIN` | The permanent `*.myshopify.com` store domain |
| `SHOPIFY_CLIENT_ID` | Client ID from the new Shopify Dev Dashboard app |
| `SHOPIFY_CLIENT_SECRET` | Client Secret from the new Shopify Dev Dashboard app |
| `SHOPIFY_API_VERSION` | `2026-07` |
| `ALLOWED_EMAILS` | Comma-separated Google accounts allowed to use the warehouse app |

The code automatically creates and manages these cache properties:

- `SHOPIFY_ADMIN_ACCESS_TOKEN`
- `SHOPIFY_ACCESS_TOKEN_EXPIRES_AT`
- `SHOPIFY_ACCESS_TOKEN_SCOPE`

Do not manually populate the generated token properties.

## Shopify Dev Dashboard setup

1. Open Shopify Dev Dashboard and confirm the Designated Drinks production store appears in the same organization that will own the app.
2. Create an app named **Designated Warehouse**.
3. Start from **Dev Dashboard**, not a legacy admin-created custom app.
4. Create a version.
5. Use Shopify's default app-home URL because the current warehouse UI is not embedded in Shopify Admin.
6. Select Admin API and webhook version `2026-07`.
7. Add `read_products`.
8. When the order-import code is ready to migrate, add `read_orders` and configure protected customer data for **Name** and **Address**.
9. Release the app version.
10. Install the app on the Designated Drinks store.
11. From the app's **Settings**, copy the Client ID and Client Secret into Apps Script Properties.

Do not uninstall the legacy custom app yet. Run the new app in parallel until product sync and order import have both been verified.

## Apps Script installation

1. Open the Apps Script project connected to the warehouse Sheet, or create a standalone project.
2. Add `Code.gs`.
3. Add `ShopifyDevAppAuth.gs`.
4. Enable **Show appsscript.json manifest file** in Project Settings and copy the included manifest.
5. Add the Script Properties listed above.
6. Run `testShopifyDevAppConnection()` and authorize Google permissions.
7. Confirm the returned scopes include `read_products`.
8. Run `backupImageLookup()` once and confirm a timestamped backup tab was created.
9. Run `syncShopifyProductImagesWithDevApp()` once.
10. Spot-check existing column-D `locCode` values and confirm they did not change.
11. Run `installDailyImageSyncWithDevApp()`.

## Legacy app cutover

Use a controlled cutover rather than replacing everything at once:

1. Keep the legacy app installed and operational.
2. Activate the new Dev Dashboard authentication for product-image sync.
3. Verify at least one automatic token refresh and one daily image sync.
4. Open the warehouse spreadsheet's Apps Script editor and locate the functions or triggers that currently populate `Orders` and `Orders_Other`. That source is not stored in this GitHub repository and was not discoverable as a separate Drive file.
5. Migrate the order-import/webhook code to the new authentication flow.
6. Compare the new order output against the legacy output without letting both integrations write duplicate rows.
7. Only after the order import is verified should the legacy custom app be uninstalled and its old token revoked.

## Required security cleanup

1. Rotate or delete the Google API key currently committed in `script.js`. Removing it from the latest file is not enough because it remains in Git history.
2. Restrict the Google Sheet so it is no longer readable by anyone with the link.
3. Stop loading orders, names and addresses directly through the public Google Sheets API.
4. Move the production frontend into Apps Script HTML Service and call `getWarehouseData()` through `google.script.run`, or place the current GitHub frontend behind an authenticated backend.
5. Do not deploy a customer-data endpoint as **Anyone, even anonymous**.

## Secure target architecture

```text
Authenticated warehouse staff
          ↓
Apps Script HTML app / authenticated backend
          ↓
Google Sheets + Shopify Dev Dashboard app
          ↓
Short-lived Shopify Admin API token
```

GitHub can remain the source-control location, but it should not be the unauthenticated production data layer for customer shipping information.
