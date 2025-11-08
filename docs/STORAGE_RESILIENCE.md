# Storage Resilience & Fallback Strategy

## Overview

The tattoo contest app implements a **multi-tier storage strategy** to ensure submissions are **NEVER lost**, even when external services fail.

**Key Principle:** Data is always persisted to `data.json` immediately after upload, regardless of image storage success.

---

## Storage Architecture

### Tier 1: Image Storage (Primary: Cloudinary, Fallback: Local)

```
┌─────────────────┐
│  User Upload    │
└────────┬────────┘
         │
         ▼
   ┌─────────────┐
   │  multer     │  ← Saves to ./uploads/
   │  diskStorage│     (temp location)
   └────┬────────┘
        │
        ├──────────────────┐
        │                  │
        ▼                  ▼
   ┌─────────────┐   ┌──────────────┐
   │ Cloudinary  │   │ Local Fallback│
   │ (Primary)   │   │ (Fallback)    │
   │ CDN URLs    │   │ /uploads/*    │
   └─────────────┘   └──────────────┘
        │                  │
        └──────┬───────────┘
               │
               ▼
        ┌─────────────────┐
        │   data.json     │  ← ALWAYS SAVED
        │ (imageUrl stored)│     regardless
        └─────────────────┘     of storage tier
```

### Tier 2: Submission Data (File-based: data.json)

Every submission entry includes:

- **id**: Unique identifier
- **category**: Contest category
- **caption**, **name**, **phone**: User-provided data
- **imageUrl**: URL (Cloudinary or local)
- **storageMethod**: Which storage was used
- **createdAt**: Timestamp

---

## Upload Flow with Fallback

### Step 1: Multer Receives File

```javascript
upload.single('photo')  // Saves to ./uploads/ with unique filename
```

**Features:**

