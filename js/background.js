// ==============================
// DEVSCAN BACKGROUND SCRIPT
// ==============================
// Service worker for the DEVScan browser extension
// Handles extension lifecycle, server communication, and inter-tab messaging
// Manages scan sessions and coordinates between content scripts and server

// ==============================
// EXTENSION LIFECYCLE EVENTS
// ==============================

// Initialize extension settings when first installed / updated
chrome.runtime.onInstalled.addListener((details) => {
  // Always keep existing user prefs when possible—only set missing defaults
  chrome.storage.sync.get(
    ["enableBlocking", "showWarningsOnly", "logDetection", "suppressReminder", "serverUrl", "currentSessionId"],
    (cur) => {
      const defaults = {
        enableBlocking: true,
        showWarningsOnly: true,
        logDetection: false,
        suppressReminder: false, // initialize to false
        serverUrl: "http://localhost:3000",
        currentSessionId: null,
      };

      const toSet = {};
      for (const [k, v] of Object.entries(defaults)) {
        if (typeof cur[k] === "undefined") toSet[k] = v;
      }

      // Reset suppression on extension UPDATE so users see the reminder again
      if (details.reason === "update") {
        toSet.suppressReminder = false;
        toSet.lastUpdate = Date.now();
      }

      if (Object.keys(toSet).length) {
        chrome.storage.sync.set(toSet);
      }
    }
  );
});

// Handle browser startup - create new scan session
chrome.runtime.onStartup.addListener(() => {
  // Reset the reminder suppression on *every* real browser start
  chrome.storage.sync.set({ suppressReminder: false, lastStartup: Date.now() });

  // Create a new scan session when browser starts
  createNewScanSession();
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
  if (message.action === "test") {
    sendResponse({ success: true, reply: "Background script is working!" });
    return true;
  }
  
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
    }, (tab) => {
      if (chrome.runtime.lastError) {
        console.error(`[DEVScan Background] Error creating tab:`, chrome.runtime.lastError);
        sendResponse({ success: false, error: chrome.runtime.lastError.message });
      } else {
        sendResponse({ success: true, tabId: tab.id });
      }
    });
    return true; // Keep message channel open for async response
  } 
  
  else if (message.action === "analyzeSingleLink") {
    // Handle individual link analysis for immediate verdict delivery
    handleSingleLinkAnalysis(message.url, message.domain, message.sessionId, sender.tab.id)
      .catch(error => {
        console.error("[DEVScan Background] Single link analysis failed:", error);
        // Send failure message to content script
        chrome.tabs.sendMessage(sender.tab.id, {
          action: "updateSingleLinkVerdict",
          url: message.url,
          verdict: "failed"
        });
      });
    // Don't use sendResponse - use direct messaging instead
  } 
  
  else if (message.action === "createSession") {
    // Allow content scripts to request session creation
    createNewScanSession()
      .then(sessionId => sendResponse({ success: true, sessionId }))
      .catch(error => sendResponse({ success: false, error: error.message }));
    return true; // Keep message channel open for async response
  }
  
  else if (message.action === "allowOnce" && message.url) {
    maliciousUrls.add(message.url);
    setTimeout(() => maliciousUrls.delete(message.url), 60000);
    sendResponse({ success: true });
    return true;
  }
  
  else if (message.action === "closeAndSwitchBack" && sender.tab?.id) {
    chrome.tabs.remove(sender.tab.id, () => {
      chrome.tabs.update(message.openerTabId, { active: true });
    });
    sendResponse({ success: true });
    return true;
  }
});

// ==============================
// SERVER COMMUNICATION
// ==============================

