// background.js

// Verify service worker environment
if (typeof self === 'undefined') {
  console.error('[DEVScan] This script must run in a service worker context');
}

console.log('[DEVScan] Service worker starting up...');

// URL utility functions (embedded for reliability)
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

async function resolveShortenedUrl(url, details = {}) {
  const shortenedPatterns = [
    'bit.ly', 't.co', 'tinyurl.com', 'goo.gl', 'is.gd', 
    'buff.ly', 'cutt.ly', 'ow.ly', 'rebrand.ly'
  ];
  
  try {
    const parsedUrl = new URL(url);

    if (shortenedPatterns.includes(parsedUrl.hostname) && !details._unshortened) {
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

// Import URL utilities for service worker (as backup)
try {
  importScripts('./js/url-utils.js');
  console.log('[DEVScan] Successfully loaded url-utils.js');
} catch (e) {
  console.warn('[DEVScan] Failed to import url-utils.js, using embedded functions:', e.message);
}

console.log('[DEVScan] Background script URL utility functions available:', {
  decodeHexUrl: typeof decodeHexUrl,
  resolveShortenedUrl: typeof resolveShortenedUrl
});

// ==============================
// DEVSCAN BACKGROUND SCRIPT
// ==============================
// Service worker for the DEVScan browser extension
// Handles extension lifecycle, server communication, and inter-tab messaging
// Manages scan sessions and coordinates between content scripts and server

// ==============================
// SERVER CONNECTION MANAGEMENT
// ==============================

class ServerConnectionManager {
  constructor() {
    this.serverUrl = null;
    this.lastHealthCheck = 0;
    this.isHealthy = false;
    this.healthCheckInterval = 300000; // 5 minutes
  }

  async ensureConnection() {
    const now = Date.now();
    
    // Check health periodically
    if (now - this.lastHealthCheck > this.healthCheckInterval) {
      await this.healthCheck();
    }

    if (!this.isHealthy) {
      await this.findServer();
    }

    return this.serverUrl;
  }

  async healthCheck() {
    if (!this.serverUrl) return false;
    
    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 5000); // 5 second timeout
      
      const response = await fetch(`${this.serverUrl}/api/health`, {
        method: 'GET',
        signal: controller.signal
      });
      
      clearTimeout(timeoutId);
      this.isHealthy = response.ok;
      this.lastHealthCheck = Date.now();
      
      if (this.isHealthy) {
        console.log('[DEVScan] 💚 Server health check: OK');
      } else {
        console.warn(`[DEVScan] 💛 Server responded with status: ${response.status}`);
      }
      
      return this.isHealthy;
    } catch (error) {
      this.isHealthy = false;
      console.warn('[DEVScan] ❤️ Server health check failed:', error.message);
      return false;
    }
  }

  async findServer() {
    const possibleUrls = [
      'http://localhost:3001',
      'http://localhost:3000', 
      'http://127.0.0.1:3001',
      'http://127.0.0.1:3000'
    ];

    console.log('[DEVScan] 🔍 Searching for DEVScan server...');

    for (const url of possibleUrls) {
      try {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 3000); // 3 second timeout per attempt
        
        const response = await fetch(`${url}/api/health`, { 
          signal: controller.signal 
        });
        
        clearTimeout(timeoutId);
        
        if (response.ok) {
          this.serverUrl = url;
          this.isHealthy = true;
          this.lastHealthCheck = Date.now();
          
          // Store successful URL
          await chrome.storage.sync.set({ serverUrl: url });
          console.log(`[DEVScan] ✅ Found server at: ${url}`);
          return url;
        }
      } catch (e) {
        console.log(`[DEVScan] 🔍 Server not found at ${url}: ${e.message}`);
        continue;
      }
    }

    this.isHealthy = false;
    throw new Error('DEVScan server not found on any port. Please ensure the server is running.');
  }

  getConnectionInfo() {
    return {
      serverUrl: this.serverUrl,
      isHealthy: this.isHealthy,
      lastHealthCheck: this.lastHealthCheck,
      nextHealthCheck: this.lastHealthCheck + this.healthCheckInterval
    };
  }
}

