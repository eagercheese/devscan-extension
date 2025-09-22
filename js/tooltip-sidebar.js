// js/tooltip-sidebar.js (info-only panel, no gauge)
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

    /* ===== Overlay / Container ===== */
    .wrap { position: fixed; inset: 0; pointer-events: none; }
    .overlay{
      position: fixed; inset: 0;
      background: radial-gradient(1000px 600px at 90% -10%, rgba(96,165,250,.18), transparent 60%),
                  radial-gradient(800px 500px at 10% 110%, rgba(148,163,184,.16), transparent 60%),
                  rgba(2,6,23,.38);
      opacity: 0; transition: opacity .18s ease;
      pointer-events: none;
      backdrop-filter: blur(1.5px);
    }
    .open .overlay{ opacity: 0; pointer-events:auto; }

    /* ===== Panel ===== */
    .panel{
      position: fixed; top:0; right:0; bottom:0;
      width:380px; max-width:calc(100vw - 80px);
      background: linear-gradient(180deg, rgba(23,26,34,.96), rgba(23,26,34,.92));
      color:#e5e7eb;
      transform: translateX(100%);
      transition: transform .22s cubic-bezier(.22,.7,.3,1);
      display:flex; flex-direction:column;
      font-family: Inter, system-ui, -apple-system, "Segoe UI", Arial, sans-serif;
      -webkit-font-smoothing:antialiased; -moz-osx-font-smoothing:grayscale;
      border-top-left-radius:14px; border-bottom-left-radius:14px;
      font-size:20px;
      pointer-events:none;
      border-left:1px solid rgba(148,163,184,.18);
      max-height:100vh; overflow:hidden;
    }
    .open .panel{ transform: translateX(0); pointer-events:auto; }

    /* Thin scrollbar for the scroller only */
    .panel ::-webkit-scrollbar{ width:10px; }
    .panel ::-webkit-scrollbar-thumb{
      background: rgba(148,163,184,.25);
      border-radius: 999px;
      border: 2px solid transparent;
      background-clip: padding-box;
    }
    .panel ::-webkit-scrollbar-track{ background: transparent; }

    /* ===== Header (themed) ===== */
    .head{
      background: linear-gradient(90deg, var(--bg), var(--bg2));
      color:var(--ink);
      padding:16px;
      display:grid; grid-template-columns:1fr auto; gap:12px; align-items:center;
      border-top-left-radius:14px;
      box-shadow: 0 2px 10px rgba(0,0,0,.25);
      flex-shrink:0;
      border-bottom: 1px solid rgba(255,255,255,.08);
    }
    .badge{ display:flex; flex-direction:column; line-height:1.15; }
    .badge .label{ font-weight:900; letter-spacing:.5px; font-size:27px; text-transform:uppercase; margin-bottom:2px; text-shadow:0 1px 6px rgba(0,0,0,.22); }
    .badge .sub{ font-weight:600; font-size:17px; opacity:.98; text-shadow:0 1px 4px rgba(0,0,0,.18); }

    /* Close button */
    .close{
      appearance:none; border:0; width:30px; height:30px; border-radius:10px;
      background: rgba(255,255,255,.22); color:var(--ink);
      cursor:pointer; display:grid; place-items:center;
      box-shadow: inset 0 0 0 1px rgba(255,255,255,.25);
      transition: transform .12s ease, background .12s ease, box-shadow .12s ease;
    }
    .close:hover{ background: rgba(255,255,255,.32); box-shadow: inset 0 0 0 1px rgba(255,255,255,.35), 0 0 0 4px rgba(255,255,255,.14); }
    .close:active{ transform: scale(.97); }
    .close::before{ content:"✕"; font-weight:800; font-size:14px; }

    /* ===== Content ===== */
    .scroller{ 
      flex:1; overflow-y:auto; 
      display:flex; flex-direction:column; 
      background:
        radial-gradient(600px 320px at 110% -20%, rgba(59,130,246,.12), transparent 60%),
        radial-gradient(600px 320px at -10% 120%, rgba(245,158,11,.10), transparent 60%),
        transparent;
    }
    .body{
      padding:16px; 
      display:flex; flex-direction:column; gap:12px;
      flex-shrink:0;
    }

    /* Title row (keep layout, add cyber underline & glow) */
    .title-row{
      display:flex; justify-content:flex-start; align-items:center; gap:16px;
      padding-bottom:12px;
      border-bottom: 2px solid rgba(148,163,184,.22);
      margin-bottom:12px;
      box-shadow: 0 8px 22px -14px rgba(59,130,246,.35);
    }
    .title-info{ flex:1; display:flex; flex-direction:column; justify-content:center; }

    .title{
      font-size:22px; font-weight:900; color:#e5e7eb; margin-bottom:4px; letter-spacing:.2px; line-height:1.05;
      text-shadow:
        0 0 6px rgba(148,163,184,.25),
        0 0 14px rgba(59,130,246,.18);
      white-space:nowrap; overflow:hidden; text-overflow:ellipsis;
    }
    .url{
      font-size:14px; color:#93c5fd; word-break:break-word; text-decoration:none; opacity:.95; line-height:1.2;
    }
    .url:hover{ text-decoration:underline; }

    /* Meta grid rows */
    .meta{ margin-top:0; display:grid; gap:6px; flex-shrink:0; }
    .row{ padding:8px 0; border-bottom:1px solid rgba(148,163,184,.18); }
    .row:last-child{ border-bottom:none; }
    .row .k{ color:#94a3b8; font-size:18px; font-weight:600; text-transform:uppercase; letter-spacing:.5px; margin-bottom:3px; display:block; }
    .row .v{ font-weight:800; color:#e5e7eb; font-size:16px; display:block; text-shadow:0 1px 3px rgba(0,0,0,.25); }

    /* Info cards (Analysis / Tip) – glass + accent left bar */
    .explain, .tip{
      margin: 0 16px 12px; padding:12px 12px 12px 14px;
      background: rgba(17,23,41,.6);
      border: 1px solid rgba(148,163,184,.25);
      border-radius:10px; line-height:1.5; color:#cbd5e1; font-size:18px;
      border-left: 4px solid var(--accent);
      box-shadow: 0 10px 24px rgba(0,0,0,.28), inset 0 0 14px rgba(59,130,246,.10);
      backdrop-filter: blur(6px);
      flex-shrink:0;
    }
    .section-title{
      font-weight:800; color:#e5e7eb; margin-bottom:6px; font-size:24px; text-transform:uppercase; letter-spacing:.5px;
      text-shadow:0 0 10px rgba(59,130,246,.25);
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
          <div class="title-row">
            <div class="title-info">
              <div class="title" id="ds-title">WEBSITE IS SAFE</div>
              <div class="url" id="ds-url"></div>
            </div>
          </div>
          
          <div class="meta">
            <div class="row">
              <span class="k">Final verdict</span> 
              <span class="v" id="ds-verdict">Benign</span>
            </div>
            <div class="row">
              <span class="k">Risk level</span>   
              <span class="v" id="ds-risk">Zero</span>
            </div>
            <div class="row">
              <span class="k">Confidence</span>   
              <span class="v" id="ds-conf">—</span>
            </div>
          </div>
        </div>

        <div class="explain" id="ds-explain" style="display:none;">
          <div class="section-title">Analysis Details</div>
          <div id="ds-explain-text"></div>
        </div>
        
        <div class="tip" id="ds-tip" style="display:none;">
          <div class="section-title">Security Tip</div>
          <div id="ds-tip-text"></div>
        </div>
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
    explain: shadow.getElementById("ds-explain"),
    explainText: shadow.getElementById("ds-explain-text"),
    tip: shadow.getElementById("ds-tip"),
    tipText: shadow.getElementById("ds-tip-text"),
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

    fields.label.textContent = d.label || t.toUpperCase();
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

    fields.url.textContent = d.href || "";
    fields.verdict.textContent = d.verdict || "—";
    fields.risk.textContent = d.riskLabel || "—";

    // Confidence (text only)
    const pct = fmtPct(d.confidence);
    fields.conf.textContent = pct.text;

    // Explanation
    // if (d.description && d.description.trim()) {
    //   fields.explainText.textContent = d.description;
    //   fields.explain.style.display = "block";
    // } else {
    //   fields.explain.style.display = "none";
    // }
    let explainText = d.explanation  || "";
    if (!explainText) {
      if (t === "safe") {
        explainText =
          "This website appears legitimate and safe to visit. Always verify the URL matches the intended destination.";
      } else if (t === "anomalous") {
        explainText =
          "Exercise caution when visiting this link. Verify the website authenticity before providing personal information.";
      } else if (t === "malicious") {
        explainText =
          "This website has been identified as potentially harmful. Avoid interacting with it.";
      } else if (t === "scanning") {
        explainText =
          "We are currently analyzing this link for potential threats.";
      } else {
        explainText =
          "We couldn't generate a detailed explanation for this link.";
      }
    }

    if (explainText) {
      fields.explainText.textContent = explainText;
      fields.explain.style.display = "block";
    } else {
      fields.explain.style.display = "none";
    }

    // Tip
    let tipText = d.tip || "hi";
    if (!tipText) {
      if (t === "safe") {
        tipText =
          "This website appears legitimate and safe to visit. Always verify the URL matches the intended destination.";
      } else if (t === "anomalous") {
        tipText =
          "Exercise caution when visiting this link. Verify the website authenticity before providing personal information.";
      } else if (t === "malicious") {
        tipText =
          "Do not visit this website. It has been identified as potentially harmful and may compromise your security.";
      } else if (t === "scanning") {
        tipText =
          "Please wait while we analyze this link for potential security threats.";
      } else {
        tipText =
          "We couldn't verify this link's safety. Proceed with caution and verify the website manually.";
      }
    }

    if (tipText) {
      fields.tipText.textContent = tipText;
      fields.tip.style.display = "block";
    } else {
      fields.tip.style.display = "none";
    }
  }

  function open(details) {
    paint(details || {});
    wrap.classList.add("open");
    host.style.pointerEvents = "auto";
    setTimeout(() => btnClose.focus(), 0);

    window.devscanSidebar.isOpen = true;
    window.devscanSidebar.currentHref = details?.href || "";
  }

  function update(details) {
    paint(details || {});
    if (details && details.href) {
      window.devscanSidebar.currentHref = details.href;
    }
  }

  function close() {
    wrap.classList.remove("open");
    host.style.pointerEvents = "none";
    window.devscanSidebar.isOpen = false;
    window.devscanSidebar.currentHref = "";
  }

  window.devscanSidebar = {
    open,
    update,
    close,
    isOpen: false,
    currentHref: "",
  };

  overlay.addEventListener("click", close);
  btnClose.addEventListener("click", close);
  shadow.addEventListener("keydown", (e) => {
    if (e.key === "Escape") close();
  });
})();
