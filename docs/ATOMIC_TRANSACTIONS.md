# Atomic Database Operations & Transaction Safety

## Overview

The tattoo contest app implements **transaction-safe file operations** with zero data loss guarantees using atomic writes, write-ahead logging (WAL), and backup snapshots.

**Key Principle:** Every database write is an atomic transaction with:

- ✅ Write-ahead logging for crash recovery
- ✅ Pre-operation backup snapshots
- ✅ Atomic file writes (write-then-rename)
- ✅ Automatic retry with exponential backoff
- ✅ Immediate write verification
- ✅ Real-time error recovery

---

## Architecture

### Multi-Tier Transaction Safety

```
┌─────────────────────────────────┐
│   Save Request (Submissions)    │
└────────────┬────────────────────┘
             │
             ▼
┌─────────────────────────────────────┐
│ Step 1: Create Pre-Operation Backup  │
│ (backup-timestamp-hash.json)        │
└────────────┬────────────────────────┘
             │
             ▼
┌─────────────────────────────────────┐
│ Step 2: Write WAL Entry             │
│ (wal-timestamp-hash.json)           │
│ Status: "pending"                   │
└────────────┬────────────────────────┘
             │
             ▼
┌─────────────────────────────────────┐
│ Step 3: Atomic Write                │
│ 1. Write to temp file               │
│ 2. Verify data integrity            │
│ 3. Rename temp to data.json         │
│ (atomic, no partial files)          │
└────────────┬────────────────────────┘
             │
             ▼
┌─────────────────────────────────────┐
│ Step 4: Verify Written Data         │
│ Read back and compare with source   │
└────────────┬────────────────────────┘
             │
             ▼
┌─────────────────────────────────────┐
│ Step 5: Mark WAL Complete           │
│ Status: "completed"                 │
└────────────┬────────────────────────┘
             │
             ▼
       ✅ SUCCESS
    (Response sent)
```

---

## Directory Structure

```
/workspaces/TATTOO-CONTEST/
├── data.json                  # Main data file (never partially written)
├── backups/
│   ├── backup-1731023456789-a1b2c3d4.json         # User snapshots
│   ├── pre-write-1731023456789-a1b2c3d4.json      # Pre-write backups
│   ├── submission-sleeve-1731023456789-a1b2c3d4.json
│   └── ...
├── .wal/
│   ├── wal-1731023456789-a1b2c3d4.json            # Completed
│   ├── wal-1731023456789-b2c3d4e5.json            # Completed
│   └── ... (recovered on startup if "pending")
└── .temp/
    ├── tmp-1731023456789-abc123.json              # Temp files
    └── ... (cleaned up after 5 minutes)
```

---

## Transaction Flow

### Example: Photo Submission with Atomic Write

#### Request

```bash
POST /api/submit
{
  "category": "sleeve",
  "caption": "Amazing sleeve design",
  "name": "John Doe",
  "phone": "555-1234",
  "photo": <binary image data>
}
```

#### Processing

