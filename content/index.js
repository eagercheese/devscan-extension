// Content script entry point
(function () {
  console.log("✅ DEVScan v2: universal link highlighter with Shadow DOM support 🧠");

  const processed = new WeakSet();
  const linkRegex = /(?:https?:\/\/|www\.)\S+/gi;

  function processTarget(el) {
    if (processed.has(el)) return;
    const isAnchor = el.tagName === 'A';
    const href = el.getAttribute?.('href');
    const isValidLink = isAnchor && href && href.trim() !== '';
    if (isValidLink) {
      try {
        const absoluteUrl = new URL(href, window.location.href).href;
        const linkDomain = new URL(absoluteUrl).hostname;
        const currentDomain = window.location.hostname;
        if (linkDomain === currentDomain) {
          return;
        }
        console.log("🔗 External link found:", absoluteUrl, "Domain:", linkDomain);
        chrome.runtime.sendMessage(
          {
            type: "NEW_LINK_FOUND",
            payload: {
              url: absoluteUrl,
              timestamp: Date.now()
            }
          },
          function (response) {
            if (response && response.status === "received") {
              console.log("Link processed successfully:", response.message);
            } else {
              console.error("Error processing link:", response.message);
            }
          }
        );
      } catch (e) {
        console.log("🔗 Invalid link (could not resolve):", href);
      }
      const rect = el.getBoundingClientRect();
      if (rect.width > 0 && rect.height > 0) {
        el.style.textDecoration = "underline";
        el.style.textDecorationColor = "green";
        el.style.textDecorationThickness = "2px";
        el.style.textUnderlineOffset = "2px";
        const children = el.querySelectorAll("*");
        children.forEach(child => {
          child.style.textDecoration = "underline";
          child.style.textDecorationColor = "green";
          child.style.textDecorationThickness = "2px";
          child.style.textUnderlineOffset = "2px";
        });
      }
    }
    processed.add(el);
  }

  function scanAndStyle(root = document) {
    const walkDOM = (node) => {
      const roots = [node];
      if (node.querySelectorAll) {
        node.querySelectorAll("*").forEach(el => {
          if (el.shadowRoot) roots.push(el.shadowRoot);
        });
      }
      roots.forEach(rootNode => {
        const walker = document.createTreeWalker(rootNode, NodeFilter.SHOW_TEXT, null, false);
        const textNodes = [];
        while (walker.nextNode()) {
          const textNode = walker.currentNode;
          if (
            textNode.parentNode &&
            textNode.nodeValue.trim().length > 0 &&
            !processed.has(textNode.parentNode) &&
            !["SCRIPT", "STYLE", "NOSCRIPT"].includes(textNode.parentNode.tagName)
          ) {
            textNodes.push(textNode);
          }
        }
        textNodes.forEach(node => {
          const matches = [...node.nodeValue.matchAll(linkRegex)];
          if (matches.length === 0) return;
          const frag = document.createDocumentFragment();
          let lastIndex = 0;
          matches.forEach(match => {
            const [url] = match;
            const index = match.index;
            try {
              const absoluteUrl = new URL(url.startsWith('www.') ? 'https://' + url : url);
              const linkDomain = absoluteUrl.hostname;
              const currentDomain = window.location.hostname;
              if (linkDomain === currentDomain) {
                return;
              }
              console.log("🔗 External text URL found:", absoluteUrl.href, "Domain:", linkDomain);
              chrome.runtime.sendMessage(
                {
                  type: "NEW_LINK_FOUND",
                  payload: {
                    url: absoluteUrl.href,
                    timestamp: Date.now()
                  }
                },
                function (response) {
                  if (response && response.status === "received") {
                    console.log("Text URL processed successfully");
                  } else {
                    console.error("Error processing text URL");
                  }
                }
              );
            } catch (e) {
              return;
            }
            if (index > lastIndex) {
              frag.appendChild(document.createTextNode(node.nodeValue.slice(lastIndex, index)));
            }
            const span = document.createElement("span");
            span.textContent = url;
            span.style.textDecoration = "underline";
            span.style.textDecorationColor = "green";
            span.style.textDecorationThickness = "2px";
            span.style.textUnderlineOffset = "2px";
            frag.appendChild(span);
            processed.add(span);
            lastIndex = index + url.length;
          });
          if (lastIndex < node.nodeValue.length) {
            frag.appendChild(document.createTextNode(node.nodeValue.slice(lastIndex)));
          }
          node.parentNode.replaceChild(frag, node);
        });
        const anchors = rootNode.querySelectorAll?.(
          'a, span[role="link"], div[jsaction*="click"], div[data-header-feature] a, div[data-ved] a, a[jsname], a > h3'
        ) || [];
        anchors.forEach(processTarget);
      });
    };
    walkDOM(root);
  }

  const observer = new MutationObserver(mutations => {
    for (const mutation of mutations) {
      if (mutation.addedNodes.length) {
        mutation.addedNodes.forEach(node => {
          if (node.nodeType === Node.ELEMENT_NODE) {
            scanAndStyleWithPopups(node);
          }
        });
      }
    }
  });

  // --- Floating verdict popup on link hover ---
  // Using the VerdictPopup class from verdictPopup.js
  const verdictPopup = new VerdictPopup();

  // Add scanLink function for hover popup (uses same API as batching)
  async function scanLinkForPopup(url) {
    try {
      // Use the single link endpoint for immediate hover results
      const response = await fetch('http://localhost:3000/api/scan-links/scan-link', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url }),
      });
      
      if (!response.ok) throw new Error('Server error');
      const result = await response.json();
      
      // Return the full result data for the popup
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
      console.error('Error scanning link for popup:', error);
      return { 
        verdict: 'error', 
        data: { error: error.message }
      };
    }
  }

  // Attach hover listeners to all external links
  function attachLinkHoverPopups(root = document) {
    // Improved selector to catch more link types including our highlighted ones
    const anchors = root.querySelectorAll('a[href], span[style*="underline"], span[style*="text-decoration"]');
    anchors.forEach(anchor => {
      if (anchor._devscanHoverAttached) return;
      anchor._devscanHoverAttached = true;
      
      anchor.addEventListener('mouseenter', async (e) => {
        // Only show for external links
        let url = anchor.href;
        if (!url && anchor.textContent) {
          // Handle text spans that were converted to links
          const text = anchor.textContent.trim();
          if (text.match(/^https?:\/\//)) {
            url = text;
          } else if (text.match(/^www\./)) {
            url = 'https://' + text;
          } else {
            return;
          }
        }
        
        if (!url) return; // Skip if no URL found
        
        try {
          const absoluteUrl = new URL(url, window.location.href).href;
          const linkDomain = new URL(absoluteUrl).hostname;
          const currentDomain = window.location.hostname;
          if (linkDomain === currentDomain) return; // Skip internal links
        } catch { 
          return; // Skip invalid URLs
        }
        
        // Show analyzing popup immediately
        verdictPopup.show(anchor, 'analyzing');
        
        // Call backend for verdict (separate from batching for immediate results)
        const result = await scanLinkForPopup(url);
        verdictPopup.update(result.verdict, result.data);
      });
      
      anchor.addEventListener('mouseleave', () => {
        verdictPopup.hide();
      });
    });
  }

  // Combined function for scanning and attaching popups
  function scanAndStyleWithPopups(root = document) {
    scanAndStyle(root);
    attachLinkHoverPopups(root);
  }

  function waitForBody(callback) {
    if (document.body) {
      callback();
    } else {
      requestAnimationFrame(() => waitForBody(callback));
    }
  }
  waitForBody(() => {
    observer.observe(document.body, { childList: true, subtree: true });
    scanAndStyleWithPopups();
  });
  if (location.hostname.includes("docs.google.com")) {
    const waitForEditor = () => {
      const editor = document.querySelector(".kix-appview-editor");
      if (!editor) return setTimeout(waitForEditor, 1000);
      console.log("🧠 Google Docs editor ready.");
      scanAndStyle(editor);
    };
    waitForEditor();
  } else {
    scanAndStyle();
  }

  // --- Floating Analyzing Notification ---
  function showAnalyzingNotification() {
    if (document.getElementById('devscan-analyzing-popup')) return;
    const popup = document.createElement('div');
    popup.id = 'devscan-analyzing-popup';
    popup.innerHTML = `
      <div style="display:flex;align-items:center;gap:10px;">
        <span style="font-size:1.5rem;color:#7a7a7a;">&#9888;</span>
        <div>
          <div style="font-weight:bold;color:#333;letter-spacing:1px;">ANALYZING</div>
          <div style="font-size:1.05rem;font-weight:500;">Link Analysis in Progress</div>
          <div style="font-size:0.98rem;color:#555;">Please wait while we analyze this link for potential threats.</div>
        </div>
      </div>
    `;
    Object.assign(popup.style, {
      position: 'fixed',
      left: '50%',
      bottom: '40px',
      transform: 'translateX(-50%)',
      background: '#e0e3e8',
      color: '#333',
      borderLeft: '6px solid #7a7a7a',
      borderRadius: '10px',
      boxShadow: '0 2px 8px rgba(0,0,0,0.08)',
      padding: '1rem 1.2rem',
      zIndex: 2147483647,
      minWidth: '320px',
      maxWidth: '90vw',
      fontFamily: "'Segoe UI', Arial, sans-serif"
    });
    document.body.appendChild(popup);
  }

  function hideAnalyzingNotification() {
    const popup = document.getElementById('devscan-analyzing-popup');
    if (popup) popup.remove();
  }
})();
