const params = new URLSearchParams(location.search);
const original = params.get("url");
const openerTabId = parseInt(params.get("openerTabId"));

document.getElementById("proceed-btn").onclick = () => {
  if (original) {
    // Don't save anything. Always show warning on next click.
    location.href = original; // still proceeds, but doesn't remember
  }
};

document.getElementById("back-btn").onclick = () => {
  if (chrome.runtime && chrome.tabs && !isNaN(openerTabId)) {
    chrome.runtime.sendMessage({ action: "closeAndSwitchBack", openerTabId }, (response) => {
      if (chrome.runtime.lastError || response?.success === false) {
        // Could not switch back — fallback to Google
        window.location.href = "https://www.google.com";
      }
    });
  } else {
    // fallback: either no openerTabId or tabs API not available
    window.location.href = "https://www.google.com";
  }
};

