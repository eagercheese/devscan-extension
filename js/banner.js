function showBanner(timeoutMs = 5000) {
  // Prevent duplicates
  if (document.getElementById("devscan-banner-host")) return;

  // Host for shadow DOM
  const host = document.createElement("div");
  host.id = "devscan-banner-host";
  Object.assign(host.style, {
    position: "fixed",
    top: "20px",
    right: "20px",
    zIndex: "2147483646",
    pointerEvents: "none",
  });
  const shadow = host.attachShadow({ mode: "open" });
  document.body.appendChild(host);

  // Shadow DOM HTML + CSS
  shadow.innerHTML = `
    <style>
      :host { all: initial; }

      @keyframes dsSlideIn {
        from { transform: translateX(calc(100% + 20px)); opacity: 0; }
        to   { transform: translateX(0); opacity: 1; }
      }
      @keyframes dsSlideOut {
        from { transform: translateX(0); opacity: 1; }
        to   { transform: translateX(calc(100% + 20px)); opacity: 0; }
      }

      .banner {
        pointer-events: auto;
        display: grid;
        grid-template-columns: 8px 1fr auto;
        align-items: start;
        gap: 16px;

        width: clamp(400px, 60vw, 700px);
        padding: 20px 24px;

        background: rgba(23, 26, 34, 0.96);
        color: #f1f5f9;
        border: 1px solid rgba(148,163,184,0.28);
        border-radius: 16px;

        box-shadow:
          0 16px 36px rgba(0,0,0,0.55),
          0 0 20px rgba(96,165,250,0.3);
        -webkit-backdrop-filter: blur(10px);
        backdrop-filter: blur(10px);

        font-family: 'Montserrat', system-ui, -apple-system, 'Segoe UI', Roboto, Arial, sans-serif;
        animation: dsSlideIn .32s cubic-bezier(.22,.7,.3,1) forwards;
      }

      /* Accent rail */
      .rail {
        width: 8px;
        height: 100%;
        border-radius: 10px;
        background: linear-gradient(180deg, #3b82f6, rgba(96,165,250,0.25));
        box-shadow: 0 0 12px rgba(96,165,250,0.4);
      }

      .content {
        display: flex;
        flex-direction: column;
        gap: 6px;
      }

      .title {
        margin: 0;
        font-size: 24px;
        font-weight: 900;
        letter-spacing: .4px;
        color: #60a5fa;
        text-shadow: 0 0 6px rgba(96,165,250,0.35);
      }

      .desc {
        margin: 0;
        font-size: 20px;
        line-height: 1.6;
        color: #d1d5db;
      }

      .close {
        appearance: none;
        border: 0;
        cursor: pointer;
        width: 34px;
        height: 34px;
        border-radius: 10px;
        background: rgba(255,255,255,0.1);
        color: #f1f5f9;
        font-size: 20px;
        font-weight: 700;
        display: grid;
        place-items: center;
        box-shadow: inset 0 0 0 1px rgba(255,255,255,0.15);
        transition: background .15s ease, transform .12s ease, box-shadow .15s ease;
      }
      .close:hover {
        background: rgba(255,255,255,0.18);
        box-shadow: inset 0 0 0 1px rgba(255,255,255,0.25);
        transform: translateY(-1px);
      }
      .close:active { transform: translateY(0); }

      .slide-out { animation: dsSlideOut .28s ease-in forwards; }
    </style>

    <div class="banner" role="alert" aria-labelledby="ds-banner-title" aria-describedby="ds-banner-desc">
      <div class="rail"></div>

      <div class="content">
        <h3 class="title" id="ds-banner-title">DEVScan Notice</h3>
        <p class="desc" id="ds-banner-desc">
          DEVScan will automatically skip scanning links with the same domain as the current site.
        </p>
      </div>

      <button class="close" aria-label="Close notification">✕</button>
    </div>
  `;

  const root = shadow.querySelector(".banner");
  const btnClose = shadow.querySelector(".close");

  const dismiss = () => {
    root.classList.add("slide-out");
    setTimeout(() => {
      if (host && host.parentNode) host.parentNode.removeChild(host);
    }, 300);
  };

  btnClose.addEventListener("click", dismiss);

  // Auto-hide after timeout
  setTimeout(dismiss, timeoutMs);
}