// Global connection manager instance
const connectionManager = new ServerConnectionManager();

// ==============================
// ENHANCED URL MATCHING SYSTEM
// ==============================

// Normalize URL for consistent matching
function normalizeUrl(url) {
  if (!url || typeof url !== 'string') return '';
  
  try {
    // Remove trailing slashes, normalize case, decode components
    let normalized = decodeURIComponent(url.trim())
      .toLowerCase()
      .replace(/\/+$/, '')
      .replace(/^https?:\/\//, ''); // Remove protocol for comparison
    
    // Remove www prefix for domain comparison
    normalized = normalized.replace(/^www\./, '');
    
    return normalized;
  } catch (e) {
    // If decoding fails, just do basic normalization
    return url.trim().toLowerCase().replace(/\/+$/, '');
  }
}

// Extract domain from URL
function extractDomain(url) {
  if (!url || typeof url !== 'string') return '';
  
  try {
    const urlObj = new URL(url.startsWith('http') ? url : `http://${url}`);
    return urlObj.hostname.replace(/^www\./, '').toLowerCase();
  } catch (e) {
    // Fallback: extract domain manually
    const match = url.match(/^(?:https?:\/\/)?(?:www\.)?([^\/]+)/i);
    return match ? match[1].toLowerCase() : '';
  }
}

// Enhanced URL matching with multiple strategies
function findVerdictForUrl(url, serverVerdicts) {
  if (!serverVerdicts || typeof serverVerdicts !== 'object') {
    return null;
  }

  const strategies = [
    // Strategy 1: Exact match
    (u, verdicts) => verdicts[u],
    
    // Strategy 2: Normalized match (trailing slash, case, protocol)
    (u, verdicts) => {
      const normalized = normalizeUrl(u);
      return verdicts[normalized] || Object.entries(verdicts)
        .find(([key]) => normalizeUrl(key) === normalized)?.[1];
    },
    
    // Strategy 3: Domain-based match for redirects
    (u, verdicts) => {
      const domain = extractDomain(u);
      if (!domain) return null;
      
      return Object.entries(verdicts)
        .find(([key]) => extractDomain(key) === domain)?.[1];
    },
    
    // Strategy 4: Decoded URL match
    (u, verdicts) => {
      try {
        const decoded = decodeURIComponent(u);
        return verdicts[decoded];
      } catch { 
        return null; 
      }
    },
    
    // Strategy 5: Base URL match (without query params)
    (u, verdicts) => {
      const baseUrl = u.split('?')[0].split('#')[0];
      return verdicts[baseUrl] || Object.entries(verdicts)
        .find(([key]) => key.split('?')[0].split('#')[0] === baseUrl)?.[1];
    }
  ];

  // Try each strategy until we find a match
  for (let i = 0; i < strategies.length; i++) {
    const strategy = strategies[i];
    const result = strategy(url, serverVerdicts);
    
    if (result) {
      console.log(`[DEVScan Background] 🎯 Found verdict using strategy ${i + 1} for ${url}`);
      return result;
    }
  }
  
  console.log(`[DEVScan Background] ❌ No verdict found for ${url} using any strategy`);
  return null;
}

// ==============================
// VERDICT CACHING SYSTEM
// ==============================

class VerdictCache {
  constructor() {
    this.cache = new Map();
    this.sessionCache = new Map(); // Per-session cache
    this.cleanupInterval = setInterval(() => this.cleanup(), 60000); // Cleanup every minute
  }

  set(url, verdict, anomaly_risk_level, confidence_score, sessionId = null, ttl = 300000) { // 5 min default TTL
    const entry = {
      verdict,
      anomaly_risk_level,
      confidence_score,
      timestamp: Date.now(),
      ttl,
      sessionId
    };
    
    this.cache.set(url, entry);
    
    if (sessionId) {
      if (!this.sessionCache.has(sessionId)) {
        this.sessionCache.set(sessionId, new Map());
      }
      this.sessionCache.get(sessionId).set(url, entry);
    }
    
    console.log(`[DEVScan Background] 💾 Cached verdict for ${url}: verdict: ${verdict} | anomaly_risk_level: ${anomaly_risk_level} | confidence_score: ${confidence_score}` );
  }
  
  get(url, sessionId = null) {
    // Try session cache first (higher priority)
    if (sessionId && this.sessionCache.has(sessionId)) {
      const sessionEntry = this.sessionCache.get(sessionId).get(url);
      if (sessionEntry && this.isValid(sessionEntry)) {
        console.log(`[DEVScan Background] 🎯 Cache HIT (session) for ${url}: verdict: ${sessionEntry.verdict} | anomaly_risk_level: ${sessionEntry.anomaly_risk_level} | confidence_score: ${sessionEntry.confidence_score}`);
        return {
          verdict: sessionEntry.verdict,
          anomaly_risk_level: sessionEntry.anomaly_risk_level,
          confidence_score: sessionEntry.confidence_score
        };
      }
    }
    
    // Fallback to global cache
    const entry = this.cache.get(url);
    if (entry && this.isValid(entry)) {
      console.log(`[DEVScan Background] 🎯 Cache HIT (global) for ${url}: verdict: ${entry.verdict} | anomaly_risk_level: ${entry.anomaly_risk_level} | confidence_score: ${entry.confidence_score}`);
      return {
        verdict: entry.verdict,
        anomaly_risk_level: entry.anomaly_risk_level,
        confidence_score: entry.confidence_score
      };
    }
    
    console.log(`[DEVScan Background] 🎯 Cache MISS for ${url}`);
    return null;
  }
  
  isValid(entry) {
    return Date.now() - entry.timestamp < entry.ttl;
  }
  
  cleanup() {
    const now = Date.now();
    let cleaned = 0;
    
    // Clean global cache
    for (const [url, entry] of this.cache) {
      if (!this.isValid(entry)) {
        this.cache.delete(url);
        cleaned++;
      }
    }
    
    // Clean session caches
    for (const [sessionId, sessionMap] of this.sessionCache) {
      for (const [url, entry] of sessionMap) {
        if (!this.isValid(entry)) {
          sessionMap.delete(url);
          cleaned++;
        }
      }
      
      // Remove empty session maps
      if (sessionMap.size === 0) {
        this.sessionCache.delete(sessionId);
      }
    }
    
    if (cleaned > 0) {
      console.log(`[DEVScan Background] 🧹 Cleaned ${cleaned} expired cache entries`);
    }
  }
  
  getStats() {
    return {
      globalEntries: this.cache.size,
      sessions: this.sessionCache.size,
      totalSessionEntries: Array.from(this.sessionCache.values())
        .reduce((sum, map) => sum + map.size, 0)
    };
  }
}

// Global verdict cache instance
const verdictCache = new VerdictCache();

// ==============================
// DIAGNOSTICS & MONITORING
// ==============================

class VerdictDeliveryDiagnostics {
  constructor() {
    this.stats = {
      sent: 0,
      delivered: 0,
      failed: 0,
      retries: 0,
      averageDeliveryTime: 0,
      cacheHits: 0,
      cacheMisses: 0
    };
    this.errors = [];
    this.maxErrors = 50; // Keep last 50 errors
  }
  
  logDeliveryAttempt(url, tabId, startTime) {
    this.stats.sent++;
    
    return {
      success: () => {
        this.stats.delivered++;
        const deliveryTime = ((typeof performance !== 'undefined' && performance.now) ? performance.now() : Date.now()) - startTime;
        this.updateAverageDeliveryTime(deliveryTime);
        
        if (deliveryTime > 1000) { // Log slow deliveries
          console.warn(`[DEVScan Background] 🐌 Slow delivery (${deliveryTime.toFixed(2)}ms): ${url}`);
        }
      },
      failure: (error) => {
        this.stats.failed++;
        this.errors.push({
          url,
          tabId,
          error: error.message,
          timestamp: new Date().toISOString(),
          stack: error.stack
        });
        
        // Keep only recent errors
        if (this.errors.length > this.maxErrors) {
          this.errors = this.errors.slice(-this.maxErrors);
        }
      },
      retry: () => {
        this.stats.retries++;
      }
    };
  }
  
  logCacheEvent(hit = true) {
    if (hit) {
      this.stats.cacheHits++;
    } else {
      this.stats.cacheMisses++;
    }
  }
  
  updateAverageDeliveryTime(newTime) {
    const totalDelivered = this.stats.delivered;
    this.stats.averageDeliveryTime = 
      ((this.stats.averageDeliveryTime * (totalDelivered - 1)) + newTime) / totalDelivered;
  }
  
  getReport() {
    const successRate = this.stats.sent > 0 
      ? (this.stats.delivered / this.stats.sent * 100).toFixed(2) 
      : '0.00';
    
    const cacheHitRate = (this.stats.cacheHits + this.stats.cacheMisses) > 0
      ? (this.stats.cacheHits / (this.stats.cacheHits + this.stats.cacheMisses) * 100).toFixed(2)
      : '0.00';
    
    return {
      ...this.stats,
      successRate: `${successRate}%`,
      cacheHitRate: `${cacheHitRate}%`,
      averageDeliveryTime: `${this.stats.averageDeliveryTime.toFixed(2)}ms`,
      recentErrors: this.errors.slice(-10),
      cacheStats: verdictCache.getStats()
    };
  }
  
  // Console command to check diagnostics
  logReport() {
    const report = this.getReport();
    console.group('🔍 DEVScan Verdict Delivery Diagnostics');
    console.log('📊 Performance Stats:', {
      sent: report.sent,
      delivered: report.delivered,
      failed: report.failed,
      retries: report.retries,
      successRate: report.successRate,
      averageDeliveryTime: report.averageDeliveryTime
    });
    console.log('💾 Cache Stats:', {
      hits: report.cacheHits,
      misses: report.cacheMisses,
      hitRate: report.cacheHitRate,
      ...report.cacheStats
    });
    if (report.recentErrors.length > 0) {
      console.warn('⚠️ Recent Errors:', report.recentErrors);
    }
    console.groupEnd();
  }
}

// Global diagnostics instance
const diagnostics = new VerdictDeliveryDiagnostics();

// Make diagnostics available globally for debugging
self.DEVScanDiagnostics = diagnostics;

// ==============================
// VERDICT DELIVERY SYSTEM
// ==============================

// Enhanced message delivery with acknowledgment and retry logic
function sendVerdictWithAck(tabId, url, verdict, verdictData = null, retryCount = 0) {
  const maxRetries = 3;
  const messageId = Date.now() + Math.random();
  const startTime = (typeof performance !== 'undefined' && performance.now) ? performance.now() : Date.now();
  
  return new Promise((resolve, reject) => {
    const logger = diagnostics.logDeliveryAttempt(url, tabId, startTime);
    
    if (retryCount > 0) {
      logger.retry();
      console.log(`[DEVScan Background] � Retry ${retryCount}/${maxRetries} for ${url}`);
    } else {
      console.log(`[DEVScan Background] 📤 Sending verdict: ${url} -> ${verdict}`);
    }
    
    chrome.tabs.sendMessage(tabId, {
      action: "updateSingleLinkVerdict",
      url: url,
      verdict: verdict,
      verdictData: verdictData,
      messageId: messageId
    }, (response) => {
      if (chrome.runtime.lastError) {
        const error = new Error(chrome.runtime.lastError.message);
        console.warn(`[DEVScan Background] ⚠️ Message failed (attempt ${retryCount + 1}):`, error.message);
        
        if (retryCount < maxRetries) {
          const delay = 1000 * Math.pow(2, retryCount); // Exponential backoff
          console.log(`[DEVScan Background] 🔄 Retrying in ${delay}ms...`);
          
          setTimeout(() => {
            sendVerdictWithAck(tabId, url, verdict, verdictData, retryCount + 1)
              .then(resolve).catch(reject);
          }, delay);
        } else {
          console.error(`[DEVScan Background] ❌ Max retries exceeded for ${url}`);
          logger.failure(error);
          reject(error);
        }
      } else if (response && response.success) {
        console.log(`[DEVScan Background] ✅ Verdict delivered: ${url} -> ${verdict}`);
        logger.success();
        resolve(response);
      } else {
          if (response && response.message === "Failed to update tooltip") {
            console.log(`[DEVScan Background] ℹ️ No link in DOM for ${url}, skipping tooltip update.`);
            logger.success(); // treat as a "handled" case, not failure
            resolve(response);
          } else {
            const error = new Error(`Message not acknowledged: ${JSON.stringify(response)}`);
            console.warn(`[DEVScan Background] ⚠️ Message not acknowledged for ${url}:`, response);
            
            if (retryCount < maxRetries) {
              setTimeout(() => {
                sendVerdictWithAck(tabId, url, verdict, verdictData, retryCount + 1)
                  .then(resolve).catch(reject);
              }, 1000 * (retryCount + 1));
            } else {
              logger.failure(error);
              reject(error);
            }
          }
        }
    });
  });
}

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
// SAME-DOMAIN DETECTION
// ==============================

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
    console.warn(`[DEVScan Background] Error parsing URLs for same-domain check: ${error.message}`);
    return false;
  }
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
// Check server health status
async function checkServerHealth() {
  try {
    // Use connection manager instead of manual server URL handling
    const baseUrl = await connectionManager.ensureConnection();

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
    // Use connection manager for reliable server connection
    const baseUrl = await connectionManager.ensureConnection();

    // Get browser info for session tracking (service worker compatible)
    const browserInfo = `Chrome Extension v4.0 - Service Worker`;
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
  console.log(`[DEVScan Background] 📨 Received message:`, message);
  console.log(`[DEVScan Background] 🔧 DEBUG: Sender:`, sender);
  console.log(`[DEVScan Background] 🔧 DEBUG: Message action:`, message.action);
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

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.action === "retryScan" && message.url) {
    (async () => {
      const retryUrl = message.url;
      let domain = "unknown";

      try {
        domain = new URL(retryUrl).hostname;
      } catch (err) {
        console.warn("[DEVScan] Invalid retry URL:", retryUrl);
      }

      // Get or create session
      const { currentSessionId: existingSession } = await chrome.storage.sync.get("currentSessionId");
      let currentSessionId = existingSession;
      if (!currentSessionId) {
        console.log("[DEVScan] No session — creating one...");
        currentSessionId = await createNewScanSession();
      }

      // Only redirect to ScanningPage if we are not already there
      const currentTabUrl = sender.tab?.url || "";
      const scanningPageUrl = chrome.runtime.getURL("html/ScanningPage.html");

      if (!currentTabUrl.startsWith(scanningPageUrl)) {
        chrome.tabs.update(sender.tab.id, {
          url: chrome.runtime.getURL(
            `html/ScanningPage.html?url=${encodeURIComponent(message.url)}&initiator=${encodeURIComponent(message.initiator || 'unknown')}`
          )
        });
      } else {
        console.log("[DEVScan] Already on ScanningPage, skipping redirect.");
      }

      let verdict = "scan_failed"; // default fallback
      try {
        const analysisResult = await handleSingleLinkAnalysis(retryUrl, domain, currentSessionId, sender.tab.id);
        verdict = analysisResult?.verdict || "scan_failed";
      } catch (err) {
        console.error("[DEVScan] Retry analysis error:", err);
        verdict = "scan_failed";
      }

      // Malicious / anomalous verdict
      if (verdict === "malicious" || verdict === "anomalous") {
        console.log("[DEVScan] Risky verdict on retry, redirecting...");

        const { strictMaliciousBlocking } = await chrome.storage.sync.get("strictMaliciousBlocking");
        const strictBlocking = strictMaliciousBlocking ?? false;

        let warningPageFile;
        if (verdict === "anomalous") {
          warningPageFile = "html/AnomalousWarningPage.html";
        } else if (verdict === "malicious" && strictBlocking) {
          warningPageFile = "html/StrictWarningPage.html";
        } else {
          warningPageFile = "html/WarningPage.html";
        }

        chrome.tabs.update(sender.tab.id, {
          url: chrome.runtime.getURL(
            `${warningPageFile}?url=${encodeURIComponent(retryUrl)}&openerTabId=${sender.tab.id}&strict=${strictBlocking}&fromDevScan=true&ts=${Date.now()}`
          )
        });

        const extractionResult = await handleExtractLinks(retryUrl);
        console.log("[DEVScan] Link extraction result:", extractionResult);
      }

      // Scan failed again
      else if (verdict === "scan_failed") {
        // Notify warning.js directly
        chrome.tabs.sendMessage(sender.tab.id, {
          action: "scanFailed",
          url: retryUrl,
          reason: "The analysis service did not return a valid verdict."
        }, (response) => {
          if (chrome.runtime.lastError) {
            console.error("[DEVScan] Failed to send scanFailed message:", chrome.runtime.lastError);
          } else {
            console.log("[DEVScan] ScanFailed message delivered to warning.js");
          }
        });
      } 

      // Safe verdict
      else {
        chrome.tabs.update(sender.tab.id, { url: retryUrl });
        addSafeBypass(retryUrl);
      }

      sendResponse({ success: true, verdict });
    })();

    return true; // keep sendResponse alive
  }
});

