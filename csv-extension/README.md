# Buylist CSV Fixer (Chrome Extension)

A local Chrome extension that:
- Lets you add multiple CSVs one at a time (click or drag & drop)
- Renames the `Product ID` column header to `Product_ID` in each one
- Merges every file you add into a single combined dataset — matching columns by name, so files don't need identical column order
- Displays the combined `Quantity` values (next to `Name`) for every row added so far
- Persists what you've added even if you close and reopen the popup
- Lets you manually **Clear all** to start over
- Lets you download everything you've added as one combined CSV

## Install it locally (Developer Mode)

1. Unzip this folder somewhere on your computer.
2. Open Chrome and go to `chrome://extensions`.
3. Turn on **Developer mode** (top-right toggle).
4. Click **Load unpacked**.
5. Select the unzipped `csv-extension` folder.
6. Pin the extension (puzzle-piece icon in the toolbar → pin "Buylist CSV Fixer").

## Use it

1. Click the extension icon to open the popup.
2. Click the dropzone (or drag a `.csv` file onto it) to add your first CSV. It's fixed (`Product ID` → `Product_ID`) and added to the combined dataset.
3. Add more CSVs the same way — each one is fixed and appended to the same combined dataset. The "Files added" list shows every file and how many rows it contributed; "Combined quantity values" shows every row added so far.
4. Click **Download combined CSV** any time to save everything added so far as one file (named `combined_buylist_<date>.csv`).
5. Click **Clear all** when you want to start fresh — this wipes every file added, all combined rows, and the displayed quantities.

### Keeping the values visible while you work in another tab

The normal toolbar popup closes the moment you click into another tab — that's a Chrome limitation, not something a setting can fix. To get around it, click the **⧉** button in the top-right of the popup. It reopens the same tool as a standalone window (not anchored to the toolbar), so it stays open no matter which tab or window you click into — you can keep it next to your other tab and type the quantities in as you read them off.

## Notes

- All processing happens locally in the popup — nothing is uploaded anywhere. The combined dataset is stored locally via `chrome.storage.local` (not synced, not sent anywhere) so it survives closing/reopening the popup.
- It matches the header `Product ID` case-insensitively (so `product id`, `PRODUCT ID`, etc. also get renamed) and leaves every other column untouched.
- When merging a second (or later) file, columns are matched to the first file's columns **by name**, not position — so if a later CSV has columns in a different order, they'll still land in the right place. Columns that don't exist in the first file's headers are dropped from later files; columns missing from a later file are filled in as blank.
- The downloaded CSV only quotes fields that need it (commas, quotes, or newlines) and has no BOM — this matches what Shopify's importer expects.
- If a CSV doesn't have a `Product ID` or `Quantity` column, the popup will tell you rather than failing silently.
