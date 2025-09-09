//warning.js
const params = new URLSearchParams(location.search);
const original = params.get("url");
const openerTabId = parseInt(params.get("openerTabId"));

// Handle proceed button (works for both malicious and anomalous pages)
const proceedBtn = document.querySelector(".proceed-btn");
if (proceedBtn) {
  proceedBtn.onclick = () => {
    if (original) {
      chrome.runtime.sendMessage({ action: "allowOnce", url: original }, (response) => {
        // Wait a tiny bit to ensure background script has time to update
        setTimeout(() => {
          location.href = original;
        }, 250); // delay 
      });
    }
  };
}

// Handle safety/back button (works for both malicious and anomalous pages)
const safetyBtn = document.querySelector(".safety-btn");
if (safetyBtn) {
  safetyBtn.onclick = () => {
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
}

// Legacy support for old button IDs (for existing malicious warning page)
const legacyProceedBtn = document.getElementById("proceed-btn");
if (legacyProceedBtn) {
  legacyProceedBtn.onclick = () => {
    if (original) {
      chrome.runtime.sendMessage({ action: "allowOnce", url: original }, (response) => {
        setTimeout(() => {
          location.href = original;
        }, 250);
      });
    }
  };
}

const legacyBackBtn = document.getElementById("back-btn");
if (legacyBackBtn) {
  legacyBackBtn.onclick = () => {
    if (chrome.runtime && chrome.tabs && !isNaN(openerTabId)) {
      chrome.tabs.query({}, (tabs) => {
        if (tabs.length > 1) {
          chrome.runtime.sendMessage({ action: "closeAndSwitchBack", openerTabId }, (response) => {
            if (chrome.runtime.lastError || response?.success === false) {
              window.location.href = "https://www.google.com";
            }
          });
        } else {
          window.location.href = "https://www.google.com";
        }
      });
    } else {
      window.location.href = "https://www.google.com";
    }
  };
}


// Scanning page logic
// Only run if this is the scanning page (check for unique class)
const isScanningPage = !!document.querySelector(".popups");
if (isScanningPage) {
  // Show scanning page after 2s
  setTimeout(() => {
    document.body.style.display = "block";
  }, 2000);


  // Scanning popup logic
  // Grab intercepted URL from query param
  const params = new URLSearchParams(window.location.search);
  const interceptedUrl = params.get("url");
  const initiator = params.get("initiator");

  const scanningPopupProceedBtn = document.querySelector(".scanning-popup-proceed");
  const scanningPopupBackBtn = document.querySelector(".scanning-popup-back");

  if (scanningPopupProceedBtn && interceptedUrl) {
    scanningPopupProceedBtn.addEventListener("click", () => {
      console.log("[DEVScan] User chose to proceed:", interceptedUrl);

      // Tell background.js to allow bypass for this URL
      chrome.runtime.sendMessage(
        { action: "allowLinkBypass", url: interceptedUrl },
        () => {
          // After background acknowledges, navigate to intercepted URL
          window.location.href = interceptedUrl;
        }
      );
    });
  }

  if (scanningPopupBackBtn) {
    scanningPopupBackBtn.addEventListener("click", () => {
      console.log("[DEVScan] User clicked Go Back");

      if (initiator && initiator !== "none" && initiator !== "null") {
        window.location.href = initiator; // go back to initiator
      } else {
        window.location.href = "https://www.google.com"; // fallback
      }
    });
  }


  // listen for messages to show progress/UI
  chrome.runtime.onMessage.addListener((msg) => {
    if (msg.action === "verdictReady") {
      console.log("[DEVScan] Verdict received in ScanningPage:", msg.verdict);
      // TODO: update UI based on verdict if needed
    }

    if (msg.action === "scanFailed") {
      console.log("[DEVScan] Scan failed message received in ScanningPage:", msg);

      const scanfailPopupProceedBtn = document.querySelector(".scanfailed-popup-proceed");
      const scanfailPopupBackBtn = document.querySelector(".scanfailed-popup-back");

      if (scanfailPopupProceedBtn && interceptedUrl) {
        scanfailPopupProceedBtn.addEventListener("click", () => {
          console.log("[DEVScan] User chose to proceed:", interceptedUrl);

          // Tell background.js to allow bypass for this URL
          chrome.runtime.sendMessage(
            { action: "allowLinkBypass", url: interceptedUrl },
            () => {
              // After background acknowledges, navigate to intercepted URL
              window.location.href = interceptedUrl;
            }
          );
        });
      }

      if (scanfailPopupBackBtn) {
        scanfailPopupBackBtn.addEventListener("click", () => {
          console.log("[DEVScan] User clicked Go Back");

          if (initiator && initiator !== "none" && initiator !== "null") {
            window.location.href = initiator; // go back to initiator
          } else {
            window.location.href = "https://www.google.com"; // fallback
          }
          
        });
      }

      // Example: show your scan failed popup UI
      const scanFailedPopup = document.querySelector("#scanfailed-popup");
      const scanningPopup = document.querySelector("#scanning-popup");
      if (scanFailedPopup) {
        scanFailedPopup.style.display = "block";
      }
      if (scanningPopup) {
        scanningPopup.style.display = "none";
      }
    }
  });
}