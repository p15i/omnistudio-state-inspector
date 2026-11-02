const btn = document.getElementById("query-btn");
const output = document.getElementById("output");
const snapshotSelect = document.getElementById("snapshot-select");
const olderBtn = document.getElementById("older-btn");
const newerBtn = document.getElementById("newer-btn");
const copyBtn = document.getElementById("copy-btn");
const monitorLabel = document.getElementById("monitor-label");
const monitorCheckbox = document.getElementById("monitor-checkbox");

// Monitoring interval in milliseconds. Configurable here in code.
const MONITOR_INTERVAL_MS = 500;

// How often to poll the inspected page's identity as a fallback to onNavigated.
const PAGE_CHANGE_POLL_MS = 2000;

// Colour used to highlight changes between the viewed snapshot and the one
// immediately older than it. Change this value to taste.
const DIFF_HIGHLIGHT_COLOR = "#fff3a8";

// Focus ring shown around the output area while it has keyboard focus.
const FOCUS_BORDER_COLOR = "#1a73e8";
const FOCUS_BORDER_WIDTH_PX = 3;

document.documentElement.style.setProperty("--diff-highlight", DIFF_HIGHLIGHT_COLOR);
document.documentElement.style.setProperty("--focus-border-color", FOCUS_BORDER_COLOR);
document.documentElement.style.setProperty(
  "--focus-border-width",
  FOCUS_BORDER_WIDTH_PX + "px"
);

// Code executed inside the inspected page's context.
const inspectionCode = `(function () {
  const seen = new Set();

  function search(root) {
    if (!root || seen.has(root)) return null;
    seen.add(root);

    if (root.nodeType === 1 &&
        root.nodeName &&
        root.nodeName.toLowerCase().includes('omni-script') &&
        ('jsonDataStr' in root)) {
      return { found: true, value: root.jsonDataStr };
    }

    const elements = root.querySelectorAll ? root.querySelectorAll('*') : [];
    for (const el of elements) {
      if (el.nodeName &&
          el.nodeName.toLowerCase().includes('omni-script') &&
          ('jsonDataStr' in el)) {
        return { found: true, value: el.jsonDataStr };
      }
      if (el.shadowRoot) {
        const nested = search(el.shadowRoot);
        if (nested) return nested;
      }
    }
    return null;
  }

  return search(document) || { found: false };
})()`;

// ---- HTML escaping + JSON token rendering ----
function escapeHtml(s) {
  return s.replace(/[&<>"']/g, (c) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;",
  }[c]));
}

function renderPrimitiveHtml(value) {
  if (value === null)
    return '<span class="json-null">null</span>';
  if (typeof value === "boolean")
    return '<span class="json-' + value + '">' + value + "</span>";
  if (typeof value === "number")
    return '<span class="json-number">' + escapeHtml(String(value)) + "</span>";
  if (typeof value === "string")
    return '<span class="json-string">' + escapeHtml(JSON.stringify(value)) + "</span>";
  return escapeHtml(String(value));
}

function renderKeyHtml(key) {
  return '<span class="json-key">' + escapeHtml(JSON.stringify(key)) + "</span>";
}

function renderJsonValue(value, indent) {
  if (value === null || typeof value !== "object") {
    return renderPrimitiveHtml(value);
  }

  const inner = "  ".repeat(indent + 1);
  const outer = "  ".repeat(indent);

  if (Array.isArray(value)) {
    if (value.length === 0) return '<span class="json-punct">[]</span>';
    let s = '<span class="json-punct">[</span>\n';
    value.forEach((v, i) => {
      s += inner + renderJsonValue(v, indent + 1);
      if (i < value.length - 1) s += '<span class="json-punct">,</span>';
      s += "\n";
    });
    s += outer + '<span class="json-punct">]</span>';
    return s;
  }

  const keys = Object.keys(value);
  if (keys.length === 0) return '<span class="json-punct">{}</span>';
  let s = '<span class="json-punct">{</span>\n';
  keys.forEach((k, i) => {
    s += inner + renderKeyHtml(k) + '<span class="json-punct">:</span> ';
    s += renderJsonValue(value[k], indent + 1);
    if (i < keys.length - 1) s += '<span class="json-punct">,</span>';
    s += "\n";
  });
  s += outer + '<span class="json-punct">}</span>';
  return s;
}

