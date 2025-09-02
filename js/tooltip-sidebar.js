// js/tooltip-sidebar.js (info-only panel, improved readability + pointer events)
(function () {
  if (window.devscanSidebar) return; // singleton

  const host = document.createElement("div");
  host.id = "devscan-sidebar-host";
  Object.assign(host.style, {
    position: "fixed",
    inset: "0 0 0 auto",
    zIndex: "2147483646",
    pointerEvents: "none",
  });
  const shadow = host.attachShadow({ mode: "open" });
  document.documentElement.appendChild(host);

  const themeCSS = `
    .panel[data-theme="safe"]       { --bg:#16a34a; --bg2:#22c55e; --accent:#166534; --ink:#fff; }
    .panel[data-theme="anomalous"]  { --bg:#f59e0b; --bg2:#fbbf24; --accent:#b45309; --ink:#fff; }
    .panel[data-theme="malicious"]  { --bg:#dc2626; --bg2:#ef4444; --accent:#991b1b; --ink:#fff; }
    .panel[data-theme="scanning"]   { --bg:#2196f3; --bg2:#42a5f5; --accent:#1976d2; --ink:#fff; }
    .panel[data-theme="scan_failed"]{ --bg:#6b7280; --bg2:#9ca3af; --accent:#374151; --ink:#fff; }
  `;

  const style = document.createElement("style");
  style.textContent = `
    ${themeCSS}

    .wrap { position: fixed; inset: 0; pointer-events: none; }
    .overlay {
      position: fixed; inset: 0;
      background: rgba(15,23,42,.30);
      opacity: 0; transition: opacity .18s ease;
      pointer-events: none;
    }
    .open .overlay { opacity: .30; pointer-events: auto; }

    .panel {
      position: fixed; top: 0; right: 0; bottom: 0;
      width: 380px; max-width: calc(100vw - 80px);
      background: #fff; color: #0f172a;
      transform: translateX(100%);
      transition: transform .22s cubic-bezier(.22,.7,.3,1);
      box-shadow: -16px 0 36px rgba(0,0,0,.25);
      display: flex; flex-direction: column;
      font-family: Inter, system-ui, -apple-system, "Segoe UI", Arial, sans-serif;
      -webkit-font-smoothing: antialiased; moz-osx-font-smoothing: grayscale;
      border-top-left-radius: 14px; border-bottom-left-radius: 14px;
      font-size: 20px; /* more readable */
      pointer-events: none; /* disabled until open */
    }
    .open .panel { transform: translateX(0); pointer-events: auto; }

    /* Header */
    .head {
      background: linear-gradient(90deg, var(--bg), var(--bg2));
      color: var(--ink);
      padding: 16px;
      display: grid; grid-template-columns: 1fr auto; gap: 12px; align-items: center;
      border-top-left-radius: 14px;
    }
    .badge { display:flex; flex-direction:column; line-height:1.15; }
    .badge .label  { font-weight: 900; letter-spacing: .3px; font-size: 20px; text-transform: uppercase; }
    .badge .sub    { font-weight: 600; font-size: 15px; opacity: .95; }

    .close {
      appearance: none; border: 0; width: 30px; height: 30px; border-radius: 8px;
      background: rgba(255,255,255,.22); color: var(--ink);
      cursor: pointer; display:grid; place-items:center;
    }
    .close:hover { background: rgba(255,255,255,.32); }
    .close:active { transform: scale(.97); }
    .close::before { content: "✕"; font-weight: 800; font-size: 14px; }

    /* Content */
    .scroller { overflow: auto; padding-bottom: 16px; }
    .body {
      padding: 16px; display: grid; grid-template-columns: 1fr auto; gap: 14px; align-items: start;
    }
    .title { font-size: 25px; font-weight: 900; color: var(--accent); margin-bottom: 6px; letter-spacing:.2px; }
    .url   { font-size: 13.5px; color: var(--accent); word-break: break-word; text-decoration: underline; }

    .meta  { margin-top: 12px; display: grid; gap: 8px; }
    .row .k { color:#374151; font-size:13px; }
    .row .v { font-weight: 800; color:#111827; font-size:14.5px; }

    /* Gauge */
    .gauge {
      position: relative; width: 88px; height: 88px; border-radius: 50%;
      background: conic-gradient(var(--accent) calc(var(--p,0) * 1%), #e5e7eb 0);
      display: grid; place-items: center; margin-top: 6px;
    }
    .gauge::after { content:""; position:absolute; inset: 11px; border-radius: 50%; background:#fff; box-shadow: inset 0 0 0 1px #e5e7eb; }
    .gauge > span { position: relative; font-weight: 900; color: var(--accent); font-size: 16px; }

    .explain {
      margin: 10px 16px 14px; padding: 14px;
      background: #f3f4f6; border: 1px solid #d1d5db;
      border-radius: 12px; line-height: 1.6; color:#111827; font-size: 15px;
      white-space: pre-line; /* Support line breaks */
    }
    .explain .info-box {
      margin: 8px 0; padding: 10px 12px; 
      border-left: 4px solid var(--accent); 
      background: rgba(255,255,255,0.7);
      border-radius: 6px;
    }
    .explain .info-box strong {
      color: var(--accent);
      font-weight: 800;
    }
  `;
  shadow.appendChild(style);

  const wrap = document.createElement("div");
  wrap.className = "wrap";
  wrap.innerHTML = `
    <div class="overlay"></div>
    <aside class="panel" role="dialog" aria-modal="true" aria-label="DEVScan details" data-theme="safe">
      <header class="head">
        <div class="badge"><div class="label" id="ds-label">SAFE</div><div class="sub" id="ds-sub">Verified Safe</div></div>
        <button class="close" aria-label="Close"></button>
      </header>

      <div class="scroller">
        <div class="body">
          <div class="summary">
            <div class="title" id="ds-title">WEBSITE IS SAFE</div>
            <div class="url" id="ds-url"></div>
            <div class="meta">
              <div class="row"><span class="k">Final verdict</span> <span class="v" id="ds-verdict">Benign</span></div>
              <div class="row"><span class="k">Risk level</span>   <span class="v" id="ds-risk">Zero</span></div>
              <div class="row"><span class="k">Confidence</span>   <span class="v" id="ds-conf">95%</span></div>
            </div>
          </div>
          <div class="gauge" style="--p:95"><span id="ds-confText">95%</span></div>
        </div>

        <div class="explain" id="ds-explain"></div>
      </div>
    </aside>
  `;
  shadow.appendChild(wrap);

  const overlay = wrap.querySelector(".overlay");
  const panel = wrap.querySelector(".panel");
  const btnClose = wrap.querySelector(".close");

  const fields = {
    label: shadow.getElementById("ds-label"),
    sub: shadow.getElementById("ds-sub"),
    title: shadow.getElementById("ds-title"),
    url: shadow.getElementById("ds-url"),
    verdict: shadow.getElementById("ds-verdict"),
    risk: shadow.getElementById("ds-risk"),
    conf: shadow.getElementById("ds-conf"),
    confTxt: shadow.getElementById("ds-confText"),
    explain: shadow.getElementById("ds-explain"),
    gauge: wrap.querySelector(".gauge"),
  };

  function themeFor(level) {
    return [
      "safe",
      "anomalous",
      "malicious",
      "scanning",
      "scan_failed",
    ].includes(level)
      ? level
      : "safe";
  }

  function fmtPct(n) {
    const v = Number.isFinite(n) ? Math.max(0, Math.min(100, n)) : 0;
    return { raw: v, text: v ? `${v}%` : "—" };
  }

  function paint(d = {}) {
    const t = themeFor(d.level);
    panel.setAttribute("data-theme", t);

    // Use ML verdict data if available
    const finalVerdict = d.final_verdict || d.verdict || t.toUpperCase();
    const confidenceScore = d.confidence_score || d.confidence || "—";
    const anomalyRisk = d.anomaly_risk_level || d.riskLabel || "—";
    const explanation = d.explanation || d.description || "";
    const tip = d.tip || "";

    // Parse confidence percentage from string (e.g., "100%" -> 100)
    let confidenceNum = 0;
    if (typeof confidenceScore === 'string') {
      if (confidenceScore.includes('%')) {
        confidenceNum = parseInt(confidenceScore.replace('%', ''));
      } else if (confidenceScore !== "—" && confidenceScore !== "") {
        confidenceNum = parseInt(confidenceScore);
      }
    } else if (typeof confidenceScore === 'number') {
      confidenceNum = Math.round(confidenceScore);
    }
    
    console.log('[DEVScan Sidebar] 🔧 DEBUG: Confidence processing:', {
      original: confidenceScore,
      parsed: confidenceNum,
      type: typeof confidenceScore
    });

    // Set labels based on verdict type
    fields.label.textContent = finalVerdict;
    fields.sub.textContent =
      d.subtext ||
      (t === "safe"
        ? "Verified Safe"
        : t === "anomalous"
        ? "Unusual Link"
        : t === "malicious"
        ? "Do Not Click"
        : t === "scanning"
        ? "Analysis in Progress"
        : "Cannot Verify");

    // Set title based on verdict
    fields.title.textContent =
      d.title ||
      (t === "safe"
        ? "WEBSITE IS SAFE"
        : t === "anomalous"
        ? "WEBSITE IS UNUSUAL"
        : t === "malicious"
        ? "HARMFUL WEBSITE DETECTED"
        : t === "scanning"
        ? "CHECKING SAFETY"
        : "UNABLE TO CHECK SAFETY");

    // Format risk level for better readability
    let displayRisk = anomalyRisk;
    if (anomalyRisk && anomalyRisk !== "—") {
      if (anomalyRisk.toLowerCase().includes('zero')) {
        displayRisk = "Zero Risk";
      } else if (anomalyRisk.toLowerCase().includes('low')) {
        displayRisk = "Low Risk";
      } else if (anomalyRisk.toLowerCase().includes('medium') || anomalyRisk.toLowerCase().includes('moderate')) {
        displayRisk = "Moderate Risk";
      } else if (anomalyRisk.toLowerCase().includes('high')) {
        displayRisk = "High Risk";
      }
      // Keep original if it doesn't match common patterns
    }

    fields.url.textContent = d.href || "";
    fields.verdict.textContent = finalVerdict;
    fields.risk.textContent = displayRisk;

    // Set confidence with proper formatting
    let displayConfidence = confidenceScore;
    if (confidenceNum > 0) {
      displayConfidence = `${confidenceNum}%`;
    } else if (confidenceScore && confidenceScore !== "—" && confidenceScore !== "") {
      displayConfidence = confidenceScore;
    } else {
      displayConfidence = "—";
    }
    
    fields.conf.textContent = displayConfidence;
    fields.confTxt.textContent = displayConfidence;
    fields.gauge.style.setProperty("--p", confidenceNum);

    // Build comprehensive explanation with ML insights
    let explainText = "";
    
    if (explanation) {
      explainText = explanation;
    } else {
      // Provide default explanations based on verdict
      if (t === "safe") {
        explainText = "This website has been analyzed and determined to be safe. You can proceed with confidence.";
      } else if (t === "malicious") {
        explainText = "This website has been flagged as potentially harmful. It may attempt to steal personal information, install malware, or engage in other malicious activities.";
      } else if (t === "anomalous") {
        explainText = "This website shows unusual characteristics that deviate from typical safe patterns. While not necessarily malicious, exercise caution.";
      } else if (t === "scan_failed") {
        explainText = "Unable to complete security analysis at this time. The scanning service may be temporarily unavailable.";
      }
    }

    // Add ML confidence insights
    if (confidenceNum > 0) {
      if (confidenceNum >= 90) {
        explainText += `<div class="info-box">🎯 <strong>High Confidence:</strong> Our ML model is ${confidenceScore} confident in this assessment, indicating very reliable results.</div>`;
      } else if (confidenceNum >= 70) {
        explainText += `<div class="info-box">📊 <strong>Good Confidence:</strong> Our ML model shows ${confidenceScore} confidence in this assessment, suggesting reliable results.</div>`;
      } else if (confidenceNum >= 50) {
        explainText += `<div class="info-box">⚠️ <strong>Moderate Confidence:</strong> Our ML model has ${confidenceScore} confidence. Consider additional verification.</div>`;
      } else {
        explainText += `<div class="info-box">⚡ <strong>Low Confidence:</strong> Our ML model has only ${confidenceScore} confidence. Results should be interpreted with caution.</div>`;
      }
    }

    // Add risk level explanation
    if (anomalyRisk && anomalyRisk !== "—") {
      if (anomalyRisk.toLowerCase().includes('low')) {
        explainText += `<div class="info-box">✅ <strong>Risk Level:</strong> ${displayRisk} - This indicates minimal security concerns.</div>`;
      } else if (anomalyRisk.toLowerCase().includes('medium') || anomalyRisk.toLowerCase().includes('moderate')) {
        explainText += `<div class="info-box">⚠️ <strong>Risk Level:</strong> ${displayRisk} - Some caution is advised when interacting with this website.</div>`;
      } else if (anomalyRisk.toLowerCase().includes('high')) {
        explainText += `<div class="info-box">🚨 <strong>Risk Level:</strong> ${displayRisk} - High security risk detected. Avoid this website.</div>`;
      } else {
        explainText += `<div class="info-box">📋 <strong>Risk Level:</strong> ${displayRisk}</div>`;
      }
    }

    // Add educational tips based on verdict type and risk level
    if (tip) {
      explainText += `<div class="info-box">💡 <strong>Security Tip:</strong> ${tip}</div>`;
    } else {
      // Provide educational tips based on verdict
      if (t === "safe") {
        explainText += `<div class="info-box">💡 <strong>Security Best Practices:</strong> Even safe websites can be compromised. Always verify the URL matches the intended destination, look for HTTPS encryption, and be cautious when entering personal information.</div>`;
      } else if (t === "malicious") {
        explainText += `<div class="info-box">💡 <strong>Security Alert:</strong> Never enter personal information, passwords, or financial details on suspicious websites. Close this page immediately and run a virus scan if you've already interacted with the site.</div>`;
      } else if (t === "anomalous") {
        explainText += `<div class="info-box">💡 <strong>Security Caution:</strong> When encountering unusual websites, verify the domain spelling, check for HTTPS, avoid downloading files, and don't enter sensitive information until you can verify the site's legitimacy.</div>`;
      }
    }

    // Add general security education
    if (confidenceNum > 0 && t !== "scan_failed") {
      explainText += `<div class="info-box">🎓 <strong>Learn More:</strong> DEVScan uses advanced machine learning to analyze website patterns, behavior, and characteristics. Our model examines factors like domain reputation, SSL certificates, content patterns, and known threat indicators to provide this assessment.</div>`;
    }

    // Add specific risk level education
    if (anomalyRisk && anomalyRisk !== "—") {
      if (anomalyRisk.toLowerCase().includes('zero') || anomalyRisk.toLowerCase().includes('low')) {
        explainText += `<div class="info-box">🔒 <strong>Why It's Safe:</strong> This website exhibits normal, expected behavior patterns with no suspicious characteristics detected by our analysis.</div>`;
      } else if (anomalyRisk.toLowerCase().includes('medium') || anomalyRisk.toLowerCase().includes('moderate')) {
        explainText += `<div class="info-box">⚠️ <strong>What Makes It Unusual:</strong> Our analysis detected some patterns that deviate from typical safe websites, but not enough to classify it as malicious. Exercise normal web browsing caution.</div>`;
      } else if (anomalyRisk.toLowerCase().includes('high')) {
        explainText += `<div class="info-box">🚨 <strong>Security Risk Detected:</strong> This website shows multiple suspicious characteristics that strongly suggest malicious intent. Common tactics include phishing, malware distribution, or data theft.</div>`;
      }
    }

    fields.explain.innerHTML = explainText;
  }

  function open(details) {
    console.log('[DEVScan Sidebar] 🔧 DEBUG: Opening sidebar with details:', details);
    paint(details || {});
    wrap.classList.add("open");
    host.style.pointerEvents = "auto";
    setTimeout(() => btnClose.focus(), 0);
  }

  function update(details) {
    console.log('[DEVScan Sidebar] 🔧 DEBUG: Updating sidebar with details:', details);
    paint(details || {}); // trial of the error
  }

  function close() {
    wrap.classList.remove("open");
    host.style.pointerEvents = "none";
  }

  overlay.addEventListener("click", close);
  btnClose.addEventListener("click", close);
  shadow.addEventListener("keydown", (e) => {
    if (e.key === "Escape") close();
  });

  window.devscanSidebar = { open, update, close };
})();
