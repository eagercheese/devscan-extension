// Shared API utility functions for extension

let extensionSessionId = null;

/**
 * Creates a new scan session for the extension
 * @returns {Promise<number>} The session ID
 */
export async function createSession() {
  try {
    const response = await fetch('http://localhost:3000/api/scan-sessions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        browserInfo: `${navigator.userAgent} - DEVScan Extension`,
        engineVersion: '1.0.0'
      })
    });
    if (!response.ok) throw new Error('Failed to create session');
    const result = await response.json();
    extensionSessionId = result.session_ID;
    return extensionSessionId;
  } catch (error) {
    console.error('Error creating session:', error);
    return null;
  }
}

/**
 * Gets the current session ID, creating one if needed
 * @returns {Promise<number>} The session ID
 */
export async function getSessionId() {
  if (!extensionSessionId) {
    await createSession();
  }
  return extensionSessionId;
}

/**
 * Sends a link to the backend server for scanning and receives the verdict.
 * @param {string} url - The URL to scan.
 * @returns {Promise<{ verdict: string, [key: string]: any }>} The scan result from the server.
 */
export async function scanLink(url) {
  try {
    // Get or create session
    const sessionId = await getSessionId();
    
    if (sessionId) {
      // Use the bulk scan endpoint with session
      const response = await fetch('http://localhost:3000/api/scan-links', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ 
          session_ID: sessionId,
          links: [url]
        })
      });
      
      if (response.ok) {
        const result = await response.json();
        if (result.results && result.results.length > 0) {
          const scanResult = result.results[0];
          return {
            verdict: scanResult.isMalicious ? 'malicious' : (scanResult.anomalyScore > 0.5 ? 'anomaly' : 'safe'),
            data: {
              anomalyScore: scanResult.anomalyScore,
              classificationScore: scanResult.classificationScore,
              intelMatch: scanResult.intelMatch,
              cached: false
            }
          };
        }
      }
    }
    
    // Fallback to single link endpoint if session creation fails
    const response = await fetch('http://localhost:3000/api/scan-links/scan-link', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ url })
    });
    
    if (!response.ok) throw new Error('Server error');
    const result = await response.json();
    
    return {
      verdict: result.isMalicious ? 'malicious' : (result.anomalyScore > 0.5 ? 'anomaly' : 'safe'),
      data: {
        anomalyScore: result.anomalyScore,
        classificationScore: result.classificationScore,
        intelMatch: result.intelMatch,
        cached: result.cached
      }
    };
  } catch (error) {
    console.error('Error scanning link:', error);
    return { verdict: 'error', error: error.message };
  }
}