- ✅ Auto-creates `./uploads/` directory if missing
- ✅ Generates descriptive filenames: `timestamp-random.ext`
- ✅ Validates file type (image/* only)
- ✅ Enforces 10MB file size limit

---

### Step 2: Attempt Cloudinary Upload

```javascript
const result = await cloudinary.uploader.upload(req.file.path, { 
  folder: 'tattoo-contest',
  resource_type: 'auto'
});
imageUrl = result.secure_url;  // CDN URL (global distribution)
storageMethod = 'cloudinary';
```

**If Successful:**

- ✅ Image stored on Cloudinary CDN
- ✅ Local temp file deleted
- ✅ `imageUrl` = `https://res.cloudinary.com/...`
- ✅ `storageMethod` = `'cloudinary'`

---

### Step 3: Cloudinary Fails → Fallback to Local

```javascript
catch (cloudErr) {
  console.error('❌ Cloudinary upload failed:', cloudErr.message);
  imageUrl = `/uploads/${req.file.filename}`;
  storageMethod = 'local-fallback';
  // Local file is NOT deleted; it's now the primary storage
}
```

**Error Details Logged:**

- Error message
- HTTP status code
- Error status

**If Fallback Triggered:**

- ✅ Local file retained in `./uploads/`
- ✅ `imageUrl` = `/uploads/1731xxxx-abc123.jpg`
- ✅ `storageMethod` = `'local-fallback'`

---

### Step 4: Always Save to data.json

```javascript
const entry = {
  id: '...',
  category: '...',
  caption: '...',
  name: '...',
  phone: '...',
  imageUrl: imageUrl,  // ✅ Set by either Cloudinary or fallback
  storageMethod: storageMethod,
  createdAt: Date.now()
};

submissions[category].unshift(entry);
saveData();  // ✅ CRITICAL: Persisted to file immediately
```

**Critical Guarantee:**

- ✅ Submission saved to `data.json` **BEFORE** response sent
- ✅ Works even if imageUrl is local fallback
- ✅ Data survives server restarts
- ✅ No submissions ever lost

---

## Response Format

### Success (Either Storage Method)

```json
{
  "success": true,
  "entry": {
    "id": "1731023456789-abc123",
    "category": "sleeve",
    "caption": "Amazing sleeve design",
    "name": "John Doe",
    "phone": "555-1234",
    "imageUrl": "https://res.cloudinary.com/..." or "/uploads/1731023456789-abc123.jpg",
    "storageMethod": "cloudinary" or "local-fallback" or "local-primary",
    "createdAt": 1731023456789
  },
  "storageMethod": "cloudinary" or "local-fallback" or "local-primary"
}
```

### Error (Submission NOT Saved)

```json
{
  "error": "Upload failed: [specific error]",
  "note": "Submission was not saved. Please try again."
}
```

---

## Storage Method Indicators

### `storageMethod` Values

| Value | Meaning | Use Case |
|-------|---------|----------|
| `cloudinary` | Image on Cloudinary CDN | Production preferred |
| `local-fallback` | Cloudinary failed, using local | Temporary (Cloudinary down) |
| `local-primary` | Cloudinary not configured | Development environment |
| `null` | No image uploaded | Text-only submission |

---

## Error Handling & Logging

### Cloudinary Failures Logged

```
❌ Cloudinary upload failed: [specific error]
   Error code: 401 / 403 / 404 / 500 etc
   Error status: [details]
🔄 Falling back to local storage...
✅ Using local fallback storage: /uploads/1731023456789-abc123.jpg
```

### Data Persistence Logged

```
✅ Submission saved to data.json in sleeve
   ID: 1731023456789-abc123 | Storage: cloudinary | Total submissions: 42
```

### Temp File Cleanup Logged

```
📸 File received: 1731023456789-abc123.jpg (234567 bytes)
📤 Uploading to Cloudinary...
✅ Cloudinary upload successful: https://res.cloudinary.com/...
[temp file deleted automatically]
```

---

## Disaster Scenarios & Recovery

### Scenario 1: Cloudinary API Down

**What Happens:**

1. Upload endpoint receives file
2. Cloudinary request times out / returns 5xx error
3. **Fallback triggered** → local storage used
4. **Submission saved** to `data.json`
5. Response includes `storageMethod: 'local-fallback'`

**User Impact:** ✅ Submission succeeds (image served locally)

**Recovery:** When Cloudinary recovers, new submissions use CDN again

---

### Scenario 2: Cloudinary Quota Exceeded

**What Happens:**

1. Cloudinary returns 403 (permission denied)
2. **Fallback triggered** → local storage used
3. **Submission saved** to `data.json`

**User Impact:** ✅ Submission succeeds (image served locally)

**Recovery:** Admin purchases more Cloudinary quota, restart not needed

---

### Scenario 3: Network Timeout

**What Happens:**

1. Cloudinary upload takes too long / times out
2. **Fallback triggered** → local storage used
3. **Submission saved** to `data.json`

**User Impact:** ✅ Submission succeeds (image served locally)

**Recovery:** Network recovers, new submissions use Cloudinary again

---

### Scenario 4: Local Storage Disk Full

**What Happens:**

1. multer attempts to save file to `./uploads/`
2. File system returns ENOSPC error
3. **multer middleware rejects upload**
4. 500 error returned

**User Impact:** ❌ Submission fails (not saved)

**Prevention:**

- Monitor disk usage: `df -h`
- Implement cleanup job for old uploads
- Use Cloudinary exclusively in production
- Alert on high disk usage

---

### Scenario 5: data.json Corruption

**What Happens:**

1. Submission received and processed
2. `saveData()` called but JSON write fails
3. 500 error returned

**Prevention:**

- Regular backups of `data.json`
- Verify JSON integrity on startup
- Use try/catch in `saveData()`

**Recovery:**

```bash
# Restore from backup
cp data.json.backup data.json
npm start
```

---

## Testing Fallback Behavior

### Test 1: Cloudinary Disabled (Force Local Storage)

```javascript
// Temporarily unset Cloudinary credentials
process.env.CLOUDINARY_CLOUD_NAME = '';
process.env.CLOUDINARY_API_KEY = '';
process.env.CLOUDINARY_API_SECRET = '';

// Upload file
POST /api/submit
// Should use local storage: storageMethod = 'local-primary'
```

### Test 2: Cloudinary Failure Simulation

```javascript
// Mock Cloudinary error
cloudinary.uploader.upload = async () => {
  throw new Error('Test error: API rate limited');
};

// Upload file
POST /api/submit
// Should fallback to local: storageMethod = 'local-fallback'
```

### Test 3: Verify data.json Persistence

```bash
# Upload a file
curl -F "photo=@test.jpg" \
     -F "category=sleeve" \
     -F "caption=Test" \
     http://localhost:3000/api/submit

# Check data.json
cat data.json | jq .submissions.sleeve[0]
# Should show submission with imageUrl (regardless of storage method)

# Restart server
pkill node
npm start

# GET /api/feed
# Submission should still be there
```

---

## Configuration for Production

### Cloudinary Setup (Primary)

```bash
# .env file
CLOUDINARY_CLOUD_NAME=your_cloud_name
CLOUDINARY_API_KEY=your_api_key
CLOUDINARY_API_SECRET=your_api_secret
```

**Benefits:**

- ✅ Global CDN distribution
- ✅ Automatic image optimization
- ✅ Offloads storage from server
- ✅ Scales automatically

### Local Fallback (Always Available)

```bash
# Directory created automatically
./uploads/
```

**Limits:**

- ⚠️ Tied to server storage
- ⚠️ Not globally distributed
- ⚠️ Disk space constraints

---

## Monitoring & Alerts

### Metrics to Track

```javascript
GET /api/metrics
{
  "submissions": {
    "byCategory": [
      {
        "category": "sleeve",
        "count": 42,
        "oldest": 1731000000000,
        "newest": 1731023456789
      }
    ]
  },
  "dataFile": {
    "exists": true,
    "sizeBytes": 125432
  }
}
```

### Key Indicators

1. **Cloudinary Success Rate**
   - Track `storageMethod` values in `data.json`
   - Alert if `local-fallback` > 5%

2. **Data File Size**
   - Monitor growth: `data.json` size increasing?
   - Alert if > 10MB (may need cleanup)

3. **Upload Count**
   - Monitor submissions per category
   - Detect anomalies

---

## Best Practices

✅ **DO:**

- Always save to `data.json` (as implemented)
- Log storage method with each submission
- Clean up temp files after Cloudinary success
- Monitor Cloudinary error rates
- Regular backups of `data.json`
- Test fallback monthly
- Alert on disk usage > 80%

❌ **DON'T:**

- Rely on only one storage method
- Skip `saveData()` on success
- Delete local files before Cloudinary confirmation
- Store images in database (use URLs)
- Ignore upload errors in logs

---

## Quick Reference

| Component | Purpose | Failure Mode | Recovery |
|-----------|---------|--------------|----------|
| multer diskStorage | Temp file management | ENOSPC / EACCES | Clean old files |
| Cloudinary | CDN distribution | API down / quota | Use local fallback |
| Local storage | Fallback + dev | Disk full | Cleanup job |
| data.json | Persistence | Corruption | Restore backup |
| fs.unlink | Temp cleanup | Async error | Log & continue |

---

## Summary

**The app GUARANTEES:**

1. ✅ Every submission is saved to `data.json`
2. ✅ Image URL is captured (Cloudinary or local)
3. ✅ Cloudinary failures don't cause submission loss
4. ✅ Submissions survive server restarts
5. ✅ Users get clear feedback on success/failure
6. ✅ Detailed logging for troubleshooting

**Result:** **Zero submission loss**, even with external service failures.
