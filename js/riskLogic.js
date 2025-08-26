// riskLogic.js
window.determineRisk = function (url) {
  if (!url) return "safe";

  const lowered = url.toLowerCase();

  // Fallback local analysis for immediate feedback
  if (lowered.includes("phishing")) return "danger";
  if (lowered.includes("warning") || lowered.includes("risky"))
    return "warning";

  return "safe";
};

// Map server verdicts to risk levels
window.mapServerVerdict = function(verdict) {
  switch(verdict?.toLowerCase()) {
    case "malicious":
    case "phishing":
    case "dangerous":
      return "malicious";
    case "anomalous":
    case "suspicious":
    case "warning":
      return "anomalous";
    case "safe":
    case "benign":
    case "clean":
      return "safe";
    case "failed":
    case "error":
    case "timeout":
      return "failed";
    default:
      return "safe";
  }
};
