// Show scanning page after 2s
setTimeout(() => {
  document.body.style.display = "block";
}, 2000);

// Optional: listen for messages only if you want to show progress/UI
chrome.runtime.onMessage.addListener((msg) => {
  if (msg.action === "verdictReady") {
    console.log("[DEVScan] Verdict received in ScanningPage:", msg.verdict);
    // No redirect logic here anymore
  }
});
