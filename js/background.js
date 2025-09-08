// background.js
import { decodeHexUrl, resolveShortenedUrl } from "./url-utils.js";

// ==============================
// DEVSCAN BACKGROUND SCRIPT
// ==============================
// Service worker for the DEVScan browser extension
// Handles extension lifecycle, server communication, and inter-tab messaging
// Manages scan sessions and coordinates between content scripts and server

// ==============================
// ML VERDICT CONVERSION
// ==============================
// Convert ML service verdict object to extension string format
function convertMLVerdictToString(verdict) {
  console.log(`[DEVScan Background] 🔧 DEBUG: Converting verdict:`, verdict);
  
  if (!verdict || typeof verdict !== 'object') {
    console.log(`[DEVScan Background] 🔧 DEBUG: Invalid verdict, returning scan_failed`);
    return 'scan_failed';
  }

  // If it's already a string (legacy format), return as-is
  if (typeof verdict === 'string') {
    console.log(`[DEVScan Background] 🔧 DEBUG: Already a string:`, verdict);
    return verdict;
  }

  // Convert based on final_verdict field
  const finalVerdict = verdict.final_verdict || '';
  console.log(`[DEVScan Background] 🔧 DEBUG: final_verdict field:`, finalVerdict);
  
  if (finalVerdict.toLowerCase().includes('malicious') || 
      finalVerdict.toLowerCase().includes('dangerous') ||
      finalVerdict.toLowerCase().includes('phishing')) {
    console.log(`[DEVScan Background] 🔧 DEBUG: Converted to malicious`);
    return 'malicious';
  }
  
  if (finalVerdict.toLowerCase().includes('safe') ||
      finalVerdict.toLowerCase().includes('whitelisted') ||
      finalVerdict.toLowerCase().includes('trusted')) {
    console.log(`[DEVScan Background] 🔧 DEBUG: Converted to safe`);
    return 'safe';
  }
  
  if (finalVerdict.toLowerCase().includes('anomalous') ||
      finalVerdict.toLowerCase().includes('suspicious') ||
      verdict.anomaly_risk_level?.toLowerCase().includes('high')) {
    console.log(`[DEVScan Background] 🔧 DEBUG: Converted to anomalous`);
    return 'anomalous';
  }
  
  if (finalVerdict.toLowerCase().includes('unknown') ||
      finalVerdict.toLowerCase().includes('scan failed')) {
    console.log(`[DEVScan Background] 🔧 DEBUG: Converted to scan_failed`);
    return 'scan_failed';
  }

  // Default fallback
  console.log(`[DEVScan Background] 🔧 DEBUG: No match found, defaulting to scan_failed`);
  return 'scan_failed';
}

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
        serverUrl: "http://localhost:3001",
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
// SERVER HEALTH CHECK
// ==============================
async function checkServerHealth() {
  try {
    const { serverUrl } = await chrome.storage.sync.get("serverUrl");
    const baseUrl = serverUrl || "http://localhost:3001";

    const timeoutPromise = new Promise((_, reject) => {
      setTimeout(() => reject(new Error('Health check timeout')), 8000); // Increased to 8 seconds
    });

    const fetchPromise = fetch(`${baseUrl}/health`, {
      method: "GET",
      headers: {
        "Content-Type": "application/json",
      }
    });

    const response = await Promise.race([fetchPromise, timeoutPromise]);
    
    if (!response.ok) {
      throw new Error(`Server responded with status: ${response.status}`);
    }

    console.log("[DEVScan Background] ✅ Server health check passed");
    return true;
  } catch (error) {
    console.error("[DEVScan Background] ❌ Server health check failed:", error);
    return false;
  }
}

// ==============================
// SESSION MANAGEMENT
// ==============================

