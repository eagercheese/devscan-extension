// SETTINGS FOR THE TOGGLE FOR SHOWING THE WARNING PAGE
// ETO YUNG NASA UPPER RIGHT NG PAGE PAG CINLICK YUNG ICON NG DEVSCAN

document.addEventListener("DOMContentLoaded", () => {
  const toggleBlock = document.getElementById("toggleBlock");
  const toggleWarning = document.getElementById("toggleWarning");
  const serverUrlInput = document.getElementById("serverUrl");
  const saveServerBtn = document.getElementById("saveServer");

  // Safety check in case elements don't load properly
  if (!toggleBlock || !toggleWarning) {
    console.warn("Toggle elements not found in popup.html");
    return;
  }

  // Load settings on popup open
  chrome.storage.sync.get(["enableBlocking", "showWarningsOnly", "serverUrl"], (data) => {
    toggleBlock.checked = data.enableBlocking ?? true;
    toggleWarning.checked = data.showWarningsOnly ?? true;
    if (serverUrlInput) {
      serverUrlInput.value = data.serverUrl || "http://localhost:3000";
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

  // SERVER URL CONFIGURATION
  if (saveServerBtn && serverUrlInput) {
    saveServerBtn.addEventListener("click", async () => {
      const serverUrl = serverUrlInput.value.trim();
      if (serverUrl) {
        // Test connection first
        try {
          saveServerBtn.textContent = "Testing...";
          saveServerBtn.disabled = true;
          
          const response = await fetch(`${serverUrl}/health`);
          if (response.ok) {
            // Save successful URL
            chrome.storage.sync.set({ serverUrl }, () => {
              saveServerBtn.textContent = "Saved!";
              setTimeout(() => {
                saveServerBtn.textContent = "Save";
                saveServerBtn.disabled = false;
              }, 2000);
              
              chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
                const tab = tabs[0];
                if (!tab || !tab.id || !tab.url?.startsWith("http")) return;

                chrome.tabs.sendMessage(
                  tab.id,
                  {
                    action: "showToast",
                    message: "Server connection successful!",
                    type: "success",
                  },
                  () => {
                    if (chrome.runtime.lastError) {
                      console.log("Server URL saved but toast not sent");
                    }
                  }
                );
              });
            });
          } else {
            throw new Error(`Server responded with status: ${response.status}`);
          }
        } catch (error) {
          console.error("Server connection test failed:", error);
          saveServerBtn.textContent = "Failed";
          saveServerBtn.style.backgroundColor = "#dc3545";
          
          setTimeout(() => {
            saveServerBtn.textContent = "Save";
            saveServerBtn.style.backgroundColor = "";
            saveServerBtn.disabled = false;
          }, 3000);
          
          chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
            const tab = tabs[0];
            if (!tab || !tab.id || !tab.url?.startsWith("http")) return;

            chrome.tabs.sendMessage(
              tab.id,
              {
                action: "showToast",
                message: "Server connection failed! Check URL and try again.",
                type: "error",
              },
              () => {
                if (chrome.runtime.lastError) {
                  console.log("Connection failed but toast not sent");
                }
              }
            );
          });
        }
      }
    });
  }
});
