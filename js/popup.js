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
              ? "✅ Turning ON Page Blocking. If a website looks dangerous, you'll be stopped and asked to verify before continuing."
              : "⚠️ Turning OFF Page Blocking. Risky websites will open right away without any extra verification. Only proceed if you fully trust the site.",
            type: toggleBlock.checked
              ? "info"
              : "warning",
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
              ? "✅ Turning ON Link Highlighting. Links will be highlighted, making them easier to spot before you click."
              : "⚠️ Turning OFF Link Highlighting. Links will not be highlighted after scanning—be extra cautious and avoid clicking links unless you fully trust the source.",
            type: e.target.checked
              ? "info"
              : "warning",

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

      // Send toast info
      chrome.tabs.sendMessage(
        tab.id,
        {
          action: "showToast",
           message: toggleStrictBlocking.checked
            ? "✅ Turning ON Strict Blocking. Dangerous or suspicious links will be blocked automatically, giving you stronger protection when browsing."
            : "⚠️ Turning OFF Strict Blocking. Dangerous or suspicious links will no longer be fully blocked. Do not click any link unless you fully trust the site",
          type: toggleStrictBlocking.checked
            ? "info"
            : "warning",
        }
      );
    });
  });
});

});
