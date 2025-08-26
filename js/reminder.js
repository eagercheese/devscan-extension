function initReminderPopup() {
  chrome.storage.sync.get(
    ["enableBlocking", "showWarningsOnly", "strictMaliciousBlocking", "suppressReminder"],
    (data) => {
      const { enableBlocking, showWarningsOnly, strictMaliciousBlocking, suppressReminder } = data;

      const isBlockingOff = enableBlocking === false;
      const isHighlightOff = showWarningsOnly === false;
      const isStrictBlockingOff = strictMaliciousBlocking === false;
      const isSuppressed = suppressReminder === true;

      if ((isBlockingOff || isHighlightOff || isStrictBlockingOff) && !isSuppressed) {
        const shadowHost = document.createElement("div");
        shadowHost.id = "reminder-shadow-root";
        document.body.appendChild(shadowHost);

        const shadow = shadowHost.attachShadow({ mode: "open" });

        let message = "Please enable ";
        const disabledFeatures = [];
        
        if (isBlockingOff) {
          disabledFeatures.push("<b>Page Blocking</b>");
        }
        if (isHighlightOff) {
          disabledFeatures.push("<b>Link Highlighting</b>");
        }
        if (isStrictBlockingOff) {
          disabledFeatures.push("<b>Block Malicious Links Completely</b>");
        }

        if (disabledFeatures.length === 1) {
          message += disabledFeatures[0];
        } else if (disabledFeatures.length === 2) {
          message += disabledFeatures[0] + " and " + disabledFeatures[1];
        } else if (disabledFeatures.length === 3) {
          message += disabledFeatures[0] + ", " + disabledFeatures[1] + ", and " + disabledFeatures[2];
        }
        
        message += " to ensure full protection.";

        shadow.innerHTML = `
          <style>
            .reminder-container {
              position: fixed;
              top: 50%;
              left: 50%;
              transform: translate(-50%, -50%);
              background: linear-gradient(to bottom right, #ffffff, #f8f8f8);
              border: 4px solid #b30000;
              padding: 30px 36px;
              box-shadow: 0 8px 20px rgba(0, 0, 0, 0.3);
              z-index: 999999;
              font-family: 'Segoe UI', sans-serif;
              width: 500px;
              border-radius: 20px;
              animation: fadeIn 0.4s ease-in-out;
            }

            .reminder-container h4 {
              margin: 0 0 20px 0;
              color: #b30000;
              font-size: 24px;
              font-weight: bold;
              text-align: center;
            }

            .reminder-container p {
              margin: 0 0 20px 0;
              font-size: 16px;
              line-height: 1.6;
              color: #000;
              text-align: center;
            }

            .reminder-container label {
              font-size: 15px;
              display: flex;
              align-items: center;
              margin-top: 20px;
              color: #111;
            }

            .reminder-container input[type="checkbox"] {
              margin-right: 10px;
              transform: scale(1.2);
            }

            .reminder-close-btn {
              font-size: 15px;
              font-weight: bold;
              padding: 8px 16px;
              margin-top: 24px;
              background: white;
              border: 2px solid #b30000;
              color: #000;
              border-radius: 12px;
              cursor: pointer;
              float: right;
              transition: all 0.2s ease;
            }

            .reminder-close-btn:hover {
              background: #b30000;
              color: white;
            }

            @keyframes fadeIn {
              from { opacity: 0; transform: translate(-50%, -60%); }
              to { opacity: 1; transform: translate(-50%, -50%); }
            }
          </style>

          <div class="reminder-container">
            <h4>PROTECTION OPTIONS ARE DISABLED</h4>
            <p id="reminder-msg"></p>
            <label><input type="checkbox" id="dont-remind-again"> Don’t remind me again</label>
            <button class="reminder-close-btn" id="close-reminder">CLOSE</button>
          </div>
        `;

        shadow.querySelector("#reminder-msg").innerHTML = message;

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