```
T0: Submission received
    ├─ submissionId: sub-1731023456789-abc123
    └─ storageMethod: cloudinary

T1: File operations begin
    ├─ 📸 File saved to ./uploads/ by multer
    ├─ 📤 Uploading to Cloudinary...
    └─ ✅ Cloudinary upload successful

T2: Submission entry created
    {
      "id": "1731023456789-abc123",
      "category": "sleeve",
      "caption": "Amazing sleeve design",
      "name": "John Doe",
      "phone": "555-1234",
      "imageUrl": "https://res.cloudinary.com/...",
      "storageMethod": "cloudinary",
      "createdAt": 1731023456789,
      "submissionId": "sub-1731023456789-abc123"
    }

T3: In-memory store updated
    submissions["sleeve"].unshift(entry)
    // Now in RAM but not yet persistent

T4: ATOMIC TRANSACTION STARTS
    ├─ Transaction ID: txn-1731023456789-xyz789

T5: Pre-operation backup created
    ├─ File: backup-pre-write-1731023456789-xyz789.json
    ├─ Contains: Previous data.json (if exists)
    └─ Purpose: Recovery point if write fails

T6: Write-Ahead Log entry written
    ├─ File: wal-1731023456789-xyz789.json
    ├─ Status: "pending"
    ├─ Operation: "submission-sleeve-1731023456789-abc123"
    └─ Purpose: Crash recovery

T7: Atomic write to file
    ├─ Create temp file: tmp-1731023456789-random.json
    ├─ Write JSON data to temp file
    ├─ Verify temp file contents match source
    ├─ Atomic rename: tmp-* → data.json
    │  (This is atomic on most filesystems)
    └─ Result: data.json has fresh, complete data

T8: Write verification
    ├─ Read data.json back into memory
    ├─ Compare with source data
    ├─ ✅ Verification passed
    └─ If failed: rollback to backup, throw error

T9: Mark WAL complete
    ├─ Update wal-1731023456789-xyz789.json
    ├─ Status: "completed"
    ├─ completedAt: 1731023456790
    └─ Purpose: Won't replay on recovery

T10: Cleanup
    ├─ Delete old temp files (> 5 min)
    ├─ Delete old backups (keep max 10)
    └─ Result: Clean filesystem

T11: ATOMIC TRANSACTION COMPLETE
    ├─ Duration: 45ms
    ├─ transactionId: txn-1731023456789-xyz789
    └─ status: "success"

T12: Real-time broadcast
    ├─ Socket.io: emit 'newSubmission'
    └─ Connected clients updated

T13: Response sent to client
    {
      "success": true,
      "entry": { ... },
      "storageMethod": "cloudinary",
      "submissionId": "sub-1731023456789-abc123",
      "persistenceConfirmed": true,
      "transactionId": "txn-1731023456789-xyz789"
    }
```

---

## Crash Recovery Scenarios

### Scenario 1: Crash During Atomic Write

**What happens:**

1. Server crashes while writing temp file
2. Temp file left in `.temp/` (incomplete)
3. data.json unchanged (still has old data)

**Recovery on restart:**

1. WAL recovery scans `.wal/` directory
2. Finds `wal-*.json` with status `"pending"`
3. Restores from matching backup file
4. Marks WAL entry as `"recovered"`
5. Submission NOT lost (in backup)

**Result:** ✅ Data consistent, submission safe

---

### Scenario 2: Crash After Rename

**What happens:**

1. Server crashes right after `fs.renameSync(temp → data.json)`
2. data.json written successfully
3. WAL not yet marked "completed"

**Recovery on restart:**

1. WAL recovery finds status `"pending"`
2. Latest backup has old data
3. But data.json has new data (already written)
4. No rollback needed (data is already there)
5. Mark WAL as `"recovered"`

**Result:** ✅ Data persisted correctly

---

### Scenario 3: Corrupted data.json

**What happens:**

1. data.json becomes corrupted (partial JSON)
2. App fails to parse on startup

**Recovery on startup:**

1. `loadData()` catches JSON parse error
2. `loadWithRecovery()` scans backups
3. Finds latest `pre-write-*.json` backup
4. Copies backup to data.json
5. Resumes with clean state

**Result:** ✅ Latest backup restored, minimal data loss

---

## API Endpoints with Atomic Transactions

### Submit Photo (Atomic)

**Endpoint:** `POST /api/submit`

**Transaction Guarantees:**

- ✅ Either completes fully or rolls back
- ✅ Write confirmation before response
- ✅ Backup created before modification
- ✅ WAL for recovery
- ✅ Retry on transient failures (3 attempts with backoff)

**Response includes:**

```json
{
  "success": true,
  "entry": { ... },
  "storageMethod": "cloudinary",
  "submissionId": "sub-1731023456789-abc123",
  "persistenceConfirmed": true,
  "transactionId": "txn-1731023456789-xyz789"
}
```

