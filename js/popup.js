// SETTINGS FOR THE TOGGLE FOR SHOWING THE WARNING PAGE
// ETO YUNG NASA UPPER RIGHT NG PAGE PAG CINLICK YUNG ICON NG DEVSCAN

document.addEventListener("DOMContentLoaded", () => {
  const toggleBlock = document.getElementById("toggleBlock");
  const toggleWarning = document.getElementById("toggleWarning");
  const toggleStrictBlocking = document.getElementById("toggleStrictBlocking");
  const serverUrlInput = document.getElementById("serverUrl");
  const saveServerBtn = document.getElementById("saveServer");

  // Safety check in case elements don't load properly
  if (!toggleBlock || !toggleWarning || !toggleStrictBlocking) {
    console.warn("Toggle elements not found in popup.html");
    return;
  }

  // Load settings on popup open
  chrome.storage.sync.get(["enableBlocking", "showWarningsOnly", "strictMaliciousBlocking", "serverUrl"], (data) => {
    toggleBlock.checked = data.enableBlocking ?? true;
    toggleWarning.checked = data.showWarningsOnly ?? true;
    toggleStrictBlocking.checked = data.strictMaliciousBlocking ?? true;
    if (serverUrlInput) {
      serverUrlInput.value = data.serverUrl || "http://localhost:3001";
    }
  });

  // PAGE BLOCKING
  toggleBlock.addEventListener("change", () => {
    chrome.storage.sync.set({ enableBlocking: toggleBlock.checked }, () => {
      chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
        const tab = tabs[0];
        if (!tab || !tab.id || !tab.url?.startsWith("http")) return;

        chrome.tabs.sendMessage(
          tab.id,
          {
            action: "showToast",
            message: toggleBlock.checked
              ? "Page blocking enabled"
              : "Page blocking disabled",
            type: "info",
          },
          () => {
            if (chrome.runtime.lastError) {
              // Optional debug log:
              // console.warn("No receiver for toast:", chrome.runtime.lastError.message);
            }
          }
        );
      });
    });
  });

  // LINK HIGHLIGHTING
  toggleWarning.addEventListener("change", (e) => {
    chrome.storage.sync.set({ showWarningsOnly: e.target.checked }, () => {
      chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
        const tab = tabs[0];
        if (!tab || !tab.id || !tab.url?.startsWith("http")) return;

        chrome.tabs.sendMessage(
          tab.id,
          {
            action: "showToast",
            message: e.target.checked
              ? "Highlighting enabled"
              : "Highlighting disabled",
            type: "info",
          },
          () => {
            if (chrome.runtime.lastError) {
              // Optional debug log:
              // console.warn("No receiver for toast:", chrome.runtime.lastError.message);
            }
          }
        );
      });
    });
  });

  // STRICT MALICIOUS BLOCKING
  toggleStrictBlocking.addEventListener("change", () => {
    chrome.storage.sync.set({ strictMaliciousBlocking: toggleStrictBlocking.checked }, () => {
      chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
        const tab = tabs[0];
        if (!tab || !tab.id || !tab.url?.startsWith("http")) return;

        chrome.tabs.sendMessage(
          tab.id,
          {
            action: "showToast",
            message: toggleStrictBlocking.checked
              ? "Strict malicious blocking enabled - No proceed option for dangerous links"
              : "Standard blocking enabled - Proceed option available for all links",
            type: "info",
          },
          () => {
            if (chrome.runtime.lastError) {
              // Optional debug log:
              // console.warn("No receiver for toast:", chrome.runtime.lastError.message);
            }
          }
        );
      });
    });
  });

});