function renderDiffValue(current, older, indent, highlightWhole) {
  if (highlightWhole) {
    return (
      '<span class="diff-changed">' +
      renderJsonValue(current, indent) +
      "</span>"
    );
  }

  if (current === null || typeof current !== "object") {
    if (current === older) return renderPrimitiveHtml(current);
    return '<span class="diff-changed">' + renderPrimitiveHtml(current) + "</span>";
  }

  if (
    older === null ||
    typeof older !== "object" ||
    Array.isArray(current) !== Array.isArray(older)
  ) {
    return (
      '<span class="diff-changed">' +
      renderJsonValue(current, indent) +
      "</span>"
    );
  }

  const inner = "  ".repeat(indent + 1);
  const outer = "  ".repeat(indent);

  if (Array.isArray(current)) {
    if (current.length === 0) return '<span class="json-punct">[]</span>';
    let s = '<span class="json-punct">[</span>\n';
    current.forEach((v, i) => {
      const isNew = i >= older.length;
      s += inner;
      s += isNew
        ? renderDiffValue(v, undefined, indent + 1, true)
        : renderDiffValue(v, older[i], indent + 1, false);
      if (i < current.length - 1) s += '<span class="json-punct">,</span>';
      s += "\n";
    });
    s += outer + '<span class="json-punct">]</span>';
    return s;
  }

  const keys = Object.keys(current);
  if (keys.length === 0) return '<span class="json-punct">{}</span>';
  let s = '<span class="json-punct">{</span>\n';
  keys.forEach((k, i) => {
    const entryPrefix = renderKeyHtml(k) + '<span class="json-punct">:</span> ';

    if (!(k in older)) {
      s +=
        inner +
        '<span class="diff-changed">' +
        entryPrefix +
        renderJsonValue(current[k], indent + 1) +
        "</span>";
    } else {
      s += inner + entryPrefix + renderDiffValue(current[k], older[k], indent + 1, false);
    }

    if (i < keys.length - 1) s += '<span class="json-punct">,</span>';
    s += "\n";
  });
  s += outer + '<span class="json-punct">}</span>';
  return s;
}

// ---- History state ----
// Each entry: { time: "HH:MM:SS", content: "<pretty JSON>", isJson: bool }
const history = [];
let currentIndex = -1;
let lastCapturedContent = null;

// ---- Monitoring state ----
let monitorTimer = null;
let monitorInFlight = false;

function pad2(n) {
  return String(n).padStart(2, "0");
}

function formatTime(date) {
  return (
    pad2(date.getHours()) + ":" +
    pad2(date.getMinutes()) + ":" +
    pad2(date.getSeconds())
  );
}

function snapshotLabel(index) {
  return (index + 1) + "/" + history.length + " - " + history[index].time;
}

function renderSnapshotSelect() {
  snapshotSelect.innerHTML = "";
  history.forEach((_, i) => {
    const opt = document.createElement("option");
    opt.value = String(i);
    opt.textContent = snapshotLabel(i);
    snapshotSelect.appendChild(opt);
  });
}

function updateVisibility() {
  const display = history.length > 0 ? "" : "none";
  snapshotSelect.style.display = display;
  olderBtn.style.display = display;
  newerBtn.style.display = display;
  copyBtn.style.display = display;
}

