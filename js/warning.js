const params = new URLSearchParams(location.search);
const original = params.get("url");
const openerTabId = parseInt(params.get("openerTabId"));

document.getElementById("proceed-btn").onclick = () => {
  if (original) {
    chrome.runtime.sendMessage({ action: "allowOnce", url: original }, (response) => {
      // Wait a tiny bit to ensure background script has time to update
      setTimeout(() => {
        location.href = original;
      }, 250); // delay 
    });
  }
};




document.getElementById("back-btn").onclick = () => {
  if (chrome.runtime && chrome.tabs && !isNaN(openerTabId)) {
    chrome.tabs.query({}, (tabs) => {
      if (tabs.length > 1) {
        // Safe to close and switch
        chrome.runtime.sendMessage({ action: "closeAndSwitchBack", openerTabId }, (response) => {
          if (chrome.runtime.lastError || response?.success === false) {
            window.location.href = "https://www.google.com";
          }
        });
      } else {
        // Only one tab — don't close, just redirect to safety page
        window.location.href = "https://www.google.com";
      }
    });
  } else {
    window.location.href = "https://www.google.com";
  }
};

