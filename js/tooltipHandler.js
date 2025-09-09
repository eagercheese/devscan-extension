const iconUrls = {
  malicious: chrome.runtime.getURL("css/picture/caution_mark_red.png"),
  anomalous: chrome.runtime.getURL("css/picture/caution_exclamation.png"),
  safe: chrome.runtime.getURL("css/picture/caution_mark_green.png"),
  scan_failed: chrome.runtime.getURL("css/picture/exclamationMark.png"),
  scanning: chrome.runtime.getURL("css/picture/warning_exclamation.png"),
};

(function () {
  // --- Tunables ---
  const LOCK_DELAY_MS = 900; // dwell time to lock tooltip position
  const HIDE_GRACE_MS = 260; // time allowed to move from link -> tooltip/bridge before hiding
  const BRIDGE_THICKNESS = 24; // min size of the invisible safety corridor

  // Host + shadow
  const host = document.createElement("div");
  host.id = "devscan-tooltip-host";
  Object.assign(host.style, {
    position: "fixed",
    zIndex: "2147483647",
    top: "0",
    left: "0",
    pointerEvents: "none",
    willChange: "transform",
    transform: "translate3d(0,0,0)",
  });

  const shadow = host.attachShadow({ mode: "open" });

  const tooltip = document.createElement("div");
  tooltip.id = "devscan-tooltip";
  tooltip.style.display = "none";
  tooltip.style.zIndex = "1000"; // keep tooltip above bridge

  // Invisible corridor between link and tooltip
  const bridge = document.createElement("div");
  bridge.id = "devscan-bridge";
  Object.assign(bridge.style, {
    position: "fixed",
    display: "none",
    background: "transparent",
    pointerEvents: "auto",
    zIndex: "999", // below tooltip so it can’t block hover/expand
  });

  shadow.appendChild(tooltip);
  shadow.appendChild(bridge);
  document.body.appendChild(host);

  // --- State ---
  let overLink = false;
  let overTip = false;
  let overBridge = false;

  let lockTimer = 0;
  let hideTimer = 0;
  let locked = false;
  let lockedPos = { left: 0, top: 0 };
  let currentLink = null;

  // Smooth, GPU-friendly positioning state
  let hostPos = { left: 0, top: 0 };
  function applyHostPos() {
    host.style.transform = `translate3d(${hostPos.left}px, ${hostPos.top}px, 0)`;
  }

  // rAF ticker to keep the bridge aligned & re-clamp on resize of tooltip
  let rafId = 0;
  function startTicker() {
    if (rafId) return;
    const tick = () => {
      if (tooltip.style.display === "block" && currentLink) {
        try {
          updateBridge(currentLink.getBoundingClientRect());
          if (locked) clampLockedIntoViewport();
        } catch {}
      }
      rafId = requestAnimationFrame(tick);
    };
    rafId = requestAnimationFrame(tick);
  }
  function stopTicker() {
    if (rafId) cancelAnimationFrame(rafId);
    rafId = 0;
  }

  // ---- CSS (keeps your original design, adds caret + actions) ----
  const baseCSS = document.createElement("style");
  baseCSS.textContent = `
    #devscan-tooltip {
      position: fixed;
      border-radius: 18px;
      max-width: 520px;
      min-width: 480px;
      box-shadow: 0 6px 18px rgba(0, 0, 0, 0.3);
      font-family: 'Open Sans', sans-serif;
      font-size: 14px;
      text-align: justify;
      overflow: hidden;
      pointer-events: auto;
      transition: opacity .12s cubic-bezier(.2,.7,.3,1), transform .12s cubic-bezier(.2,.7,.3,1);
      background: #444;
    }
    #devscan-tooltip.collapsed .tooltip-body { display:none; }
    #devscan-tooltip.expanded  .tooltip-body { display:block; }

    .tooltip-wrapper { padding:16px 20px; color:white; }
    .tooltip-wrapper.scanning { animation: scanningPulse 2s ease-in-out infinite; }
    @keyframes scanningPulse { 0%,100%{opacity:1} 50%{opacity:.85} }

    .tooltip-header { display:flex; justify-content:space-between; align-items:center; gap:12px; }
    .tooltip-label  { font-size:18px; font-weight:600; text-transform:uppercase; }
    .tooltip-subtext{ font-weight:bold; font-size:14px; }
    .tooltip-icon   { width:28px; height:28px; }
    .tooltip-icon.scanning { animation: scanningRotate 1.2s linear infinite; }
    @keyframes scanningRotate { from{transform:rotate(0)} to{transform:rotate(360deg)} }

    /* right side group with divider + dropdown caret */
    .tooltip-right { display:flex; align-items:center; gap:12px; }
    .tooltip-vbar  { width:2px; height:28px; border-radius:2px; background: rgba(255,255,255,.95); }
    .dd-caret {
      width:28px; height:28px; border:none; border-radius:8px; padding:0;
      background: rgba(255,255,255,.25); display:grid; place-items:center; cursor:pointer;
      transition: background .12s ease, transform .15s ease;
    }
    .dd-caret:hover { background: rgba(255,255,255,.35); }
    .dd-caret::before {
      content:""; width:0; height:0;
      border-left:6px solid transparent; border-right:6px solid transparent; border-top:8px solid #fff;
      transform: translateY(1px);
    }
    #devscan-tooltip.expanded .dd-caret { transform: rotate(180deg); }

    .tooltip-body {
      margin-top:16px; position:relative; border-radius:12px; padding:30px 20px;
      background:#fff; color:#000; overflow:hidden; min-height:130px;
      background-position:bottom right; background-repeat:no-repeat; background-size:contain; z-index:1;
    }
    .tooltip-body::before { content:""; position:absolute; inset:0; background:rgba(255,255,255,.75); z-index:0; pointer-events:none; }

    .tooltip-title,.tooltip-description,.tooltip-link { position:relative; z-index:1; }
    .tooltip-title { font-size:22px; font-weight:bold; font-family:'Lato',sans-serif; text-shadow:0 1px 2px rgba(0,0,0,.4); }
    .tooltip-description { margin-top:6px; line-height:1.5; font-size:15px; text-shadow:0 1px 2px rgba(0,0,0,.3); }
    .tooltip-link { margin-top:10px; font-size:12px; word-break:break-word; text-shadow:0 1px 2px rgba(0,0,0,.3); }

    /* scanning spinner */
    .ds-spinner {
      width: 28px;
      height: 28px;
      border: 4px solid #fff;
      border-bottom-color: transparent;
      border-radius: 50%;
      display: inline-block;
      box-sizing: border-box;
      animation: ds-rotation 0.9s linear infinite;
      flex: 0 0 auto;
    }
    @keyframes ds-rotation { 0% { transform: rotate(0deg); } 100% { transform: rotate(360deg); } }

    /* "See more in DEVScan" action */
    .tooltip-actions { position:relative; z-index:1; margin-top:12px; }
    .ds-more {
      appearance:none; border:0; border-radius:999px; padding:8px 12px; cursor:pointer;
      background:#eef2ff; color:#111827; font-weight:700; font-size:13px; display:inline-flex; align-items:center; gap:8px;
      box-shadow:0 1px 0 rgba(0,0,0,.05);
    }
    .ds-more:hover { filter: brightness(.98); }
    .ds-logo { width:18px; height:18px; border-radius:999px; background:#111827; display:inline-block; }
  `;
  shadow.appendChild(baseCSS);

  // ---- styles map ----
  const styles = {
    malicious: {
      label: "DANGER!",
      subtext: "Do Not Click",
      mainTitle: "HARMFUL WEBSITE DETECTED",
      description:
        "DEVScan has detected that this website is dangerous! It may try to steal your passwords, credit card information, or install harmful software on your device. For your safety, we strongly recommend NOT clicking this link.",
      background: "#c41e3a",
      titleColor: "#c41e3a",
    },
    anomalous: {
      label: "ANOMALOUS",
      subtext: "Unusual Link",
      mainTitle: "WEBSITE IS UNUSUAL",
      description:
        "DEVScan noticed something unusual about this website. While it might not be harmful, it doesn't look like a typical safe website.",
      background: "#ff8c00",
      titleColor: "#cc6900",
    },
    safe: {
      label: "SAFE",
      subtext: "Verified Safe",
      mainTitle: "WEBSITE IS SAFE",
      description:
        "Good news! DEVScan analyzed this website and found it to be safe. You can click this link without worry.",
      background: "#34a853",
      titleColor: "#1e7e34",
    },
    scanning: {
      label: "SCANNING",
      subtext: "Analysis in Progress",
      mainTitle: "CHECKING SAFETY",
      description:
        "DEVScan is currently checking this website. Please wait for the scan to complete before clicking.",
      background: "#2196f3",
      titleColor: "#1976d2",
    },
    scan_failed: {
      label: "SCAN FAILED",
      subtext: "Cannot Verify",
      mainTitle: "UNABLE TO CHECK SAFETY",
      description:
        "DEVScan couldn't complete the check due to a technical issue. Proceed with caution.",
      background: "#6c757d",
      titleColor: "#495057",
    },
  };

  // ---- small helper to force-close the hover tooltip immediately ----
  function closeTooltipNow() {
    if (hideTimer) {
      clearTimeout(hideTimer);
      hideTimer = 0;
    }
    if (lockTimer) {
      clearTimeout(lockTimer);
      lockTimer = 0;
    }
    collapseTooltip();
    hideTooltip();
    stopPointerFollow();
    resetLock();
    overLink = overTip = overBridge = false;
    currentLink = null;
    try {
      bridge.style.display = "none";
    } catch {}
  }

  // ---- Render ----
  function renderTooltip(level, href) {
    const s = styles[level] || styles.safe;
    const isScanning = level === "scanning";

    // header icon: spinner for scanning, exclamation image for others
    const headerIcon = isScanning
      ? `<span class="ds-spinner" aria-label="Loading"></span>`
      : `<img src="${chrome.runtime.getURL(
          "css/picture/exclamationMark.png"
        )}" alt="!" class="tooltip-icon" />`;

    // body background image: keep existing for non-scanning; none for scanning
    const bodyBg = isScanning
      ? ""
      : `background-image:url('${iconUrls[level]}')`;

    // Get extra fields from currentLink.dataset if available
    let confidence = "";
    let anomalyRisk = "";
    let explanation = "";
    let tip = "";
    if (currentLink) {
      confidence = currentLink.dataset.confidence || "";
      anomalyRisk = currentLink.dataset.anomalyRisk || "";
      explanation = currentLink.dataset.explanation || "";
      tip = currentLink.dataset.tip || "";
    }

    tooltip.innerHTML = `
      <div class="tooltip-wrapper${isScanning ? " scanning" : ""}">
        <div class="tooltip-header">
          <div>
            <div class="tooltip-label">${s.label}</div>
            <div class="tooltip-subtext">${s.subtext}</div>
          </div>

          <div class="tooltip-right">
            ${headerIcon}
            <div class="tooltip-vbar" aria-hidden="true"></div>
            <button class="dd-caret" type="button" aria-label="Toggle details"></button>
          </div>
        </div>

        <div class="tooltip-body" style="${bodyBg}">
          <div class="tooltip-title" style="color:${s.titleColor};">${
      s.mainTitle
    }</div>
          <div class="tooltip-description">${s.description}</div>
          <div class="tooltip-link"><strong style="color:${
            s.titleColor
          };">${href}</strong></div>
          <div class="tooltip-actions">
            <button class="ds-more" type="button"><span class="ds-logo" aria-hidden="true"></span> See more in DEVScan</button>
          </div>
        </div>
      </div>`;
    tooltip.style.background = s.background;

    // caret toggles collapse/expand
    const caret = tooltip.querySelector(".dd-caret");
    caret?.addEventListener("click", (e) => {
      e.stopPropagation();
      if (tooltip.classList.contains("expanded")) {
        collapseTooltip();
      } else {
        expandTooltip();
      }
    });

    // open right sidebar and CLOSE the hover tooltip immediately
    const moreBtn = tooltip.querySelector(".ds-more");
    moreBtn?.addEventListener("click", (e) => {
      e.preventDefault();
      e.stopPropagation();

      // Debug: Log all dataset values
      console.log(
        "[DEVScan Tooltip] 🔧 DEBUG: currentLink element:",
        currentLink
      );
      console.log(
        "[DEVScan Tooltip] 🔧 DEBUG: Link dataset keys:",
        currentLink ? Object.keys(currentLink.dataset) : "no currentLink"
      );
      console.log("[DEVScan Tooltip] 🔧 DEBUG: Link dataset values:", {
        finalVerdict: currentLink?.dataset.finalVerdict,
        confidence: currentLink?.dataset.confidence,
        anomalyRisk: currentLink?.dataset.anomalyRisk,
        explanation: currentLink?.dataset.explanation,
        tip: currentLink?.dataset.tip,
        devscanRisk: currentLink?.dataset.devscanRisk,
        allDataset: currentLink?.dataset,
      });

      const details = {
        level,
        href,
        // ML verdict data from dataset
        final_verdict: (currentLink && currentLink.dataset.finalVerdict) || "—",
        confidence_score:
          (currentLink && currentLink.dataset.confidence) || "—",
        anomaly_risk_level:
          (currentLink && currentLink.dataset.anomalyRisk) || "—",
        explanation: (currentLink && currentLink.dataset.explanation) || "",
        tip: (currentLink && currentLink.dataset.tip) || "",
        // Legacy compatibility fields
        confidence:
          (currentLink && parseInt(currentLink.dataset.confidence || "", 10)) ||
          0,
        riskLabel: (currentLink && currentLink.dataset.anomalyRisk) || "—",
        verdict: (currentLink && currentLink.dataset.finalVerdict) || "—",
        description: s.description,
        title: s.mainTitle,
        label: s.label,
        subtext: s.subtext,
      };

      console.log(
        "[DEVScan Tooltip] 🔧 DEBUG: Sending details to sidebar:",
        details
      );

      try {
        if (
          window.devscanSidebar &&
          typeof window.devscanSidebar.open === "function"
        ) {
          window.devscanSidebar.open(details);
        } else {
          console.warn("DEVScan: tooltip-sidebar.js not loaded");
        }
      } finally {
        // ensure the hover tooltip disappears
        closeTooltipNow();
      }
    });
  }

  // ---- Visibility helpers ----
  function showTooltip() {
    tooltip.style.display = "block";
    host.style.pointerEvents = "auto";
    startTicker();
  }
  function hideTooltip() {
    tooltip.style.display = "none";
    host.style.pointerEvents = "none";
    bridge.style.display = "none";
    stopTicker();
  }
  function collapseTooltip() {
    tooltip.classList.add("collapsed");
    tooltip.classList.remove("expanded");
  }
  function expandTooltip() {
    tooltip.classList.remove("collapsed");
    tooltip.classList.add("expanded");
    requestAnimationFrame(() => {
      if (currentLink) {
        placeNearElement(currentLink);
      }
      clampLockedIntoViewport(true);
    });
  }

  function clearTimers() {
    if (lockTimer) {
      clearTimeout(lockTimer);
      lockTimer = 0;
    }
    if (hideTimer) {
      clearTimeout(hideTimer);
      hideTimer = 0;
    }
  }

  function lockNow() {
    locked = true;
    lockedPos.left = hostPos.left;
    lockedPos.top = hostPos.top;
    stopPointerFollow();
  }
  function resetLock() {
    locked = false;
    lockedPos = { left: 0, top: 0 };
  }

  // clamp any position into viewport with padding
  function clampIntoViewport(left, top, width, height) {
    const pad = 10;
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    const l = Math.max(pad, Math.min(left, vw - width - pad));
    const t = Math.max(pad, Math.min(top, vh - height - pad));
    return { left: l, top: t };
  }
  function clampLockedIntoViewport(applyNow = false) {
    const w = tooltip.offsetWidth || 480;
    const h = tooltip.offsetHeight || 120;
    const p = clampIntoViewport(lockedPos.left, lockedPos.top, w, h);
    lockedPos = p;
    if (applyNow) {
      hostPos.left = p.left;
      hostPos.top = p.top;
      applyHostPos();
    }
  }

  // ---- Bridge management ----
  function updateBridge(linkRect) {
    const tipRect = tooltip.getBoundingClientRect();
    if (!tipRect.width || !tipRect.height) return;

    // Default corridor between link.right and tip.left
    let left = Math.min(linkRect.right, tipRect.left);
    let right = Math.max(linkRect.right, tipRect.left);
    let top = Math.min(linkRect.top, tipRect.top);
    let bottom = Math.max(linkRect.bottom, tipRect.bottom);

    // Keep bridge OFF the tooltip if they overlap horizontally
    const overlapX = !(
      tipRect.right <= linkRect.left || tipRect.left >= linkRect.right
    );
    if (overlapX) {
      if (
        Math.abs(tipRect.left - linkRect.right) <
        Math.abs(linkRect.left - tipRect.right)
      ) {
        right = tipRect.left;
        left = right - BRIDGE_THICKNESS;
      } else {
        left = tipRect.right;
        right = left + BRIDGE_THICKNESS;
      }
    }

    const width = Math.max(BRIDGE_THICKNESS, right - left);
    const height = Math.max(BRIDGE_THICKNESS, bottom - top);

    Object.assign(bridge.style, {
      display: "block",
      left: `${left}px`,
      top: `${top}px`,
      width: `${width}px`,
      height: `${height}px`,
    });
  }

  bridge.addEventListener("mouseenter", () => {
    overBridge = true;
  });
  bridge.addEventListener("mouseleave", () => {
    overBridge = false;
    if (!overLink && !overTip) {
      if (hideTimer) clearTimeout(hideTimer);
      hideTimer = setTimeout(() => {
        if (!overLink && !overTip && !overBridge) {
          hideTooltip();
          resetLock();
          currentLink = null;
        }
      }, HIDE_GRACE_MS);
    }
  });

  // Tooltip hover expand/keep-open
  tooltip.addEventListener("mouseenter", () => {
    overTip = true;
    expandTooltip();
    if (!locked) lockNow();
  });
  tooltip.addEventListener("mouseleave", () => {
    overTip = false;
    collapseTooltip();
    if (!overLink && !overBridge) {
      if (hideTimer) clearTimeout(hideTimer);
      hideTimer = setTimeout(() => {
        if (!overLink && !overTip && !overBridge) {
          hideTooltip();
          resetLock();
          currentLink = null;
        }
      }, HIDE_GRACE_MS);
    }
  });

  // ---- Pointer-follow system (kept) ----
  let followId = 0;
  let trackingPointer = false;
  let lastPointer = { x: 0, y: 0 };

  function onPointerMove(e) {
    lastPointer.x = e.clientX;
    lastPointer.y = e.clientY;
  }
  function followRAF() {
    if (!trackingPointer || locked) {
      followId = 0;
      return;
    }
    placeNearMouse(lastPointer.x, lastPointer.y);
    followId = requestAnimationFrame(followRAF);
  }
  function startPointerFollow(initialEvent) {
    if (trackingPointer) return;
    trackingPointer = true;
    lastPointer.x = initialEvent.clientX;
    lastPointer.y = initialEvent.clientY;
    document.addEventListener("pointermove", onPointerMove, { passive: true });
    followRAF();
  }
  function stopPointerFollow() {
    if (!trackingPointer) return;
    trackingPointer = false;
    document.removeEventListener("pointermove", onPointerMove);
    if (followId) cancelAnimationFrame(followId);
    followId = 0;
  }

  // ---- Position helpers ----
  function placeNearMouse(clientX, clientY) {
    const padding = 15;
    const w = tooltip.offsetWidth || 480;
    const h = tooltip.offsetHeight || 120;
    const viewportWidth = window.innerWidth;
    const viewportHeight = window.innerHeight;

    let left = clientX + 20;
    let top = clientY - h - 15;

    if (left + w > viewportWidth - padding) {
      left = clientX - w - 20;
    }
    if (top < padding) {
      top = clientY + 25;
    }
    if (top + h > viewportHeight - padding) {
      top = clientY - h - 5;
    }

    left = Math.max(padding, Math.min(left, viewportWidth - w - padding));
    top = Math.max(padding, Math.min(top, viewportHeight - h - padding));

    hostPos.left = left;
    hostPos.top = top;
    applyHostPos();
  }

  // Grammarly-style element-relative positioning
  function placeNearElement(element) {
    if (!element) return;

    const padding = 15;
    const w = tooltip.offsetWidth || 480;
    const h = tooltip.offsetHeight || 120;
    const viewportWidth = window.innerWidth;
    const viewportHeight = window.innerHeight;

    const rect = element.getBoundingClientRect();
    const gap = 12;

    const positions = [
      {
        left: rect.right + gap,
        top: rect.top + rect.height / 2 - h / 2,
        position: "right",
      },
      {
        left: rect.left - w - gap,
        top: rect.top + rect.height / 2 - h / 2,
        position: "left",
      },
      {
        left: rect.left + rect.width / 2 - w / 2,
        top: rect.bottom + gap,
        position: "bottom",
      },
      {
        left: rect.left + rect.width / 2 - w / 2,
        top: rect.top - h - gap,
        position: "top",
      },
    ];

    for (const pos of positions) {
      const fitsHorizontally =
        pos.left >= padding && pos.left + w <= viewportWidth - padding;
      const fitsVertically =
        pos.top >= padding && pos.top + h <= viewportHeight - padding;
      if (fitsHorizontally && fitsVertically) {
        hostPos.left = pos.left;
        hostPos.top = pos.top;
        applyHostPos();
        return pos.position;
      }
    }

    // fallback (right, clamped)
    let fallbackPos = positions[0];
    fallbackPos.left = Math.max(
      padding,
      Math.min(fallbackPos.left, viewportWidth - w - padding)
    );
    fallbackPos.top = Math.max(
      padding,
      Math.min(fallbackPos.top, viewportHeight - h - padding)
    );

    hostPos.left = fallbackPos.left;
    hostPos.top = fallbackPos.top;
    applyHostPos();
    return "right-clamped";
  }
  function placeLocked() {
    if (currentLink) {
      placeNearElement(currentLink);
    }
  }

  // ---- Public API ----
  window.attachRiskTooltip = function (link, level = "scanning") {
    if (!link) return;

    chrome.storage.sync.get("showWarningsOnly", ({ showWarningsOnly }) => {
      const underlineEnabled = showWarningsOnly ?? true;
      const s = styles[level] || styles.safe;

      if (underlineEnabled) {
        link.style.textDecoration = "underline";
        link.style.textDecorationColor = s.titleColor;
        link.style.textUnderlineOffset = "2px";
        link.style.cursor = "pointer";
      } else {
        link.style.textDecoration = "none";
        link.style.textDecorationColor = "";
      }
    });

    // Store the current level for updates
    link.dataset.tooltipLevel = level;

    // If tooltip is already bound, just update the level and return
    if (link.dataset.tooltipBound === "true") {
      return;
    }

    link.dataset.tooltipBound = "true";

    // Remove any existing event listeners to prevent stacking
    if (link._devscanMouseEnter) {
      link.removeEventListener("mouseenter", link._devscanMouseEnter);
    }
    if (link._devscanMouseMove) {
      link.removeEventListener("mousemove", link._devscanMouseMove);
    }
    if (link._devscanMouseLeave) {
      link.removeEventListener("mouseleave", link._devscanMouseLeave);
    }

    // Create event handlers
    const mouseEnterHandler = (e) => {
      overLink = true;
      currentLink = link;

      clearTimers();
      resetLock();

      const currentLevel = link.dataset.tooltipLevel || level;
      renderTooltip(currentLevel, link.href || link.src || "");
      collapseTooltip();
      showTooltip();

      // element-based positioning (Grammarly-style)
      placeNearElement(link);

      // build bridge immediately so user can move toward it
      try {
        updateBridge(link.getBoundingClientRect());
      } catch {}

      // Lock tooltip position immediately to prevent any movement
      lockNow();
    };

    const mouseMoveHandler = (e) => {
      if (!currentLink || currentLink !== link) return;
      try {
        const r = link.getBoundingClientRect();
        updateBridge(r);
      } catch {}
    };

    const mouseLeaveHandler = () => {
      overLink = false;
      stopPointerFollow();
      collapseTooltip();

      if (hideTimer) clearTimeout(hideTimer);
      hideTimer = setTimeout(() => {
        if (!overTip && !overBridge) {
          hideTooltip();
          resetLock();
          currentLink = null;
        }
      }, HIDE_GRACE_MS);
    };

    // Store handlers on the element for cleanup
    link._devscanMouseEnter = mouseEnterHandler;
    link._devscanMouseMove = mouseMoveHandler;
    link._devscanMouseLeave = mouseLeaveHandler;

    // Add event listeners
    link.addEventListener("mouseenter", mouseEnterHandler);
    link.addEventListener("mousemove", mouseMoveHandler);
    link.addEventListener("mouseleave", mouseLeaveHandler);
  };

  // Function to update tooltip level without recreating event listeners
  window.updateTooltipLevel = function (link, newLevel) {
    if (!link) return;

    link.dataset.tooltipLevel = newLevel;

    // Refresh underline styling (non-blocking)
    chrome.storage.sync.get("showWarningsOnly", ({ showWarningsOnly }) => {
      const underlineEnabled = showWarningsOnly ?? true;
      const s = styles[newLevel] || styles.safe;

      if (underlineEnabled) {
        link.style.textDecoration = "underline";
        link.style.textDecorationColor = s.titleColor;
        link.style.textUnderlineOffset = "2px";
        link.style.cursor = "pointer";
      } else {
        link.style.textDecoration = "none";
        link.style.textDecorationColor = "";
      }
    });

    // Live update the visible tooltip (no re-hover)
    if (currentLink === link && tooltip.style.display === "block") {
      renderTooltip(newLevel, link.href || link.src || "");
      // keep its locked position after re-render
      requestAnimationFrame(() => {
        try {
          clampLockedIntoViewport(true);
        } catch {}
      });
    }

    // Live update the right sidebar ONLY if it's open for this same link
    if (
      window.devscanSidebar &&
      typeof window.devscanSidebar.update === "function" &&
      window.devscanSidebar.isOpen &&
      (!window.devscanSidebar.currentHref ||
        window.devscanSidebar.currentHref === (link.href || link.src || ""))
    ) {
      const details = {
        level: newLevel,
        href: link.href || link.src || "",
        // ML verdict data from dataset
        final_verdict: link.dataset.finalVerdict || "—",
        confidence_score: link.dataset.confidence || "—",
        anomaly_risk_level: link.dataset.anomalyRisk || "—",
        explanation: link.dataset.explanation || "",
        tip: link.dataset.tip || "",
        // compatibility fields used by the sidebar
        confidence: parseInt(link.dataset.confidence || "0", 10),
        riskLabel: link.dataset.anomalyRisk || "—",
        verdict: link.dataset.finalVerdict || "—",
        description: styles[newLevel]?.description,
        title: styles[newLevel]?.mainTitle,
        label: styles[newLevel]?.label,
        subtext: styles[newLevel]?.subtext,
      };
      try {
        window.devscanSidebar.update(details);
      } catch (e) {
        console.warn("[DEVScan] Sidebar update failed:", e);
      }
    }
  };

  // safety: if page layout shifts, close unless pointer is on tip/bridge
  window.addEventListener(
    "scroll",
    () => {
      if (!overTip && !overBridge && !overLink) {
        hideTooltip();
        resetLock();
        currentLink = null;
      }
    },
    true
  );

  window.addEventListener("resize", () => {
    if (!overTip && !overBridge && !overLink) {
      hideTooltip();
      resetLock();
      currentLink = null;
    } else if (locked) {
      clampLockedIntoViewport(true);
    }
  }); // <-- close the addEventListener call

  // NOTE: fallback sidebar has been removed by request
})();
