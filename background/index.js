// Background script entry point
import { createSession, getSessionId } from '../scripts/api.js';

let linkQueue = [];
let batchTimer = null;
let currentTabId = null;
const BATCH_DELAY = 2000; // Wait 2 seconds to collect links from the same page

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === "NEW_LINK_FOUND") {
    const { url, timestamp } = message.payload;
    console.log("📨 Link received in background.js:", url);
    
    // Add to queue with tab info
    linkQueue.push({ 
      url, 
      timestamp, 
      tabId: sender.tab.id 
    });
    
    currentTabId = sender.tab.id;
    sendResponse({ status: "received" });

    // Reset batch timer - collect links for 2 seconds then process as batch
    if (batchTimer) {
      clearTimeout(batchTimer);
    }
    
    batchTimer = setTimeout(() => {
      processBatch();
    }, BATCH_DELAY);
  }
  return true;
});

async function processBatch() {
  if (linkQueue.length === 0) return;
  
  console.log(`🔄 Processing batch of ${linkQueue.length} links...`);
  
  try {
    // Get or create a session for this batch
    const sessionId = await getSessionId();
    
    if (!sessionId) {
      console.error("Failed to get session ID for batch");
      linkQueue = [];
      return;
    }
    
    // Extract URLs from queue
    const urls = linkQueue.map(item => item.url);
    
    // Send batch to backend using the bulk endpoint
    const response = await fetch('http://localhost:3000/api/scan-links', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ 
        session_ID: sessionId,
        links: urls
      })
    });
    
    if (response.ok) {
      const result = await response.json();
      console.log(`✅ Batch processed successfully. Session ID: ${sessionId}`);
      
      // Send individual verdicts back to content script
      if (result.results && currentTabId) {
        result.results.forEach((scanResult, index) => {
          const originalUrl = urls[index];
          const verdict = scanResult.isMalicious ? 'malicious' : 
                         (scanResult.anomalyScore > 0.5 ? 'anomaly' : 'safe');
          
          chrome.tabs.sendMessage(currentTabId, {
            type: "LINK_VERDICT",
            payload: { 
              url: originalUrl, 
              verdict: verdict,
              sessionId: sessionId
            }
          });
        });
      }
    } else {
      console.error("Batch processing failed:", response.statusText);
    }
    
  } catch (error) {
    console.error("Error processing batch:", error);
  }
  
  // Clear the queue
  linkQueue = [];
  batchTimer = null;
}
