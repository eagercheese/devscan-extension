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

Legacy support for old button IDs (for existing malicious warning page)
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
  setTimeout(() => {
    document.body.style.display = "block";
  }, 2000);

  const params = new URLSearchParams(window.location.search);
  const interceptedUrl = params.get("url");
  const initiator = params.get("initiator");

  const scanningPopupProceedBtn = document.querySelector(".scanning-popup-proceed");
  const scanningPopupBackBtn = document.querySelector(".scanning-popup-back");

  const scanLinkText = document.querySelector("#scanning-popup .link-text");
  const failLinkText = document.querySelector("#scanfailed-popup .link-text");

  if (scanLinkText) scanLinkText.textContent = interceptedUrl || "this link";
  if (failLinkText) failLinkText.textContent = interceptedUrl || "this link";

  // scanning popup buttons
  if (scanningPopupProceedBtn && interceptedUrl) {
    scanningPopupProceedBtn.addEventListener("click", () => {
      chrome.runtime.sendMessage(
        { action: "allowLinkBypass", url: interceptedUrl },
        () => window.location.href = interceptedUrl
      );
    });
  }

  if (scanningPopupBackBtn) {
    scanningPopupBackBtn.addEventListener("click", () => {
      window.location.href = initiator && initiator !== "none" && initiator !== "null"
        ? initiator
        : "https://www.google.com";
    });
  }


  // ✅ ONLY show scan failed when background tells us
  chrome.runtime.onMessage.addListener((msg ,sender, sendResponse) => {
    if (msg.action === "verdictReady") {
      console.log("[DEVScan] Verdict received in ScanningPage:", msg.verdict);
      // TODO: update UI based on verdict if needed
    }
    else if (msg.action === "scanFailed") {
      console.log("[DEVScan] Scan failed message received:", msg);

      const scanfailPopupProceedBtn = document.querySelector(".scanfailed-popup-proceed");
      const scanfailPopupBackBtn = document.querySelector(".scanfailed-popup-back");
      const scanfailPopupTryAgainBtn = document.querySelector(".scanfailed-popup-tryagain");

      const scanFailedPopup = document.querySelector("#scanfailed-popup");
      const scanningPopup = document.querySelector("#scanning-popup");

      // 🔄 toggle visibility
      scanFailedPopup?.classList.remove("hidden");
      scanningPopup?.classList.add("hidden");

      // bind buttons
      if (scanfailPopupProceedBtn && interceptedUrl) {
        scanfailPopupProceedBtn.onclick = () => {
          chrome.runtime.sendMessage(
            { action: "allowLinkBypass", url: interceptedUrl },
            () => window.location.href = interceptedUrl
          );
        };
      }

      if (scanfailPopupBackBtn) {
        scanfailPopupBackBtn.onclick = () => {
          window.location.href = initiator && initiator !== "none" && initiator !== "null"
            ? initiator
            : "https://www.google.com";
        };
      }

      if (scanfailPopupTryAgainBtn) {
        scanfailPopupTryAgainBtn.onclick = async () => {
          const scanningText = document.querySelector(".scanning-rescanning");
          const analyzingText = document.querySelector(".scanning-reanalyzing");

          if (scanningText) scanningText.textContent = "Security Re-Scanning in Progress";
          if (analyzingText) analyzingText.textContent = "re-analyzing";

          scanFailedPopup?.classList.add("hidden");
          scanningPopup?.classList.remove("hidden");

          try {
            const response = await new Promise((resolve, reject) => {
              chrome.runtime.sendMessage(
                {
                  action: "retryScan",
                  url: interceptedUrl,
                  initiator: initiator,
                },
                (resp) => {
                  if (chrome.runtime.lastError) {
                    reject(new Error(chrome.runtime.lastError.message));
                  } else {
                    resolve(resp);
                  }
                }
              );
            });

            console.log("[DEVScan Sender] ✅ Retry response:", response);

            if (response?.success) {
              console.log("[DEVScan Sender] Verdict:", response.verdict);
            }
          } catch (err) {
            console.error("[DEVScan Sender] ❌ RetryScan error:", err);
          }
        };
      }


      sendResponse({ received: true });
      return true;
    }
  });
}
