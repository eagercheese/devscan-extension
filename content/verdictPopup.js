// VerdictPopup - Modular popup component for showing link scan results
class VerdictPopup {
  constructor() {
    this.popup = null;
    this.timeout = null;
    this.isVisible = false;
  }

  // Show popup with different verdict types
  show(target, verdict = 'analyzing', data = {}) {
    this.hide(); // Hide any existing popup first
    
    this.popup = document.createElement('div');
    this.popup.id = 'devscan-link-verdict-popup';
    this.popup.className = 'devscan-verdict-popup';
    
    // Position the popup near the target element
    const rect = target.getBoundingClientRect();
    const popupStyles = {
      position: 'fixed',
      zIndex: '2147483647',
      top: `${rect.top + window.scrollY - 10}px`,
      left: `${rect.left + window.scrollX}px`,
      minWidth: '300px',
      maxWidth: '350px',
      boxShadow: '0 4px 12px rgba(0,0,0,0.15)',
      borderRadius: '12px',
      fontFamily: "'Segoe UI', 'Roboto', Arial, sans-serif",
      fontSize: '0.95rem',
      padding: '1rem 1.2rem',
      pointerEvents: 'none',
      opacity: '0',
      transform: 'translateY(-10px)',
      transition: 'all 0.2s ease-out'
    };

    // Apply styles
    Object.assign(this.popup.style, popupStyles);

    // Set content based on verdict type
    this.setContent(verdict, data);

    // Add to DOM
    document.body.appendChild(this.popup);
    
    // Animate in
    requestAnimationFrame(() => {
      this.popup.style.opacity = '1';
      this.popup.style.transform = 'translateY(0)';
    });

    this.isVisible = true;
  }

  // Set popup content based on verdict
  setContent(verdict, data) {
    let content = '';
    let styles = {};

    switch (verdict) {
      case 'analyzing':
        styles = {
          background: 'linear-gradient(135deg, #e3f2fd 0%, #bbdefb 100%)',
          color: '#1565c0',
          borderLeft: '4px solid #2196f3'
        };
        content = `
          <div style="display:flex;align-items:center;gap:12px;">
            <div style="font-size:1.5rem;animation:spin 2s linear infinite;">🔄</div>
            <div>
              <div style="font-weight:700;font-size:1.1rem;margin-bottom:4px;">ANALYZING</div>
              <div style="font-weight:500;color:#1976d2;">Scanning link for threats...</div>
              <div style="font-size:0.85rem;color:#424242;margin-top:4px;">Please wait while we check this URL</div>
            </div>
          </div>
          <style>
            @keyframes spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }
          </style>
        `;
        break;

      case 'malicious':
        styles = {
          background: 'linear-gradient(135deg, #ffebee 0%, #ffcdd2 100%)',
          color: '#c62828',
          borderLeft: '4px solid #f44336'
        };
        content = `
          <div style="display:flex;align-items:center;gap:12px;">
            <div style="font-size:1.8rem;">🛡️</div>
            <div>
              <div style="font-weight:700;font-size:1.1rem;margin-bottom:4px;">⚠️ DANGER</div>
              <div style="font-weight:600;color:#d32f2f;">Malicious Link Detected</div>
              <div style="font-size:0.85rem;color:#424242;margin-top:4px;">
                Risk Score: ${data.anomalyScore || 'High'} | 
                Classification: ${data.classificationScore || 'Malicious'}
              </div>
              <div style="font-size:0.8rem;color:#666;margin-top:6px;font-style:italic;">
                This link may contain phishing, malware, or other threats
              </div>
            </div>
          </div>
        `;
        break;

      case 'anomaly':
        styles = {
          background: 'linear-gradient(135deg, #fff8e1 0%, #ffecb3 100%)',
          color: '#f57f17',
          borderLeft: '4px solid #ff9800'
        };
        content = `
          <div style="display:flex;align-items:center;gap:12px;">
            <div style="font-size:1.8rem;">⚠️</div>
            <div>
              <div style="font-weight:700;font-size:1.1rem;margin-bottom:4px;">CAUTION</div>
              <div style="font-weight:600;color:#ef6c00;">Suspicious Activity Detected</div>
              <div style="font-size:0.85rem;color:#424242;margin-top:4px;">
                Anomaly Score: ${data.anomalyScore || 'Medium'} | 
                Classification: ${data.classificationScore || 'Suspicious'}
              </div>
              <div style="font-size:0.8rem;color:#666;margin-top:6px;font-style:italic;">
                Proceed with caution - unusual patterns detected
              </div>
            </div>
          </div>
        `;
        break;

      case 'safe':
        styles = {
          background: 'linear-gradient(135deg, #e8f5e8 0%, #c8e6c9 100%)',
          color: '#2e7d32',
          borderLeft: '4px solid #4caf50'
        };
        content = `
          <div style="display:flex;align-items:center;gap:12px;">
            <div style="font-size:1.8rem;">✅</div>
            <div>
              <div style="font-weight:700;font-size:1.1rem;margin-bottom:4px;">SAFE</div>
              <div style="font-weight:600;color:#388e3c;">Link Verified as Safe</div>
              <div style="font-size:0.85rem;color:#424242;margin-top:4px;">
                Risk Score: ${data.anomalyScore || 'Low'} | 
                Classification: ${data.classificationScore || 'Benign'}
              </div>
              <div style="font-size:0.8rem;color:#666;margin-top:6px;font-style:italic;">
                No threats detected - safe to proceed
              </div>
            </div>
          </div>
        `;
        break;

      case 'error':
        styles = {
          background: 'linear-gradient(135deg, #fafafa 0%, #eeeeee 100%)',
          color: '#424242',
          borderLeft: '4px solid #9e9e9e'
        };
        content = `
          <div style="display:flex;align-items:center;gap:12px;">
            <div style="font-size:1.8rem;">❌</div>
            <div>
              <div style="font-weight:700;font-size:1.1rem;margin-bottom:4px;">ERROR</div>
              <div style="font-weight:600;color:#616161;">Unable to Scan Link</div>
              <div style="font-size:0.85rem;color:#424242;margin-top:4px;">
                ${data.error || 'Connection to security service failed'}
              </div>
              <div style="font-size:0.8rem;color:#666;margin-top:6px;font-style:italic;">
                Manual verification recommended
              </div>
            </div>
          </div>
        `;
        break;
    }

    // Apply verdict-specific styles
    Object.assign(this.popup.style, styles);
    this.popup.innerHTML = content;
  }

  // Hide the popup
  hide() {
    if (this.popup) {
      this.popup.style.opacity = '0';
      this.popup.style.transform = 'translateY(-10px)';
      
      setTimeout(() => {
        if (this.popup && this.popup.parentNode) {
          this.popup.parentNode.removeChild(this.popup);
        }
        this.popup = null;
      }, 200);
    }
    
    if (this.timeout) {
      clearTimeout(this.timeout);
      this.timeout = null;
    }
    
    this.isVisible = false;
  }

  // Show popup with auto-hide after delay
  showWithTimeout(target, verdict, data, delay = 5000) {
    this.show(target, verdict, data);
    this.timeout = setTimeout(() => this.hide(), delay);
  }

  // Update existing popup content
  update(verdict, data) {
    if (this.popup && this.isVisible) {
      this.setContent(verdict, data);
    }
  }
}

// Export for use in other scripts
if (typeof window !== 'undefined') {
  window.VerdictPopup = VerdictPopup;
}

// For module environments
if (typeof module !== 'undefined' && module.exports) {
  module.exports = VerdictPopup;
}
