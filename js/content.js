// ==============================
// DEVSCAN CONTENT SCRIPT VERSION 4.0
// ==============================
// Main browser extension content script for real-time link analysis
// Monitors web pages for external links and processes them through the security pipeline
// Handles dynamic content, prevents duplicate processing, and manages user interactions

/* MAS PINA AYOS YUNG MGA MODULES */

// ==============================
// INITIALIZATION & SESSION MANAGEMENT
// ==============================

// Initialize settings from extension storage
watchBlockingSetting();

// Detect if this is a page refresh or new navigation
const navigationEntry = performance.getEntriesByType('navigation')[0];
if (navigationEntry && navigationEntry.type === 'reload') {
  pageRefreshDetected = true;
  console.log('[DEVScan] Page refresh detected');
} else {
  console.log('[DEVScan] New page navigation detected');
}

// Get current session ID from storage or create new one
chrome.storage.sync.get(['currentSessionId'], (result) => {
  if (result.currentSessionId) {
    currentSessionId = result.currentSessionId;
    console.log('[DEVScan] Using session ID:', currentSessionId);
  } else {
    // Request creation of new session
    chrome.runtime.sendMessage({ action: "createSession" }, (response) => {
      if (response && response.success && response.sessionId) {
        currentSessionId = response.sessionId;
        console.log('[DEVScan] Created new session ID:', currentSessionId);
      }
    });
  }
});

// ==============================
// GLOBAL STATE MANAGEMENT
// ==============================

let collectedLinks = new Set();     // Links waiting to be sent to server
let processedLinks = new Set();     // Links already sent to server (prevents duplicates)
let linkVerdicts = new Map();       // Server verdicts cached locally
const BATCH_SIZE = 50;              // Maximum links per batch request
const BATCH_DELAY = 2500;           // 2.5 seconds delay before sending batch
let batchTimeout = null;            // Timeout handle for batch sending
let currentSessionId = null;        // Current scan session ID

// ==============================
// PAGE-BASED SCANNING STATE
// ==============================
let currentPageUrl = window.location.href;        // Track current page URL
let pageProcessedLinks = new Set();               // Links processed for current page
let pageRefreshDetected = false;                  // Track if page was refreshed
let pageLoadTime = Date.now();                    // Track when page loaded

const selectors = [
    "a[href]",
    "link[href]",
    "iframe[src]",
    "frame[src]",
    "script[src]",
    "form[action]",
    "button[onclick]",
    "[onclick*='http']",
    "[data-href]"
  ];

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

  // Use server verdict if available, otherwise fall back to local risk assessment
  const riskLevel = linkVerdicts.get(link.href) || determineRisk(link.href);
  attachRiskTooltip(link, riskLevel);
  link.dataset.devscanRisk = riskLevel; // Store the determined risk on the element for click handling

   // Create click handler that ONLY opens warning page for malicious links
  const clickHandler = (e) => {
    const storedRisk = link.dataset.devscanRisk || "safe";
    if (storedRisk === "malicious" || storedRisk === "danger") {
      e.preventDefault();
      e.stopPropagation();
      chrome.runtime.sendMessage({
        action: "openWarningTab",
        targetUrl: link.href,
      });
    }
  };

  // Attach click handler to intercept clicks on risky links
  link.__devscanHandlerAttached = clickHandler;
  link.addEventListener("click", clickHandler);
}

// ==============================
// LINK COLLECTION & BATCH PROCESSING
// ==============================

// Collect links for analysis and manage batching to server
function collectLinkForAnalysis(rawUrl) {
  try {
    const decodedUrl = decodeURIComponent(rawUrl);
    
    if (isSameDomain(decodedUrl, window.location.href)) return;

    // Check if this link was already processed for current page
    if (!collectedLinks.has(decodedUrl) && !pageProcessedLinks.has(decodedUrl)) {
      collectedLinks.add(decodedUrl);

      console.log("[DEVScan] Acquired link:", decodedUrl);
      
      if (batchTimeout) clearTimeout(batchTimeout);

      batchTimeout = setTimeout(() => {
        sendLinkBatch();
      }, BATCH_DELAY);

      if (collectedLinks.size >= BATCH_SIZE) {
        clearTimeout(batchTimeout);
        sendLinkBatch();
      }
    }
  } catch (e) {
    console.warn("[DEVScan] Failed to decode URL:", rawUrl, e);
  }
}


// Check if two URLs belong to the same domain
function isSameDomain(url1, url2) {
  try {
    const domain1 = new URL(url1).hostname.toLowerCase();
    const domain2 = new URL(url2).hostname.toLowerCase();
    return domain1.replace(/^www\./, "") === domain2.replace(/^www\./, "");
  } catch (error) {
    console.warn(`[DEVScan] Error parsing URLs: ${error.message}`);
    return false;
  }
}

