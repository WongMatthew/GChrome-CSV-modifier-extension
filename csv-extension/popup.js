// ---------- CSV parsing helpers ----------

// Parses CSV text into an array of rows (each row = array of field strings).
// Handles quoted fields, escaped quotes (""), commas inside quotes, and CRLF/LF.
function parseCSV(text) {
  // Strip UTF-8 BOM if present
  if (text.charCodeAt(0) === 0xfeff) {
    text = text.slice(1);
  }

  const rows = [];
  let row = [];
  let field = "";
  let inQuotes = false;
  let i = 0;
  const len = text.length;

  while (i < len) {
    const char = text[i];

    if (inQuotes) {
      if (char === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i += 2;
          continue;
        }
        inQuotes = false;
        i++;
        continue;
      }
      field += char;
      i++;
      continue;
    }

    if (char === '"') {
      inQuotes = true;
      i++;
      continue;
    }

    if (char === ",") {
      row.push(field);
      field = "";
      i++;
      continue;
    }

    if (char === "\r") {
      i++;
      continue;
    }

    if (char === "\n") {
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
      i++;
      continue;
    }

    field += char;
    i++;
  }

  // Push last field/row if the file doesn't end with a newline
  if (field.length > 0 || row.length > 0) {
    row.push(field);
    rows.push(row);
  }

  // Drop fully-empty trailing rows (e.g. trailing blank line)
  return rows.filter((r) => !(r.length === 1 && r[0] === ""));
}