// Handle individual link analysis for immediate verdict delivery
async function handleSingleLinkAnalysis(url, domain, providedSessionId, tabId) {
  try {
    // Get server URL and session ID from storage
    const { serverUrl, currentSessionId } = await chrome.storage.sync.get(["serverUrl", "currentSessionId"]);
    const baseUrl = serverUrl || "http://localhost:3000";

    // Use provided session ID or fallback to stored one
    const sessionId = providedSessionId || currentSessionId;

    const response = await fetch(`${baseUrl}/api/extension/analyze`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        links: [url], // Send as single-item array
        domain: domain,
        sessionId: sessionId,
        browserInfo: `Chrome Extension v4.0 - ${domain}`,
        singleLink: true // Flag to indicate individual analysis
      })
    });

    if (!response.ok) {
      throw new Error(`Server responded with status: ${response.status}`);
    }

    const result = await response.json();

    if (result.success && result.verdicts) {
      // Try to find the verdict for this URL (exact match first)
      let verdict = result.verdicts[url];

      if (!verdict) {
        // If exact match fails, try to find by partial match or URL variations
        for (const [responseUrl, responseVerdict] of Object.entries(result.verdicts)) {
          // Simple string equality
          if (url === responseUrl) {
            verdict = responseVerdict;
            break;
          }

          // Try normalized comparison (remove trailing slashes, etc.)
          const normalizeUrl = (u) => u.replace(/\/+$/, '').toLowerCase();
          if (normalizeUrl(url) === normalizeUrl(responseUrl)) {
            verdict = responseVerdict;
            break;
          }

          // Try decoding both URLs in case of encoding differences
          try {
            const decodedRequestUrl = decodeURIComponent(url);
            const decodedResponseUrl = decodeURIComponent(responseUrl);

            if (decodedRequestUrl === decodedResponseUrl) {
              verdict = responseVerdict;
              break;
            }

            // Also try without query parameters
            const requestUrlBase = decodedRequestUrl.split('?')[0];
            const responseUrlBase = decodedResponseUrl.split('?')[0];

            if (requestUrlBase === responseUrlBase) {
              verdict = responseVerdict;
              break;
            }
          } catch (e) {
            // Silent error handling for URL decoding
          }
        }
      }

      if (verdict) {
        // Send verdict directly to content script (it's already a string)
        chrome.tabs.sendMessage(tabId, {
          action: "updateSingleLinkVerdict",
          url: url,
          verdict: verdict // Send the string verdict directly
        }, (response) => {
          if (chrome.runtime.lastError) {
            console.error(`[DEVScan Background] Failed to send message to tab ${tabId}:`, chrome.runtime.lastError);
          }
        });
      } else {
        console.error(`[DEVScan Background] No verdict found for ${url} in server response`);

        // Send unknown verdict
        chrome.tabs.sendMessage(tabId, {
          action: "updateSingleLinkVerdict",
          url: url,
          verdict: "failed"
        });
      }

      // Store session ID if provided by server
      if (result.session_ID) {
        await chrome.storage.sync.set({ currentSessionId: result.session_ID });
      }

      // Add malicious URLs to intercept list for click-based blocking
      if (verdict === "malicious" || verdict === "anomalous") {
        addMaliciousUrl(url);
      }

      return { 
        verdict: verdict, 
        sessionId: result.session_ID || sessionId 
      };
    } else {
      throw new Error("Invalid response format from server");
    }

  } catch (error) {
    console.error("[DEVScan Background] Single link analysis failed:", error);
    throw error;
  }
}

async function handleExtractLinks(maliciousUrl) {
  try {
    // Get server URL from storage
    const { serverUrl } = await chrome.storage.sync.get("serverUrl");
    const baseUrl = serverUrl || "http://localhost:3000";

    // Call the extract-links endpoint
    const response = await fetch(`${baseUrl}/api/extract-links`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ url: maliciousUrl }),
    });

    if (!response.ok) {
      throw new Error(`Extract-links endpoint responded with status: ${response.status}`);
    }

    const data = await response.json();

    if (data.success && Array.isArray(data.links)) {
      return { success: true, links: data.links };
    } else {
      throw new Error("Invalid or empty link extraction response from server");
    }

  } catch (error) {
    console.error("[DEVScan Background] Failed to extract links:", error);
    return { success: false, error: error.message };
  }
}