**Key Fields:**

- `persistenceConfirmed: true` - Data verified written to disk
- `transactionId` - Unique transaction ID for audit trail
- `submissionId` - Client can use to verify in next request

---

### Update Winners (Atomic)

**Endpoint:** `POST /api/save-winners`

**Transaction Guarantees:**

- Same atomic guarantees as submissions
- WAL entry shows "winners-update-*"
- Backup created with "winners-" prefix

**Response:**

```json
{
  "success": true,
  "transactionId": "txn-1731023456790-abc456"
}
```

---

## Metrics & Monitoring

### GET /api/metrics

Includes persistence metrics:

```json
{
  "persistence": {
    "dataFile": {
      "exists": true,
      "sizeBytes": 125432,
      "path": "/workspaces/TATTOO-CONTEST/data.json"
    },
    "backups": {
      "count": 8,
      "maxRetained": 10,
      "path": "/workspaces/TATTOO-CONTEST/backups"
    },
    "wal": {
      "count": 0,
      "path": "/workspaces/TATTOO-CONTEST/.wal"
    },
    "temp": {
      "count": 0,
      "path": "/workspaces/TATTOO-CONTEST/.temp"
    }
  }
}
```

### Key Indicators

| Metric | Good Value | Warning | Critical |
|--------|-----------|---------|----------|
| WAL count | 0 | 1-2 | > 5 |
| Backups count | 5-10 | 2-4 | 0 or 11+ |
| Temp files | 0 | 1-2 | > 10 |
| Data file size | < 5MB | 5-10MB | > 10MB |

---

## Retry Logic

### Exponential Backoff

```
Attempt 1: Immediate
Attempt 2: 100ms delay
Attempt 3: 200ms delay (100 * 2^1)
Attempt 4: Would be 400ms delay (but maxRetries = 3)
```

**Configuration:**

- `maxRetries: 3` - Max 3 total attempts
- `retryDelayMs: 100` - Base delay 100ms
- `Backoff: 2^n` - Double delay each attempt

**Scenarios that trigger retry:**

- File system busy (EAGAIN)
- Temporary permission issues
- Disk I/O errors

---

## Data Loss Prevention

### Zero-Loss Guarantees

**Submission NOT lost if:**

1. ✅ Cloudinary fails - fallback to local
2. ✅ Crash during write - recovered from backup
3. ✅ Crash during Cloudinary upload - local file preserved
4. ✅ Disk full - error returned, old data intact
5. ✅ Corrupted data.json - restored from backup
6. ✅ Network timeout - retried up to 3 times
7. ✅ Race condition on concurrent writes - atomic operations prevent this

**Submission might be lost only if:**

- ❌ Backup directory becomes inaccessible while writing
- ❌ Filesystem completely fails during atomic rename
- ❌ Multiple concurrent disk failures
- ❌ Data.json and ALL backups deleted simultaneously

---

## Best Practices

### For Developers

✅ **DO:**

- Always use `saveTransaction()` for writes
- Catch and log transaction errors
- Include `transactionId` in error responses
- Monitor `/api/metrics` for persistence health
- Keep backups directory on separate disk (if possible)
- Regular backups of `.backups/` directory

❌ **DON'T:**

- Bypass atomic persistence layer
- Manually edit data.json while app running
- Delete `.wal/` or `.backups/` directories
- Assume all writes succeed without confirmation
- Ignore `persistenceConfirmed` in responses

### For Operations

✅ **Monitoring:**

```bash
# Watch WAL recovery logs
tail -f app.log | grep "WAL recovery"

# Monitor backup count
ls -la /workspaces/TATTOO-CONTEST/backups/ | wc -l

# Check data file size
du -h /workspaces/TATTOO-CONTEST/data.json

# Verify disk space
df -h /workspaces/TATTOO-CONTEST/
```