// Send collected links to server for analysis
function sendLinkBatch() {
  if (collectedLinks.size === 0) return;

  const linksArray = Array.from(collectedLinks);
  const currentDomain = window.location.hostname;
  
  // Mark links as processed for current page
  linksArray.forEach(url => pageProcessedLinks.add(url));

  chrome.runtime.sendMessage(
    {
      action: "sendLinksToServer",
      links: linksArray,
      domain: currentDomain,
      sessionId: currentSessionId,
      pageUrl: currentPageUrl,
      pageRefreshed: pageRefreshDetected
    },
    (response) => {
      if (chrome.runtime.lastError) {
        console.error("[DEVScan] Extension error:", chrome.runtime.lastError);
         // Remove from processed set if sending failed, so they can be retried
        linksArray.forEach((url) => {
          pageProcessedLinks.delete(url);
          if (!linkVerdicts.has(url)) {
            linkVerdicts.set(url, "failed");
            updateLinkTooltip(url, "failed");
          }
        });
        collectedLinks.clear();
        return;
      }

      if (response && response.success) {
        collectedLinks.clear();
        pageRefreshDetected = false; // Reset refresh flag after successful send

        // Update session ID if provided by server
        if (response.sessionId) { 
          currentSessionId = response.sessionId;
        }

        // Update local verdicts cache with server results
        for (const [url, verdict] of Object.entries(response.verdicts || {})) {
          // Convert server verdict object to risk level string
          const riskLevel = verdict.isMalicious ? "malicious" : "safe";
          linkVerdicts.set(url, riskLevel);
          updateLinkTooltip(url, riskLevel);
        }
      } else {
        // Remove from processed set if server processing failed
        linksArray.forEach((url) => {
          pageProcessedLinks.delete(url);
          if (!linkVerdicts.has(url)) {
            const localVerdict = determineRisk(url);
            linkVerdicts.set(url, localVerdict);
            updateLinkTooltip(url, localVerdict);
          }
        });
        collectedLinks.clear();
      }
    }
  );
}

// Update tooltip display for a specific URL with new verdict
function updateLinkTooltip(url, verdict) {
  const links = document.querySelectorAll(`a[href="${url}"]`);
  links.forEach((link) => {
    delete link.dataset.tooltipBound;
    delete link.dataset.devscanStyled;
    link.dataset.devscanRisk = verdict;
    attachRiskTooltip(link, verdict);
  });
}



// ==============================
// PAGE SCANNING & EARLY DOM OBSERVATION
// ==============================


function scanLinks() {
  const links = document.querySelectorAll(selectors.join(","));
  links.forEach(processLink); 
}

function earlyScanObserver() {
  const seen = new Set();

  const observer = new MutationObserver(mutations => {
    mutations.forEach(m => {
      m.addedNodes.forEach(n => {
        if (n.nodeType === 1) {
          // If node matches any selector, process directly
          if (n.matches && selectors.some(sel => n.matches(sel))) {
            processLink(n);
          }

          // Also scan all matching children
          if (n.querySelectorAll) {
            const matches = n.querySelectorAll(selectors.join(","));
            matches.forEach(link => {
              processLink(link);
            });
          }
        }
      });
    });
  });

  observer.observe(document.documentElement, {
    childList: true,
    subtree: true
  });

  // Initial scan
  document.querySelectorAll(selectors.join(",")).forEach(link => {
    processLink(link);
  });
}

earlyScanObserver();

// ==============================
// MESSAGE HANDLING
// ==============================

// Listen for messages from background script and other extension components
chrome.runtime.onMessage.addListener((msg) => {
  if (msg.action === "showToast") {
    showToast(msg.message, msg.type);
  } else if (msg.action === "updateLinkVerdicts") {
    const { verdicts } = msg;
    for (const [url, verdict] of Object.entries(verdicts)) {
      linkVerdicts.set(url, verdict);
      updateLinkTooltip(url, verdict);
    }
  } else if (msg.action === "sessionUpdated") {
    currentSessionId = msg.sessionId;
    console.log("[DEVScan] Session updated:", currentSessionId);
  } else if (msg.action === "redirectToWarningPage") {
    const warningUrl = chrome.runtime.getURL(
      `html/WarningPage.html?url=${encodeURIComponent(msg.targetUrl)}&openerTabId=${msg.openerTabId}`
    );
    console.log("[DEVScan] Redirecting to warning page:", warningUrl);
    window.location.replace(warningUrl);
  }
});

// ==============================
// TAB VISIBILITY & PERFORMANCE MANAGEMENT
// ==============================

