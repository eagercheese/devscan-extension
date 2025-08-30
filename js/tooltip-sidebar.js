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

    const pct = fmtPct(d.confidence);
    fields.conf.textContent = pct.text;
    fields.confTxt.textContent = pct.text;
    fields.gauge.style.setProperty("--p", pct.raw);

    fields.explain.textContent = d.description || "";
  }

  function open(details) {
    paint(details || {});
    wrap.classList.add("open");
    host.style.pointerEvents = "auto";
    setTimeout(() => btnClose.focus(), 0);
  }

  function update(details) {
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
