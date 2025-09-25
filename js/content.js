// content.js
// ==============================
// DEVSCAN CONTENT SCRIPT VERSION 4.0
// ==============================
// Main browser extension content script for real-time link analysis
// Monitors web pages for external links and processes them through the security pipeline
// Handles dynamic content, prevents duplicate processing, and manages user interactions

console.log("[DEVScan] Content script loaded on:", window.location.href);

// ==============================
// URL UTILITY FUNCTIONS (EMBEDDED FOR RELIABILITY)
// ==============================

function decodeHexUrl(url) {
  try {
    const decoded = decodeURIComponent(url);
    console.log("[DEVScan] Decoded URL:", decoded);
    return decoded;
  } catch (e) {
    console.warn("[DEVScan] Hex decode failed:", url, e);
    return url;
  }
}

async function unshortenLink(shortUrl) {
  try {
    const { serverUrl } = await chrome.storage.sync.get("serverUrl");
    const baseUrl = serverUrl || "http://localhost:3001";

    // Create timeout promise
    const timeoutPromise = new Promise((_, reject) => {
      setTimeout(() => reject(new Error("Unshorten request timeout")), 8000);
    });

    const fetchPromise = fetch(`${baseUrl}/api/unshortened-links`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ url: shortUrl }),
    });

    const response = await Promise.race([fetchPromise, timeoutPromise]);

    if (!response.ok) {
      console.warn(
        `[DEVScan] Unshortener returned status ${response.status} → using original`
      );
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

async function resolveShortenedUrl(url, details = {}) {
  const shortenedPatterns = [
    "bit.ly",
    "t.co",
    "tinyurl.com",
    "goo.gl",
    "is.gd",
    "buff.ly",
    "cutt.ly",
    "ow.ly",
    "rebrand.ly",
  ];

  try {
    const parsedUrl = new URL(url);

    if (
      shortenedPatterns.includes(parsedUrl.hostname) &&
      !details._unshortened
    ) {
      // For now, just return the original URL since unshortening requires server
      const resolvedUrl = await unshortenLink(url);
      console.log("[DEVScan] Resolved shortened link →", resolvedUrl);
      details._unshortened = true;

      // Recursively resolve again in case the resolved URL is also shortened
      return resolveShortenedUrl(resolvedUrl, details);
    }
  } catch (e) {
    console.warn("[DEVScan] URL parsing failed in unshorten step:", url, e);
    return url;
  }

  return url;
}

// Make functions available globally
window.decodeHexUrl = decodeHexUrl;
window.resolveShortenedUrl = resolveShortenedUrl;

console.log("[DEVScan] URL utility functions loaded:", {
  decodeHexUrl: typeof decodeHexUrl,
  resolveShortenedUrl: typeof resolveShortenedUrl,
  window_decodeHexUrl: typeof window.decodeHexUrl,
  window_resolveShortenedUrl: typeof window.resolveShortenedUrl,
});

// ==============================
// GLOBAL STATE MANAGEMENT (MOVED TO TOP)
// ==============================

let collectedLinks = new Set(); // Links currently being analyzed
let linkVerdicts = new Map(); // Server verdicts cached locally
let currentSessionId = null; // Current scan session ID

// ==============================
// PAGE-BASED SCANNING STATE (MOVED TO TOP)
// ==============================
let currentPageUrl = window.location.href; // Track current page URL
let pageProcessedLinks = new Set(); // Links processed for current page
let pageRefreshDetected = false; // Track if page was refreshed
let pageLoadTime = Date.now(); // Track when page loaded

// ==============================
// HELPER FUNCTIONS
// ==============================

// Check if a verdict represents a valid security assessment (not a failure)
function isValidSecurityVerdict(verdict) {
  if (!verdict || typeof verdict !== "string") return false;

  const validVerdicts = ["safe", "malicious", "anomalous"];
  return validVerdicts.includes(verdict.toLowerCase());
}

// ==============================
// INITIALIZATION & SESSION MANAGEMENT
// ==============================

// Clear any cached scan failures to allow fresh retries
function clearFailedCacheEntries() {
  const failedEntries = [];
  for (const [url, verdict] of linkVerdicts.entries()) {
    if (!isValidSecurityVerdict(verdict)) {
      failedEntries.push(url);
    }
  }

  failedEntries.forEach((url) => {
    linkVerdicts.delete(url);
    console.log(`[DEVScan] 🧹 Cleared failed cache entry for: ${url}`);
  });

  if (failedEntries.length > 0) {
    console.log(
      `[DEVScan] 🧹 Cleared ${failedEntries.length} failed cache entries to allow retries`
    );
  }
}

// Clear failed cache entries on page load
clearFailedCacheEntries();

// Detect if this is a page refresh or new navigation
const navigationEntry = performance.getEntriesByType("navigation")[0];
if (navigationEntry && navigationEntry.type === "reload") {
  pageRefreshDetected = true;
  console.log("[DEVScan] Page refresh detected");
} else {
  console.log("[DEVScan] New page navigation detected");
}

// Clean up any stuck "scanning" tooltips from previous sessions
function cleanupStuckScanningLinks() {
  const scanningLinks = document.querySelectorAll(
    'a[data-devscan-risk="scanning"]'
  );
  console.log(
    `[DEVScan] Found ${scanningLinks.length} stuck scanning links, cleaning up...`
  );

  scanningLinks.forEach((link) => {
    // Reset to scan_failed state for security (don't assume safe)
    link.dataset.devscanRisk = "scan_failed";
    delete link.dataset.tooltipBound;
    delete link.dataset.devscanStyled;

    // Reattach tooltip with scan_failed state
    attachRiskTooltip(link, "scan_failed");
    attachClickHandler(link);
  });
}

// Clean up stuck links after sufficient time for server processing (30 seconds)
// This only cleans up truly stuck links from previous sessions, not current scans
setTimeout(cleanupStuckScanningLinks, 30000);

// Get current session ID from storage or create new one
chrome.storage.sync.get(["currentSessionId"], (result) => {
  if (result.currentSessionId) {
    currentSessionId = result.currentSessionId;
    console.log("[DEVScan] Using session ID:", currentSessionId);
  } else {
    // Request creation of new session
    chrome.runtime.sendMessage({ action: "createSession" }, (response) => {
      if (response && response.success && response.sessionId) {
        currentSessionId = response.sessionId;
        console.log("[DEVScan] Created new session ID:", currentSessionId);
      }
    });
  }
});

const selectors = [
  "a[href]", // Only scan actual navigation links
  // Removed other selectors that shouldn't be scanned for security:
  // "link[href]", "iframe[src]", "frame[src]", "script[src]",
  // "form[action]", "button[onclick]", "[onclick*='http']", "[data-href]"
];

// ==============================
// SETTINGS CACHE
// ==============================
let blockingEnabled = true; // Default value

// Load blocking setting on page load
chrome.storage.sync.get("enableBlocking", ({ enableBlocking }) => {
  blockingEnabled = enableBlocking ?? true;
  console.log(`[DEVScan] 🔧 Blocking enabled: ${blockingEnabled}`);
});

// Listen for setting changes
chrome.storage.onChanged.addListener((changes) => {
  if (changes.enableBlocking) {
    blockingEnabled = changes.enableBlocking.newValue ?? true;
    console.log(`[DEVScan] 🔧 Blocking setting changed to: ${blockingEnabled}`);
  }
});

// ==============================
// LINK PROCESSING ENGINE
// ==============================
// Main function to process individual links found on the page
function processLink(link) {
  if (!link || !link.href) return;

  const isInternal = isSameDomain(link.href, window.location.href); // Check if it's an internal link first

  if (isInternal) {
    console.log(`[DEVScan] 🔧 Skipping same-domain link: ${link.href}`);
    return; // Skip processing internal links completely - no tooltips, no underlining, no scanning
  }

  console.log(`[DEVScan] 🔧 Processing external link: ${link.href}`);

  // ==============================
  // EXTERNAL LINK PROCESSING
  // ==============================

  // Force unbind previous handler to ensure it doesn't disappear after repeated clicks or reloads
  if (link.__devscanHandlerAttached) {
    link.removeEventListener("click", link.__devscanHandlerAttached);
  }

  collectLinkForAnalysis(link.href); // Add external link to collection for server processing

  // Show "scanning" initially, then update with server verdict or local assessment
  const serverVerdict = linkVerdicts.get(link.href);
  let riskLevel;

  if (serverVerdict) {
    // We already have a server verdict
    riskLevel = serverVerdict;
  } else {
    // Show scanning state while waiting for server analysis
    riskLevel = "scanning";
  }

  // Ensure tooltipHandler is loaded before calling
  if (typeof window.attachRiskTooltip === "function") {
    attachRiskTooltip(link, riskLevel);
  } else {
    console.error("[DEVScan] attachRiskTooltip function not available");
  }
  link.dataset.devscanRisk = riskLevel; // Store the determined risk on the element for click handling

  // Attach click handler using the new function
  attachClickHandler(link);
}

// ==============================
// LINK COLLECTION & BATCH PROCESSING
// ==============================
// Collect links for analysis and manage batching to server
async function collectLinkForAnalysis(rawUrl, details = {}) {
  try {
    // Hex Decoder - now guaranteed to be available
    const decodedUrl = decodeHexUrl(rawUrl);

    // URL unshortening - now guaranteed to be available
    const resolvedUrl = await resolveShortenedUrl(decodedUrl, details);

    // Skip browser internal URLs and special protocols
    if (isBrowserInternalUrl(resolvedUrl)) {
      console.log(`[DEVScan] Skipping browser internal URL: ${resolvedUrl}`);
      return;
    }

    // ENHANCED DEDUPLICATION: Check multiple conditions
    // Only skip if we have a valid cached security verdict (not failed scans)
    const isAlreadyCollected = collectedLinks.has(resolvedUrl);
    const isAlreadyProcessed = pageProcessedLinks.has(resolvedUrl);
    const cachedVerdict = linkVerdicts.get(resolvedUrl);
    const hasValidCachedVerdict =
      cachedVerdict && isValidSecurityVerdict(cachedVerdict);

    if (isAlreadyCollected || (isAlreadyProcessed && hasValidCachedVerdict)) {
      console.log(
        `[DEVScan] 🔧 Skipping ${resolvedUrl} - collected: ${isAlreadyCollected}, processed: ${isAlreadyProcessed}, valid cache: ${hasValidCachedVerdict}`
      );
      return;
    }

    // Mark as being processed before sending request
    collectedLinks.add(resolvedUrl);
    pageProcessedLinks.add(resolvedUrl);

    // Send individual link for immediate analysis
    console.log(
      `[DEVScan] 🔧 DEBUG: About to call analyzeSingleLink for: ${resolvedUrl}`
    );
    analyzeSingleLink(resolvedUrl);
  } catch (e) {
    console.warn("[DEVScan] Failed to decode URL:", rawUrl, e);
  }
}

// Analyze a single link immediately
function analyzeSingleLink(url) {
  console.log(`[DEVScan] 🚀 analyzeSingleLink CALLED for: ${url}`);
  const currentDomain = window.location.hostname;

  console.log(`[DEVScan] 🔍 Starting analysis for: ${url}`);
  console.log(`[DEVScan] Current domain: ${currentDomain}`);
  console.log(`[DEVScan] Session ID: ${currentSessionId}`);

  const message = {
    action: "analyzeSingleLink",
    url: url,
    domain: currentDomain,
    sessionId: currentSessionId,
  };

  console.log(`[DEVScan] 📤 Sending message to background:`, message);
  console.log(
    `[DEVScan] 🔧 DEBUG: chrome.runtime available:`,
    !!chrome.runtime
  );
  console.log(
    `[DEVScan] 🔧 DEBUG: sendMessage function available:`,
    !!chrome.runtime.sendMessage
  );
  console.log(
    `[DEVScan] 🔧 DEBUG: About to call chrome.runtime.sendMessage...`
  );

  chrome.runtime.sendMessage(message, (response) => {
    console.log(`[DEVScan] 🔧 DEBUG: Message sent, checking response...`);
    if (chrome.runtime.lastError) {
      console.error(
        `[DEVScan] Error sending message:`,
        chrome.runtime.lastError
      );
    } else {
      console.log(`[DEVScan] Background script response:`, response);
    }
  });

  // Set a client-side timeout as backup in case server is completely unresponsive
  // Increased timeout to 150 seconds to allow much more time for server processing
  setTimeout(() => {
    // Check if this URL is still marked as scanning
    if (linkVerdicts.get(url) === undefined && collectedLinks.has(url)) {
      console.log(
        `[DEVScan] ⏰ Client timeout reached for ${url} after 2.5 minutes, marking as scan failed for security`
      );
      console.log(
        `[DEVScan] 🔧 DEBUG: Final timeout state - verdict: ${linkVerdicts.get(
          url
        )}, in collection: ${collectedLinks.has(url)}`
      );

      // Update tooltip but don't cache the failed result - allow retry later
      updateLinkTooltip(url, "scan_failed");
      collectedLinks.delete(url);
      console.log(
        `[DEVScan] ⚠️ Not caching timeout failure for ${url} to allow future retries`
      );
    } else {
      console.log(
        `[DEVScan] ✅ No timeout needed for ${url} - verdict: ${linkVerdicts.get(
          url
        )}, in collection: ${collectedLinks.has(url)}`
      );
    }
  }, 150000); // 150 second (2.5 minutes) client-side timeout to give much more time

  // The response will come via the "updateSingleLinkVerdict" message listener
  // No need for response callback - using direct messaging instead
}

// Check if URL is a browser internal URL that should never be scanned
function isBrowserInternalUrl(url) {
  if (!url || typeof url !== "string") return true;

  const lowerUrl = url.toLowerCase().trim();

  // Browser internal protocols
  const internalProtocols = [
    "about:",
    "chrome:",
    "chrome-extension:",
    "chrome-search:",
    "chrome-devtools:",
    "edge:",
    "firefox:",
    "safari:",
    "data:",
    "blob:",
    "file:",
    "ftp:",
    "javascript:",
    "mailto:",
    "tel:",
    "sms:",
    "moz-extension:",
    "safari-extension:",
    "webkit:",
    "resource:",
    "view-source:",
  ];

  // Check if URL starts with any internal protocol
  for (const protocol of internalProtocols) {
    if (lowerUrl.startsWith(protocol)) {
      return true;
    }
  }

  // Special cases
  if (lowerUrl === "" || lowerUrl === "#" || lowerUrl.startsWith("#")) {
    return true; // Empty URLs, anchors
  }

  return false;
}

// Check if two URLs belong to the same domain or trusted service
function isSameDomain(url1, url2) {
  try {
    const domain1 = new URL(url1).hostname.toLowerCase();
    const domain2 = new URL(url2).hostname.toLowerCase();

    // Remove www prefix for comparison
    const normalizedDomain1 = domain1.replace(/^www\./, "");
    const normalizedDomain2 = domain2.replace(/^www\./, "");

    // Direct domain match
    if (normalizedDomain1 === normalizedDomain2) {
      return true;
    }

    // Check for trusted service domains (like Google services)
    const trustedDomainGroups = [
      [
        "google.com",
        "google.co.uk",
        "google.ca",
        "google.com.au",
        "google.de",
        "google.fr",
        "accounts.google.com",
        "myaccount.google.com",
        "docs.google.com",
        "drive.google.com",
        "mail.google.com",
        "gmail.com",
        "youtube.com",
        "googlesource.com",
        "gstatic.com",
        "googleusercontent.com",
        "googleapis.com",
        "googleadservices.com",
        "googlesyndication.com",
      ],
      [
        "microsoft.com",
        "live.com",
        "outlook.com",
        "office.com",
        "xbox.com",
        "msn.com",
        "bing.com",
      ],
      ["facebook.com", "instagram.com", "whatsapp.com", "fb.com"],
      [
        "amazon.com",
        "aws.amazon.com",
        "amazonaws.com",
        "amazon.co.uk",
        "amazon.ca",
      ],
    ];

    // Check if both domains belong to the same trusted group
    for (const group of trustedDomainGroups) {
      const domain1InGroup = group.some(
        (trusted) =>
          normalizedDomain1 === trusted ||
          normalizedDomain1.endsWith("." + trusted)
      );
      const domain2InGroup = group.some(
        (trusted) =>
          normalizedDomain2 === trusted ||
          normalizedDomain2.endsWith("." + trusted)
      );

      if (domain1InGroup && domain2InGroup) {
        return true;
      }
    }

    return false;
  } catch (error) {
    console.warn(`[DEVScan] Error parsing URLs: ${error.message}`);
    return false;
  }
}

// Update tooltip display for a specific URL with new verdict
function updateLinkTooltip(url, verdict, verdictData = null) {
  console.log(`[DEVScan Content] 🔧 DEBUG: updateLinkTooltip called with:`, {
    url,
    verdict,
    verdictType: typeof verdict,
    hasVerdictData: verdictData !== null,
  });

  // Try multiple selection approaches
  let links = document.querySelectorAll(`a[href="${url}"]`);

  if (links.length === 0) {
    // Try with escaped quotes
    const escapedUrl = url.replace(/"/g, '\\"');
    links = document.querySelectorAll(`a[href="${escapedUrl}"]`);
  }

  if (links.length === 0) {
    // Try finding links by iterating through all links
    const allLinks = document.querySelectorAll("a[href]");
    const matchingLinks = [];
    allLinks.forEach((link) => {
      const linkHref = link.href;

      // Direct comparison
      if (linkHref === url) {
        matchingLinks.push(link);
        return;
      }

      // Normalized comparison (remove trailing slash, case insensitive)
      const normalizeUrl = (u) => u.replace(/\/+$/, "").toLowerCase();
      if (normalizeUrl(linkHref) === normalizeUrl(url)) {
        matchingLinks.push(link);
        return;
      }

      // URL without query parameters
      const linkBase = linkHref.split("?")[0];
      const urlBase = url.split("?")[0];
      if (linkBase === urlBase) {
        matchingLinks.push(link);
        return;
      }
    });
    links = matchingLinks;
  }

  if (links.length === 0) {
    console.log(`[DEVScan] No matching links found for ${url}`);
    return false;
  }

  let updateCount = 0;
  links.forEach((link) => {
    console.log("[DEVScan Content] 🔧 DEBUG: Processing verdict for link:", {
      url: link.href,
      verdict: verdict,
      verdictType: typeof verdict,
      hasVerdictData: verdictData !== null,
    });

    // Always use the converted verdict string for risk level
    let riskLevel = verdict;

    // If we have rich verdict data, store it for tooltips
    if (verdictData && typeof verdictData === "object") {
      console.log("[DEVScan Content] 🔧 DEBUG: Storing rich ML data from verdictData:", verdictData);

      link.dataset.finalVerdict = verdict || "";
      link.dataset.confidence = verdictData.confidence_score != null ? verdictData.confidence_score : "";
      link.dataset.anomalyRisk = verdictData.anomaly_risk_level || "";
      link.dataset.explanation = verdictData.explanation || "";
      link.dataset.textContent = verdictData.explanation || "";
      link.dataset.tip = verdictData.tip || "";
      link.dataset.tipText = verdictData.tip || "";
      riskLevel = verdict; // already simplified by background
    } else if (typeof verdict === "object" && verdict !== null) {
      // Legacy fallback
      console.log(
        "[DEVScan Content] 🔧 DEBUG: Legacy: verdict is object, extracting fields:",
        verdict
      );
      link.dataset.finalVerdict = verdict.final_verdict || "";
      link.dataset.confidence =
        verdictData.confidence_score != null ? verdictData.confidence_score : "";
      link.dataset.anomalyRisk = verdictData.anomaly_risk_level || "";
      link.dataset.explanation = verdictData.explanation || "";
      link.dataset.textContent = verdictData.explanation || "";
      link.dataset.tip = verdictData.tip || "";
      link.dataset.tipText = verdictData.tip || "";
      const rawVerdict = verdict.final_verdict || "";
      if (rawVerdict.toLowerCase().includes("scan failed"))
        riskLevel = "scan_failed";
      else if (rawVerdict.toLowerCase().includes("safe")) riskLevel = "safe";
      else if (rawVerdict.toLowerCase().includes("malicious"))
        riskLevel = "malicious";
      else if (rawVerdict.toLowerCase().includes("anomalous"))
        riskLevel = "anomalous";
      else riskLevel = "scanning";
      console.log(
        "[DEVScan Content] 🔧 DEBUG: Converted raw verdict to risk level:",
        riskLevel
      );
    } else {
      // String verdict - store as basic data
      console.log(
        "[DEVScan Content] 🔧 DEBUG: Storing string verdict:",
        verdict
      );
      link.dataset.finalVerdict = verdict;
      link.dataset.confidence = "";
      link.dataset.anomalyRisk = "";
      link.dataset.explanation = "";
      link.dataset.textContent = "";
      link.dataset.tip = "";
      link.dataset.tipText = "";
      riskLevel = verdict;
    }

    console.log("[DEVScan Content] 🔧 DEBUG: Stored dataset:", {
      finalVerdict: link.dataset.finalVerdict,
      confidence: link.dataset.confidence,
      anomalyRisk: link.dataset.anomalyRisk,
      explanation: link.dataset.explanation,
      textContent: link.dataset.textContent,
      tip: link.dataset.tip,
      tipText: link.dataset.tipText,
    });

    // Always force refresh if verdict actually changed
    const currentRisk = link.dataset.devscanRisk;
    const needsUpdate = currentRisk !== riskLevel;
    console.log(`[DEVScan Content] 🔧 DEBUG: Link update check:`, {
      url: link.href,
      currentRisk,
      newRiskLevel: riskLevel,
      needsUpdate,
    });
    console.log(
      `[DEVScan] Updating link ${url} from ${currentRisk} to ${riskLevel}`
    );
    if (needsUpdate) {
      delete link.dataset.tooltipBound;
      delete link.dataset.devscanStyled;
    }
    link.dataset.devscanRisk = riskLevel;
    console.log(
      `[DEVScan Content] 🔧 DEBUG: After assignment, link.dataset.devscanRisk =`,
      link.dataset.devscanRisk
    );

    // ⬇️ Live-refresh an already-open tooltip/sidebar (no re-hover needed)
    if (typeof window.updateTooltipLevel === "function") {
      try {
        window.updateTooltipLevel(link, riskLevel);
      } catch (err) {
        console.warn("[DEVScan] updateTooltipLevel failed:", err);
      }
    }

    // Always reattach tooltip for fresh state (ensures listeners exist)
    if (typeof window.attachRiskTooltip === "function") {
      attachRiskTooltip(link, riskLevel);
    } else {
      console.error(
        "[DEVScan] attachRiskTooltip function not available during update"
      );
    }

    // Reattach click handler with updated verdict
    attachClickHandler(link);
    updateCount++;
  });

  console.log(
    `[DEVScan] Updated ${updateCount} links for ${url} with verdict: ${verdict}`
  );
  return updateCount > 0;
}

// Separate function to attach click handlers - ADDED THIS FUNCTION
function attachClickHandler(link) {
  // Remove existing handler if any
  if (link.__devscanHandlerAttached) {
    link.removeEventListener("click", link.__devscanHandlerAttached);
  }

  // Create new click handler that opens warning page for risky links
  const clickHandler = (e) => {
    // Check if temporary bypass is active
    if (window.devscanTemporaryBypass) {
      console.log("[DEVScan] Temporary bypass active, allowing navigation");
      return; // Allow normal navigation
    }

    const storedRisk = link.dataset.devscanRisk || "safe";

    // Check if link is currently being scanned
    if (storedRisk === "scanning") {
      e.preventDefault();
      e.stopPropagation();

      // Store the actual link element for the "Proceed Anyway" button
      window.devscanCurrentClickedLink = link;

      // Show scanning popup message
      showScanningPopup();
      return;
    }

    // Check if scan failed
    if (storedRisk === "scan_failed") {
      e.preventDefault();
      e.stopPropagation();

      // Store the actual link element for the "Proceed with Caution" button
      window.devscanCurrentClickedLink = link;

      // Show scan failed popup message
      showScanFailedPopup();
      return;
    }

    if (storedRisk === "malicious" || storedRisk === "anomalous") {
      e.preventDefault();
      e.stopPropagation();

      if (blockingEnabled) {
        chrome.runtime.sendMessage({
          action: "openWarningTab",
          targetUrl: link.href,
          riskLevel: storedRisk,
        });
      } else {
        // If blocking is disabled, navigate to the link normally
        window.location.href = link.href;
      }
    }
  };

  // Attach click handler to intercept clicks on risky links
  link.__devscanHandlerAttached = clickHandler;
  link.addEventListener("click", clickHandler);
}

// Function to show scanning popup message
function showScanningPopup() {
  if (document.getElementById("devscan-scanning-popup")) return;

  // Create popup wrapper
  const popup = document.createElement("div");
  popup.id = "devscan-scanning-popup";
  popup.innerHTML = `
    <div class="scanning-popup-content">
      <div class="scanning-popup-header">
        <div class="scanning-spinner"></div>
        <h3>Security Scan in Progress</h3>
      </div>
      <p>DEVScan is analyzing this link for your safety. Please wait for the scan to complete before proceeding.</p>
      <p class="popup-note"><strong>This helps protect you from potential security threats.</strong></p>
      <div class="scanning-popup-buttons">
        <button class="scanning-popup-close">Go Back</button>
        <button class="scanning-popup-proceed">Proceed Anyway</button>
      </div>
    </div>
  `;

  // Overlay background
  popup.style.cssText = `
    position: fixed;
    inset: 0;
    background: rgba(10, 15, 25, 0.85);
    backdrop-filter: blur(6px);
    -webkit-backdrop-filter: blur(6px);
    z-index: 999999;
    display: flex;
    justify-content: center;
    align-items: center;
    font-family: 'Montserrat', system-ui, -apple-system, 'Segoe UI', Roboto, Arial, sans-serif;
  `;

  // Cyber-blue popup style
  const style = document.createElement("style");
  style.textContent = `
    .scanning-popup-content {
      background: #171a22;
      border: 1px solid rgba(96, 165, 250, 0.35);
      border-radius: 18px;
      padding: 32px;
      max-width: 650px;
      width: 90%;
      color: #f8fafc;
      box-shadow: 0 0 20px rgba(59, 130, 246, 0.25), 0 10px 32px rgba(0,0,0,0.6);
      text-align: center;
      animation: popupSlide 0.35s ease-out;
    }

    .scanning-popup-header {
      display: flex;
      align-items: center;
      justify-content: center;
      gap: 14px;
      margin-bottom: 20px;
    }

    .scanning-popup-header h3 {
      margin: 0;
      font-size: 25px;
      font-weight: 800;
      color: #60a5fa;
      text-shadow: 0 0 6px rgba(96, 165, 250, 0.4);
    }

    .scanning-spinner {
      width: 26px;
      height: 26px;
      border: 3px solid rgba(96, 165, 250, 0.2);
      border-top: 3px solid #3b82f6;
      border-radius: 50%;
      animation: spin 1s linear infinite;
      box-shadow: 0 0 8px rgba(59,130,246,0.6);
    }

    .scanning-popup-content p {
      margin: 14px 0;
      font-size: 18px;
      line-height: 1.6;
      color: #cbd5e1;
    }
    .popup-note {
      color: #93c5fd;
      font-size: 14px;
      margin-top: 8px;
    }

    .scanning-popup-buttons {
      display: flex;
      gap: 14px;
      justify-content: center;
      margin-top: 24px;
      flex-wrap: wrap;
    }

    .scanning-popup-close, 
    .scanning-popup-proceed {
      padding: 12px 18px;
      border-radius: 12px;
      font-size: 16px;
      font-weight: 700;
      cursor: pointer;
      transition: all 0.25s ease;
      min-width: 140px;
    }

    .scanning-popup-close {
      background: #3b82f6;
      color: #fff;
      border: none;
      box-shadow: 0 0 10px rgba(59, 130, 246, 0.4);
    }
    .scanning-popup-close:hover {
      background: #2563eb;
      box-shadow: 0 0 14px rgba(59, 130, 246, 0.6);
      transform: translateY(-1px);
    }

    .scanning-popup-proceed {
      background: transparent;
      color: #f8fafc;
      border: 2px solid rgba(148,187,255,0.55);
    }
    .scanning-popup-proceed:hover {
      background: rgba(96,165,250,0.1);
      box-shadow: 0 0 12px rgba(96,165,250,0.35);
      transform: translateY(-1px);
    }

    @keyframes spin {
      to { transform: rotate(360deg); }
    }

    @keyframes popupSlide {
      from { opacity: 0; transform: translateY(-20px) scale(0.96); }
      to   { opacity: 1; transform: translateY(0) scale(1); }
    }
  `;

  // Add popup and styles to page
  document.head.appendChild(style);
  document.body.appendChild(popup);

  // Add event listeners for buttons
  const closeButton = popup.querySelector(".scanning-popup-close");
  const proceedButton = popup.querySelector(".scanning-popup-proceed");

  if (closeButton) {
    closeButton.addEventListener("click", () => {
      if (popup.parentElement) {
        popup.remove();
      }
    });
  }

  if (proceedButton) {
    proceedButton.addEventListener("click", () => {
      if (popup.parentElement) {
        popup.remove();
      }

      // Set temporary bypass flag
      window.devscanTemporaryBypass = true;

      // Get the stored link element and navigate to it
      const clickedLink = window.devscanCurrentClickedLink;
      if (clickedLink && clickedLink.href) {
        console.log("[DEVScan] Proceeding anyway to:", clickedLink.href);
        // Navigate to the URL directly
        window.location.href = clickedLink.href;
      } else {
        console.warn("[DEVScan] No valid link found to proceed to");
      }

      // Notify background that this URL is allowed in InterceptURL
      chrome.runtime.sendMessage({
        action: "allowLinkBypass",
        url: clickedLink.href,
      });

      // Clear the bypass flag and stored link after navigation
      setTimeout(() => {
        delete window.devscanTemporaryBypass;
        delete window.devscanCurrentClickedLink;
      }, 1000);
    });
  }

  // Auto-remove popup after 5 seconds
  setTimeout(() => {
    if (popup.parentElement) {
      popup.remove();
    }
  }, 5000);
}

// Function to show scan failed popup message
function showScanFailedPopup() {
  // Check if popup already exists to avoid duplicates
  if (document.getElementById("devscan-scanfailed-popup")) {
    return;
  }

  // Overlay + content
  const popup = document.createElement("div");
  popup.id = "devscan-scanfailed-popup";
  popup.innerHTML = `
    <div class="scanfailed-popup-content" role="alertdialog" aria-labelledby="sf-title" aria-describedby="sf-desc">
      <div class="scanfailed-popup-header">
        <div class="scanfailed-icon" aria-hidden="true">
          <svg viewBox="0 0 24 24" width="22" height="22" fill="currentColor">
            <path d="M12 2l10 18H2L12 2zm1 13h-2v2h2v-2zm0-6h-2v5h2V9z"/>
          </svg>
        </div>
        <h3 id="sf-title">Security Scan Failed</h3>
      </div>

      <p id="sf-desc">DEVScan was unable to analyze this link (network issues or temporary server unavailability).</p>
      <p class="sf-note"><strong>Please proceed carefully or try the scan again.</strong></p>

      <div class="scanfailed-popup-buttons">
        <button class="scanfailed-popup-close" aria-label="Close">Cancel</button>

        <div class="divider">
          <button class="tryagain-btn scanfailed-popup-tryagain">Try Again</button>
          <button class="scanfailed-popup-proceed">Proceed with Caution</button>
        </div>
      </div>
    </div>
  `;

  // Overlay (blurred, dark)
  popup.style.cssText = `
    position: fixed;
    inset: 0;
    background: rgba(10, 15, 25, 0.85);
    backdrop-filter: blur(6px);
    -webkit-backdrop-filter: blur(6px);
    z-index: 999999;
    display: flex;
    justify-content: center;
    align-items: center;
    font-family: 'Montserrat', system-ui, -apple-system, 'Segoe UI', Roboto, Arial, sans-serif;
  `;

  // Styles (dark panel + blue accent)
  const style = document.createElement("style");
  style.textContent = `
    .scanfailed-popup-content {
      background: #171a22;
      border: 1px solid rgba(96,165,250,0.35);
      border-radius: 18px;
      width: min(650px, 92%);
      margin: 20px;
      padding: 30px 28px;
      color: #e5f0ff;
      text-align: center;
      box-shadow: 0 0 20px rgba(59,130,246,0.22), 0 12px 36px rgba(0,0,0,0.6);
      animation: sfSlide 0.35s ease-out;
    }

    .scanfailed-popup-header {
      display: flex;
      align-items: center;
      justify-content: center;
      gap: 12px;
      margin-bottom: 14px;
    }

    .scanfailed-icon {
      width: 34px;
      height: 34px;
      display: grid;
      place-items: center;
      color: #93c5fd;
      background: rgba(59,130,246,0.12);
      border: 1px solid rgba(148,187,255,0.35);
      border-radius: 999px;
      box-shadow: 0 0 10px rgba(96,165,250,0.25);
      animation: sfPulse 2.2s ease-in-out infinite;
    }

    .scanfailed-popup-header h3 {
      margin: 0;
      font-size: 24px;
      font-weight: 800;
      color: #60a5fa;
      text-shadow: 0 0 6px rgba(96,165,250,0.35);
    }

    .scanfailed-popup-content p {
      margin: 12px 0;
      color: #cbd5e1;
      font-size: 18px;
      line-height: 1.6;
    }
    .sf-note { color: #93c5fd; }

    .scanfailed-popup-buttons {
      display: flex;
      gap: 16px;
      justify-content: space-between;
      margin-top: 22px;
      flex-wrap: wrap;
    }

    .divider {
      display: flex;
      gap: 12px;
      flex-wrap: wrap;
      justify-content: center;
    }

    .scanfailed-popup-close,
    .scanfailed-popup-proceed,
    .scanfailed-popup-tryagain {
      padding: 12px 16px;
      border-radius: 12px;
      font-size: 16px;
      font-weight: 800;
      cursor: pointer;
      transition: transform .2s ease, box-shadow .25s ease, background-color .2s ease, border-color .2s ease;
      min-width: 150px;
    }

    /* Neutral cancel */
    .scanfailed-popup-close {
      background: #0f141d;
      color: #e5e7eb;
      border: 1px solid rgba(148,163,184,0.35);
    }
    .scanfailed-popup-close:hover {
      background: #111826;
      box-shadow: 0 0 12px rgba(148,163,184,0.25);
      transform: translateY(-1px);
    }

    /* Primary action = Try Again (blue) */
    .scanfailed-popup-tryagain {
      background: #3b82f6;
      color: #fff;
      border: none;
      box-shadow: 0 0 12px rgba(59,130,246,0.45);
    }
    .scanfailed-popup-tryagain:hover {
      background: #2563eb;
      box-shadow: 0 0 16px rgba(59,130,246,0.6);
      transform: translateY(-1px);
    }

    /* Secondary action = Proceed (outlined) */
    .scanfailed-popup-proceed {
      background: transparent;
      color: #e5f0ff;
      border: 2px solid rgba(148,187,255,0.55);
    }
    .scanfailed-popup-proceed:hover {
      background: rgba(96,165,250,0.10);
      box-shadow: 0 0 14px rgba(96,165,250,0.35);
      transform: translateY(-1px);
    }

    @keyframes sfPulse {
      0%, 100% { transform: scale(1); box-shadow: 0 0 10px rgba(96,165,250,0.25); }
      50% { transform: scale(1.06); box-shadow: 0 0 16px rgba(96,165,250,0.35); }
    }

    @keyframes sfSlide {
      from { opacity: 0; transform: translateY(-18px) scale(0.96); }
      to   { opacity: 1; transform: translateY(0) scale(1); }
    }

    @media (max-width: 520px) {
      .scanfailed-popup-buttons,
      .divider { flex-direction: column; }
      .scanfailed-popup-content { padding: 26px 20px; }
    }
  `;

  // Add popup and styles to page
  document.head.appendChild(style);
  document.body.appendChild(popup);

  // Add event listeners for buttons
  const closeButton = popup.querySelector(".scanfailed-popup-close");
  const proceedButton = popup.querySelector(".scanfailed-popup-proceed");
  const tryAgainButton = popup.querySelector(".scanfailed-popup-tryagain");

  if (closeButton) {
    closeButton.addEventListener("click", () => {
      if (popup.parentElement) {
        popup.remove();
      }
    });
  }

  if (tryAgainButton) {
    tryAgainButton.addEventListener("click", async () => {
      if (popup.parentElement) {
        popup.remove();
      }

      const clickedLink = window.devscanCurrentClickedLink;
      if (!clickedLink) {
        console.error("[DEVScan Sender] ❌ No clicked link available!");
        return;
      }

      // Get initiator from query params or fallback
      const params = new URLSearchParams(window.location.search);
      const initiator = params.get("initiator") || window.location.href || document.referrer || "unknown";

      console.log("[DEVScan Content] Retrying scan for:", clickedLink.href, "initiator:", initiator);
      try {
        const response = await new Promise((resolve, reject) => {
          chrome.runtime.sendMessage(
            {
              action: "retryScan",
              url: clickedLink.href,
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
    });
  }

  if (proceedButton) {
    proceedButton.addEventListener("click", () => {
      if (popup.parentElement) {
        popup.remove();
      }

      // Set temporary bypass flag
      window.devscanTemporaryBypass = true;

      // Get the stored link element and navigate to it
      const clickedLink = window.devscanCurrentClickedLink;
      if (clickedLink && clickedLink.href) {
        console.log("[DEVScan] Proceeding with caution to:", clickedLink.href);
        // Navigate to the URL directly
        window.location.href = clickedLink.href;
      } else {
        console.warn("[DEVScan] No valid link found to proceed to");
      }

      // Clear the bypass flag and stored link after navigation
      setTimeout(() => {
        delete window.devscanTemporaryBypass;
        delete window.devscanCurrentClickedLink;
      }, 1000);
    });
  }

  // Auto-remove popup after 8 seconds (longer than scanning popup)
  setTimeout(() => {
    if (popup.parentElement) {
      popup.remove();
    }
  }, 8000);
}

// Trigger banner display if function is available
function triggerBanner() {
  if (typeof showBanner === "function") {
    showBanner();
  } else {
    console.warn("[DEVScan] showBanner() not found in banner.js");
  }
}
// ==============================
// PAGE SCANNING & EARLY DOM OBSERVATION
// ==============================

function scanLinks() {
  console.log("[DEVScan] 🔍 Starting initial link scan...");
  const links = document.querySelectorAll(selectors.join(","));
  console.log(`[DEVScan] 📊 Found ${links.length} potential links to scan`);
  links.forEach((link, index) => {
    console.log(
      `[DEVScan] 🔗 Processing link ${index + 1}/${links.length}: ${
        link.href || link.textContent?.substring(0, 50)
      }`
    );
    processLink(link);
  });
  console.log("[DEVScan] ✅ Initial link scan complete");
}

// ==============================
// DYNAMIC CONTENT MONITORING
// ==============================

let scanTimeout = null;

// Unified DOM observer for dynamic content and initial scan
function startDOMObserver() {
  console.log("[DEVScan] 🔧 Starting DOM observer...");
  const observer = new MutationObserver((mutations) => {
    let hasNewLinks = false;

    mutations.forEach((mutation) => {
      if (mutation.type === "childList") {
        mutation.addedNodes.forEach((node) => {
          if (node.nodeType === Node.ELEMENT_NODE) {
            // Check if the node itself matches any selector
            if (node.matches && selectors.some((sel) => node.matches(sel))) {
              processLink(node);
              hasNewLinks = true;
              return;
            }

            // Check if the node contains any matching elements
            if (node.querySelectorAll) {
              const matches = node.querySelectorAll(selectors.join(","));
              if (matches.length > 0) {
                matches.forEach((link) => processLink(link));
                hasNewLinks = true;
              }
            }
          }
        });
      }
    });

    if (hasNewLinks) {
      // Debounce additional scans to avoid excessive processing
      if (scanTimeout) clearTimeout(scanTimeout);
      scanTimeout = setTimeout(() => {
        scanLinks();
      }, 300);
    }
  });

  observer.observe(document.documentElement, {
    childList: true,
    subtree: true,
    attributes: false,
    characterData: false,
  });

  // Initial scan
  scanLinks();
}

// ==============================
// MESSAGE HANDLING
// ==============================

// Listen for messages from background script and other extension components
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg.action === "showToast") {
    // Remove old toast if still visible
    const oldToast = document.getElementById("devscan-toast");
    if (oldToast) oldToast.remove();

    // Create container
    const toast = document.createElement("div");
    toast.id = "devscan-toast";

    // Use innerHTML so <h3> and <p> render properly
    toast.innerHTML = `
      <div class="devscan-toast-content ${msg.type}">
        <div class="devscan-toast-line"></div>
        <div class="devscan-toast-icon">
          ${msg.type === "warning" ? "⚠️" : "✅"}
        </div>
        <div class="devscan-toast-text">
          ${msg.message}
        </div>
      </div>
    `;

    // Base positioning (theme font + center top)
    toast.style.cssText = `
      position: fixed;
      top: 20px;
      left: 50%;
      transform: translateX(-50%);
      z-index: 2147483647;
      font-family: 'Montserrat', system-ui, -apple-system, 'Segoe UI', Roboto, Arial, sans-serif;
    `;

    // Add styles for content (glass + glow; amber for warning, blue for other)
    const style = document.createElement("style");
    style.textContent = `
      .devscan-toast-content {
        --accent: ${msg.type === "warning" ? "#f59e0b" : "#60a5fa"};
        --accentSoft: ${
          msg.type === "warning"
            ? "rgba(245,158,11,0.40)"
            : "rgba(96,165,250,0.40)"
        };

        display: flex;
        flex-direction: row;
        align-items: center;
        gap: 12px;

        padding: 12px 16px;
        border-radius: 14px;
        width: clamp(260px, 80vw, 520px);

        background: rgba(23, 26, 34, 0.88);
        color: #e5e7eb;
        border: 1px solid rgba(148,163,184,0.25);
        box-shadow:
          0 8px 24px rgba(0,0,0,0.35),
          0 0 18px var(--accentSoft);
        -webkit-backdrop-filter: blur(10px);
        backdrop-filter: blur(10px);

        text-align: left;
        animation: devscanToastFade 0.28s ease-out;
      }

      .devscan-toast-line {
        align-self: stretch;
        width: 6px;
        border-radius: 8px;
        background: linear-gradient(180deg, var(--accent), var(--accentSoft));
        box-shadow: 0 0 8px var(--accentSoft);
      }

      .devscan-toast-icon {
        font-size: 22px;
        margin-right: 4px;
        border-radius: 50%;
        flex-shrink: 0;
        filter: drop-shadow(0 0 6px var(--accentSoft));
      }

      .devscan-toast-text {
        font-size: 14px;
        line-height: 1.45;
      }

      @keyframes devscanToastFade {
        from { opacity: 0; transform: translateY(-10px) scale(0.96); }
        to   { opacity: 1; transform: translateY(0) scale(1); }
      }
    `;

    document.body.appendChild(style);
    document.body.appendChild(toast);

    // Auto remove after 5s
    setTimeout(() => toast.remove(), 5000);
  } else if (msg.action === "updateSingleLinkVerdict") {
    console.log("Listening from updateSingleLinkVerdict");
    // Handle individual link verdict updates for immediate feedback
    const { url, verdict, verdictData } = msg;

    console.log(`[DEVScan Content] 📨 Received verdict for ${url}: ${verdict}`);
    console.log(`[DEVScan Content] 🔧 DEBUG: Verdict data:`, verdictData);
    console.log(
      `[DEVScan Content] 🔧 DEBUG: isValidSecurityVerdict(${verdict}):`,
      isValidSecurityVerdict(verdict)
    );

    console.log(
      `[DEVScan Content] Current linkVerdicts state:`,
      Array.from(linkVerdicts.entries())
    );
    console.log(
      `[DEVScan Content] Current collectedLinks state:`,
      Array.from(collectedLinks)
    );

    // Validate the verdict
    if (!verdict || typeof verdict !== "string") {
      console.error(
        `[DEVScan Content] Invalid verdict received for ${url}:`,
        verdict
      );

      sendResponse({ success: false, error: "Invalid verdict" });
      return true;
    }

    // Only cache legitimate security verdicts, not failed scans
    if (isValidSecurityVerdict(verdict)) {
      linkVerdicts.set(url, verdict);
      console.log(
        `[DEVScan Content] ✅ Successfully cached security verdict ${verdict} for ${url}`
      );
    } else {
      console.log(
        `[DEVScan Content] ⚠️ Not caching failed scan result for ${url}: ${verdict}`
      );
      // Remove from collectedLinks to allow retry
      collectedLinks.delete(url);
    }

    console.log(
      `[DEVScan Content] 🔧 DEBUG: linkVerdicts now contains:`,
      Array.from(linkVerdicts.entries())
    );

    let updateSuccess = false;
    if (verdictData) {
      // Store additional verdict data for rich tooltips
      const links = document.querySelectorAll(`a[href="${url}"]`);
      console.log(`[DEVScan Content] 🔧 DEBUG: Found ${links.length} links matching href="${url}"`);

      links.forEach((link, index) => {
        console.log(`[DEVScan Content] 🔧 DEBUG: Updating link ${index + 1} with verdict data`);

        link.dataset.finalVerdict = verdictData.final_verdict || "secret";
        link.dataset.confidence = verdictData.confidence_score || ""; // Fixed: use 'confidence' not 'confidenceScore'
        link.dataset.anomalyRisk = verdictData.anomaly_risk_level || "";
        link.dataset.explanation = verdictData.explanation || "";
        link.dataset.tipText = verdictData.tip || "";
        link.dataset.riskLabel = verdict; // Store the simplified verdict too
      });

      // Update tooltip with converted verdict string but pass verdictData for rich tooltip info
      console.log(`[DEVScan Content] 🔧 DEBUG: Calling updateLinkTooltip with converted verdict: ${verdict} and verdictData for rich info`);

      updateSuccess = updateLinkTooltip(url, verdict, verdictData);
      console.log(`[DEVScan Content] ${updateSuccess ? "✅" : "❌"} Tooltip update for ${url} with converted verdict and rich data ||  verdict: ${verdict}`);

    } else {
      // Fallback to string verdict if no rich data
      console.log(
        `[DEVScan Content] 🔧 DEBUG: Calling updateLinkTooltip with string verdict: ${verdict}`
      );

      updateSuccess = updateLinkTooltip(url, verdict);
      console.log(
        `[DEVScan Content] ${
          updateSuccess ? "✅" : "❌"
        } Tooltip update for ${url} with string verdict: ${verdict}`
      );
    }

    console.log(`[DEVScan Content] Stored verdict ${verdict} for ${url}`);

    // Clean up processing state
    const wasInCollection = collectedLinks.has(url);
    collectedLinks.delete(url);
    console.log(
      `[DEVScan Content] Cleaned up processing state for ${url} (was in collection: ${wasInCollection})`
    );

    // Send response back to background script
    if (sendResponse) {
      sendResponse({
        success: updateSuccess,
        message: updateSuccess
          ? "Verdict processed successfully"
          : "Failed to update tooltip",
        url: url,
        verdict: verdict,
      });
    }

    // Don't remove from pageProcessedLinks - keep it to prevent reprocessing
    // Only if it was a complete failure should we allow reprocessing later

    return true; // Keep message channel open for async response
  } else if (msg.action === "sessionUpdated") {
    currentSessionId = msg.sessionId;
  }
});

// ==============================
// TAB VISIBILITY & PERFORMANCE MANAGEMENT
// ==============================

// Handle tab visibility changes to manage processing
document.addEventListener("visibilitychange", () => {
  if (!document.hidden) {
    // Tab became visible, check for new content
    setTimeout(() => {
      scanLinks();
    }, 500);
  }
});

// ==============================
// PAGE REFRESH DETECTION
// ==============================

// Detect when user is about to refresh or navigate away
window.addEventListener("beforeunload", () => {
  // Store that user initiated refresh/navigation
  sessionStorage.setItem("devscan_page_refresh", "true");
});

// Check if we returned from a refresh
window.addEventListener("load", () => {
  if (sessionStorage.getItem("devscan_page_refresh") === "true") {
    pageRefreshDetected = true;
    sessionStorage.removeItem("devscan_page_refresh");
  }
});

// ==============================
// MEMORY MANAGEMENT
// ==============================

// Periodic cleanup to prevent memory leaks from accumulating too many cached results
setInterval(() => {
  // First, clear any failed cache entries to allow retries
  clearFailedCacheEntries();

  // Clear old verdicts if we have too many (keep last 1000 valid entries only)
  if (linkVerdicts.size > 1000) {
    const validEntries = Array.from(linkVerdicts.entries()).filter(
      ([url, verdict]) => isValidSecurityVerdict(verdict)
    );
    linkVerdicts.clear();
    // Keep only the last 500 valid entries
    validEntries.slice(-500).forEach(([url, verdict]) => {
      linkVerdicts.set(url, verdict);
    });
    console.log(
      `[DEVScan] 🧹 Kept ${Math.min(
        500,
        validEntries.length
      )} valid cache entries out of ${validEntries.length} total`
    );
  }

  // Clear page processed links if we have too many (keep last 500)
  if (pageProcessedLinks.size > 500) {
    const linksArray = Array.from(pageProcessedLinks);
    pageProcessedLinks.clear();
    // Keep only the last 250 links
    linksArray.slice(-250).forEach((url) => {
      pageProcessedLinks.add(url);
    });
  }
}, 30000); // Run every 30 seconds

// ==============================
// SETTINGS CHANGE HANDLING
// ==============================

// Listen for extension settings changes and update UI accordingly
chrome.storage.onChanged.addListener((changes) => {
  if (!changes.showWarningsOnly) return;

  const highlightEnabled = changes.showWarningsOnly.newValue;

  document.querySelectorAll(selectors.join(",")).forEach((link) => {
    // Skip internal / same-domain links
    if (
      isSameDomain(
        link.href || link.getAttribute?.("data-href") || "",
        window.location.href
      )
    )
      return;

    if (highlightEnabled) {
      const url =
        link.href || link.getAttribute?.("data-href") || link.src || "";

      const serverVerdict = url ? linkVerdicts.get(url) : null;
      const riskLevel = serverVerdict || "scanning";

      // If tooltip was previously styled/bound, keep it fresh
      const prev = link.dataset.devscanRisk;
      const changed = prev !== riskLevel;

      // Update element state
      link.dataset.devscanRisk = riskLevel;
      if (changed) {
        delete link.dataset.tooltipBound;
        delete link.dataset.devscanStyled;
      }

      // Live-refresh any already-open tooltip/sidebar for this link
      if (typeof window.updateTooltipLevel === "function") {
        try {
          window.updateTooltipLevel(link, riskLevel);
        } catch (e) {
          console.warn(
            "[DEVScan] updateTooltipLevel failed in settings handler:",
            e
          );
        }
      }

      // Ensure hover handlers exist (idempotent inside attachRiskTooltip)
      if (typeof window.attachRiskTooltip === "function") {
        attachRiskTooltip(link, riskLevel);
      } else {
        console.error(
          "[DEVScan] attachRiskTooltip function not available in settings handler"
        );
      }

      // Make sure the click interception matches the new state
      attachClickHandler(link);
    } else {
      // Highlighting turned off: remove visual underline but keep dataset/listeners
      link.style.textDecoration = "none";
      link.style.textDecorationColor = "";
    }
  });
});

// ==============================
// INFINITE SCROLL DETECTION
// ==============================

let scrollTimeout;
window.addEventListener("scroll", () => {
  clearTimeout(scrollTimeout);
  scrollTimeout = setTimeout(() => {
    // Only scan if we're near the bottom (infinite scroll detection)
    const scrollPosition = window.scrollY + window.innerHeight;
    const documentHeight = document.documentElement.scrollHeight;

    if (scrollPosition >= documentHeight * 0.8) {
      // 80% scrolled
      scanLinks();
    }
  }, 1000);
});

// ==============================
// SINGLE PAGE APPLICATION (SPA) SUPPORT
// ==============================
// Handle URL changes without page reloads (React, Angular, Vue.js apps)

let lastUrl = window.location.href;
const urlObserver = new MutationObserver(() => {
  if (window.location.href !== lastUrl) {
    const previousUrl = lastUrl;
    lastUrl = window.location.href;

    // Update page tracking
    currentPageUrl = lastUrl;
    pageLoadTime = Date.now();
    triggerBanner();

    // Only clear processed links if it's a different page (not just hash changes)
    const previousUrlBase = previousUrl.split("#")[0];
    const currentUrlBase = lastUrl.split("#")[0];

    if (previousUrlBase !== currentUrlBase) {
      pageProcessedLinks.clear();
      pageRefreshDetected = false; // SPA navigation, not a refresh

      // Rescan after a short delay to allow page to load
      setTimeout(() => {
        scanLinks();
      }, 1000);
    }
  }
});

// Trigger banner on initial load
window.addEventListener("load", () => {
  triggerBanner();
});
// Monitor for URL changes in SPAs
urlObserver.observe(document, { subtree: true, childList: true });

// ==============================
// INITIALIZATION - START EXTENSION
// ==============================

// Ensure DOM is ready before starting the extension
function initializeExtension() {
  try {
    console.log("[DEVScan] 🚀 Initializing extension...");
    startDOMObserver();
    console.log("[DEVScan] ✅ Extension initialization complete");
  } catch (error) {
    console.error("[DEVScan] Extension initialization failed:", error);
  }
}

// Start extension when DOM is ready
if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", initializeExtension);
} else {
  // DOM is already ready
  initializeExtension();
}

// Test URL functions
console.log("🧪 Testing content script URL functions:");
const testUrl = "https%3A//example.com/test";
console.log("  - decodeHexUrl test:", decodeHexUrl(testUrl));
console.log(
  "  - resolveShortenedUrl available:",
  typeof resolveShortenedUrl === "function"
);
