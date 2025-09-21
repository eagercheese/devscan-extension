function initReminderPopup() {
  chrome.storage.sync.get(
    [
      "enableBlocking",
      "showWarningsOnly",
      "strictMaliciousBlocking",
      "suppressReminder",
    ],
    (data) => {
      const {
        enableBlocking,
        showWarningsOnly,
        strictMaliciousBlocking,
        suppressReminder,
      } = data;

      const isBlockingOff = enableBlocking === false;
      const isHighlightOff = showWarningsOnly === false;
      const isStrictBlockingOff = strictMaliciousBlocking === false;
      const isSuppressed = suppressReminder === true;

      if (
        (isBlockingOff || isHighlightOff || isStrictBlockingOff) &&
        !isSuppressed
      ) {
        const shadowHost = document.createElement("div");
        shadowHost.id = "reminder-shadow-root";
        document.body.appendChild(shadowHost);

        const shadow = shadowHost.attachShadow({ mode: "open" });

        // Build a BULLET LIST (instead of a sentence)
        const items = [];
        if (isBlockingOff)
          items.push("<li><span class='pill'>Page Blocking</span></li>");
        if (isHighlightOff)
          items.push("<li><span class='pill'>Link Highlighting</span></li>");
        if (isStrictBlockingOff)
          items.push(
            "<li><span class='pill'>Block Malicious Links Completely</span></li>"
          );

        shadow.innerHTML = `
          <style>
            :host { all: initial; }

            /* Neutral backdrop: no red glow */
            .backdrop{
              position: fixed; inset: 0;
              background: rgba(2, 6, 23, 0.55);  /* soft, neutral dim */
              backdrop-filter: blur(6px);
              -webkit-backdrop-filter: blur(6px);
              z-index: 999998;
            }

            .reminder-container{
              position: fixed; top: 50%; left: 50%;
              transform: translate(-50%, -50%);
              width: min(640px, 92vw);
              z-index: 999999;

              /* dark glass */
              background: rgba(23, 26, 34, 0.96);
              color: #fef2f2;
              border: 1px solid rgba(239, 68, 68, 0.35);
              border-radius: 20px;
              box-shadow: 0 12px 28px rgba(0,0,0,0.45); /* reduced overall glow */
              -webkit-backdrop-filter: blur(8px);
              backdrop-filter: blur(8px);

              padding: 24px 26px 20px;
              font-family: 'Montserrat', system-ui, -apple-system, 'Segoe UI', Roboto, Arial, sans-serif;
              animation: cardIn .28s cubic-bezier(.22,.7,.3,1);
            }

            /* Header: keep urgency, lower glow */
            .reminder-head{
              display: grid; grid-template-columns: auto 1fr; align-items: center; gap: 12px;
              padding: 14px 16px; margin: -6px -6px 18px; border-radius: 16px;
              background: linear-gradient(90deg, #dc2626, #ef4444);
              color: #fff;
              box-shadow: inset 0 0 0 1px rgba(255,255,255,.18); /* no pulsing */
            }
            .reminder-icon{
              width: 36px; height: 36px; border-radius: 10px;
              display: grid; place-items: center;
              background: rgba(255,255,255,.92); color: #dc2626;
              font-weight: 900; font-size: 18px;
              box-shadow: 0 0 8px rgba(239,68,68,0.35); /* toned down */
            }
            .reminder-title{ margin: 0; font-size: 20px; font-weight: 900; letter-spacing: .5px; text-transform: uppercase; }
            .reminder-sub{ margin: 2px 0 0 0; font-size: 16px; font-weight: 700; opacity: .95; }

            .reminder-body{ padding: 2px 6px 0; font-size: 16px; line-height: 1.65; }
            /* Lead sentence pure white */
            .lead { color: #ffffff; margin: 0 0 10px 0; font-weight: 700; }

            /* Bulleted list */
            #reminder-list{ margin: 0; padding-left: 22px; }
            #reminder-list li{
              margin: 8px 0;
              list-style: none;
            }

            /* Attention pill for disabled features */
            .pill{
              display: inline-flex; align-items: center; gap: 8px;
              padding: 6px 10px;
              border-radius: 999px;
              background: rgba(239, 68, 68, 0.12);
              border: 1px solid rgba(239, 68, 68, 0.55);
              color: white;
              font-weight: 900;
              letter-spacing: .2px;
              box-shadow: inset 0 0 10px rgba(239,68,68,0.12);
              white-space: nowrap;
            }
            .pill::before{
              content: "";
              width: 8px; height: 8px; border-radius: 999px;
              background: #ef4444;
              box-shadow: 0 0 8px rgba(239,68,68,.6);
            }

            .reminder-row{
              display: flex; align-items: center; gap: 10px;
              margin-top: 16px; padding: 10px;
              border: 1px solid rgba(148,163,184,0.25);
              border-radius: 12px;
              background: rgba(15, 23, 42, 0.35);
              color: #e5e7eb;
            }
            .reminder-row input[type="checkbox"]{
              width: 18px; height: 18px; accent-color: #dc2626; cursor: pointer; flex-shrink: 0;
            }
            .reminder-row label{ display: inline-flex; align-items: center; gap: 10px; font-size: 16px; cursor: pointer; margin: 0; }

            .reminder-actions{ display: flex; justify-content: flex-end; gap: 10px; margin-top: 18px; padding: 0 6px 4px; }
            .reminder-close-btn{
              font-size: 14px; font-weight: 800; padding: 10px 18px;
              background: #dc2626; color: #fff; border-radius: 12px; border: none; cursor: pointer;
              transition: transform .15s ease, box-shadow .2s ease, background-color .2s ease;
              box-shadow: 0 6px 16px rgba(239,68,68,.35); /* reduced */
            }
            .reminder-close-btn:hover{ background: #b91c1c; transform: translateY(-1px); box-shadow: 0 10px 22px rgba(239,68,68,.45); }

            @keyframes cardIn{
              from{ opacity: 0; transform: translate(-50%, calc(-50% - 14px)) scale(.96); }
              to  { opacity: 1; transform: translate(-50%, -50%) scale(1); }
            }
          </style>

          <div class="backdrop"></div>

          <div class="reminder-container">
            <div class="reminder-head">
              <div class="reminder-icon">!</div>
              <div>
                <h4 class="reminder-title">Protection Disabled</h4>
                <div class="reminder-sub">Some safety features are OFF</div>
              </div>
            </div>

            <div class="reminder-body">
              <p class="lead">Please enable the following to ensure full protection.</p>
              <ul id="reminder-list"></ul>
            </div>

            <div class="reminder-row">
              <label for="dont-remind-again">
                <input type="checkbox" id="dont-remind-again">
                Don’t remind me again
              </label>
            </div>

            <div class="reminder-actions">
              <button class="reminder-close-btn" id="close-reminder">Close</button>
            </div>
          </div>
        `;

        // Inject the bullet list
        shadow.querySelector("#reminder-list").innerHTML = items.join("");

        shadow
          .getElementById("close-reminder")
          .addEventListener("click", () => {
            if (shadow.getElementById("dont-remind-again").checked) {
              chrome.storage.sync.set({ suppressReminder: true });
            }
            shadowHost.remove();
          });
      }
    }
  );
}

// Trigger logic: immediately if DOM is ready, otherwise wait
if (
  document.readyState === "complete" ||
  document.readyState === "interactive"
) {
  initReminderPopup();
} else {
  window.addEventListener("DOMContentLoaded", initReminderPopup);
}
