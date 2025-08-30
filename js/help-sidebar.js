// js/devscan-help-sidebar.js
(function () {
  if (window.devscanHelpSidebar) return; // singleton guard

  const TYPES = [
    {
      key: "malicious",
      label: "Malicious",
      color: "#D7263D",
      expl: [
        "Strong indicators of phishing, malware, fraud, or credential theft.",
        "We recommend NOT opening this link.",
        "If you must, use an isolated/throwaway environment.",
      ],
    },
    {
      key: "anomalous",
      label: "Anomalous",
      color: "#FF8C00",
      expl: [
        "Deviates from patterns of typical safe websites.",
        "Not necessarily harmful, but caution is advised.",
        "Only proceed if you trust the source.",
      ],
    },
    {
      key: "safe",
      label: "Safe",
      color: "#34A853",
      expl: [
        "Matches patterns seen in trusted websites.",
        "No suspicious signals were detected.",
        "Still avoid sharing sensitive info you don’t intend to.",
      ],
    },
    {
      key: "scan_failed",
      label: "Failed",
      color: "#6C757D",
      expl: [
        "We couldn’t complete the analysis (site or network error).",
        "Safety is unknown; be extra cautious.",
        "Try again later or verify the site by other means.",
      ],
    },
  ];

  // ---------- host + shadow ----------
  const host = document.createElement("div");
  Object.assign(host.style, {
    position: "fixed",
    inset: "0 0 0 auto",
    zIndex: "2147483646",
    pointerEvents: "none",
  });
  const shadow = host.attachShadow({ mode: "open" });

  // ---------- styles ----------
  const css = document.createElement("style");
  css.textContent = `
    :host { all: initial; }

    /* Size knob for the small Chrome-like FAB */
    .fab { --fab-size: 32px; }

    /* Compact white round help button with '?' */
    .fab {
      position: fixed; right: 16px; bottom: 16px;
      width: var(--fab-size); height: var(--fab-size); min-width: var(--fab-size);
      border-radius: 999px;
      background: #ffffff; color: #111827;
      border: 1px solid rgba(2, 6, 23, .10);
      box-shadow:
        0 6px 18px rgba(2, 6, 23, .20),
        0 1px 0 rgba(255,255,255,.85) inset;
      display: grid; place-items: center;
      cursor: pointer; user-select: none; pointer-events: auto;
      transition: transform .12s ease, box-shadow .12s ease, background .12s ease, border-color .12s ease, filter .12s ease;
    }
    .fab:hover { background:#f8fafc; border-color:rgba(2,6,23,.15); box-shadow:0 8px 22px rgba(2,6,23,.24); transform:translateY(-1px); }
    .fab:active { transform:translateY(0); filter:saturate(.95); }
    .fab:focus-visible { outline:none; box-shadow:0 0 0 4px rgba(59,130,246,.25), 0 6px 18px rgba(2,6,23,.20); }
    .fab-q { font:900 14px/1 Inter, system-ui, Segoe UI, Roboto, Arial, sans-serif; color:#111827; transform:translateY(1px); }

    .wrap { position: fixed; inset: 0; pointer-events: none; }
    .overlay { position: fixed; inset: 0; background: rgba(15,23,42,.25); opacity:0; transition:opacity .18s ease; pointer-events:none; }
    .open .overlay { opacity:.25; pointer-events:auto; }

    .panel {
      position: fixed; top:0; right:0; bottom:0;
      width: 420px; max-width: calc(100vw - 64px);
      background:#ffffff; color:#0f172a;
      transform: translateX(100%);
      transition: transform .22s cubic-bezier(.22,.7,.3,1);
      box-shadow: -18px 0 36px rgba(0,0,0,.25);
      border-top-left-radius:14px; border-bottom-left-radius:14px;
      display:flex; flex-direction:column; overflow:hidden; pointer-events:auto;
      font-family: Inter, system-ui, Segoe UI, Roboto, Arial, sans-serif;
    }
    .open .panel { transform: translateX(0); }

    .head {
      padding:14px 16px;
      background:#ffffff; border-bottom:1px solid #e5e7eb;
      display:grid; grid-template-columns:1fr auto; align-items:center; gap:12px;
    }
    .title { font-weight:900; font-size:14px; text-transform:uppercase; letter-spacing:.35px; color:#0f172a; }
    .sub   { font-weight:600; font-size:12px; color:#6b7280; }
    .close {
      appearance:none; border:0; width:28px; height:28px; border-radius:8px;
      background:#f1f5f9; color:#0f172a; font-weight:800;
      display:grid; place-items:center; cursor:pointer; transition:background .12s ease;
    }
    .close:hover { background:#e2e8f0; }

    .content { padding:14px 16px; overflow:auto; }

    /* Tabs row */
    .tabs {
      display:grid; grid-template-columns: repeat(4, 1fr); gap:10px;
      margin-bottom:12px;
    }
    .tab {
      --accent:#e5e7eb;
      border:1px solid #e5e7eb; border-radius:10px; background:#fff;
      padding:8px 10px 7px; text-align:left; cursor:pointer; user-select:none;
      transition:border-color .12s ease, box-shadow .12s ease, background .12s ease;
    }
    .tab:hover { background:#f8fafc; }
    .tab .label { font-size:13px; color:#111827; font-weight:600; }
    .tab .meter {
      height:4px; width:100%; background:var(--accent); border-radius:999px; margin-bottom:6px; position:relative;
    }
    .tab .meter::after {
      content:""; position:absolute; right:2px; top:50%; transform:translateY(-50%);
      width:8px; height:8px; border-radius:999px; background:#fff; box-shadow:0 0 0 2px var(--accent);
    }
    .tab.active { border-color:var(--accent); box-shadow:0 0 0 2px color-mix(in srgb, var(--accent) 25%, transparent); }
    .tab.active .label { font-weight:800; }

    .tab[data-key="malicious"]  { --accent:#D7263D; }
    .tab[data-key="anomalous"]  { --accent:#FF8C00; }
    .tab[data-key="safe"]       { --accent:#34A853; }
    .tab[data-key="scan_failed"]{ --accent:#6C757D; }

    .section {
      border:1px solid #e5e7eb; border-radius:12px; background:#ffffff;
      padding:14px; box-shadow:0 2px 8px rgba(2,6,23,.05);
    }
    .section h2 { margin:0 0 8px; font-size:16px; font-weight:900; color:#0f172a; }

    /* >>> Full-width accent bar (fits the card) <<< */
    .badges { display:block; margin:6px 0 12px; }
    .badge {
      display:block; position:relative;
      height:8px; width:100%;                      /* <-- stretches across container */
      border-radius:999px; background:var(--accent);
    }
    .badge::after {
      content:""; position:absolute; right:4px; top:50%; transform:translateY(-50%);
      width:12px; height:12px; border-radius:999px; background:#fff; box-shadow:0 0 0 3px var(--accent);
    }

    .desc { font-size:13px; color:#0f172a; line-height:1.5; }
    .desc ul { margin:8px 0 0 18px; }
    .desc li { margin:4px 0; }
  `;
  shadow.appendChild(css);

  // ---------- markup ----------
  const fab = document.createElement("button");
  fab.className = "fab";
  fab.setAttribute("aria-label", "DEVScan help");
  fab.title = "DEVScan help";
  fab.innerHTML = `<span class="fab-q" aria-hidden="true">?</span>`;

  const wrap = document.createElement("div");
  wrap.className = "wrap";
  wrap.innerHTML = `
    <div class="overlay"></div>
    <aside class="panel" role="dialog" aria-modal="true" aria-label="DEVScan Help">
      <header class="head">
        <div>
          <div class="title">DEVScan Help</div>
          <div class="sub">Risk types explained</div>
        </div>
        <button class="close" aria-label="Close">✕</button>
      </header>
      <div class="content">
        <div class="tabs" id="tabs" role="tablist" aria-label="Risk types"></div>
        <section class="section" id="body">
          <h2 id="body-title"></h2>
          <div class="badges"><span class="badge" id="badge"></span></div>
          <div class="desc" id="body-desc"></div>
        </section>
      </div>
    </aside>
  `;

  shadow.appendChild(fab);
  shadow.appendChild(wrap);
  document.documentElement.appendChild(host);

  // ---------- refs ----------
  const overlay = wrap.querySelector(".overlay");
  const closeBtn = wrap.querySelector(".close");
  const tabsEl = wrap.querySelector("#tabs");
  const bodyTitle = wrap.querySelector("#body-title");
  const badge = wrap.querySelector("#badge");
  const bodyDesc = wrap.querySelector("#body-desc");

  // ---------- build tabs ----------
  TYPES.forEach((t, idx) => {
    const b = document.createElement("button");
    b.className = "tab";
    b.dataset.key = t.key;
    b.setAttribute("role", "tab");
    b.setAttribute("aria-selected", idx === 0 ? "true" : "false");
    b.setAttribute("tabindex", idx === 0 ? "0" : "-1");
    b.innerHTML = `<div class="meter"></div><div class="label">${t.label}</div>`;
    tabsEl.appendChild(b);
  });

  function setActive(key) {
    const t = TYPES.find((x) => x.key === key) || TYPES[0];
    tabsEl.querySelectorAll(".tab").forEach((btn) => {
      const active = btn.dataset.key === t.key;
      btn.classList.toggle("active", active);
      btn.setAttribute("aria-selected", active ? "true" : "false");
      btn.tabIndex = active ? 0 : -1;
    });
    bodyTitle.textContent = t.label;
    badge.style.setProperty("--accent", t.color);
    badge.style.background = t.color;
    bodyDesc.innerHTML = `<ul>${t.expl
      .map((l) => `<li>${l}</li>`)
      .join("")}</ul>`;
  }
  setActive(TYPES[0].key);

  // click & keyboard navigation
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

  // open/close
  function open(defaultKey = "safe") {
    setActive(defaultKey);
    wrap.classList.add("open");
    host.style.pointerEvents = "auto";
  }
  function close() {
    wrap.classList.remove("open");
    host.style.pointerEvents = "none";
  }

  // FAB interactions
  fab.addEventListener("click", open);
  overlay.addEventListener("click", close);
  closeBtn.addEventListener("click", close);
  shadow.addEventListener("keydown", (e) => e.key === "Escape" && close());

  // expose API
  window.devscanHelpSidebar = { open, close, setActive };
})();
