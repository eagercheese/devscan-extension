// Popup script

// This script manages the popup UI state (analyzing, result, etc.
document.addEventListener('DOMContentLoaded', () => {
  // Show analyzing state by default
  document.getElementById('analyzing-state').style.display = 'block';
  document.getElementById('result-state').style.display = 'none';

  // Example: Simulate verdict update after 2 seconds (replace with real API call)
  setTimeout(() => {
    showResult({ verdict: 'benign' });
  }, 2000);
});

function showResult({ verdict }) {
  const resultState = document.getElementById('result-state');
  let html = '';
  if (verdict === 'malicious') {
    html = `<div class="popup-card" style="background:#f44336;color:#fff;border-left:6px solid #b71c1c;">
      <div class="popup-header"><span class="popup-icon">&#9888;</span><span class="popup-title">WARNING!</span></div>
      <div class="popup-status">Malicious Link Detected</div>
      <div class="popup-message"><b>HIGH RISK</b><br>This page has been identified as containing malicious content with a high probability of phishing or harmful behavior. Continuing may compromise your security.</div>
    </div>`;
  } else if (verdict === 'anomaly') {
    html = `<div class="popup-card" style="background:#ffc107;color:#333;border-left:6px solid #ff9800;">
      <div class="popup-header"><span class="popup-icon">&#9888;</span><span class="popup-title">CAUTION</span></div>
      <div class="popup-status">Anomaly Detected</div>
      <div class="popup-message"><b>POSSIBLE RISK</b><br>This page may exhibit suspicious traits or behaviors that resemble phishing or malware activity. It is recommended to proceed with caution.</div>
    </div>`;
  } else {
    html = `<div class="popup-card" style="background:#4caf50;color:#fff;border-left:6px solid #087f23;">
      <div class="popup-header"><span class="popup-icon">&#10003;</span><span class="popup-title">SAFE</span></div>
      <div class="popup-status">Benign Link Detected</div>
      <div class="popup-message"><b>SAFE TO PROCEED</b><br>No suspicious or harmful activity was detected. The page appears to be safe for viewing or interaction.</div>
    </div>`;
  }
  document.getElementById('analyzing-state').style.display = 'none';
  resultState.innerHTML = html;
  resultState.style.display = 'block';
}
