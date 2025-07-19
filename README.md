# DEVScan Link Highlighter

A clean Chrome extension that highlights external links for security scanning.

## Features

- **Link Highlighting**: Automatically underlines external links in green
- **Text URL Detection**: Converts text URLs to highlighted links
- **Background Processing**: Sends external URLs to backend for security analysis
- **User Controls**: Toggle highlighting and other features via popup

## Files Structure

```
extension/
├── manifest.json          # Extension configuration
├── simple-test.html      # Test page for development
├── assets/
│   └── images/           # Icons and images for UI
│       ├── icon48.png    # Extension icon
│       ├── DEVscan Logo.png
│       ├── warning_exclamation.png
│       ├── caution_exclamation.png
│       ├── safe_exclamation.png
│       └── exclamationMark.png
├── background/
│   └── index.js          # Background service worker
├── content/
│   └── linkHighlighter.js    # Main content script - detects and highlights external links
├── popup/
│   ├── popup.html        # Extension popup UI
│   ├── popup.css         # Popup styling
│   └── popup.js          # Popup functionality
└── options/
    ├── options.html      # Settings page
    ├── options.css       # Settings styling
    └── options.js        # Settings functionality
```

## Installation

1. Open Chrome and go to `chrome://extensions`
2. Enable "Developer mode"
3. Click "Load unpacked" and select the extension folder
4. The extension should now be active

## Testing

Open `simple-test.html` in Chrome to test the extension functionality.

## Backend Integration

The extension sends external URLs to `http://localhost:3000/api/scan-links/scan-link` for security analysis.

