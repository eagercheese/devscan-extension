// url-utils.js
// URL utility functions for both service worker and content scripts

// List of common shortener hostnames
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

// Call your backend unshortener API
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
      body: JSON.stringify({ url: shortUrl })
    });

    const response = await Promise.race([fetchPromise, timeoutPromise]);

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

// Function to detect if URL is shortened and unshorten recursively
async function resolveShortenedUrl(url, details = {}) {
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

  return url;
}

// Hex decoder
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

// Export for ES6 modules (service worker)
if (typeof module !== 'undefined' && module.exports) {
  // Node.js/CommonJS style
  module.exports = {
    decodeHexUrl,
    resolveShortenedUrl,
    shortenedPatterns
  };
} else if (typeof self !== 'undefined' && self.importScripts) {
  // Service Worker context
  self.decodeHexUrl = decodeHexUrl;
  self.resolveShortenedUrl = resolveShortenedUrl;
  self.shortenedPatterns = shortenedPatterns;
} else if (typeof window !== 'undefined') {
  // Browser/Content Script context
  window.decodeHexUrl = decodeHexUrl;
  window.resolveShortenedUrl = resolveShortenedUrl;
  window.shortenedPatterns = shortenedPatterns;
}

// Also provide as exports for ES6 import (if supported)
try {
  if (typeof globalThis !== 'undefined') {
    globalThis.decodeHexUrl = decodeHexUrl;
    globalThis.resolveShortenedUrl = resolveShortenedUrl;
  }
} catch (e) {
  // Ignore if globalThis not available
}
