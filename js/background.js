// ==============================
// DEVSCAN BACKGROUND SCRIPT
// ==============================
// Service worker for the DEVScan browser extension
// Handles extension lifecycle, server communication, and inter-tab messaging
// Manages scan sessions and coordinates between content scripts and server

// ==============================
// EXTENSION LIFECYCLE EVENTS
// ==============================

// Initialize extension settings when first installed
chrome.runtime.onInstalled.addListener(() => {
  chrome.storage.sync.set({
    enableBlocking: true,
    showWarningsOnly: true,
    logDetection: false,
    suppressReminder: false, // Ensure this is initialized
    serverUrl: "http://localhost:3000", // Default server URL
    currentSessionId: null, // Track current session


  });
});

// Handle browser startup - create new scan session
chrome.runtime.onStartup.addListener(() => {
  console.log("🌐 Browser started — checking toggle settings...");

  // Create a new scan session when browser starts
  createNewScanSession();

  // All UI is handled via reminder.js (floating reminder injected)
  chrome.storage.sync.get(
    ["enableBlocking", "showWarningsOnly", "suppressReminder"],
    (data) => {
      const { enableBlocking, showWarningsOnly, suppressReminder } = data;

      console.log("Startup check:");
      console.log("  enableBlocking:", enableBlocking);
      console.log("  showWarningsOnly:", showWarningsOnly);
      console.log("  suppressReminder:", suppressReminder);

      // These values will be used by reminder.js which runs on all pages
    }
  );
});

// ==============================
// SESSION MANAGEMENT
// ==============================