// ==============================
// SERVER COMMUNICATION
// ==============================

// Handle individual link analysis for immediate verdict delivery
async function handleSingleLinkAnalysis(url, domain, providedSessionId, tabId) {
  try {
    console.log(`[DEVScan Background] 🔍 Starting analysis for: ${url}`);
    
    // Check cache first to avoid unnecessary server requests
    const cachedVerdict = verdictCache.get(url, providedSessionId);
    if (cachedVerdict) {
      console.log(`[DEVScan Background] 🎯 Using cached verdict for ${url}: ${JSON.stringify(cachedVerdict)}`);
      let verdictAnomalyLevel = cachedVerdict.anomaly_risk_level || 'N/A';
      let verdictConfidence = cachedVerdict.confidence_score || 'N/A';

      diagnostics.logCacheEvent(true); // Cache hit

      await sendVerdictWithAck(tabId, url, cachedVerdict.verdict, cachedVerdict);
      return {  verdict: cachedVerdict.verdict , reason: 'cached' };

    } else {
      diagnostics.logCacheEvent(false); // Cache miss
    }
    
    // SAME-DOMAIN FILTERING: Skip analysis for same-domain links
    // if (isSameDomain(url, `https://${domain}`)) {
    //   console.log(`[DEVScan Background] ⏭️  Skipping same-domain link: ${url} (matches ${domain})`);
      
    //   // Cache the same-domain result
    //   // verdictCache.set(url, 'safe', providedSessionId, 600000); // 10 minute TTL for same-domain
    //   // await sendVerdictWithAck(tabId, url, 'safe');
    //   return { verdict: 'safe', reason: 'same_domain_skip' };
    // }
    
    // Don't do immediate health check - let the actual request handle timing
    console.log(`[DEVScan Background] ✅ Proceeding with analysis for: ${url}`);

    // Use connection manager to ensure server availability
    let baseUrl;
    try {
      baseUrl = await connectionManager.ensureConnection();
      console.log(`[DEVScan Background] 🔗 Using server: ${baseUrl}`);
    } catch (error) {
      console.error(`[DEVScan Background] ❌ Server connection failed: ${error.message}`);
      // Send connection failure verdict
      await sendVerdictWithAck(tabId, url, "scan_failed");
      throw error;
    }

    // Get session ID from storage (server URL is now managed by connection manager)
    const { currentSessionId } = await chrome.storage.sync.get(["currentSessionId"]);

    // Use provided session ID or fallback to stored one
    const sessionId = providedSessionId || currentSessionId;

    // Create timeout promise that rejects after 90 seconds (increased for ML processing)
    const timeoutPromise = new Promise((_, reject) => {
      setTimeout(() => reject(new Error('Request timeout - analysis taking too long')), 90000); //trial
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
        // Enhanced URL matching with multiple strategies
        verdict = findVerdictForUrl(url, result.verdicts);
      }

      if (verdict) {
        // Convert ML verdict object to extension string format
        verdictString = convertMLVerdictToString(verdict);
        verdictAnomalyLevel = verdict.anomaly_risk_level || 'N/A';
        verdictConfidence = verdict.confidence_score || 'N/A';
        
        // Log detailed verdict info for debugging
        console.log(`[DEVScan Background] 🎯 Verdict found for ${url}: ${verdictString}`);
        console.log(`[DEVScan Background] 🔧 DEBUG: Original verdict object:`, verdict);
        console.log(`[DEVScan Background] 🔧 DEBUG: Conversion result: "${verdict.final_verdict}" -> "${verdictString}"`);
        console.log(`[DEVScan Background] 🎯 Anomaly_risk_level result: "${verdict.anomaly_risk_level}"`);
        console.log(`[DEVScan Background] 🎯 Confidence_score result: "${verdict.confidence_score}"`);

        
        // Cache the successful verdict
        const ttl = verdictString === 'malicious' ? 600000 : 300000; // 10 min for malicious, 5 min for others
        verdictCache.set(url, verdictString, verdictAnomalyLevel, verdictConfidence, sessionId, ttl);

        // Use enhanced delivery system with acknowledgment
        try {
          await sendVerdictWithAck(tabId, url, verdictString, verdict);
          console.log(`[DEVScan Background] ✅ Verdict delivered successfully for ${url}: ${verdictString}`);
        } catch (error) {
          console.error(`[DEVScan Background] ❌ Failed to deliver verdict for ${url}:`, error);
          // Continue with fallback - don't throw
        }
      } else {
        console.error(`[DEVScan Background] ❌ No verdict found for ${url} in server response`);
        
        // Don't cache scan failures to allow retries
        
        // Use enhanced delivery for failed verdict too
        try {
          await sendVerdictWithAck(tabId, url, "scan_failed");
        } catch (error) {
          console.error(`[DEVScan Background] ❌ Failed to deliver scan_failed verdict for ${url}:`, error);
        }
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
    // Use connection manager for reliable server connection
    const baseUrl = await connectionManager.ensureConnection();

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
  const decodedUrl = (typeof decodeHexUrl !== 'undefined') ? decodeHexUrl(details.url) : details.url;

  // Conditional link unshortening
  const resolvedUrl = (typeof resolveShortenedUrl !== 'undefined') ? await resolveShortenedUrl(decodedUrl, details) : decodedUrl;

  // If this URL is proceeded by user recently, skip scanning
  if (proceedURLS.has(resolvedUrl)) {
    console.log("[DEVScan] Skipping re-scan of safe URL:", resolvedUrl);
    return;
  }

  // If this URL is already marked safe, skip scanning
  if (safeBypassed.has(resolvedUrl)) {
    console.log("[DEVScan] Skipping re-scan of safe URL:", resolvedUrl);
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
  
  // Determine initiator 
  let initiatorValue = "none"; // default
  if (details.initiator && details.initiator !== "null") {
    initiatorValue = details.initiator;
  }
  console.log("[DEVScan] Navigation initiator:", initiatorValue);
  //  Redirect to scanning page immediately
  // Pass both the resolved URL and initiator to the scanning page
  chrome.tabs.update(details.tabId, {
    url: chrome.runtime.getURL(
      `html/ScanningPage.html?url=${encodeURIComponent(resolvedUrl)}&initiator=${encodeURIComponent(initiatorValue)}`
    )
  });
  
  let verdict = "scan_failed"; // default fallback
  try {
    const analysisResult = await handleSingleLinkAnalysis(resolvedUrl, domain, currentSessionId, details.tabId);
    verdict = analysisResult?.verdict || "scan_failed";
  } catch (err) {
    console.error("[DEVScan] Analysis error, treating as scan_failed:", err);
    verdict = "scan_failed";
  }

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

  } 

  else if (verdict === "scan_failed") {
      // Notify warning.js directly
    chrome.tabs.sendMessage(details.tabId, {
      action: "scanFailed",
      url: resolvedUrl,
      reason: "The analysis service did not return a valid verdict."
    }, (response) => {
      if (chrome.runtime.lastError) {
        console.error("[DEVScan] Failed to send scanFailed message:", chrome.runtime.lastError);
      } else {
        console.log("[DEVScan] ScanFailed message delivered to warning.js");
      }
    });
  } 
  
  else {
    // Safe verdict → go to actual site
    chrome.tabs.update(details.tabId, { url: resolvedUrl });
    addSafeBypass(resolvedUrl); // Safe to the temporary Set
  }

}


function shouldIntercept(details) {
  try {
    const u = new URL(details.url);

    // === Skip search engines (full domains) ===
    const searchEngines = ["google.com", "bing.com", "yahoo.com", "duckduckgo.com", "baidu.com"];
    if (searchEngines.some(engine => u.hostname.endsWith(engine))) {

      // --- Special handling for Google ---
      if (u.hostname.endsWith("google.com")) {
        if (u.pathname.startsWith("/search")) return false; // Skip Google search results
        if (u.searchParams.has("tbm") || u.searchParams.has("udm")) return false; // Skip Google AI/images/news results
      }
      return false; // Skip other search engines entirely
    }

    // Skip navigation FROM search engines
    try {
      if (details.initiator) {
        const initiatorUrl = new URL(details.initiator);
        if (searchEngines.some(engine => initiatorUrl.hostname.endsWith(engine))) {
          console.log("[DEVScan] Skipping navigation from search engine:", details.initiator);
          return false;
        }
      }
    } catch (e) {
      // invalid initiator → still scan instead of skipping
    }

    // Skip internal extension pages
    if (u.protocol === "chrome-extension:" || u.protocol === "chrome:") {
      return false;
    }

    return true;

  } catch {
    return false;
  }
}

// Listen for web requests to intercept navigation to potentially malicious URLs from link clicks
chrome.webRequest.onBeforeRequest.addListener(
  (details) => {
    if (!shouldIntercept(details)) return;
    console.log("[DEVScan] Intercepting navigation from", details.initiator, "to", details.url);
    interceptURL(details.url, details);
  },
  { urls: ["<all_urls>"], types: ["main_frame"] }
);

// ==============================
// DEBUG COMMANDS (Available in console)
// ==============================

// Make global commands available for debugging
self.DEVScan = {
  diagnostics: () => diagnostics.logReport(),
  cache: {
    stats: () => verdictCache.getStats(),
    clear: () => {
      verdictCache.cache.clear();
      verdictCache.sessionCache.clear();
      console.log('🧹 Cache cleared');
    }
  },
  connection: {
    status: () => {
      const info = connectionManager.getConnectionInfo();
      console.log('🔗 Connection Status:', info);
      return info;
    },
    test: async () => {
      console.log('🧪 Testing server connection...');
      try {
        const result = await connectionManager.healthCheck();
        console.log('🧪 Connection test result:', result ? '✅ Success' : '❌ Failed');
        return result;
      } catch (error) {
        console.error('🧪 Connection test failed:', error.message);
        return false;
      }
    },
    find: async () => {
      console.log('🔍 Searching for server...');
      try {
        const url = await connectionManager.findServer();
        console.log('🔍 Server found:', url);
        return url;
      } catch (error) {
        console.error('🔍 Server search failed:', error.message);
        return null;
      }
    }
  },
  test: {
    url: async (url) => {
      console.log('🧪 Testing URL analysis:', url);
      try {
        const result = await handleSingleLinkAnalysis(url, 'test.com', null, 1);
        console.log('🧪 Test result:', result);
        return result;
      } catch (error) {
        console.error('🧪 Test failed:', error.message);
        return { error: error.message };
      }
    }
  }
};

console.log('🚀 DEVScan Background Script Loaded');
console.log('💡 Debug commands (use in service worker console):');
console.log('  - self.DEVScan.diagnostics() // Performance stats');
console.log('  - self.DEVScan.cache.stats() // Cache statistics');  
console.log('  - self.DEVScan.connection.status() // Connection info');
console.log('  - self.DEVScan.connection.test() // Test server connection');

// Test URL functions
console.log('🧪 Testing URL functions:');
const testUrl = 'https%3A//example.com/test';
console.log('  - decodeHexUrl test:', typeof decodeHexUrl !== 'undefined' ? decodeHexUrl(testUrl) : 'Function not available');
console.log('  - resolveShortenedUrl test:', typeof resolveShortenedUrl !== 'undefined' ? 'Function available' : 'Function not available');