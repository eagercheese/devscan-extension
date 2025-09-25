function showBanner(timeoutMs = 5000) {
  // Prevent duplicates
  if (document.getElementById("devscan-banner")) return;

  const banner = document.createElement("div");
  banner.id = "devscan-banner";
  banner.innerHTML = `
    <div class="banner-content" role="alert" aria-labelledby="sf-title" aria-describedby="sf-desc">
      <div class="banner-header">
        <div class="banner-icon" aria-hidden="true">
          <svg viewBox="0 0 24 24" width="20" height="20" fill="currentColor">
            <path d="M12 2l10 18H2L12 2zm1 13h-2v2h2v-2zm0-6h-2v5h2V9z"/>
          </svg>
        </div>
        <h3 id="banner-title">DEVScan Notice</h3>
      </div>

      <p id="banner-desc"> DEVScan will automatically skip scanning links with the same domain as the current site.</p>
    </div>
  `;

  // Position & base style
  banner.style.cssText = `
    position: fixed;
    top: 10px;
    right: 0;
    height: auto;
    width: clamp(340px, 50%, 550px);
    background: #171a22;
    border-left: 2px solid #3b82f6;
    box-shadow: -4px 0 16px rgba(0,0,0,0.45);
    z-index: 2147483646;
    display: flex;
    flex-direction: column;
    transform: translateX(100%);
    animation: SlideIn 0.4s ease-out forwards;
    font-family: 'Montserrat', system-ui, -apple-system, 'Segoe UI', Roboto, Arial, sans-serif;
  `;

  const style = document.createElement("style");
  style.textContent = `
    .banner-content {
      padding: 20px;
      color: #e5f0ff;
      flex: 1;
      display: flex;
      flex-direction: column;
    }

    .banner-header {
      display: flex;
      align-items: center;
      gap: 10px;
      margin-bottom: 10px;
    }
    .banner-icon {
      width: 28px;
      height: 28px;
      display: grid;
      place-items: center;
      color: #93c5fd;
      background: rgba(59,130,246,0.12);
      border: 1px solid rgba(148,187,255,0.35);
      border-radius: 999px;
    }
    .banner-header h3 {
      margin: 0;
      font-size: 20px;
      font-weight: 700;
      color: #60a5fa;
    }

    .banner-content p {
      margin: 8px 0;
      font-size: 15px;
      line-height: 1.5;
      color: #cbd5e1;
    }

    @keyframes SlideIn {
      from { transform: translateX(100%); }
      to   { transform: translateX(0); }
    }

    @keyframes SlideOut {
      from { transform: translateX(0); }
      to   { transform: translateX(100%); }
    }
  `;

  document.head.appendChild(style);
  document.body.appendChild(banner);

  // 🔹 Auto-hide after timeout
  setTimeout(() => {
    banner.style.animation = "SlideOut 0.4s ease-in forwards";
    setTimeout(() => banner.remove(), 400); 
  }, timeoutMs);
}