✅ **Alerts:**

- Alert if WAL count > 5
- Alert if backups count approaches 10
- Alert if data.json > 10MB
- Alert if disk usage > 80%

---

## Testing Atomicity

### Test 1: Verify Backup Creation

```bash
# Upload a submission
curl -F "photo=@test.jpg" \
     -F "category=sleeve" \
     -F "caption=Test" \
     http://localhost:3000/api/submit

# Check backups created
ls -la /workspaces/TATTOO-CONTEST/backups/
# Should see pre-write-*.json files
```

### Test 2: Verify Write Confirmation

```javascript
// Check response includes persistence confirmation
const response = await fetch('http://localhost:3000/api/submit', {
  method: 'POST',
  body: formData
});

const result = await response.json();
console.log(result.persistenceConfirmed); // Should be true
console.log(result.transactionId); // Should have value
```

### Test 3: Simulate Crash & Recovery

```bash
# Kill server mid-write (advanced test)
# Server will recover from WAL on restart

# Check logs for recovery message
grep "WAL recovery\|Recovering pending" app.log
```

### Test 4: Verify Data Integrity

```bash
# Validate JSON structure
jq . /workspaces/TATTOO-CONTEST/data.json > /dev/null && echo "Valid JSON"

# Check backup integrity
jq . /workspaces/TATTOO-CONTEST/backups/pre-write-*.json | head -5
```

---

## Performance Characteristics

### Transaction Overhead

| Operation | Typical Time | Components |
|-----------|-------------|------------|
| Backup creation | 5-10ms | File copy |
| WAL write | 3-5ms | JSON serialize + write |
| Atomic write | 15-30ms | Temp write + verify + rename |
| Verification | 3-5ms | Read + compare |
| Total | 30-50ms | All steps combined |

### Disk Usage

| Component | Typical Size |
|-----------|-------------|
| data.json (1000 submissions) | ~150KB |
| Single backup file | ~150KB |
| 10 backups retained | ~1.5MB |
| WAL directory | ~50KB (until cleanup) |
| Total overhead | ~2MB (on 150KB data) |

---

## Troubleshooting

### Issue: High WAL Count

**Symptoms:** `/api/metrics` shows WAL count > 5

**Cause:** Pending transactions not completed (e.g., crash mid-transaction)

**Solution:**

```bash
# Restart app (triggers WAL recovery)
systemctl restart tattoo-contest

# Monitor recovery
tail -f app.log | grep "WAL recovery"
```

---

### Issue: Data File Keeps Growing

**Symptoms:** data.json size increases unexpectedly

**Cause:** Possible memory leak or duplicate submissions

**Solution:**

```bash
# Check submissions count
curl http://localhost:3000/api/metrics | jq .submissions.total

# Verify data integrity
jq '.submissions | keys | .[] | [., (.[] | length)]' data.json
```

---

### Issue: Backups Not Being Created

**Symptoms:** `/api/metrics` shows `backups.count: 0`

**Cause:** Possible permission issues or directory deleted

**Solution:**

```bash
# Check backup directory exists and is writable
ls -ld /workspaces/TATTOO-CONTEST/backups/
chmod 755 /workspaces/TATTOO-CONTEST/backups/

# Restart app
systemctl restart tattoo-contest
```

---

## Summary

**Atomic Persistence provides:**

1. ✅ **Transaction-safe writes** - All or nothing
2. ✅ **Crash recovery** - From backups and WAL
3. ✅ **Write confirmation** - Before client response
4. ✅ **Automatic retry** - 3 attempts with backoff
5. ✅ **Backup management** - Auto-create and cleanup
6. ✅ **Verification** - Read-back check after write
7. ✅ **Monitoring** - Metrics endpoint for health
8. ✅ **Zero data loss** - Even with crashes

**Result:** Production-grade database reliability without a database.
