# Buylist CSV Fixer (Chrome Extension)

A local Chrome extension that:
- Lets you upload a CSV (click or drag & drop)
- Renames the `Product ID` column header to `Product_ID`
- Displays every row's `Quantity` value (next to its `Name`) in the popup
- Lets you manually clear the displayed values (without losing the loaded file)
- Re-populates the displayed values automatically whenever you upload a new CSV
- Lets you download the fixed CSV

## Install it locally (Developer Mode)

1. Unzip this folder somewhere on your computer.
2. Open Chrome and go to `chrome://extensions`.
3. Turn on **Developer mode** (top-right toggle).
4. Click **Load unpacked**.
5. Select the unzipped `csv-extension` folder.
6. Pin the extension (puzzle-piece icon in the toolbar → pin "Buylist CSV Fixer").

## Use it

1. Click the extension icon to open the popup.
2. Click the dropzone (or drag a `.csv` file onto it) to load your CSV.
3. The popup will:
   - Rename `Product ID` → `Product_ID` in the header row
   - List each row's Quantity value below
4. Click **Download fixed CSV** to save the corrected file (saved as `<original name>_fixed.csv` via Chrome's normal download flow).
5. Click **Clear** to wipe the displayed quantity list at any time — uploading a new CSV will repopulate it.

### Keeping the values visible while you work in another tab

The normal toolbar popup closes the moment you click into another tab — that's a Chrome limitation, not something a setting can fix. To get around it, click the **⧉** button in the top-right of the popup. It reopens the same tool as a standalone window (not anchored to the toolbar), so it stays open no matter which tab or window you click into — you can keep it next to your other tab and type the quantities in as you read them off.

## Notes

- All processing happens locally in the popup — nothing is uploaded anywhere.
- The extension requests no special permissions.
- It matches the header `Product ID` case-insensitively (so `product id`, `PRODUCT ID`, etc. also get renamed) and leaves every other column untouched.
- If your CSV doesn't have a `Product ID` or `Quantity` column, the popup will tell you rather than failing silently.