// Serializes rows back into CSV text. Only quotes a field when it actually
// needs it (contains a comma, quote, or newline) — matches plain, minimally
// quoted CSV, which is what Shopify's importer expects.
function csvEscapeField(value) {
  const str = String(value);
  if (/[",\r\n]/.test(str)) {
    return `"${str.replace(/"/g, '""')}"`;
  }
  return str;
}

function toCSV(rows) {
  return rows
    .map((row) => row.map(csvEscapeField).join(","))
    .join("\r\n");
}

// ---------- App state ----------
//
// The extension now accumulates data across multiple uploaded CSVs into one
// combined dataset:
//   - headers: the "master" column list, taken from the first file added
//   - rows: every data row from every file added so far, reordered to match
//     `headers` by column NAME (so files with columns in a different order
//     still merge correctly)
//   - files: metadata about each file added, for the file list UI
//
// State is persisted to chrome.storage.local so it survives closing and
// reopening the popup — "Clear all" is the only thing that resets it.

let state = {
  headers: [],
  rows: [],
  files: [], // { name, rowCount }
};

const STORAGE_KEY = "combinedCsvState";

function saveState() {
  chrome.storage.local.set({ [STORAGE_KEY]: state });
}

function loadState(callback) {
  chrome.storage.local.get([STORAGE_KEY], (result) => {
    if (result && result[STORAGE_KEY]) {
      state = result[STORAGE_KEY];
    }
    callback();
  });
}

// ---------- DOM references ----------

const dropzone = document.getElementById("dropzone");
const dropzoneText = document.getElementById("dropzoneText");
const fileInput = document.getElementById("fileInput");
const fileList = document.getElementById("fileList");
const fileCount = document.getElementById("fileCount");
const downloadBtn = document.getElementById("downloadBtn");
const clearBtn = document.getElementById("clearBtn");
const statusEl = document.getElementById("status");
const quantityList = document.getElementById("quantityList");
const quantityCount = document.getElementById("quantityCount");
const popOutBtn = document.getElementById("popOutBtn");

// ---------- Pop-out window ----------
// The toolbar action popup closes as soon as another tab/window gets focus.
// To let the user keep the values visible while typing into another tab,
// offer a button that reopens this same page as a normal, independent
// browser window (via chrome.windows.create), which does NOT auto-close.

const params = new URLSearchParams(window.location.search);
const isStandalone = params.get("standalone") === "1";

if (isStandalone) {
  // Already in a standalone window — no need to offer popping out again.
  popOutBtn.classList.add("hidden");
} else if (popOutBtn) {
  popOutBtn.addEventListener("click", () => {
    const url = chrome.runtime.getURL("popup.html?standalone=1");
    chrome.windows.create({
      url,
      type: "popup",
      width: 380,
      height: 640,
    });
    // Close the anchored popup now that the standalone window has opened.
    window.close();
  });
}

// ---------- Event wiring ----------

dropzone.addEventListener("click", (e) => {
  // Let the native label->input click happen; nothing extra needed.
});

fileInput.addEventListener("change", (e) => {
  const file = e.target.files[0];
  if (file) handleFile(file);
});

["dragenter", "dragover"].forEach((evt) => {
  dropzone.addEventListener(evt, (e) => {
    e.preventDefault();
    e.stopPropagation();
    dropzone.classList.add("dragover");
  });
});

["dragleave", "drop"].forEach((evt) => {
  dropzone.addEventListener(evt, (e) => {
    e.preventDefault();
    e.stopPropagation();
    dropzone.classList.remove("dragover");
  });
});

dropzone.addEventListener("drop", (e) => {
  const file = e.dataTransfer.files[0];
  if (file) handleFile(file);
});

downloadBtn.addEventListener("click", downloadFixedCSV);
clearBtn.addEventListener("click", clearAll);

// ---------- Core logic ----------

function handleFile(file) {
  if (!file.name.toLowerCase().endsWith(".csv")) {
    setStatus("Please choose a .csv file.", "error");
    return;
  }

  const reader = new FileReader();
  reader.onload = () => {
    try {
      processCSVText(reader.result, file.name);
    } catch (err) {
      console.error(err);
      setStatus("Couldn't parse that CSV. Check the file and try again.", "error");
    }
  };
  reader.onerror = () => setStatus("Failed to read the file.", "error");
  reader.readAsText(file);
}

function processCSVText(text, fileName) {
  const rows = parseCSV(text);
  if (rows.length === 0) {
    setStatus("That CSV appears to be empty.", "error");
    return;
  }

  const rawHeaders = rows[0];
  const dataRows = rows.slice(1);

  // Rename "Product ID" -> "Product_ID" (case-insensitive, trims whitespace)
  const fixedHeaders = rawHeaders.map((h) =>
    h.trim().toLowerCase() === "product id" ? "Product_ID" : h
  );
  const renamed = fixedHeaders.some((h, idx) => h !== rawHeaders[idx]);

  if (state.headers.length === 0) {
    // First file added: it defines the combined header order.
    state.headers = fixedHeaders;
    state.rows.push(...dataRows);
  } else {
    // Subsequent files: reorder each row to match the master headers by
    // column NAME, so column order differences between files don't matter.
    // Columns present in this file but not in the master list are dropped;
    // columns missing from this file are filled in as "".
    const indexByName = new Map();
    fixedHeaders.forEach((h, idx) => {
      indexByName.set(h.trim().toLowerCase(), idx);
    });

    const aligned = dataRows.map((row) =>
      state.headers.map((masterHeader) => {
        const srcIdx = indexByName.get(masterHeader.trim().toLowerCase());
        return srcIdx === undefined ? "" : row[srcIdx] ?? "";
      })
    );
    state.rows.push(...aligned);
  }

  state.files.push({ name: fileName, rowCount: dataRows.length });
  saveState();

  renderFileList();
  renderQuantities();

  downloadBtn.disabled = state.rows.length === 0;
  clearBtn.disabled = state.files.length === 0;

  setStatus(
    renamed
      ? `Added "${fileName}" (${dataRows.length} row${
          dataRows.length === 1 ? "" : "s"
        }). "Product ID" renamed to "Product_ID".`
      : `Added "${fileName}" (${dataRows.length} row${
          dataRows.length === 1 ? "" : "s"
        }) — no "Product ID" column found.`,
    renamed ? "success" : "error"
  );

  dropzoneText.textContent = "Click to add another CSV, or drag & drop it here";
}

function renderFileList() {
  if (state.files.length === 0) {
    fileList.innerHTML = "";
    fileList.classList.add("empty");
    fileList.textContent = "No CSVs added yet.";
    fileCount.textContent = "0";
    return;
  }

  fileList.classList.remove("empty");
  fileList.innerHTML = "";

  const frag = document.createDocumentFragment();
  state.files.forEach((f) => {
    const rowEl = document.createElement("div");
    rowEl.className = "file-row";

    const nameEl = document.createElement("span");
    nameEl.className = "file-name";
    nameEl.textContent = f.name;
    nameEl.title = f.name;

    const countEl = document.createElement("span");
    countEl.className = "file-rows";
    countEl.textContent = `${f.rowCount} row${f.rowCount === 1 ? "" : "s"}`;

    rowEl.appendChild(nameEl);
    rowEl.appendChild(countEl);
    frag.appendChild(rowEl);
  });

  fileList.appendChild(frag);
  fileCount.textContent = String(state.files.length);
}

function renderQuantities() {
  const headers = state.headers;
  const dataRows = state.rows;

  const qtyIndex = headers.findIndex(
    (h) => h.trim().toLowerCase() === "quantity"
  );
  const nameIndex = headers.findIndex(
    (h) => h.trim().toLowerCase() === "name"
  );

  if (qtyIndex === -1) {
    quantityList.innerHTML = "";
    quantityList.classList.add("empty");
    quantityList.textContent = 'No "Quantity" column found in this CSV.';
    quantityCount.textContent = "0";
    return;
  }

  if (dataRows.length === 0) {
    quantityList.innerHTML = "";
    quantityList.classList.add("empty");
    quantityList.textContent = "No data rows found.";
    quantityCount.textContent = "0";
    return;
  }

  quantityList.classList.remove("empty");
  quantityList.innerHTML = "";

  const frag = document.createDocumentFragment();
  dataRows.forEach((row) => {
    const qty = row[qtyIndex] ?? "";
    const name = nameIndex !== -1 ? row[nameIndex] ?? "" : "";

    const rowEl = document.createElement("div");
    rowEl.className = "quantity-row";

    const nameEl = document.createElement("span");
    nameEl.className = "qty-name";
    nameEl.textContent = name || "(unnamed row)";
    nameEl.title = name;

    const qtyEl = document.createElement("span");
    qtyEl.className = "qty-value";
    qtyEl.textContent = qty;

    rowEl.appendChild(nameEl);
    rowEl.appendChild(qtyEl);
    frag.appendChild(rowEl);
  });

  quantityList.appendChild(frag);
  quantityCount.textContent = String(dataRows.length);
}

function downloadFixedCSV() {
  if (state.rows.length === 0) return;

  const csvText = toCSV([state.headers, ...state.rows]);
  const blob = new Blob([csvText], {
    type: "text/csv;charset=utf-8;",
  });
  const url = URL.createObjectURL(blob);

  const stamp = new Date().toISOString().slice(0, 10);
  const outName = `combined_buylist_${stamp}.csv`;

  const a = document.createElement("a");
  a.href = url;
  a.download = outName;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);

  setStatus(`Downloaded ${outName} (${state.rows.length} total rows).`, "success");
}

// Clears the entire combined dataset — every file added, all rows, and the
// displayed quantities. This is the explicit "start over" action.
function clearAll() {
  state = { headers: [], rows: [], files: [] };
  saveState();

  renderFileList();
  renderQuantities();

  downloadBtn.disabled = true;
  clearBtn.disabled = true;

  dropzoneText.textContent = "Click to add a CSV, or drag & drop it here";
  setStatus("Cleared. All added files and combined rows removed.", "success");
}

function setStatus(message, kind) {
  statusEl.textContent = message;
  statusEl.className = `status ${kind || ""}`.trim();
}

// ---------- Init ----------
// Restore whatever combined dataset was built up in previous popup sessions.

loadState(() => {
  renderFileList();
  renderQuantities();

  downloadBtn.disabled = state.rows.length === 0;
  clearBtn.disabled = state.files.length === 0;

  if (state.files.length > 0) {
    dropzoneText.textContent = "Click to add another CSV, or drag & drop it here";
  }
});
