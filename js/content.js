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

   // Create click handler that ALWAYS opens warning page for risky links
  const clickHandler = (e) => {
    const storedRisk = link.dataset.devscanRisk || "unknown";
    if (["danger", "warning", "malicious", "anomalous"].includes(storedRisk)) {
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

    if (!collectedLinks.has(decodedUrl) && !processedLinks.has(decodedUrl)) {
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
  linksArray.forEach(url => processedLinks.add(url)); // Mark all links as processed to avoid re-sending

  chrome.runtime.sendMessage(
    {
      action: "sendLinksToServer",
      links: linksArray,
      domain: currentDomain,
      sessionId: currentSessionId
    },
    (response) => {
      if (chrome.runtime.lastError) {
        console.error("[DEVScan] Extension error:", chrome.runtime.lastError);
         // Remove from processed set if sending failed, so they can be retried
        linksArray.forEach((url) => {
          processedLinks.delete(url);
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

        // Update session ID if provided by server
        if (response.sessionId) { 
          currentSessionId = response.sessionId;
        }

        // Update local verdicts cache with server results
        for (const [url, verdict] of Object.entries(response.verdicts || {})) {
          linkVerdicts.set(url, verdict);
          updateLinkTooltip(url, verdict);
        }
      } else {
        // Remove from processed set if server processing failed
        linksArray.forEach((url) => {
          processedLinks.delete(url);
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
    // Update local verdicts cache with server results
    const { verdicts } = msg;
    for (const [url, verdict] of Object.entries(verdicts)) {
      linkVerdicts.set(url, verdict);
      updateLinkTooltip(url, verdict);
    }
  } else if (msg.action === "sessionUpdated") {
    // Update session ID when it changes
    currentSessionId = msg.sessionId;
    console.log("[DEVScan] Session updated:", currentSessionId);
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
    console.log("[DEVScan] Cleaned up link verdicts cache");
  }
  
  // Clear old processed links if we have too many (keep last 2000)
  if (processedLinks.size > 2000) {
    const entries = Array.from(processedLinks);
    processedLinks.clear();
    // Keep only the last 1000 entries
    entries.slice(-1000).forEach(url => {
      processedLinks.add(url);
    });
    console.log("[DEVScan] Cleaned up processed links cache");
  }
}, 5 * 60 * 1000); // Every 5 minutes

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
    lastUrl = window.location.href;
    console.log("[DEVScan] URL changed, clearing processed links and rescanning...");
    
    // Clear processed links for new page but keep verdicts cache for performance
    processedLinks.clear();
    
    // Rescan after a short delay to allow page to load
    setTimeout(() => {
      scanLinks();
    }, 1000);
  }
});

// Monitor for URL changes in SPAs
urlObserver.observe(document, { subtree: true, childList: true });

console.log("[DEVScan] Dynamic content monitoring started");