// Create a new scan session on the server
async function createNewScanSession() {
  try {
    const { serverUrl } = await chrome.storage.sync.get("serverUrl");
    const baseUrl = serverUrl || "http://localhost:3001";

    // Get browser info for session tracking
    const browserInfo = `Chrome Extension v4.0 - ${navigator.userAgent || 'Unknown Browser'}`;
    const engineVersion = "DEVSCAN-4.0";

    // Create timeout promise
    const timeoutPromise = new Promise((_, reject) => {
      setTimeout(() => reject(new Error('Session creation timeout')), 8000);
    });

    const fetchPromise = fetch(`${baseUrl}/api/scan-sessions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        browserInfo,
        engineVersion
      })
    });

    const response = await Promise.race([fetchPromise, timeoutPromise]);

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
    // Get user's strict blocking preference
    chrome.storage.sync.get(["strictMaliciousBlocking"], (data) => {
      const strictBlocking = data.strictMaliciousBlocking ?? false;
      const riskLevel = message.riskLevel || "malicious";
      
      // Determine which warning page to use based on risk level and user preference
      let warningPageFile;
      if (riskLevel === "anomalous") {
        warningPageFile = "html/AnomalousWarningPage.html";
      } else if (riskLevel === "malicious" && strictBlocking) {
        warningPageFile = "html/StrictWarningPage.html";
      } else {
        warningPageFile = "html/WarningPage.html";
      }
      
      // Open appropriate warning page for risky links
      const warningUrl = chrome.runtime.getURL(
        `${warningPageFile}?url=${encodeURIComponent(
          message.targetUrl
        )}&openerTabId=${sender.tab.id}&riskLevel=${riskLevel}&strict=${strictBlocking}`
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
    });
    return true; // Keep message channel open for async response
  } 
  
  else if (message.action === "analyzeSingleLink") {
    console.log(`[DEVScan Background] 🔧 DEBUG: Received analyzeSingleLink request for: ${message.url}`);
    console.log(`[DEVScan Background] 🔧 DEBUG: Message details:`, message);
    console.log(`[DEVScan Background] 🔧 DEBUG: Sender tab ID:`, sender.tab?.id);
    
    // Handle individual link analysis for immediate verdict delivery
    handleSingleLinkAnalysis(message.url, message.domain, message.sessionId, sender.tab.id)
      .catch(error => {
        console.error("[DEVScan Background] Single link analysis failed:", error);
        
        // Determine fallback verdict based on error type
        let fallbackVerdict = "scan_failed"; // Default to scan_failed when server is unavailable for security
        
        // If it's a timeout or connection error, mark as scan failed
        if (error.message && (
          error.message.includes('timeout') || 
          error.message.includes('fetch') ||
          error.message.includes('NetworkError') ||
          error.message.includes('Failed to fetch')
        )) {
          fallbackVerdict = "scan_failed";
          console.log(`[DEVScan Background] Server unavailable for ${message.url}, will mark as scan failed after delay`);
        } else {
          // For other errors, also mark as scan failed
          fallbackVerdict = "scan_failed";
        }
        
        // Send fallback verdict to content script with longer delay to avoid immediate failure appearance
        setTimeout(() => {
          console.log(`[DEVScan Background] Sending delayed scan_failed for ${message.url} due to error after longer wait`);
          chrome.tabs.sendMessage(sender.tab.id, {
            action: "updateSingleLinkVerdict",
            url: message.url,
            verdict: fallbackVerdict
          }).catch(msgError => {
            console.error("[DEVScan Background] Failed to send fallback verdict:", msgError);
          });
        }, 8000); // Wait 8 seconds (increased from 3) before sending scan_failed on error
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

  else if (message.action === "allowLinkBypass" && message.url) {
    proceedURLS.add(message.url);
    setTimeout(() => proceedURLS.delete(message.url), 60000);
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
    console.log(`[DEVScan Background] 🔍 Starting analysis for: ${url}`);
    
    // Don't do immediate health check - let the actual request handle timing
    console.log(`[DEVScan Background] ✅ Proceeding with analysis for: ${url}`);

    // Get server URL and session ID from storage
    const { serverUrl, currentSessionId } = await chrome.storage.sync.get(["serverUrl", "currentSessionId"]);
    const baseUrl = serverUrl || "http://localhost:3001";

    // Use provided session ID or fallback to stored one
    const sessionId = providedSessionId || currentSessionId;

    // Create timeout promise that rejects after 90 seconds (increased for ML processing)
    const timeoutPromise = new Promise((_, reject) => {
      setTimeout(() => reject(new Error('Request timeout - analysis taking too long')), 90000);
    });

    // Create fetch promise with proper timeout
    const fetchPromise = fetch(`${baseUrl}/api/extension/analyze`, {
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

    // Race between fetch and timeout
    const response = await Promise.race([fetchPromise, timeoutPromise]);

    if (!response.ok) {
      throw new Error(`Server responded with status: ${response.status}`);
    }

    const result = await response.json();

    console.log(`[DEVScan Background] 📥 Received response for ${url}:`, {
      success: result.success,
      verdictCount: result.verdicts ? Object.keys(result.verdicts).length : 0,
      verdicts: result.verdicts,
      requestedUrl: url,
      exactMatch: result.verdicts ? result.verdicts[url] : 'no exact match',
      allKeys: result.verdicts ? Object.keys(result.verdicts) : []
    });

    if (result.success && result.verdicts) {
      // Try to find the verdict for this URL (exact match first)
      let verdict = result.verdicts[url];
      let verdictString = 'scan_failed'; // Default value

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
        // Convert ML verdict object to extension string format
        verdictString = convertMLVerdictToString(verdict);
        
        console.log(`[DEVScan Background] 📤 Sending verdict to tab ${tabId}: ${url} -> ${verdictString}`);
        console.log(`[DEVScan Background] 🔧 DEBUG: Original verdict object:`, verdict);
        console.log(`[DEVScan Background] 🔧 DEBUG: Converted to string:`, verdictString);
        
        // Store additional verdict data for tooltips
        chrome.tabs.sendMessage(tabId, {
          action: "updateSingleLinkVerdict",
          url: url,
          verdict: verdictString,
          verdictData: verdict // Include full verdict object for tooltip display
        }, (response) => {
          if (chrome.runtime.lastError) {
            console.error(`[DEVScan Background] Failed to send message to tab ${tabId}:`, chrome.runtime.lastError);
            // Retry once after a short delay
            setTimeout(() => {
              chrome.tabs.sendMessage(tabId, {
                action: "updateSingleLinkVerdict",
                url: url,
                verdict: verdictString,
                verdictData: verdict
              });
            }, 1000);
          } else {
            console.log(`[DEVScan Background] ✅ Verdict delivered successfully for ${url}: ${verdictString}`);
          }
        });
      } else {
        console.error(`[DEVScan Background] No verdict found for ${url} in server response`);

        // Send failed verdict instead of "unknown"
        chrome.tabs.sendMessage(tabId, {
          action: "updateSingleLinkVerdict",
          url: url,
          verdict: "scan_failed"
        });
      }

      // Store session ID if provided by server
      if (result.session_ID) {
        await chrome.storage.sync.set({ currentSessionId: result.session_ID });
      }

      // Add malicious URLs to intercept list for click-based blocking
      if (verdictString === "malicious" || verdictString === "anomalous") {
        addMaliciousUrl(url);
      }

      return { 
        verdict: verdictString, 
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
    const baseUrl = serverUrl || "http://localhost:3001";

    // Create timeout promise
    const timeoutPromise = new Promise((_, reject) => {
      setTimeout(() => reject(new Error('Extract-links request timeout')), 8000);
    });

    // Call the extract-links endpoint
    const fetchPromise = fetch(`${baseUrl}/api/extract-links`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ url: maliciousUrl }),
    });

    const response = await Promise.race([fetchPromise, timeoutPromise]);

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


// ==============================
// URL Interception & Analysis
// ==============================

// Intercept URLs before they load to check if malicious
let proceedURLS = new Set(); // Store URLs allowed to proceed without warning
let maliciousUrls = new Set(); // Store intercepted URLs identified as malicious
const safeBypassed = new Set(); // Store URLs marked safe to skip re-scanning

// Function to add malicious URLs to intercept list
function addMaliciousUrl(url) {
  maliciousUrls.add(url);
  setTimeout(() => maliciousUrls.delete(url), 60000);
  console.log(`[DEVScan Background] Added ${url} to malicious intercept list`);
}

// Temporary safe bypass for URLs marked safe to avoid re-scanning in short term
const SAFE_BYPASS_TTL = 10 * 60 * 1000; // 10 minutes
function addSafeBypass(url) {
  safeBypassed.add(url);
  setTimeout(() => safeBypassed.delete(url), SAFE_BYPASS_TTL);
}

async function interceptURL(url, details) {
  console.log("[DEVScan Intercepted] URL:", url);

  // Hex Decoder of the intercepted link
  const decodedUrl = decodeHexUrl(details.url);

  // Conditional link unshortening
  const resolvedUrl = await resolveShortenedUrl(decodedUrl, details);

  // If this URL is already marked safe, skip scanning
  if (safeBypassed.has(url)) {
    console.log("[DEVScan] Skipping re-scan of safe URL:", url);
    return;
  }
  // Check if the URL is allowed to bypass the warning by the user
  if (maliciousUrls.has(resolvedUrl)) {
    console.log("[DEVScan] URL allowed to bypass warning:", resolvedUrl);
    return;
  }

  // Skip internal warning pages to avoid infinite loops
  if (resolvedUrl.includes("html/WarningPage.html") || 
      resolvedUrl.includes("html/AnomalousWarningPage.html") || 
      resolvedUrl.includes("html/StrictWarningPage.html") || 
      resolvedUrl.includes("html/ScanningPage.html")){
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

   // Redirect to scanning page immediately
  // chrome.tabs.update(details.tabId, {
  //   url: chrome.runtime.getURL(`html/ScanningPage.html?url=${encodeURIComponent(url)}`)
  // });
  
  const { verdict } = await handleSingleLinkAnalysis(resolvedUrl, domain, currentSessionId, details.tabId);

  // Fix logic: redirect when verdict is malicious or anomalous
  if (verdict === "malicious" || verdict === "anomalous") {
    console.log("[DEVScan] Risky verdict, redirecting to warning page...");

    // Get user's strict blocking preference
    const { strictMaliciousBlocking } = await new Promise(resolve => {
      chrome.storage.sync.get(["strictMaliciousBlocking"], resolve);
    });
    
    const strictBlocking = strictMaliciousBlocking ?? false;

    // Choose warning page
    let warningPageFile;
    if (verdict === "anomalous") {
      warningPageFile = "html/AnomalousWarningPage.html";
    } else if (verdict === "malicious" && strictBlocking) {
      warningPageFile = "html/StrictWarningPage.html";
    } else {
      warningPageFile = "html/WarningPage.html";
    }

    // Redirect tab directly from background
    chrome.tabs.update(details.tabId, {
      url: chrome.runtime.getURL(
        `${warningPageFile}?url=${encodeURIComponent(resolvedUrl)}&openerTabId=${details.tabId}&strict=${strictBlocking}&fromDevScan=true&ts=${Date.now()}`
      )
    });

    const extractionResult = await handleExtractLinks(resolvedUrl);
    console.log("[DEVScan] Link extraction result:", extractionResult);

  } else {
    // Safe verdict → go to actual site
    chrome.tabs.update(details.tabId, { url: resolvedUrl });
    addSafeBypass(resolvedUrl); // Safe to the temporary Set
  }

}


function shouldIntercept(details) {
  try {
    const u = new URL(details.url);

    // Skip yung errors HAHAHAHA
    if (u.hostname.endsWith("google.com")) {
      if (u.pathname.startsWith("/search")) return false; // any Google search results - for future use
      if (u.searchParams.has("tbm") || u.searchParams.has("udm")) return false; // AI/images/news
    }

    return true; // everything else is valid
  } catch {
    return false;
  }
}

// Listen for web requests via manually input or redirect from other apps to intercept navigation to potentially malicious URLs
chrome.webRequest.onBeforeRequest.addListener(
  (details) => {
    if (!shouldIntercept(details)) return;
    interceptURL(details.url, details);
  },
  { urls: ["<all_urls>"], types: ["main_frame"] }
);