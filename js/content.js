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

let collectedLinks = new Set();     // Links currently being analyzed
let linkVerdicts = new Map();       // Server verdicts cached locally
let currentSessionId = null;        // Current scan session ID

// ==============================
// PAGE-BASED SCANNING STATE (MOVED TO TOP)
// ==============================
let currentPageUrl = window.location.href;        // Track current page URL
let pageProcessedLinks = new Set();               // Links processed for current page
let pageRefreshDetected = false;                  // Track if page was refreshed
let pageLoadTime = Date.now();                    // Track when page loaded

// ==============================
// INITIALIZATION & SESSION MANAGEMENT
// ==============================

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
  
  attachRiskTooltip(link, riskLevel);
  link.dataset.devscanRisk = riskLevel; // Store the determined risk on the element for click handling

  // Attach click handler using the new function
  attachClickHandler(link);
}

// ==============================
// LINK COLLECTION & BATCH PROCESSING
// ==============================
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

// Collect links for analysis and manage batching to server
function collectLinkForAnalysis(rawUrl) {
  try {
    //Hex Decoder
    const decodedUrl = decodeURIComponent(rawUrl);

    //Url unshortener
    try {
      const parsedUrl = new URL(decodedUrl);

      // Check if it's a shortened link
      if (shortenedPatterns.includes(parsedUrl.hostname)) {
        handleShortenedLink(decodedUrl); // Call the unshortener server
        return; 
      }
    } catch (e) {
        console.warn("[DEVScan] URL parsing failed, using original:", decodedUrl, e);
        return decodedUrl; //return the original url if their is a error in the  unshortener server
    }

    if (isSameDomain(decodedUrl, window.location.href)) return;

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
  
  chrome.runtime.sendMessage({
    action: "analyzeSingleLink",
    url: url,
    domain: currentDomain,
    sessionId: currentSessionId
  });
  
  // The response will come via the "updateSingleLinkVerdict" message listener
  // No need for response callback - using direct messaging instead
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
    const allLinks = document.querySelectorAll('a[href]');
    
    const matchingLinks = [];
    allLinks.forEach(link => {
      const linkHref = link.href;
      
      // Direct comparison
      if (linkHref === url) {
        matchingLinks.push(link);
        return;
      }
      
      // Normalized comparison (remove trailing slash, case insensitive)
      const normalizeUrl = (u) => u.replace(/\/+$/, '').toLowerCase();
      if (normalizeUrl(linkHref) === normalizeUrl(url)) {
        matchingLinks.push(link);
        return;
      }
      
      // URL without query parameters
      const linkBase = linkHref.split('?')[0];
      const urlBase = url.split('?')[0];
      if (linkBase === urlBase) {
        matchingLinks.push(link);
        return;
      }
    });
    
    links = matchingLinks;
  }
  
  if (links.length === 0) {
    return false;
  }
  
  let updateCount = 0;
  links.forEach((link) => {
    delete link.dataset.tooltipBound;
    delete link.dataset.devscanStyled;
    link.dataset.devscanRisk = verdict;
    attachRiskTooltip(link, verdict);
    
    // Reattach click handler with updated verdict
    attachClickHandler(link);
    
    updateCount++;
  });
  
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
    
    if (storedRisk === "malicious" || storedRisk === "anomalous") {
      e.preventDefault();
      e.stopPropagation();
      
      if (blockingEnabled) {
        chrome.runtime.sendMessage({
          action: "openWarningTab",
          targetUrl: link.href,
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



// ==============================
// PAGE SCANNING & EARLY DOM OBSERVATION
// ==============================


function scanLinks() {
  const links = document.querySelectorAll(selectors.join(","));
  
  links.forEach(link => {
    processLink(link);
  });
}

// ==============================
// DYNAMIC CONTENT MONITORING
// ==============================

let scanTimeout = null;

// Unified DOM observer for dynamic content and initial scan
function startDOMObserver() {
  console.log("[DEVScan] 🔧 Starting DOM observer...");
  const observer = new MutationObserver(mutations => {
    let hasNewLinks = false;
    
    mutations.forEach(mutation => {
      if (mutation.type === "childList") {
        mutation.addedNodes.forEach(node => {
          if (node.nodeType === Node.ELEMENT_NODE) {
            // Check if the node itself matches any selector
            if (node.matches && selectors.some(sel => node.matches(sel))) {
              processLink(node);
              hasNewLinks = true;
              return;
            }
            
            // Check if the node contains any matching elements
            if (node.querySelectorAll) {
              const matches = node.querySelectorAll(selectors.join(","));
              if (matches.length > 0) {
                matches.forEach(link => processLink(link));
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
    characterData: false
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
    
    // Store the verdict and update tooltip
    linkVerdicts.set(url, verdict);
    
    const updateSuccess = updateLinkTooltip(url, verdict);
    
    // Clean up processing state
    collectedLinks.delete(url);
    
    // Send response back to background script
    if (sendResponse) {
      sendResponse({
        success: updateSuccess,
        message: updateSuccess ? 'Verdict processed successfully' : 'Failed to update tooltip',
        url: url,
        verdict: verdict
      });
    }
    
    // Only remove from pageProcessedLinks if it failed, otherwise keep it to prevent reprocessing
    if (verdict === "failed") {
      pageProcessedLinks.delete(url);
    }
    
    // Send response to acknowledge receipt
    sendResponse({ success: true });
  } else if (msg.action === "sessionUpdated") {
    currentSessionId = msg.sessionId;
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
    linksArray.slice(-250).forEach(url => {
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
    document.querySelectorAll(selectors).forEach((link) => {
      if (isSameDomain(link.href, window.location.href)) return;

      if (highlightEnabled) {
        const serverVerdict = linkVerdicts.get(link.href);
        let riskLevel;
        
        if (serverVerdict) {
          // We already have a server verdict
          riskLevel = serverVerdict;
        } else {
          // Show scanning state while waiting for server analysis
          riskLevel = "scanning";
        }
        
        delete link.dataset.devscanStyled;
        attachRiskTooltip(link, riskLevel);
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
    
    if (scrollPosition >= documentHeight * 0.8) { // 80% scrolled
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
    const previousUrlBase = previousUrl.split('#')[0];
    const currentUrlBase = lastUrl.split('#')[0];
    
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
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', initializeExtension);
} else {
  // DOM is already ready
  initializeExtension();
}