// Handle tab visibility changes to manage processing
document.addEventListener('visibilitychange', () => {
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
window.addEventListener('beforeunload', () => {
  // Store that user initiated refresh/navigation
  sessionStorage.setItem('devscan_page_refresh', 'true');
});

// Check if we returned from a refresh
window.addEventListener('load', () => {
  if (sessionStorage.getItem('devscan_page_refresh') === 'true') {
    pageRefreshDetected = true;
    sessionStorage.removeItem('devscan_page_refresh');
    console.log('[DEVScan] Page refresh detected via beforeunload');
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
    console.log("[DEVScan] Cleaned up verdicts cache, kept 500 most recent");
  }
  
  // Clear page processed links if we have too many (keep last 500)
  if (pageProcessedLinks.size > 500) {
    const linksArray = Array.from(pageProcessedLinks);
    pageProcessedLinks.clear();
    // Keep only the last 250 links
    linksArray.slice(-250).forEach(url => {
      pageProcessedLinks.add(url);
    });
    console.log("[DEVScan] Cleaned up page processed links cache, kept 250 most recent");
  }
}, 30000); // Run every 30 seconds

// ==============================
// SETTINGS CHANGE HANDLING
// ==============================

// Listen for extension settings changes and update UI accordingly
chrome.storage.onChanged.addListener((changes) => {
  if (changes.showWarningsOnly) {
    const highlightEnabled = changes.showWarningsOnly.newValue;
    document.querySelectorAll(selectors).forEach((link) => {
      if (isSameDomain(link.href, window.location.href)) return;

      if (highlightEnabled) {
        const riskLevel =
          linkVerdicts.get(link.href) || determineRisk(link.href);
        delete link.dataset.devscanStyled;
        window.attachRiskTooltip(link, riskLevel);
      } else {
        link.style.textDecoration = "none";
        link.style.textDecorationColor = "";
      }
    });
  }
});

// ==============================
// INITIAL PAGE SCAN
// ==============================

// Perform initial scan of page when content script loads
scanLinks();

// ==============================
// DYNAMIC CONTENT MONITORING
// ==============================
// Advanced monitoring for single-page applications (SPAs) and dynamic content loading
// Handles infinite scroll, AJAX content updates, and URL changes without page reloads

let scanTimeout = null;

// Monitor DOM changes for new links (handles AJAX, infinite scroll, etc.)
const observer = new MutationObserver((mutations) => {
  let hasNewLinks = false;
  
  mutations.forEach((mutation) => {
    if (mutation.type === "childList") {
      mutation.addedNodes.forEach((node) => {
        if (node.nodeType === Node.ELEMENT_NODE) {
          // Check if the node itself is a link
          if (node.tagName === "A" && node.href) {
            hasNewLinks = true;
            return;
          }
          
          // Check if the node contains any links
          if (node.querySelectorAll) {
            const newLinks = node.querySelectorAll(selectors);
            if (newLinks.length > 0) {
              hasNewLinks = true;
              return;
            }
          }
        }
      });
    }
  });
  
  if (hasNewLinks) {
    // Debounce scan calls to avoid excessive processing on rapidly changing content
    if (scanTimeout) clearTimeout(scanTimeout);
    scanTimeout = setTimeout(() => {
      console.log("[DEVScan] New links detected, rescanning...");
      scanLinks();
    }, 300); // Reduced delay for better responsiveness on dynamic sites
  }
});

// Start observing DOM changes
observer.observe(document.body, { 
  childList: true, 
  subtree: true,
  // Only observe what we need to reduce overhead
  attributes: false,
  characterData: false
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
    
    if (scrollPosition >= documentHeight * 0.8) { // 80% scrolled
      console.log("[DEVScan] Near bottom of page, checking for new content...");
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
    
    console.log("[DEVScan] URL changed from", previousUrl, "to", lastUrl);
    
    // Update page tracking
    currentPageUrl = lastUrl;
    pageLoadTime = Date.now();
    
    // Only clear processed links if it's a different page (not just hash changes)
    const previousUrlBase = previousUrl.split('#')[0];
    const currentUrlBase = lastUrl.split('#')[0];
    
    if (previousUrlBase !== currentUrlBase) {
      console.log("[DEVScan] New page detected, clearing processed links and rescanning...");
      pageProcessedLinks.clear();
      pageRefreshDetected = false; // SPA navigation, not a refresh
      
      // Rescan after a short delay to allow page to load
      setTimeout(() => {
        scanLinks();
      }, 1000);
    } else {
      console.log("[DEVScan] Hash change detected, no rescan needed");
    }
  }
});

// Monitor for URL changes in SPAs
urlObserver.observe(document, { subtree: true, childList: true });

console.log("[DEVScan] Dynamic content monitoring started");
