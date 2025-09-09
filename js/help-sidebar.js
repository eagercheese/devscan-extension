// js/devscan-help-sidebar.js
(function () {
  if (window.devscanHelpSidebar) return; // singleton

  // ----- content -----
  const TYPES = [
    {
      key: "safe",
      label: "SAFE",
      subtext: "Trusted & Secure",
      color: "#16a34a",
      bgColor: "#dcfce7",
      meaning: "A website that appears completely safe to visit and use.",
      expl: [
        "✅ <strong>What this means:</strong> This website looks legitimate and trustworthy, similar to well-known sites like Amazon, Google, or your bank's official website.",
        "🔍 <strong>What we checked:</strong> The web address looks normal, the website has proper security certificates, and it matches patterns of trusted sites.",
        "🛡️ <strong>Your safety:</strong> This site appears safe to visit. As always, be cautious with personal information and verify you're on the correct website before entering passwords or sensitive data.",
        "💡 <strong>Tip:</strong> Even safe sites can have fake lookalikes, so always double-check the web address (URL) matches what you expect.",
      ],
    },
    {
      key: "anomalous",
      label: "UNUSUAL",
      subtext: "Needs Extra Caution",
      color: "#f59e0b",
      bgColor: "#fef3c7",
      meaning:
        "A website that has some unusual characteristics that make us unsure about its safety.",
      expl: [
        "⚠️ <strong>What this means:</strong> Something about this website seems different from typical, trusted sites. It might be a new website, have an unusual web address, or lack some security features.",
        "🔍 <strong>What we found:</strong> The website might have a very new domain, unusual URL structure, or other characteristics that don't match established, trusted websites.",
        "🛡️ <strong>Your safety:</strong> Be extra careful here. Only continue if you expected this link and trust who sent it to you. Avoid entering personal information, passwords, or payment details.",
        "💡 <strong>Tip:</strong> When in doubt, search for the company or service using Google instead of clicking the link directly.",
      ],
    },
    {
      key: "malicious",
      label: "DANGEROUS",
      subtext: "Do Not Visit",
      color: "#dc2626",
      bgColor: "#fee2e2",
      meaning:
        "A website that is designed to harm your computer or steal your personal information.",
      expl: [
        "🚨 <strong>What this means:</strong> This website is likely a scam, phishing site, or contains malware. It's designed to trick you into giving away passwords, credit card numbers, or to infect your computer with viruses.",
        "🔍 <strong>What we found:</strong> The website matches known patterns of dangerous sites, such as fake banking pages, fraudulent shopping sites, or malware distribution points.",
        "🛡️ <strong>Your safety:</strong> DO NOT visit this website. If you already clicked it, close the page immediately and consider changing any passwords you may have entered.",
        "💡 <strong>Emergency tip:</strong> If you entered personal information, contact your bank or the real company directly using their official phone number or website.",
      ],
    },
    {
      key: "scanning",
      label: "SCANNING",
      subtext: "Checking Safety",
      color: "#2196f3",
      bgColor: "#dbeafe",
      meaning:
        "We are currently analyzing this website to determine its safety level.",
      expl: [
        "🔄 <strong>What this means:</strong> Our security system is actively checking this website to see if it's safe, suspicious, or dangerous. This usually takes a few seconds.",
        "🔍 <strong>What we're checking:</strong> We're analyzing the website's reputation, checking for known threats, verifying security certificates, and comparing it against our database of safe and malicious sites.",
        "🛡️ <strong>Your safety:</strong> Please wait for the scan to complete before proceeding. This gives you the most accurate safety assessment.",
        "💡 <strong>Tip:</strong> If the scan takes longer than expected, it might be due to network issues or the website being temporarily unavailable.",
      ],
    },
    {
      key: "scan_failed",
      label: "UNKNOWN",
      subtext: "Cannot Verify",
      color: "#6b7280",
      bgColor: "#f3f4f6",
      meaning:
        "We couldn't check this website's safety due to technical issues.",
      expl: [
        "❓ <strong>What this means:</strong> Our security scanner couldn't analyze this website, possibly due to internet connection issues, the website being temporarily down, or other technical problems.",
        "🔍 <strong>What happened:</strong> The safety check failed to complete, so we don't know if this website is safe or dangerous.",
        "🛡️ <strong>Your safety:</strong> Treat this website with caution. It might be perfectly safe, but we can't confirm it. Avoid entering sensitive information until you can verify it's legitimate.",
        "💡 <strong>What to do:</strong> Try refreshing the page, check your internet connection, or search for the website's official page through Google to verify it's real.",
      ],
    },
  ];

  // ----- host + shadow -----
  const host = document.createElement("div");
  host.id = "devscan-help-host";
  Object.assign(host.style, {
    position: "fixed",
    inset: "0 0 0 auto",
    zIndex: "2147483645",
    pointerEvents: "none",
  });
  const shadow = host.attachShadow({ mode: "open" });

  const themeCSS = `
    .panel[data-theme="safe"]       { --bg:#16a34a; --bg2:#22c55e; --accent:#166534; --ink:#fff; }
    .panel[data-theme="scanning"]   { --bg:#2196f3; --bg2:#42a5f5; --accent:#1976d2; --ink:#fff; }
    .panel[data-theme="anomalous"]  { --bg:#f59e0b; --bg2:#fbbf24; --accent:#b45309; --ink:#fff; }
    .panel[data-theme="malicious"]  { --bg:#dc2626; --bg2:#ef4444; --accent:#991b1b; --ink:#fff; }
    .panel[data-theme="scan_failed"]{ --bg:#6b7280; --bg2:#9ca3af; --accent:#374151; --ink:#fff; }
  `;

  // ----- styles -----
  const css = document.createElement("style");
  css.textContent = `
    ${themeCSS}

    .fab { --fab-size: 32px; }
    .fab{
      position: fixed; right: 16px; bottom: 16px;
      width: var(--fab-size); height: var(--fab-size); min-width: var(--fab-size);
      border-radius: 999px; background: #fff; color: #111827;
      border: 1px solid rgba(2,6,23,.10);
      box-shadow: 0 6px 18px rgba(2,6,23,.20), 0 1px 0 rgba(255,255,255,.85) inset;
      display: grid; place-items: center; cursor: pointer; user-select: none; pointer-events: auto;
      transition: transform .12s ease, box-shadow .12s ease, background .12s ease, border-color .12s ease, filter .12s ease;
    }
    .fab:hover{ background:#f8fafc; border-color:rgba(2,6,23,.15); box-shadow:0 8px 22px rgba(2,6,23,.24); transform:translateY(-1px); }
    .fab:active{ transform:translateY(0); filter:saturate(.95); }
    .fab:focus-visible{ outline:none; box-shadow:0 0 0 4px rgba(59,130,246,.25), 0 6px 18px rgba(2,6,23,.20); }
    .fab-q{ font:900 14px/1 Inter, system-ui, Segoe UI, Roboto, Arial, sans-serif; color:#111827; transform:translateY(1px); }

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
      width: 470px;                        /* match tooltip sidebar */
      max-width: calc(100vw - 80px);
      background: #fff; color: #0f172a;
      transform: translateX(100%);
      transition: transform .22s cubic-bezier(.22,.7,.3,1);
      box-shadow: -16px 0 36px rgba(0,0,0,.25);
      display: flex; flex-direction: column;
      font-family: Inter, system-ui, -apple-system, "Segoe UI", Arial, sans-serif;
      -webkit-font-smoothing: antialiased; moz-osx-font-smoothing: grayscale;
      border-top-left-radius: 14px; border-bottom-left-radius: 14px;
      font-size: 20px;
      pointer-events: none;
      border-left: 1px solid #e2e8f0;
      max-height: 100vh;
      overflow: hidden;
    }
    .open .panel { transform: translateX(0); pointer-events: auto; }

    .head {
      background: linear-gradient(90deg, var(--bg), var(--bg2));
      color: var(--ink);
      padding: 16px;
      display: grid; grid-template-columns: 1fr auto; gap: 12px; align-items: center;
      border-top-left-radius: 14px;
      box-shadow: 0 2px 8px rgba(0,0,0,0.1);
      flex-shrink: 0;
    }
    .badge { display:flex; flex-direction:column; line-height:1.15; }
    .badge .label  { font-weight: 900; letter-spacing: .4px; font-size: 18px; text-transform: uppercase; margin-bottom: 2px; }
    .badge .sub    { font-weight: 600; font-size: 14px; opacity: .95; }

    .close {
      appearance: none; border: 0; width: 30px; height: 30px; border-radius: 8px;
      background: rgba(255,255,255,.22); color: var(--ink);
      cursor: pointer; display:grid; place-items:center;
    }
    .close:hover { background: rgba(255,255,255,.32); }
    .close:active { transform: scale(.97); }
    .close::before { content: "✕"; font-weight: 800; font-size: 14px; }

    .scroller {
      flex: 1;
      overflow-y: auto;
      display: flex;
      flex-direction: column;
    }

    /* Tabs row */
    .tabs {
      display: flex;
      gap: 8px;
      padding: 16px;
      background: #f8fafc;
      border-bottom: 1px solid #e2e8f0;
      flex-shrink: 0;
      overflow-x: auto;
      overflow-y: hidden;
      scroll-behavior: smooth;
      -webkit-overflow-scrolling: touch;
      cursor: default; /* keep normal arrow */
      user-select: none; /* helps during drag */
    }
    .tabs::-webkit-scrollbar { height: 4px; }
    .tabs::-webkit-scrollbar-track { background: #f1f5f9; border-radius: 4px; }
    .tabs::-webkit-scrollbar-thumb { background: #cbd5e1; border-radius: 4px; }
    .tabs::-webkit-scrollbar-thumb:hover { background: #94a3b8; }

    .tab {
      padding: 8px 16px;
      border: 2px solid #e5e7eb;
      border-radius: 8px;
      background: #fff;
      color: #374151;
      text-align: center;
      cursor: pointer;
      transition: all .12s ease;
      font-size: 14px;
      font-weight: 600;
      text-transform: uppercase;
      letter-spacing: 0.5px;
      white-space: nowrap;
      flex-shrink: 0;
      min-width: fit-content;
    }
    .tab:hover { background: #f1f5f9; color: #1f2937; }
    .tab.active { border-color: var(--accent); background: var(--bgColor); color: var(--accent); font-weight: 700; }
    .tab[data-key="safe"] { --accent:#16a34a; --bgColor:#dcfce7; }
    .tab[data-key="scanning"] { --accent:#2196f3; --bgColor:#dbeafe; }
    .tab[data-key="anomalous"] { --accent:#f59e0b; --bgColor:#fef3c7; }
    .tab[data-key="malicious"] { --accent:#dc2626; --bgColor:#fee2e2; }
    .tab[data-key="scan_failed"] { --accent:#6b7280; --bgColor:#f3f4f6; }
    .tab[data-key="safe"]:not(.active) { color:#16a34a; border-color:#16a34a; }
    .tab[data-key="scanning"]:not(.active) { color:#2196f3; border-color:#2196f3; }
    .tab[data-key="anomalous"]:not(.active) { color:#f59e0b; border-color:#f59e0b; }
    .tab[data-key="malicious"]:not(.active) { color:#dc2626; border-color:#dc2626; }
    .tab[data-key="scan_failed"]:not(.active) { color:#6b7280; border-color:#6b7280; }

    .content { padding: 20px; flex: 1; }
    .meaning-box {
      background: var(--bgColor);
      border: 2px solid var(--accent);
      border-radius: 12px;
      padding: 16px;
      margin-bottom: 20px;
    }
    .meaning-title { font-size: 18px; font-weight: 700; color: var(--accent); margin-bottom: 8px; text-transform: uppercase; letter-spacing: 0.5px; }
    .meaning-text  { font-size: 16px; color:#374151; line-height:1.5; font-weight:500; }

    .explanation {
      background: #f8fafc;
      border: 1px solid #e2e8f0;
      border-radius: 12px;
      padding: 16px;
      border-left: 4px solid var(--accent);
    }
    .explanation ul { list-style:none; padding:0; margin:0; }
    .explanation li {
      margin-bottom: 16px;
      padding: 12px;
      background: #fff;
      border-radius: 8px;
      border: 1px solid #e5e7eb;
      font-size: 16px;
      line-height: 1.6;
    }
    .explanation li:last-child { margin-bottom: 0; }
    .explanation strong { color: var(--accent); }
  `;
  shadow.appendChild(css);

  // ----- markup -----
  const fab = document.createElement("button");
  fab.className = "fab";
  fab.setAttribute("aria-label", "DEVScan help");
  fab.title = "DEVScan Help - Understanding Security Ratings";
  fab.innerHTML = `<span class="fab-q" aria-hidden="true">?</span>`;

  const wrap = document.createElement("div");
  wrap.className = "wrap";
  wrap.innerHTML = `
    <div class="overlay"></div>
    <aside class="panel" role="dialog" aria-modal="true" aria-label="DEVScan Help" data-theme="safe">
      <header class="head">
        <div class="badge">
          <div class="label" id="ds-help-label">DEVScan Help</div>
          <div class="sub" id="ds-help-sub">Understanding Security Ratings</div>
        </div>
        <button class="close" aria-label="Close"></button>
      </header>

      <div class="scroller">
        <div class="tabs" id="tabs" role="tablist" aria-label="Security rating types"></div>

        <div class="content">
          <div class="meaning-box" id="meaning-box">
            <div class="meaning-title" id="meaning-title">Safe - Definition</div>
            <div class="meaning-text" id="meaning-text">A website that appears completely safe to visit and use.</div>
          </div>

        <div class="explanation" id="explanation">
            <ul id="explanation-list"></ul>
          </div>
        </div>
      </div>
    </aside>
  `;
  shadow.appendChild(fab);
  shadow.appendChild(wrap);
  document.documentElement.appendChild(host);

  // ----- refs -----
  const panel = wrap.querySelector(".panel");
  const overlay = wrap.querySelector(".overlay");
  const closeBtn = wrap.querySelector(".close");
  const tabsEl = wrap.querySelector("#tabs");
  const meaningTitle = wrap.querySelector("#meaning-title");
  const meaningText = wrap.querySelector("#meaning-text");
  const explanationList = wrap.querySelector("#explanation-list");
  const meaningBox = wrap.querySelector("#meaning-box");
  const explanation = wrap.querySelector("#explanation");

  // ----- build tabs -----
  TYPES.forEach((t, idx) => {
    const b = document.createElement("button");
    b.className = "tab";
    b.dataset.key = t.key;
    b.setAttribute("role", "tab");
    b.setAttribute("aria-selected", idx === 0 ? "true" : "false");
    b.setAttribute("tabindex", idx === 0 ? "0" : "-1");
    b.textContent = t.label;
    tabsEl.appendChild(b);
  });

  function setActive(key) {
    const t = TYPES.find((x) => x.key === key) || TYPES[0];

    panel.setAttribute("data-theme", t.key);

    tabsEl.querySelectorAll(".tab").forEach((btn) => {
      const active = btn.dataset.key === t.key;
      btn.classList.toggle("active", active);
      btn.setAttribute("aria-selected", active ? "true" : "false");
      btn.tabIndex = active ? 0 : -1;
    });

    meaningTitle.textContent = `${t.label} - Definition`;
    meaningText.textContent = t.meaning;

    meaningBox.style.setProperty("--accent", t.color);
    meaningBox.style.setProperty("--bgColor", t.bgColor);
    explanation.style.setProperty("--accent", t.color);

    explanationList.innerHTML = t.expl
      .map((item) => `<li>${item}</li>`)
      .join("");
  }
  setActive(TYPES[0].key);

  // ----- interactions -----

  // Switch tabs on click (unless we just dragged)
  let _suppressNextClick = false;
  tabsEl.addEventListener("click", (e) => {
    if (_suppressNextClick) {
      _suppressNextClick = false;
      e.preventDefault();
      e.stopPropagation();
      return;
    }
    const btn = e.target.closest(".tab");
    if (!btn) return;
    setActive(btn.dataset.key);
    btn.focus();
  });

  // Keyboard navigation
  tabsEl.addEventListener("keydown", (e) => {
    const tabs = Array.from(tabsEl.querySelectorAll(".tab"));
    const current = tabs.findIndex((b) => b.classList.contains("active"));
    let next = current;
    if (e.key === "ArrowRight") next = (current + 1) % tabs.length;
    if (e.key === "ArrowLeft") next = (current - 1 + tabs.length) % tabs.length;
    if (next !== current) {
      e.preventDefault();
      const btn = tabs[next];
      setActive(btn.dataset.key);
      btn.focus();
    }
  });

  // Wheel: vertical -> horizontal scroll
  tabsEl.addEventListener(
    "wheel",
    (e) => {
      if (Math.abs(e.deltaY) > Math.abs(e.deltaX)) {
        tabsEl.scrollLeft += e.deltaY;
        e.preventDefault();
      }
    },
    { passive: false }
  );

  // Mouse drag to scroll (without breaking clicks)
  (function enableMouseDrag(row) {
    let isDown = false;
    let startX = 0;
    let startScroll = 0;
    let moved = 0;
    const THRESH = 6;

    function onMove(e) {
      if (!isDown) return;
      const dx = e.clientX - startX;
      moved = Math.max(moved, Math.abs(dx));
      row.scrollLeft = startScroll - dx;
    }

    function onUp() {
      if (!isDown) return;
      isDown = false;
      document.removeEventListener("mousemove", onMove);
      if (moved > THRESH) _suppressNextClick = true; // only suppress if it was a real drag
      moved = 0;
    }

    row.addEventListener("mousedown", (e) => {
      if (e.button !== 0) return;
      isDown = true;
      moved = 0;
      startX = e.clientX;
      startScroll = row.scrollLeft;
      document.addEventListener("mousemove", onMove);
      document.addEventListener("mouseup", onUp, { once: true });
    });

    row.addEventListener("mouseleave", onUp);
  })(tabsEl);

  function open(defaultKey = "safe") {
    setActive(defaultKey);
    wrap.classList.add("open");
    host.style.pointerEvents = "auto";
    setTimeout(() => closeBtn.focus(), 0);
  }
  function close() {
    wrap.classList.remove("open");
    host.style.pointerEvents = "none";
  }

  fab.addEventListener("click", () => open());
  overlay.addEventListener("click", close);
  closeBtn.addEventListener("click", close);
  shadow.addEventListener("keydown", (e) => {
    if (e.key === "Escape") close();
  });

  window.devscanHelpSidebar = { open, close, setActive };
})();
