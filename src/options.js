const DEFAULT_SETTINGS = {
  defaultMonitorStateChanges: false
};

const checkbox = document.getElementById("defaultMonitorStateChanges");
const saveButton = document.getElementById("save");
const status = document.getElementById("status");

// Tracks the last successfully saved value.
let savedValue = DEFAULT_SETTINGS.defaultMonitorStateChanges;

// Enable Save only when the value has changed.
function updateSaveButton(keepStatus) {
  saveButton.disabled = checkbox.checked === savedValue;

  if (keepStatus !== true) {
  	status.textContent = "";
  }
}

// Load settings from Chrome storage.
async function restoreOptions() {
  const settings = await chrome.storage.sync.get(DEFAULT_SETTINGS);

  savedValue = settings.defaultMonitorStateChanges;
  checkbox.checked = savedValue;

  updateSaveButton();
}

// Persist the changed setting.
async function saveOptions() {
  const newValue = checkbox.checked;

  if (newValue === savedValue) {
    return;
  }

  saveButton.disabled = true;
  status.textContent = "Saving...";

  try {
    await chrome.storage.sync.set({
      defaultMonitorStateChanges: newValue
    });

    savedValue = newValue;
    status.textContent = "Settings saved.";
    updateSaveButton(true);
  } catch (error) {
    status.textContent = "Failed to save settings.";
    updateSaveButton(true);
    console.error("Error saving settings:", error);
  }
}

// Event handlers.
checkbox.addEventListener("change", updateSaveButton);
saveButton.addEventListener("click", saveOptions);

// Initialise.
restoreOptions().catch(error => {
  status.textContent = "Failed to load settings.";
  console.error("Error loading settings:", error);
});