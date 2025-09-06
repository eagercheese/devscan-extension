// content.js
import { decodeHexUrl, resolveShortenedUrl } from "./utils.js";

// ==============================
// DEVSCAN CONTENT SCRIPT VERSION 4.0
// ==============================
// Main browser extension content script for real-time link analysis
// Monitors web pages for external links and processes them through the security pipeline
// Handles dynamic content, prevents duplicate processing, and manages user interactions

console.log("[DEVScan] Content script loaded on:", window.location.href);

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
// INITIALIZATION & SESSION MANAGEMENT
// ==============================

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
  const scanningLinks = document.querySelectorAll('a[data-devscan-risk="scanning"]');
  console.log(`[DEVScan] Found ${scanningLinks.length} stuck scanning links, cleaning up...`);
  
  scanningLinks.forEach(link => {
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
  "a[href]",
  "link[href]",
  "iframe[src]",
  "frame[src]",
  "script[src]",
  "form[action]",
  "button[onclick]",
  "[onclick*='http']",
  "[data-href]",
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

  if (isInternal) 
    return; // Skip processing internal links completely - no tooltips, no underlining, no scanning

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
  if (typeof window.attachRiskTooltip === 'function') {
    attachRiskTooltip(link, riskLevel);
  } else {
    console.error('[DEVScan] attachRiskTooltip function not available');
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
    //Hex Decoder
    const hexUrl = decodeHexUrl(rawUrl);

    //Url unshortener
    const decodedUrl = await resolveShortenedUrl(hexUrl, details);

    // Skip browser internal URLs and special protocols
    if (isBrowserInternalUrl(decodedUrl)) {
      console.log(`[DEVScan] Skipping browser internal URL: ${decodedUrl}`);
      return;
    }

    // ENHANCED DEDUPLICATION: Check multiple conditions
    const isAlreadyCollected = collectedLinks.has(decodedUrl);
    const isAlreadyProcessed = pageProcessedLinks.has(decodedUrl);
    const hasExistingVerdict = linkVerdicts.has(decodedUrl);

    if (isAlreadyCollected || isAlreadyProcessed || hasExistingVerdict) {
      return;
    }

    // Mark as being processed before sending request
    collectedLinks.add(decodedUrl);
    pageProcessedLinks.add(decodedUrl);

    // Send individual link for immediate analysis
    analyzeSingleLink(decodedUrl);
  } catch (e) {
    console.warn("[DEVScan] Failed to decode URL:", rawUrl, e);
  }
}

// Analyze a single link immediately
function analyzeSingleLink(url) {
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

  chrome.runtime.sendMessage(message, (response) => {
    if (chrome.runtime.lastError) {
      console.error(`[DEVScan] Error sending message:`, chrome.runtime.lastError);
    } else {
      console.log(`[DEVScan] Background script response:`, response);
    }
  });

  // Set a client-side timeout as backup in case server is completely unresponsive
  // Increased timeout to 120 seconds to allow much more time for server processing
  setTimeout(() => {
    // Check if this URL is still marked as scanning
    if (linkVerdicts.get(url) === undefined && collectedLinks.has(url)) {
      console.log(`[DEVScan] ⏰ Client timeout reached for ${url} after 2 minutes, marking as scan failed for security`);
      
      // Update with scan_failed verdict as fallback for security
      linkVerdicts.set(url, "scan_failed");
      updateLinkTooltip(url, "scan_failed");
      collectedLinks.delete(url);
    } else {
      console.log(`[DEVScan] ✅ No timeout needed for ${url} - verdict: ${linkVerdicts.get(url)}, in collection: ${collectedLinks.has(url)}`);
    }
  }, 120000); // 120 second (2 minutes) client-side timeout to give much more time

  // The response will come via the "updateSingleLinkVerdict" message listener
  // No need for response callback - using direct messaging instead
}

// Check if URL is a browser internal URL that should never be scanned
function isBrowserInternalUrl(url) {
  if (!url || typeof url !== 'string') return true;
  
  const lowerUrl = url.toLowerCase().trim();
  
  // Browser internal protocols
  const internalProtocols = [
    'about:', 'chrome:', 'chrome-extension:', 'chrome-search:', 'chrome-devtools:',
    'edge:', 'firefox:', 'safari:', 'data:', 'blob:', 'file:', 'ftp:',
    'javascript:', 'mailto:', 'tel:', 'sms:', 'moz-extension:', 'safari-extension:',
    'webkit:', 'resource:', 'view-source:'
  ];
  
  // Check if URL starts with any internal protocol
  for (const protocol of internalProtocols) {
    if (lowerUrl.startsWith(protocol)) {
      return true;
    }
  }
  
  // Special cases
  if (lowerUrl === '' || lowerUrl === '#' || lowerUrl.startsWith('#')) {
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
        'google.com', 'google.co.uk', 'google.ca', 'google.com.au', 'google.de', 'google.fr',
        'accounts.google.com', 'myaccount.google.com', 'docs.google.com', 'drive.google.com', 
        'mail.google.com', 'gmail.com', 'youtube.com', 'googlesource.com', 'gstatic.com',
        'googleusercontent.com', 'googleapis.com', 'googleadservices.com', 'googlesyndication.com'
      ],
      ['microsoft.com', 'live.com', 'outlook.com', 'office.com', 'xbox.com', 'msn.com', 'bing.com'],
      ['facebook.com', 'instagram.com', 'whatsapp.com', 'fb.com'],
      ['amazon.com', 'aws.amazon.com', 'amazonaws.com', 'amazon.co.uk', 'amazon.ca']
    ];
    
    // Check if both domains belong to the same trusted group
    for (const group of trustedDomainGroups) {
      const domain1InGroup = group.some(trusted => 
        normalizedDomain1 === trusted || normalizedDomain1.endsWith('.' + trusted)
      );
      const domain2InGroup = group.some(trusted => 
        normalizedDomain2 === trusted || normalizedDomain2.endsWith('.' + trusted)
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
function updateLinkTooltip(url, verdict) {
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
    // Always force refresh if verdict actually changed
    const currentRisk = link.dataset.devscanRisk;
    const needsUpdate = currentRisk !== verdict;
    
    console.log(`[DEVScan] Updating link ${url} from ${currentRisk} to ${verdict}`);
    
    if (needsUpdate) {
      delete link.dataset.tooltipBound;
      delete link.dataset.devscanStyled;
    }
    
    link.dataset.devscanRisk = verdict;

    // Always reattach tooltip for fresh state
    if (typeof window.attachRiskTooltip === 'function') {
      attachRiskTooltip(link, verdict);
    } else {
      console.error('[DEVScan] attachRiskTooltip function not available during update');
    }

    // Reattach click handler with updated verdict
    attachClickHandler(link);

    updateCount++;
  });

  console.log(`[DEVScan] Updated ${updateCount} links for ${url} with verdict: ${verdict}`);
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
    const storedRisk = link.dataset.devscanRisk || "safe";

    // Check if link is currently being scanned
    if (storedRisk === "scanning") {
      e.preventDefault();
      e.stopPropagation();
      
      // Show scanning popup message
      showScanningPopup();
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
  // Check if popup already exists to avoid duplicates
  if (document.getElementById('devscan-scanning-popup')) {
    return;
  }

  // Create popup element
  const popup = document.createElement('div');
  popup.id = 'devscan-scanning-popup';
  popup.innerHTML = `
    <div class="scanning-popup-content">
      <div class="scanning-popup-header">
        <div class="scanning-spinner"></div>
        <h3>Security Scan in Progress</h3>
      </div>
      <p>DEVScan is currently analyzing this link for your safety. Please wait for the scan to complete before clicking the link.</p>
      <p><strong>This helps protect you from potential security threats!</strong></p>
      <button class="scanning-popup-close">I'll Wait</button>
    </div>
  `;

  // Add styles
  popup.style.cssText = `
    position: fixed;
    top: 0;
    left: 0;
    right: 0;
    bottom: 0;
    background: rgba(0, 0, 0, 0.7);
    z-index: 999999;
    display: flex;
    justify-content: center;
    align-items: center;
    font-family: 'Segoe UI', Roboto, Arial, sans-serif;
  `;

  // Add styles for popup content
  const style = document.createElement('style');
  style.textContent = `
    .scanning-popup-content {
      background: white;
      padding: 30px;
      border-radius: 12px;
      max-width: 450px;
      margin: 20px;
      box-shadow: 0 10px 30px rgba(0, 0, 0, 0.3);
      text-align: center;
      animation: scanningPopupSlide 0.3s ease-out;
    }
    .scanning-popup-header {
      display: flex;
      align-items: center;
      justify-content: center;
      margin-bottom: 20px;
      gap: 12px;
    }
    .scanning-popup-header h3 {
      margin: 0;
      color: #C42927;
      font-size: 20px;
      font-weight: 700;
    }
    .scanning-spinner {
      width: 24px;
      height: 24px;
      border: 3px solid #f3f3f3;
      border-top: 3px solid #C42927;
      border-radius: 50%;
      animation: scanningSpinner 1s linear infinite;
    }
    .scanning-popup-content p {
      margin: 15px 0;
      color: #333;
      line-height: 1.5;
      font-size: 16px;
    }
    .scanning-popup-close {
      background: #C42927;
      color: white;
      border: none;
      padding: 12px 24px;
      border-radius: 6px;
      font-size: 16px;
      font-weight: 600;
      cursor: pointer;
      margin-top: 15px;
      transition: background 0.3s ease;
    }
    .scanning-popup-close:hover {
      background: #a02220;
    }
    @keyframes scanningSpinner {
      0% { transform: rotate(0deg); }
      100% { transform: rotate(360deg); }
    }
    @keyframes scanningPopupSlide {
      from { 
        opacity: 0; 
        transform: translateY(-20px) scale(0.95); 
      }
      to { 
        opacity: 1; 
        transform: translateY(0) scale(1); 
      }
    }
  `;

  // Add popup and styles to page
  document.head.appendChild(style);
  document.body.appendChild(popup);

  // Add event listener for close button
  const closeButton = popup.querySelector('.scanning-popup-close');
  if (closeButton) {
    closeButton.addEventListener('click', () => {
      if (popup.parentElement) {
        popup.remove();
      }
    });
  }

  // Auto-remove popup after 5 seconds
  setTimeout(() => {
    if (popup.parentElement) {
      popup.remove();
    }
  }, 5000);
}

// ==============================
// PAGE SCANNING & EARLY DOM OBSERVATION
// ==============================

function scanLinks() {
  console.log("[DEVScan] 🔍 Starting initial link scan...");
  const links = document.querySelectorAll(selectors.join(","));
  console.log(`[DEVScan] 📊 Found ${links.length} potential links to scan`);
  links.forEach((link, index) => {
    console.log(`[DEVScan] 🔗 Processing link ${index + 1}/${links.length}: ${link.href || link.textContent?.substring(0, 50)}`);
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
    showToast(msg.message, msg.type);
  } else if (msg.action === "updateSingleLinkVerdict") {
    // Handle individual link verdict updates for immediate feedback
    const { url, verdict } = msg;

    console.log(`[DEVScan Content] 📨 Received verdict for ${url}: ${verdict}`);
    console.log(`[DEVScan Content] Current linkVerdicts state:`, Array.from(linkVerdicts.entries()));
    console.log(`[DEVScan Content] Current collectedLinks state:`, Array.from(collectedLinks));

    // Validate the verdict
    if (!verdict || typeof verdict !== 'string') {
      console.error(`[DEVScan Content] Invalid verdict received for ${url}:`, verdict);
      sendResponse({ success: false, error: "Invalid verdict" });
      return true;
    }

    // Store the verdict and update tooltip
    linkVerdicts.set(url, verdict);
    console.log(`[DEVScan Content] Stored verdict ${verdict} for ${url}`);

    const updateSuccess = updateLinkTooltip(url, verdict);
    console.log(`[DEVScan Content] ${updateSuccess ? '✅' : '❌'} Tooltip update for ${url}: ${verdict}`);

    // Clean up processing state
    const wasInCollection = collectedLinks.has(url);
    collectedLinks.delete(url);
    console.log(`[DEVScan Content] Cleaned up processing state for ${url} (was in collection: ${wasInCollection})`);

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
  // Clear old verdicts if we have too many (keep last 1000)
  if (linkVerdicts.size > 1000) {
    const entries = Array.from(linkVerdicts.entries());
    linkVerdicts.clear();
    // Keep only the last 500 entries
    entries.slice(-500).forEach(([url, verdict]) => {
      linkVerdicts.set(url, verdict);
    });
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
  if (changes.showWarningsOnly) {
    const highlightEnabled = changes.showWarningsOnly.newValue;
    document.querySelectorAll(selectors.join(",")).forEach((link) => {
      if (
        isSameDomain(
          link.href || link.getAttribute?.("data-href") || "",
          window.location.href
        )
      )
        return;

      if (highlightEnabled) {
        const url = link.href || link.getAttribute?.("data-href") || link.src;
        const serverVerdict = url ? linkVerdicts.get(url) : null;
        let riskLevel;

        if (serverVerdict) {
          // We already have a server verdict
          riskLevel = serverVerdict;
        } else {
          // Show scanning state while waiting for server analysis
          riskLevel = "scanning";
        }

        delete link.dataset.devscanStyled;
        // Only refresh tooltip if needed for settings change
        if (link.dataset.tooltipBound === "true") {
          delete link.dataset.tooltipBound;
        }
        link.dataset.devscanRisk = riskLevel;
        if (typeof window.attachRiskTooltip === 'function') {
          attachRiskTooltip(link, riskLevel);
        } else {
          console.error('[DEVScan] attachRiskTooltip function not available in settings handler');
        }
      } else {
        link.style.textDecoration = "none";
        link.style.textDecorationColor = "";
      }
    });
  }
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
