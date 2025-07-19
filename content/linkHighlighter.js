// Link Highlighter - Detects and highlights external links for security scanning
(function () {
  console.log("✅ DEVScan: Link Highlighter Active");

  const processed = new WeakSet();
  const linkRegex = /(?:https?:\/\/|www\.)\S+/gi;

  function styleExternalLink(element) {
    element.style.textDecoration = "underline";
    element.style.textDecorationColor = "#34a853";
    element.style.textDecorationThickness = "2px";
    element.style.textUnderlineOffset = "2px";
  }

  function processLink(anchor) {
    if (processed.has(anchor)) return;
    
    const href = anchor.href;
    if (!href) return;

    try {
      const linkDomain = new URL(href).hostname;
      const currentDomain = window.location.hostname;
      
      // Only process external links
      if (linkDomain !== currentDomain) {
        console.log("🔗 External link:", href);
        
        // Send to background for processing
        chrome.runtime.sendMessage({
          type: "NEW_LINK_FOUND",
          payload: { url: href, timestamp: Date.now() }
        });
        
        // Style the link
        styleExternalLink(anchor);
      }
    } catch (e) {
      console.log("Invalid URL:", href);
    }
    
    processed.add(anchor);
  }

  function processTextUrls(textNode) {
    const matches = [...textNode.nodeValue.matchAll(linkRegex)];
    if (matches.length === 0) return;

    const fragment = document.createDocumentFragment();
    let lastIndex = 0;

    matches.forEach(match => {
      const [url] = match;
      const index = match.index;
      
      try {
        const fullUrl = url.startsWith('www.') ? 'https://' + url : url;
        const linkDomain = new URL(fullUrl).hostname;
        const currentDomain = window.location.hostname;
        
        if (linkDomain !== currentDomain) {
          // Send to background
          chrome.runtime.sendMessage({
            type: "NEW_LINK_FOUND",
            payload: { url: fullUrl, timestamp: Date.now() }
          });
          
          // Add text before URL
          if (index > lastIndex) {
            fragment.appendChild(document.createTextNode(textNode.nodeValue.slice(lastIndex, index)));
          }
          
          // Create styled span for URL
          const span = document.createElement("span");
          span.textContent = url;
          styleExternalLink(span);
          fragment.appendChild(span);
          processed.add(span);
          
          lastIndex = index + url.length;
        }
      } catch (e) {
        // Skip invalid URLs
      }
    });

    // Add remaining text
    if (lastIndex < textNode.nodeValue.length) {
      fragment.appendChild(document.createTextNode(textNode.nodeValue.slice(lastIndex)));
    }
    
    if (fragment.hasChildNodes()) {
      textNode.parentNode.replaceChild(fragment, textNode);
    }
  }

  function scanPage(root = document) {
    // Process all anchor links
    const anchors = root.querySelectorAll('a[href]');
    anchors.forEach(processLink);

    // Process text URLs
    const walker = document.createTreeWalker(
      root,
      NodeFilter.SHOW_TEXT,
      {
        acceptNode: (node) => {
          const parent = node.parentNode;
          if (!parent || processed.has(parent)) return NodeFilter.FILTER_REJECT;
          if (['SCRIPT', 'STYLE', 'NOSCRIPT'].includes(parent.tagName)) return NodeFilter.FILTER_REJECT;
          return NodeFilter.FILTER_ACCEPT;
        }
      }
    );

    const textNodes = [];
    let node;
    while (node = walker.nextNode()) {
      textNodes.push(node);
    }
    
    textNodes.forEach(processTextUrls);
  }

  // Initialize when DOM is ready
  function initialize() {
    if (!document.body) {
      setTimeout(initialize, 100);
      return;
    }

    console.log("🔧 Scanning page for external links...");
    scanPage();

    // Watch for dynamic content
    const observer = new MutationObserver(mutations => {
      mutations.forEach(mutation => {
        mutation.addedNodes.forEach(node => {
          if (node.nodeType === Node.ELEMENT_NODE) {
            scanPage(node);
          }
        });
      });
    });

    observer.observe(document.body, { childList: true, subtree: true });
  }

  initialize();
})();
