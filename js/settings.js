window.enableBlocking = true;

window.watchBlockingSetting = function () {
  chrome.storage.sync.get("enableBlocking", ({ enableBlocking: stored }) => {
    window.enableBlocking = typeof stored === "undefined" ? true : stored;
  });

  chrome.storage.onChanged.addListener((changes) => {
    if (changes.enableBlocking) {
      window.enableBlocking = changes.enableBlocking.newValue;
      console.log("[DEVScan] enableBlocking updated to", window.enableBlocking);
    }
  });
};
