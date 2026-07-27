# Designated Warehouse Apps Script backend

This folder fixes two problems in the current warehouse app:

1. `ImageLookup` is manually maintained and becomes stale when Shopify product images change or new products are added.
2. The current public `script.js` contains a Google API key. Browser JavaScript cannot keep an API key, token, or password secret.

## Important security finding

The current Google Sheet contains customer names and shipping addresses and is shared as **Anyone with the link — Viewer**. The GitHub Pages frontend reads the Sheet directly from the browser.

Hiding the API key alone does not secure the data. The production app should not directly expose the Sheet to a public browser. Restrict the Sheet and run the data access through an authenticated Apps Script-hosted app or another authenticated backend.

## What `Code.gs` does

- Reads Shopify credentials from Apps Script **Script Properties**.
- Pulls active products from Shopify Admin GraphQL API.
- Updates existing `ImageLookup` image URLs.
- Appends new Shopify products automatically.
- Preserves the existing `locCode` values and row order.
- Rebuilds the image preview formula in column C.
- Provides a daily time-driven trigger installer.
- Provides a server-side `getWarehouseData(mode)` function for a future Apps Script-hosted frontend.
- Restricts server-side warehouse data to emails listed in `ALLOWED_EMAILS`.

## Script Properties

In Apps Script, open **Project Settings → Script Properties** and add:

| Property | Value |
|---|---|
| `WAREHOUSE_SPREADSHEET_ID` | `1xE9SueE6rdDapXr0l8OtP_IryFM-Z6fHFH27_cQ120g` |
| `VARIETY_SPREADSHEET_ID` | `1TtRNmjsgC64jbkptnCdklBf_HqifwE9SQO2JlGrp4Us` |
| `SHOPIFY_STORE_DOMAIN` | Your `*.myshopify.com` store domain |
| `SHOPIFY_ADMIN_ACCESS_TOKEN` | Shopify custom-app Admin API token with `read_products` |
| `SHOPIFY_API_VERSION` | `2026-07` |
| `ALLOWED_EMAILS` | Comma-separated Google accounts allowed to use the warehouse app |

Do not put these values in GitHub, `Code.gs`, HTML, or client-side JavaScript.

## Installation

1. Open the Apps Script project that currently updates the warehouse Sheet, or create a standalone Apps Script project.
2. Copy `Code.gs` into the project.
3. Enable **Show appsscript.json manifest file** in Project Settings and copy the included manifest.
4. Add the Script Properties listed above.
5. Run `testShopifyConnection()` and authorize the requested permissions.
6. Run `syncShopifyProductImages()` once and confirm `ImageLookup` columns A–D are correct.
7. Run `installDailyImageSync()` to refresh the images every day at approximately 3:00 AM Toronto time.

## Required security cleanup

1. Rotate or delete the Google API key currently committed in `script.js`. Removing it from the latest file is not enough because it remains in Git history.
2. Restrict the Google Sheet so it is no longer readable by anyone with the link.
3. Stop loading orders, names, and addresses directly through the public Google Sheets API.
4. Move the production frontend into Apps Script HTML Service and call `getWarehouseData()` through `google.script.run`, or place the current GitHub frontend behind a proper authenticated backend.
5. Do not deploy a customer-data endpoint as **Anyone, even anonymous**.

## Frontend migration note

The existing GitHub Pages application cannot securely hold credentials. A value placed in JavaScript, a `.env` file compiled into the site, a hidden HTML field, or an obfuscated string is still public to every browser visitor.

The secure target architecture is:

```text
Authenticated staff browser
        ↓
Apps Script HTML app / authenticated backend
        ↓
Google Sheets + Shopify Admin API
```

GitHub can remain the source-control location, but it should not be the unauthenticated production data layer for customer shipping information.
