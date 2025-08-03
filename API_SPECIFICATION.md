# DEVScan ML Server API Specification

## Endpoint: POST /api/analyze

### Request Format
```json
{
  "links": [
    "https://example.com/page1",
    "https://suspicious-site.com/login",
    "https://legitimate-site.com/about"
  ],
  "domain": "example.com",
  "timestamp": 1703875200000
}
```

### Response Format
```json
{
  "success": true,
  "verdicts": {
    "https://example.com/page1": "safe",
    "https://suspicious-site.com/login": "anomalous",
    "https://legitimate-site.com/about": "safe"
  },
  "timestamp": 1703875200000,
  "processing_time_ms": 234
}
```

### Verdict Types
- `"safe"` - Link is safe to visit
- `"anomalous"` - Link shows suspicious patterns
- `"malicious"` - Link is definitively malicious
- `"failed"` - Analysis failed (network error, timeout, etc.)

### Error Response
```json
{
  "success": false,
  "error": "Analysis service unavailable",
  "timestamp": 1703875200000
}
```

## CORS Headers Required
Your server must include these headers:
```
Access-Control-Allow-Origin: *
Access-Control-Allow-Methods: POST, OPTIONS
Access-Control-Allow-Headers: Content-Type
```

## Rate Limiting Recommendations
- Max 1000 links per request
- Max 10 requests per minute per domain
- Implement caching for frequently requested URLs

## Example Node.js/Express Server Structure
```javascript
app.post('/api/analyze', async (req, res) => {
  try {
    const { links, domain, timestamp } = req.body;
    
    // Process links through your ML models
    const verdicts = await analyzeLinks(links);
    
    res.json({
      success: true,
      verdicts,
      timestamp: Date.now(),
      processing_time_ms: Date.now() - timestamp
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error.message,
      timestamp: Date.now()
    });
  }
});
```