async function unshortenLink(shortUrl) {
  try {
    const { serverUrl } = await chrome.storage.sync.get("serverUrl");
    const baseUrl = serverUrl || "http://localhost:3000";

    const response = await fetch(`${baseUrl}/api/unshortened-links`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ url: shortUrl })
    });

    if (!response.ok) {
      console.warn(`[DEVScan] Unshortener returned status ${response.status} → using original`);
      return shortUrl;
    }

    const data = await response.json();
    if (data && data.success && data.url) {
      return data.url;
    }

    return shortUrl;
  } catch (error) {
    console.error(`[DEVScan] Unshortener failed for ${shortUrl}:`, error);
    return shortUrl;
  }
}

// ==============================
// WARNING PAGE INTERACTION
// ==============================

// Intercept URLs before they load to check if malicious
let maliciousUrls = new Set(); // Store intercepted URLs identified as malicious
const shortenedPatterns = [
  'bit.ly',
  't.co',
  'tinyurl.com',
  'goo.gl',
  'is.gd',
  'buff.ly',
  'cutt.ly',
  'ow.ly',
  'rebrand.ly'
];

// Function to add malicious URLs to intercept list
function addMaliciousUrl(url) {
  maliciousUrls.add(url);
  console.log(`[DEVScan Background] Added ${url} to malicious intercept list`);
}

// Function to detect if URL is shortened and unshorten it recursively
async function resolveShortenedUrl(url, details) {
  try {
    const parsedUrl = new URL(url);

    if (shortenedPatterns.includes(parsedUrl.hostname) && !details._unshortened) {
      const resolvedUrl = await unshortenLink(url);
      console.log("[DEVScan] Resolved shortened link →", resolvedUrl);

      // Mark as unshortened to avoid infinite recursion
      details._unshortened = true;

      // Recursively resolve again in case the resolved URL is also shortened
      return resolveShortenedUrl(resolvedUrl, details);
    }
  } catch (e) {
    console.warn("[DEVScan] URL parsing failed in unshorten step:", url, e);
    return url;
  }

  // Return the original or resolved URL if no further unshortening needed
  return url;
}

async function interceptURL(url, details) {
  console.log("[DEVScan Intercepted] URL:", url);

  // Hex Decoder of the intercepted link
  const decodedUrl = decodeURIComponent(url);
  console.log("[DEVScan] Decoded URL:", decodedUrl);

  // Conditional link unshortening
  const resolvedUrl = await resolveShortenedUrl(decodedUrl, details);

  // Check if the URL is allowed to bypass the warning by the user
  if (maliciousUrls.has(resolvedUrl)) {
    console.log("[DEVScan] URL allowed to bypass warning:", resolvedUrl);
    return;
  }

  // Skip internal warning page to avoid infinite loops
  if (resolvedUrl.includes("html/WarningPage.html")) {
    console.log("[DEVScan] Skipping internal warning page scan");
    return;
  }

  let domain = "unknown";
  try {
    domain = new URL(resolvedUrl).hostname;
  } catch (err) {
    console.warn("Invalid intercepted URL:", resolvedUrl);
  }

  const { currentSessionId: existingSession } = await chrome.storage.sync.get("currentSessionId");
  let currentSessionId = existingSession;
  if (!currentSessionId) {
    console.log("[DEVScan] No session — creating one...");
    currentSessionId = await createNewScanSession();
  }

  const { verdict } = await handleSingleLinkAnalysis(resolvedUrl, domain, currentSessionId, details.tabId);

  // Fix logic: redirect when verdict is malicious or anomalous
  if (verdict === "malicious" || verdict === "anomalous") {
    console.log("[DEVScan] Risky verdict, redirecting to warning page...");
    chrome.tabs.update(details.tabId, {
      url: chrome.runtime.getURL(
        `html/WarningPage.html?url=${encodeURIComponent(resolvedUrl)}&openerTabId=${details.tabId}&fromDevScan=true&ts=${Date.now()}`
      )
    });
    // (Optional) Extract links
    // const extractionResult = await handleExtractLinks(resolvedUrl);
  } else {
    console.log(`[DEVScan Background] URL appears safe: ${resolvedUrl}`);
  }
}

chrome.webRequest.onBeforeRequest.addListener(
  (details) => {
    interceptURL(details.url, details);
    // observe-only: return nothing
  },
  { urls: ["<all_urls>"], types: ["main_frame"] },
  // no "blocking" extraInfoSpec here
);