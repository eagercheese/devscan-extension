const iconUrls = {
  danger: chrome.runtime.getURL("css/picture/caution_mark_red.png"),
  warning: chrome.runtime.getURL("css/picture/caution_exclamation.png"),
  safe: chrome.runtime.getURL("css/picture/caution_mark_green.png"),
  failed: chrome.runtime.getURL("css/picture/exclamationMark.png"),
};

(function () {
  const host = document.createElement("div");
  host.id = "devscan-tooltip-host";
  Object.assign(host.style, {
    position: "fixed",
    zIndex: "9999",
    top: "0",
    left: "0",
    pointerEvents: "none",
  });

  const shadow = host.attachShadow({ mode: "open" });

  const tooltip = document.createElement("div");
  tooltip.id = "devscan-tooltip";
  tooltip.style.display = "none";

  shadow.appendChild(tooltip);
  document.body.appendChild(host);

  const styles = {
    danger: {
      label: "WARNING!",
      subtext: "Malicious Link Detected",
      mainTitle: "HIGH RISK",
      description:
        "This page has been identified as containing malicious content with a high probability of phishing or harmful behavior. Continuing may compromise your security.",
      background: "#b80f0a",
      titleColor: "#b80f0a",
    },
    warning: {
      label: "CAUTION",
      subtext: "Anomaly Detected",
      mainTitle: "POSSIBLE RISK",
      description:
        "This page may exhibit suspicious traits or behaviors that resemble phishing or malware activity. It is recommended to proceed with caution.",
      background: "#f4b400",
      titleColor: "#e2960a",
    },
    safe: {
      label: "SAFE",
      subtext: "AI-Verified Safe",
      mainTitle: "SAFE TO PROCEED",
      description:
        "Our security analysis found no suspicious or harmful activity. The page appears to be safe for viewing or interaction.",
      background: "#34a853",
      titleColor: "#1e7e34",
    },
    failed: {
      label: "SCAN FAILED",
      subtext: "Unable to Analyze",
      mainTitle: "ANALYSIS INCOMPLETE",
      description:
        "We were unable to complete the security analysis for this link. This could be due to network issues or server problems. Proceed with caution.",
      background: "#6c757d",
      titleColor: "#495057",
    },
  };

  const baseCSS = document.createElement("style");
  baseCSS.textContent = `
    #devscan-tooltip {
      position: fixed;
      border-radius: 18px;
      max-width: 420px;
      min-width: 380px;
      box-shadow: 0 6px 18px rgba(0, 0, 0, 0.3);
      font-family: 'Open Sans', sans-serif;
      font-size: 14px;
      text-align: justify;
      overflow: hidden;
      pointer-events: none;
    }
    .tooltip-wrapper {
      padding: 16px 20px;
      color: white;
    }
    .tooltip-header {
      display: flex;
      justify-content: space-between;
      align-items: center;
    }
    .tooltip-label {
      font-size: 18px;
      font-weight: 600;
      text-transform: uppercase;
    }
    .tooltip-subtext {
      font-weight: bold;
      font-size: 14px;
    }
    .tooltip-icon {
      width: 28px;
      height: 28px;
    }
    .tooltip-body {
      margin-top: 16px;
      position: relative;
      border-radius: 12px;
      padding: 30px 20px;
      background-color: #fff;
      color: black;
      overflow: hidden;
      min-height: 130px;
      background-position: bottom right;
      background-repeat: no-repeat;
      background-size: contain;
      z-index: 1;
    }
    .tooltip-body::before {
      content: "";
      position: absolute;
      inset: 0;
      background: rgba(255, 255, 255, 0.75); /* Soft white layer for better readability */
      z-index: 0;
    }
    .tooltip-title,
    .tooltip-description,
    .tooltip-link {
      position: relative;
      z-index: 1;
    }
    .tooltip-title {
      font-size: 22px;
      font-weight: bold;
      font-family: 'Lato', sans-serif;
      text-shadow: 0px 1px 2px rgba(0,0,0,0.4);
    }
    .tooltip-description {
      margin-top: 6px;
      line-height: 1.5;
      font-size: 15px;
      text-shadow: 0px 1px 2px rgba(0,0,0,0.3);
    }
    .tooltip-link {
      margin-top: 10px;
      font-size: 12px;
      word-break: break-word;
      text-shadow: 0px 1px 2px rgba(0,0,0,0.3);
    }
  `;
  shadow.appendChild(baseCSS);

  window.attachRiskTooltip = function (link, level = "safe") {
    if (!link) return;
    const risk = styles[level] || styles.safe;

    chrome.storage.sync.get("showWarningsOnly", ({ showWarningsOnly }) => {
      const underlineEnabled = showWarningsOnly ?? true;

      if (underlineEnabled) {
        link.style.textDecoration = "underline";
        link.style.textDecorationColor = risk.titleColor;
        link.style.textUnderlineOffset = "2px";
        link.style.cursor = "pointer";
      } else {
        link.style.textDecoration = "none";
        link.style.textDecorationColor = "";
      }

      if (link.dataset.tooltipBound === "true") return;
      link.dataset.tooltipBound = "true";

      link.addEventListener("mouseenter", () => {
        tooltip.style.display = "block";
        tooltip.style.background = risk.background;
        tooltip.innerHTML = `
          <div class="tooltip-wrapper">
            <div class="tooltip-header">
              <div>
                <div class="tooltip-label">${risk.label}</div>
                <div class="tooltip-subtext">${risk.subtext}</div>
              </div>
              <img src="${chrome.runtime.getURL(
                "css/picture/exclamationMark.png"
              )}" alt="!" class="tooltip-icon" />
            </div>
            <div class="tooltip-body" style="background-image: url('${
              iconUrls[level]
            }');">
              <div class="tooltip-title" style="color: ${risk.titleColor};">${
          risk.mainTitle
        }</div>
              <div class="tooltip-description">${risk.description}</div>
              <div class="tooltip-link"><strong style="color: ${
                risk.titleColor
              };">${link.href}</strong></div>
            </div>
          </div>
        `;
      });

      link.addEventListener("mousemove", (e) => {
        const padding = 10;
        const tooltipWidth = tooltip.offsetWidth;

        let left = e.clientX + 20;
        let top = e.clientY - 40;

        if (left + tooltipWidth > window.innerWidth - padding) {
          left = window.innerWidth - tooltipWidth - padding;
        }
        if (top < padding) {
          top = e.clientY + 20;
        }

        host.style.left = `${left}px`;
        host.style.top = `${top}px`;
      });

      link.addEventListener("mouseleave", () => {
        tooltip.style.display = "none";
      });
    });
  };
})();
