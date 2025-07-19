// Simple popup settings management
document.addEventListener("DOMContentLoaded", () => {
  const toggleBlock = document.getElementById("toggleBlock");
  const toggleWarning = document.getElementById("toggleWarning");
  const toggleLog = document.getElementById("toggleLog");

  // Load current settings
  chrome.storage.sync.get(["enableBlocking", "showWarningsOnly", "logDetection"], (data) => {
    toggleBlock.checked = data.enableBlocking ?? true;
    toggleWarning.checked = data.showWarningsOnly ?? true;
    toggleLog.checked = data.logDetection ?? false;
  });

  // Page blocking toggle
  toggleBlock.addEventListener("change", () => {
    chrome.storage.sync.set({ enableBlocking: toggleBlock.checked });
  });

  // Link highlighting toggle
  toggleWarning.addEventListener("change", () => {
    chrome.storage.sync.set({ showWarningsOnly: toggleWarning.checked });
  });

  // Log detection toggle
  toggleLog.addEventListener("change", () => {
    chrome.storage.sync.set({ logDetection: toggleLog.checked });
  });
});
