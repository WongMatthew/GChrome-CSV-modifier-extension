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

// Serializes rows back into CSV text, quoting every field (matches the
// original file's formatting, which quotes all fields).
function toCSV(rows) {
  return rows
    .map((row) =>
      row
        .map((field) => `"${String(field).replace(/"/g, '""')}"`)
        .join(",")
    )
    .join("\r\n");
}

// ---------- App state ----------

let state = {
  fileName: null,
  headers: [],
  rows: [],
  fixedCSVText: null,
};

// ---------- DOM references ----------

const dropzone = document.getElementById("dropzone");
const dropzoneText = document.getElementById("dropzoneText");
const fileInput = document.getElementById("fileInput");
const fileInfo = document.getElementById("fileInfo");
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

  const headers = rows[0];
  const dataRows = rows.slice(1);

  // Rename "Product ID" -> "Product_ID" (case-insensitive, trims whitespace)
  const fixedHeaders = headers.map((h) =>
    h.trim().toLowerCase() === "product id" ? "Product_ID" : h
  );

  const renamed = fixedHeaders.some((h, idx) => h !== headers[idx]);

  const fixedRows = [fixedHeaders, ...dataRows];
  const fixedCSVText = toCSV(fixedRows);

  state = {
    fileName,
    headers: fixedHeaders,
    rows: dataRows,
    fixedCSVText,
  };

  fileInfo.textContent = `${fileName} — ${dataRows.length} row${
    dataRows.length === 1 ? "" : "s"
  } loaded`;
  fileInfo.classList.remove("hidden");

  downloadBtn.disabled = false;
  clearBtn.disabled = false;

  renderQuantities(fixedHeaders, dataRows);

  setStatus(
    renamed
      ? '"Product ID" renamed to "Product_ID". Ready to download.'
      : 'No "Product ID" column found — file loaded as-is.',
    renamed ? "success" : "error"
  );
}

function renderQuantities(headers, dataRows) {
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
  if (!state.fixedCSVText) return;

  const blob = new Blob(["\ufeff" + state.fixedCSVText], {
    type: "text/csv;charset=utf-8;",
  });
  const url = URL.createObjectURL(blob);

  const baseName = state.fileName.replace(/\.csv$/i, "");
  const outName = `${baseName}_fixed.csv`;

  const a = document.createElement("a");
  a.href = url;
  a.download = outName;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);

  setStatus(`Downloaded ${outName}`, "success");
}

// Clears only the displayed quantity values (per the "clear displayed
// values manually" requirement) without discarding the loaded file, so a
// download is still possible afterward.
function clearAll() {
  quantityList.innerHTML = "";
  quantityList.classList.add("empty");
  quantityList.textContent = "Cleared. Upload a CSV to see values again.";
  quantityCount.textContent = "0";
  setStatus("Displayed values cleared.", "success");
}

function setStatus(message, kind) {
  statusEl.textContent = message;
  statusEl.className = `status ${kind || ""}`.trim();
}
