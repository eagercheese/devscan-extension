// js/devscan-help-sidebar.js
(function () {
  // Prevent multiple instances (singleton)
  if (window.devscanHelpSidebar) return;

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
    zIndex: "2147483645", // One level below tooltip sidebar
    pointerEvents: "none",
  });
  const shadow = host.attachShadow({ mode: "open" });

  // Theme colors matching tooltip sidebar
  const themeCSS = `
    .panel[data-theme="safe"]       { --bg:#16a34a; --bg2:#22c55e; --accent:#166534; --ink:#fff; }
    .panel[data-theme="scanning"]   { --bg:#2196f3; --bg2:#42a5f5; --accent:#1976d2; --ink:#fff; }
    .panel[data-theme="anomalous"]  { --bg:#f59e0b; --bg2:#fbbf24; --accent:#b45309; --ink:#fff; }
    .panel[data-theme="malicious"]  { --bg:#dc2626; --bg2:#ef4444; --accent:#991b1b; --ink:#fff; }
    .panel[data-theme="scan_failed"]{ --bg:#6b7280; --bg2:#9ca3af; --accent:#374151; --ink:#fff; }
  `;

  // ----- styles matching tooltip sidebar -----
  const css = document.createElement("style");
  css.textContent = `
  ${themeCSS}

  /* Floating help button (keeps size/position) */
  .fab { --fab-size: 32px; }
  .fab{
    position: fixed; right: 16px; bottom: 16px;
    width: var(--fab-size); height: var(--fab-size); min-width: var(--fab-size);
    border-radius: 999px;
    background: linear-gradient(180deg, #1f2937, #0b1220);
    color: #e5f0ff;
    border: 1px solid rgba(148,163,184,.28);
    box-shadow:
      0 10px 26px rgba(2,6,23,.45),
      0 0 0 2px rgba(96,165,250,.18),
      0 0 22px rgba(59,130,246,.25);
    display: grid; place-items: center; cursor: pointer; user-select: none; pointer-events: auto;
    transition: transform .12s ease, box-shadow .12s ease, filter .12s ease, background .12s ease;
  }
  .fab:hover{
    transform: translateY(-1px);
    box-shadow:
      0 14px 30px rgba(2,6,23,.55),
      0 0 0 2px rgba(147,197,253,.28),
      0 0 28px rgba(96,165,250,.35);
  }
  .fab:active{ transform: translateY(0); filter: brightness(.96); }
  .fab:focus-visible{ outline: none; box-shadow: 0 0 0 4px rgba(59,130,246,.35); }
  .fab-q{
    font: 900 14px/1 Inter, system-ui, Segoe UI, Roboto, Arial, sans-serif;
    color: #93c5fd;
    text-shadow: 0 0 10px rgba(96,165,250,.45);
    transform: translateY(1px);
  }

  .wrap { position: fixed; inset: 0; pointer-events: none; }
  .overlay {
    position: fixed; inset: 0;
    background: rgba(2,6,23,.45);
    opacity: 0; transition: opacity .18s ease;
    pointer-events: none;
  }
  .open .overlay { opacity: 0; pointer-events: auto; }

  /* Panel container — dark glass + soft blue glow (keeps sizing) */
  .panel {
    position: fixed; top: 0; right: 0; bottom: 0;
    width: 460px; max-width: calc(100vw - 80px);
    background: linear-gradient(180deg, rgba(16,20,29,.96), rgba(16,20,29,.92));
    color: #e5e7eb;
    transform: translateX(100%);
    transition: transform .22s cubic-bezier(.22,.7,.3,1);
    box-shadow: -18px 0 36px rgba(0,0,0,.45);
    display: flex; flex-direction: column;
    font-family: Inter, system-ui, -apple-system, "Segoe UI", Arial, sans-serif;
    -webkit-font-smoothing: antialiased; moz-osx-font-smoothing: grayscale;
    border-top-left-radius: 14px; border-bottom-left-radius: 14px;
    font-size: 20px;
    pointer-events: none;
    border-left: 1px solid rgba(148,163,184,.22);
    max-height: 100vh;
    overflow: hidden;
  }
  .open .panel { transform: translateX(0); pointer-events: auto; }

  /* Header — gradient by theme + glow */
  .head {
    background: linear-gradient(90deg, var(--bg), var(--bg2));
    color: var(--ink);
    padding: 16px;
    display: grid; grid-template-columns: 1fr auto; gap: 12px; align-items: center;
    border-top-left-radius: 14px;
    box-shadow:
      inset 0 -1px 0 rgba(255,255,255,.12),
      0 6px 18px rgba(0,0,0,.25);
    flex-shrink: 0;
  }
  .badge { display:flex; flex-direction:column; line-height:1.15; }
  .badge .label  { font-weight: 900; letter-spacing: .4px; font-size: 22px; text-transform: uppercase; margin-bottom: 2px; }
  .badge .sub    { font-weight: 600; font-size: 16px; opacity: .98; }

  .close {
    appearance: none; border: 0; width: 30px; height: 30px; border-radius: 8px;
    background: rgba(255,255,255,.18); color: var(--ink);
    cursor: pointer; display:grid; place-items:center;
    box-shadow: inset 0 0 0 1px rgba(255,255,255,.22);
  }
  .close:hover { background: rgba(255,255,255,.26); }
  .close:active { transform: scale(.97); }
  .close::before { content: "✕"; font-weight: 800; font-size: 14px; }

  /* Scroll region */
  .scroller{ flex:1; overflow-y:auto; display:flex; flex-direction:column; }

  /* Tabs — pill chips with theme accents; keep scrollable */
  .tabs{
    display:flex; gap:8px; padding: 14px 16px;
    background: rgba(11,17,27,.6);
    border-bottom: 1px solid rgba(148,163,184,.18);
    flex-shrink:0; overflow-x:auto; overflow-y:hidden;
    scroll-behavior:smooth; -webkit-overflow-scrolling:touch;
  }
  .tabs::-webkit-scrollbar{ height:4px; }
  .tabs::-webkit-scrollbar-track{ background: rgba(148,163,184,.12); border-radius:4px; }
  .tabs::-webkit-scrollbar-thumb{ background: rgba(148,163,184,.35); border-radius:4px; }

  .tab{
    padding: 8px 14px;
    border: 1px solid rgba(148,163,184,.28);
    border-radius: 999px;
    background: rgba(17,24,39,.65);
    color: #cbd5e1;
    cursor: pointer; transition: all .12s ease;
    font-size: 16px; font-weight: 800; text-transform: uppercase; letter-spacing: .4px;
    white-space: nowrap; flex-shrink: 0; min-width: fit-content;
    box-shadow: 0 0 0 1px rgba(2,6,23,.25) inset;
  }
  .tab:hover{
    background: rgba(17,24,39,.8);
    border-color: rgba(147,197,253,.45);
    color: #e5f0ff;
  }
  .tab.active{
    color:#0b1220; background: var(--bgColor); border-color: var(--accent);
    box-shadow:
      0 0 0 1px rgba(255,255,255,.7) inset,
      0 0 18px color-mix(in srgb, var(--accent) 35%, transparent);
  }
  .tab[data-key="safe"] { --accent:#16a34a; --bgColor:#dcfce7; }
  .tab[data-key="scanning"] { --accent:#2196f3; --bgColor:#dbeafe; }
  .tab[data-key="anomalous"] { --accent:#f59e0b; --bgColor:#fef3c7; }
  .tab[data-key="malicious"] { --accent:#dc2626; --bgColor:#fee2e2; }
  .tab[data-key="scan_failed"] { --accent:#6b7280; --bgColor:#f3f4f6; }
  /* tint inactive text with the accent */
  .tab[data-key="safe"]:not(.active){ color:#86efac; }
  .tab[data-key="scanning"]:not(.active){ color:#93c5fd; }
  .tab[data-key="anomalous"]:not(.active){ color:#fde68a; }
  .tab[data-key="malicious"]:not(.active){ color:#fca5a5; }
  .tab[data-key="scan_failed"]:not(.active){ color:#cbd5e1; }

  /* Content area */
  .content{ padding: 18px; flex:1; }

  .meaning-box{
    background: linear-gradient(180deg, rgba(14,23,38,.85), rgba(14,23,38,.75));
    border: 1px solid rgba(148,163,184,.28);
    border-radius: 12px;
    padding: 16px;
    margin-bottom: 18px;
    box-shadow:
      inset 0 0 12px rgba(59,130,246,.12),
      0 0 18px rgba(59,130,246,.12);
  }
  .meaning-title{
    font-size: 20px; font-weight: 900; color: var(--accent);
    text-transform: uppercase; letter-spacing: .5px; margin-bottom: 6px;
    text-shadow: 0 0 10px color-mix(in srgb, var(--accent) 35%, transparent);
  }
  .meaning-text{ font-size: 18px; color:#d1d5db; line-height: 1.5; font-weight: 600; }

  .explanation{
    background: rgba(10,16,28,.7);
    border: 1px solid rgba(148,163,184,.22);
    border-left: 4px solid var(--accent);
    border-radius: 12px;
    padding: 14px;
    box-shadow: inset 0 0 10px rgba(59,130,246,.10);
  }
  .explanation ul{ list-style:none; padding:0; margin:0; }
  .explanation li{
    margin-bottom: 12px; padding: 12px;
    background: rgba(17,24,39,.85);
    border-radius: 10px;
    border: 1px solid rgba(148,163,184,.22);
    font-size: 18px; line-height: 1.6; color:#e5e7eb;
  }
  .explanation li:last-child{ margin-bottom: 0; }
  .explanation strong{ color: var(--accent); }
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

    // Update panel theme
    panel.setAttribute("data-theme", t.key);

    // Update tabs
    tabsEl.querySelectorAll(".tab").forEach((btn) => {
      const active = btn.dataset.key === t.key;
      btn.classList.toggle("active", active);
      btn.setAttribute("aria-selected", active ? "true" : "false");
      btn.tabIndex = active ? 0 : -1;
    });

    // Update content
    meaningTitle.textContent = `${t.label} - Definition`;
    meaningText.textContent = t.meaning;

    // Update meaning box colors
    meaningBox.style.setProperty("--accent", t.color);
    meaningBox.style.setProperty("--bgColor", t.bgColor);
    explanation.style.setProperty("--accent", t.color);

    // Update explanation list
    explanationList.innerHTML = t.expl
      .map((item) => `<li>${item}</li>`)
      .join("");
  }

  setActive(TYPES[0].key);

  // ----- interactions -----
  tabsEl.addEventListener("click", (e) => {
    const btn = e.target.closest(".tab");
    if (!btn) return;
    setActive(btn.dataset.key);
    btn.focus();
  });

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
  console.log(
    "[DEVScan Help] Sidebar loaded successfully! Button should be visible."
  );
})();
