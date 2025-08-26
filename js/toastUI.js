window.showToast = function (message, type = "info") {
  const existing = document.getElementById("devscan-toast");
  if (existing) existing.remove();

  const toast = document.createElement("div");
  toast.id = "devscan-toast";
  toast.textContent = message;

  // Colors based on type
  const backgroundColors = {
    info: "#2c3e50", // Dark blue-gray
    success: "#27ae60", // Green
    error: "#e74c3c", // Red
    warning: "#f39c12", // Yellow-orange
  };

  Object.assign(toast.style, {
    position: "fixed",
    top: "24px",
    left: "50%",
    transform: "translateX(-50%)",
    background: backgroundColors[type] || backgroundColors.info,
    color: "#fff",
    padding: "12px 20px",
    borderRadius: "10px",
    zIndex: 999999,
    fontFamily: "Segoe UI, Roboto, Arial, sans-serif",
    fontSize: "15px",
    fontWeight: "500",
    boxShadow: "0 8px 20px rgba(0, 0, 0, 0.25)",
    opacity: "0",
    transition: "opacity 0.4s ease-in-out",
  });

  document.body.appendChild(toast);

  // Trigger fade-in
  requestAnimationFrame(() => {
    toast.style.opacity = "1";
  });

  // Fade out and remove
  setTimeout(() => {
    toast.style.opacity = "0";
    setTimeout(() => toast.remove(), 400);
  }, 2200);
};

window.initToastsHost = function () {};