// Create a new scan session on the server
async function createNewScanSession() {
  try {
    const { serverUrl } = await chrome.storage.sync.get("serverUrl");
    const baseUrl = serverUrl || "http://localhost:3000";
    
    // Get browser info for session tracking
    const browserInfo = `Chrome Extension v4.0 - ${navigator.userAgent || 'Unknown Browser'}`;
    const engineVersion = "DEVSCAN-4.0";
    
    console.log("[DEVScan Background] Creating new scan session...");
    
    const response = await fetch(`${baseUrl}/api/scan-sessions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        browserInfo,
        engineVersion
      })
    });
    
    if (!response.ok) {
      throw new Error(`Failed to create session: ${response.status}`);
    }
    
    const session = await response.json();
    
    // Store session ID for use across all tabs
    await chrome.storage.sync.set({ currentSessionId: session.session_ID });
    
    console.log(`[DEVScan Background] Created session: ${session.session_ID}`);
    return session.session_ID;
    
  } catch (error) {
    console.error("[DEVScan Background] Failed to create scan session:", error);
    // Continue without session - will use individual link scanning
    await chrome.storage.sync.set({ currentSessionId: null });
    return null;
  }
}

// ==============================
// MESSAGE HANDLING
// ==============================

// Handle messages from content scripts and popup
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.action === "openWarningTab" && message.targetUrl) {
    // Open warning page for risky links
    const warningUrl = chrome.runtime.getURL(
      `html/WarningPage.html?url=${encodeURIComponent(
        message.targetUrl
      )}&openerTabId=${sender.tab.id}`
    );

    chrome.tabs.create({
      url: warningUrl,
      index: sender.tab.index + 1,
      openerTabId: sender.tab.id,
    });
  } else if (message.action === "sendLinksToServer") {
    // Handle bulk link analysis requests from content scripts
    handleServerAnalysis(message.links, message.domain, message.sessionId, sender.tab.id)
      .then(result => sendResponse({ 
        success: true, 
        verdicts: result.verdicts,
        sessionId: result.sessionId 
      }))
      .catch(error => sendResponse({ success: false, error: error.message }));
    return true; // Keep message channel open for async response
  } else if (message.action === "createSession") {
    // Allow content scripts to request session creation
    createNewScanSession()
      .then(sessionId => sendResponse({ success: true, sessionId }))
      .catch(error => sendResponse({ success: false, error: error.message }));
    return true; // Keep message channel open for async response
  } else if (message.action === "addMaliciousUrl") {
    // Allow content scripts to add URLs to malicious intercept list
    if (message.url) {
      addMaliciousUrl(message.url);
      sendResponse({ success: true });
    } else {
      sendResponse({ success: false, error: "URL required" });
    }
  } else if (message.action === "clearMaliciousUrls") {
    // Allow content scripts to clear the malicious URL list
    clearOldMaliciousUrls();
    sendResponse({ success: true });
  }
});

// ==============================
// SERVER COMMUNICATION
// ==============================

// Main function to handle server analysis requests
async function handleServerAnalysis(links, domain, providedSessionId, tabId) {
  try {
    // Get server URL and session ID from storage
    const { serverUrl, currentSessionId } = await chrome.storage.sync.get(["serverUrl", "currentSessionId"]);
    const baseUrl = serverUrl || "http://localhost:3000";
    
    // Use provided session ID or fallback to stored one
    const sessionId = providedSessionId || currentSessionId;
    
    // Send links to extension API endpoint
    console.log(`[DEVScan Background] Sending ${links.length} links from ${domain} to extension API (Session: ${sessionId})`);
    
    const response = await fetch(`${baseUrl}/api/extension/analyze`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        links: links,
        domain: domain,
        sessionId: sessionId,
        browserInfo: `Chrome Extension v4.0 - ${domain}`
      })
    });
    
    if (!response.ok) {
      throw new Error(`Server responded with status: ${response.status}`);
    }
    
    const result = await response.json();
    
    if (result.success && result.verdicts) {
      // Send verdicts back to content script for UI updates
      chrome.tabs.sendMessage(tabId, {
        action: "updateLinkVerdicts",
        verdicts: result.verdicts
      });
      
      // Store session ID if provided by server
      if (result.session_ID) {
        await chrome.storage.sync.set({ currentSessionId: result.session_ID });
        
        // Broadcast session update to all content scripts
        chrome.tabs.query({}, (tabs) => {
          tabs.forEach(tab => {
            chrome.tabs.sendMessage(tab.id, {
              action: "sessionUpdated",
              sessionId: result.session_ID
            }).catch(() => {
              // Ignore errors for tabs that don't have content scripts
            });
          });
        });
      }
      
      // show the verdict in the background.js console - monitoring
      console.log(`[DEVScan Background] Processed ${result.processed} link verdicts:`);
      for (const [url, verdict] of Object.entries(result.verdicts)) {
        console.log(`  - ${url} → ${verdict.isMalicious ? 'MALICIOUS' : 'SAFE'}`);
        
        // Add malicious URLs to intercept list for click-based blocking
        if (verdict.isMalicious) {
          addMaliciousUrl(url);
        }
      }

      return { 
        verdicts: result.verdicts, 
        sessionId: result.session_ID || sessionId 
      };
    } else {
      throw new Error("Invalid response format from server");
    }
    
  } catch (error) {
    console.error("[DEVScan Background] Server analysis failed:", error);
    
    // No fallback processing - only use server verdicts
    // If server is unavailable, links will remain in "scanning" state
    throw error;
  }
}

// ==============================
// WARNING PAGE INTERACTION
// ==============================

// Handle close-and-return from warning page
chrome.runtime.onMessage.addListener((message, sender) => {
  if (message.action === "closeAndSwitchBack" && sender.tab?.id) {
    chrome.tabs.remove(sender.tab.id, () => {
      chrome.tabs.update(message.openerTabId, { active: true });
    });
  }
});

// ======================================================
// REDIRECT / MANUALLY INPUTED LINK INTERCEPTOR
// ======================================================

// function interceptURL(url, details) {
//   console.log("[DEVScan Intercepted] URL:", url);

//   const decodedUrl = decodeURIComponent(url);

//   // Extract domain from URL
//   let domain = "unknown";
//   try {
//     domain = new URL(decodedUrl).hostname;
//   } catch (err) {
//     console.warn("Invalid intercepted URL:", decodedUrl);
//   }

//   chrome.storage.sync.get("currentSessionId", ({ currentSessionId }) => {
//     handleServerAnalysis([decodedUrl], domain, currentSessionId, details.tabId);
//   });
// }

// ==============================
// CLICK-BASED MALICIOUS LINK INTERCEPTION
// ==============================
// Only intercepts when user clicks on links that were previously identified as malicious

let maliciousUrls = new Set(); // Store URLs identified as malicious

function interceptURL(url, details) {
  console.log("[DEVScan Intercepted] URL:", url);

  const decodedUrl = decodeURIComponent(url);

  // Only intercept if this URL was previously identified as malicious
  if (maliciousUrls.has(decodedUrl)) {
    console.log("[DEVScan Intercepted] Blocking malicious URL:", decodedUrl);
    
    chrome.tabs.sendMessage(details.tabId, {
      action: "redirectToWarningPage",
      targetUrl: decodedUrl,
      openerTabId: details.tabId
    });
  }
}

// Function to add malicious URLs to the intercept list
function addMaliciousUrl(url) {
  maliciousUrls.add(url);
  console.log("[DEVScan] Added malicious URL to intercept list:", url);
}

// Function to clear old malicious URLs (cleanup)
function clearOldMaliciousUrls() {
  maliciousUrls.clear();
  console.log("[DEVScan] Cleared malicious URL intercept list");
}

chrome.webRequest.onBeforeRequest.addListener(
  (details) => {
    interceptURL(details.url, details);
    // observe-only: return nothing
  },
  { urls: ["<all_urls>"], types: ["main_frame"] },
  // no "blocking" extraInfoSpec here
);