function renderOutput() {
  if (currentIndex < 0 || currentIndex >= history.length) {
    output.textContent = "";
    snapshotSelect.selectedIndex = -1;
  } else {
    const entry = history[currentIndex];
    if (entry.isJson) {
      const olderEntry = currentIndex > 0 ? history[currentIndex - 1] : null;
      const currentObj = JSON.parse(entry.content);
      if (olderEntry && olderEntry.isJson) {
        const olderObj = JSON.parse(olderEntry.content);
        output.innerHTML = renderDiffValue(currentObj, olderObj, 0, false);
      } else {
        output.innerHTML = renderJsonValue(currentObj, 0);
      }
    } else {
      output.textContent = entry.content;
    }
    snapshotSelect.value = String(currentIndex);
  }
  olderBtn.disabled = currentIndex <= 0;
  newerBtn.disabled = currentIndex >= history.length - 1;
}

function addSnapshot(content, isJson) {
  const wasOnLatest = currentIndex === history.length - 1;

  history.push({ time: formatTime(new Date()), content, isJson });
  if (wasOnLatest) currentIndex = history.length - 1;
  lastCapturedContent = content;

  renderSnapshotSelect();
  renderOutput();
  updateVisibility();
}

function clearHistory() {
  history.length = 0;
  currentIndex = -1;
  lastCapturedContent = null;
  renderSnapshotSelect();
  renderOutput();
  updateVisibility();
}

// ---- Snapshot navigation ----
function goOlder() {
  if (currentIndex > 0) {
    currentIndex--;
    renderOutput();
  }
}

function goNewer() {
  if (currentIndex < history.length - 1) {
    currentIndex++;
    renderOutput();
  }
}

// ---- Query ----
function queryStateAsync() {
  return new Promise((resolve) => {
    chrome.devtools.inspectedWindow.eval(inspectionCode, (result, isException) => {
      if (isException) {
        resolve({
          found: false,
          isJson: false,
          content:
            "Error evaluating in inspected page:\n" +
            JSON.stringify(isException, null, 2),
        });
        return;
      }

      if (!result || !result.found) {
        resolve({ found: false, isJson: false, content: "OmniScript not found" });
        return;
      }

      const raw = result.value;
      try {
        const parsed = typeof raw === "string" ? JSON.parse(raw) : raw;
        resolve({
          found: true,
          isJson: true,
          content: JSON.stringify(parsed, null, 2),
        });
      } catch (e) {
        resolve({
          found: false,
          isJson: false,
          content:
            "Failed to parse jsonDataStr as JSON: " +
            e.message +
            "\n\nRaw value:\n" +
            String(raw),
        });
      }
    });
  });
}

function runQuery() {
  return queryStateAsync().then((res) => {
    if (res.found) {
      addSnapshot(res.content, res.isJson);
    } else if (history.length === 0) {
      output.textContent = "OmniScript not found";
    }
    setMonitorAvailability(res.found);
    return res;
  });
}

function setMonitorAvailability(available) {
  if (available) {
    monitorLabel.style.display = "";
    monitorCheckbox.disabled = false;
  } else {
    monitorLabel.style.display = "none";
    monitorCheckbox.checked = false;
    monitorCheckbox.disabled = true;
    stopMonitoring();
  }
}

// ---- Monitoring ----
function startMonitoring() {
  stopMonitoring();
  monitorTimer = setInterval(() => {
    if (monitorInFlight) return;
    monitorInFlight = true;
    queryStateAsync()
      .then((res) => {
        setMonitorAvailability(res.found);
        if (!res.found) return;
        if (res.content !== lastCapturedContent) {
          addSnapshot(res.content, res.isJson);
        }
      })
      .finally(() => {
        monitorInFlight = false;
      });
  }, MONITOR_INTERVAL_MS);
}

function stopMonitoring() {
  if (monitorTimer) {
    clearInterval(monitorTimer);
    monitorTimer = null;
  }
  monitorInFlight = false;
}

// ---- Navigation handling ----
// Snapshot state is cleared whenever the inspected page is refreshed or
// navigated to a different page. Two mechanisms are used together:
//   1. chrome.devtools.network.onNavigated (primary, immediate).
//   2. A low-frequency poll of (location.href, performance.timeOrigin) as a
//      fallback that also catches refreshes onNavigated may miss.
let navToken = 0;
let lastPageIdentity = null;
let syncPending = false;

