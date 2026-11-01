# Maps Lead Finder v1.7 — Accurate Email Totals + PNG Icons

## Email count fix
The dashboard and Copy emails both call the same `getUniqueValidEmails()` function. It searches for individual email-address tokens anywhere inside each lead's email field, so a single row such as:

`ada.support@greyhound.com; group.sales@greyhound.com`

counts as **2 email addresses**. Duplicate addresses across different businesses count once. The dashboard refreshes when saved leads change, and the Copy action copies the same unique address list represented by the counter.

## New extension icons
Custom PNG icons are included at 16x16, 32x32, 48x48, and 128x128, and are registered as the Chrome toolbar and extension icons.

## Update safely
1. Export your CSV backup.
2. Extract the v1.7 ZIP.
3. If you are using an unpacked extension, replace the files in the existing extension folder (including the `icons` folder), then click Reload at `chrome://extensions/`.
4. Keep the same extension folder / extension ID to retain local saved leads. Loading this as a separate extension creates separate storage.
5. Reopen the popup. The Emails found total should equal the number of unique addresses copied by Copy emails.

All existing collection and email scanning features are retained.
