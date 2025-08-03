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
    // Ask background to close this tab and switch focus back
    chrome.runtime.sendMessage({ action: "closeAndSwitchBack", openerTabId });
  } else {
    window.close(); // fallback
  }
};