function syncPageIdentity() {
  syncPending = true;
  const timeout = setTimeout(() => {
    syncPending = false;
  }, 5000);
  chrome.devtools.inspectedWindow.eval(
    "performance.timeOrigin + '|' + location.href",
    (identity, isException) => {
      clearTimeout(timeout);
      if (!isException) lastPageIdentity = identity;
      syncPending = false;
    }
  );
}

function handlePageNavigation() {
  const token = ++navToken;

  stopMonitoring();
  setMonitorAvailability(false);
  clearHistory();
  output.textContent = "Waiting for page to load\u2026";

  waitForLoadAndQuery(token);
  syncPageIdentity();
}

function waitForLoadAndQuery(token) {
  let attempts = 0;
  const maxAttempts = 200;

  function poll() {
    if (token !== navToken) return;
    chrome.devtools.inspectedWindow.eval(
      "document.readyState",
      (state, isException) => {
        if (token !== navToken) return;
        const done = !isException && state === "complete";
        if (done) {
          runQuery().then(() => {
            if (monitorCheckbox.checked) startMonitoring();
          });
          return;
        }
        attempts++;
        if (attempts < maxAttempts) {
          setTimeout(poll, 100);
        } else {
          runQuery().then(() => {
            if (monitorCheckbox.checked) startMonitoring();
          });
        }
      }
    );
  }
  poll();
}

// Primary navigation detection.
chrome.devtools.network.onNavigated.addListener(handlePageNavigation);

// Fallback: catches refreshes/navigations onNavigated occasionally misses.
setInterval(() => {
  if (syncPending) return;
  chrome.devtools.inspectedWindow.eval(
    "performance.timeOrigin + '|' + location.href",
    (identity, isException) => {
      if (isException) return;
      if (lastPageIdentity === null) {
        lastPageIdentity = identity;
      } else if (lastPageIdentity !== identity) {
        handlePageNavigation();
      }
    }
  );
}, PAGE_CHANGE_POLL_MS);

// ---- Copy to clipboard ----
function copyCurrentSnapshot() {
  if (currentIndex < 0 || currentIndex >= history.length) return;
  const content = history[currentIndex].content;

  const showCopied = () => {
    const original = copyBtn.textContent;
    copyBtn.textContent = "Copied \u2713";
    setTimeout(() => {
      copyBtn.textContent = original;
    }, 1000);
  };

  const fallbackCopy = () => {
    const ta = document.createElement("textarea");
    ta.value = content;
    ta.style.position = "fixed";
    ta.style.opacity = "0";
    document.body.appendChild(ta);
    ta.select();
    try {
      if (document.execCommand("copy")) showCopied();
    } catch (e) {
      console.error("Copy failed:", e);
    }
    document.body.removeChild(ta);
  };

  if (navigator.clipboard && navigator.clipboard.writeText) {
    navigator.clipboard.writeText(content).then(showCopied, fallbackCopy);
  } else {
    fallbackCopy();
  }
}

// ---- Events ----
btn.addEventListener("click", runQuery);
copyBtn.addEventListener("click", copyCurrentSnapshot);

snapshotSelect.addEventListener("change", () => {
  const idx = parseInt(snapshotSelect.value, 10);
  if (!isNaN(idx) && idx >= 0 && idx < history.length) {
    currentIndex = idx;
    renderOutput();
  }
});

olderBtn.addEventListener("click", goOlder);
newerBtn.addEventListener("click", goNewer);

output.addEventListener("keydown", (e) => {
  if (e.key === "ArrowLeft") {
    e.preventDefault();
    goOlder();
  } else if (e.key === "ArrowRight") {
    e.preventDefault();
    goNewer();
  }
});

monitorCheckbox.addEventListener("change", () => {
  if (monitorCheckbox.checked) startMonitoring();
  else stopMonitoring();
});

// ---- Init ----
renderSnapshotSelect();
renderOutput();
updateVisibility();
setMonitorAvailability(false);
syncPageIdentity();
runQuery();