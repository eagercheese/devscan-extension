# DEVSCAN Browser Extension

<div align="center">
  <img src="css/picture/DEVscan%20Logo.png" alt="DEVSCAN Logo" width="128" height="128">
  
  **Real-time Link Security Scanner with ML-Powered Analysis**
  
  [![Version](https://img.shields.io/badge/version-4.0-blue.svg)](manifest.json)
  [![Manifest](https://img.shields.io/badge/manifest-v3-green.svg)](manifest.json)
  [![License](https://img.shields.io/badge/license-MIT-yellow.svg)](#license)
</div>

## 🛡️ Overview

DEVSCAN is a powerful browser extension that provides real-time security analysis of web links using machine learning. It automatically scans links on web pages, provides visual feedback through tooltips and highlights, and can block access to potentially malicious content.

## ✨ Features

### 🔍 **Real-time Link Analysis**
- Automatically scans all external links on web pages
- Batch processing for efficient server communication
- Session-based tracking for comprehensive analysis

### 🎯 **Visual Security Indicators**
- **Green indicators**: Safe links
- **Yellow indicators**: Suspicious/anomalous links  
- **Red indicators**: Malicious or high-risk links
- Interactive tooltips with detailed security information

### 🚫 **Proactive Protection**
- Automatic blocking of malicious links
- Warning page redirection for suspicious content
- User-configurable blocking settings

### ⚙️ **Flexible Configuration**
- Customizable ML server endpoint
- Toggle link highlighting on/off
- Enable/disable page blocking
- Persistent settings storage

## 🚀 Installation

### From Source
1. Clone this repository:
   ```bash
   git clone https://github.com/eagercheese/devscan-extension.git
   ```

2. Open Chrome/Edge and navigate to `chrome://extensions/`

3. Enable "Developer mode" in the top right corner

4. Click "Load unpacked" and select the extension folder

5. The DEVSCAN extension should now appear in your browser toolbar

### Production Release
*Coming soon: Chrome Web Store and Edge Add-ons marketplace*

## 🔧 Configuration

### Setting up the ML Server
1. Click the DEVSCAN extension icon in your browser toolbar
2. Enter your ML server URL (e.g., `http://localhost:3000`)
3. Click "Save" to store the configuration

### Extension Settings
- **Enable Page Blocking**: Automatically redirects users away from malicious sites
- **Enable Link Highlights**: Shows visual indicators on links based on security analysis

## 🏗️ ML Server Integration

DEVSCAN requires a backend ML server for link analysis. See [API_SPECIFICATION.md](API_SPECIFICATION.md) for detailed implementation requirements.

### Quick Server Setup
Your ML server should implement the `/api/analyze` endpoint:

```javascript
POST /api/analyze
{
  "links": ["https://example.com/page1", "https://suspicious-site.com"],
  "domain": "current-site.com",
  "timestamp": 1703875200000
}
```

Response format:
```javascript
{
  "success": true,
  "verdicts": {
    "https://example.com/page1": "safe",
    "https://suspicious-site.com": "malicious"
  },
  "timestamp": 1703875200000,
  "processing_time_ms": 234
}
```

## 📁 Project Structure

```
extension/
├── manifest.json              # Extension configuration
├── API_SPECIFICATION.md       # ML server API documentation
├── css/
│   ├── popup.css              # Extension popup styling
│   ├── WarningPage.css        # Warning page styling
│   └── picture/               # Icon and image assets
├── html/
│   ├── popup.html             # Extension popup interface
│   ├── WarningPage.html       # Security warning page
│   └── testingTooltip.html    # Tooltip template
├── js/
│   ├── background.js          # Service worker (background tasks)
│   ├── content.js             # Main content script
│   ├── popup.js               # Popup interface logic
│   ├── riskLogic.js           # Risk assessment algorithms
│   ├── settings.js            # Settings management
│   ├── toastUI.js             # Toast notification system
│   ├── tooltipHandler.js      # Tooltip display logic
│   ├── warning.js             # Warning page functionality
│   └── reminder.js            # User reminder system
└── icons/
    ├── icon48.png             # Extension icon (48x48)
    └── tooltip_bilog.png      # Tooltip background
```

## 🔒 Permissions

DEVSCAN requires the following permissions:

- **`storage`**: Save user settings and cache analysis results
- **`tabs`**: Monitor active tabs for link analysis
- **`scripting`**: Inject content scripts for real-time scanning
- **`activeTab`**: Access current page content
- **`<all_urls>`**: Scan links across all websites

## 🛠️ Development

### Prerequisites
- Chrome/Edge browser with Developer mode enabled
- Node.js and npm (for ML server development)
- Basic understanding of Chrome Extensions Manifest V3

### Running in Development
1. Load the extension using "Load unpacked" in Chrome extensions page
2. Make changes to the code
3. Reload the extension in Chrome extensions page
4. Test functionality on various websites

### Building for Production
1. Remove any development/debug code
2. Optimize images and assets
3. Test thoroughly across different browsers
4. Package for Chrome Web Store submission

## 📊 How It Works

1. **Link Detection**: Content script monitors DOM for external links
2. **Batch Collection**: Links are collected and sent to ML server in batches
3. **Analysis**: ML server analyzes links and returns security verdicts
4. **Visual Feedback**: Extension applies color-coded indicators and tooltips
5. **Protection**: Malicious links are blocked or redirected to warning page

## 🤝 Contributing

We welcome contributions! Please feel free to submit a Pull Request. For major changes, please open an issue first to discuss what you would like to change.

### Development Guidelines
- Follow existing code style and patterns
- Add comments for complex logic
- Test thoroughly across different websites
- Update documentation as needed

## 📝 License

This project is licensed under the MIT License - see the LICENSE file for details.

## 🆘 Support

If you encounter any issues or have questions:

1. Check the [Issues](https://github.com/eagercheese/devscan-extension/issues) page
2. Create a new issue with detailed information
3. Include browser version, extension version, and steps to reproduce

## 🔮 Roadmap

- [ ] Firefox extension support
- [ ] Safari extension port
- [ ] Enhanced ML model integration
- [ ] Real-time threat intelligence feeds
- [ ] Advanced user reporting features
- [ ] Enterprise management console

---

<div align="center">
  <strong>Built with ❤️ for a safer web browsing experience</strong>
</div>
