# Disaster Recovery Runbook - Tattoo Contest App

## Overview

This document provides step-by-step procedures for handling common failure scenarios and recovering the application.

---

## 1. SERVICE FAILURE RECOVERY

### Scenario: App crashes or becomes unresponsive

**Detection:**

```bash
# Check app status on Fly.io
flyctl status -a tattoo-contest

# Check recent logs for errors
flyctl logs -a tattoo-contest --limit 100
```

**Recovery Steps:**

1. **Quick Recovery (Restart)**

   ```bash
   # Restart the machine
   flyctl machines restart <machine-id> -a tattoo-contest
   
   # Or force redeploy
   flyctl deploy --remote-only -a tattoo-contest
   ```

2. **Check Data Integrity**

   ```bash
   # SSH into machine and verify data.json
   flyctl ssh console -a tattoo-contest
   cat data.json | jq '.' | head -50
   ```

3. **Verify Cloudinary Connection**

   ```bash
   # Test from SSH console
   curl -s -H "Authorization: Bearer $CLOUDINARY_API_KEY" \
     "https://api.cloudinary.com/v1_1/$CLOUDINARY_CLOUD_NAME/resources/image"
   ```

4. **Monitor Recovery**

   ```bash
   # Watch logs during restart
   flyctl logs -a tattoo-contest --follow
   ```

---

## 2. DATA LOSS RECOVERY

### Scenario: data.json corrupted or lost

**Prevention:**

```bash
# Automated backup (run daily via cron)
#!/bin/bash
DATE=$(date +%Y%m%d_%H%M%S)
flyctl ssh console -a tattoo-contest <<EOF
tar czf /tmp/data_backup_$DATE.tar.gz data.json
EOF

# Download backup
flyctl sftp shell -a tattoo-contest
> get /tmp/data_backup_$DATE.tar.gz ./backups/
```

**Recovery - From Local Backup:**

1. **Verify Backup Exists**

   ```bash
   ls -lh backups/
   ```

2. **Restore to App**

   ```bash
   # Upload backup
   flyctl sftp shell -a tattoo-contest
   > put ./backups/data_backup_LATEST.tar.gz /tmp/
   
   # SSH and extract
   flyctl ssh console -a tattoo-contest
   tar xzf /tmp/data_backup_LATEST.tar.gz
   exit
   ```

3. **Restart App**

   ```bash
   flyctl machines restart <machine-id> -a tattoo-contest
   ```

4. **Verify Data Restored**

   ```bash
   curl https://tattoo-contest.fly.dev/api/feed | jq '.'
   ```

**Recovery - From Partial Loss:**

If data.json exists but is corrupted:

```bash
# Get into SSH console
flyctl ssh console -a tattoo-contest

# Backup corrupted file
cp data.json data.json.corrupted

# Recreate with minimal data
cat > data.json << 'EOF'
{
  "submissions": {
    "worst": [],
    "best": []
  },
  "winners": {
    "worst": [],
    "best": []
  }
}
EOF

exit

# Restart
flyctl machines restart <machine-id> -a tattoo-contest
```

---

## 3. CLOUDINARY INTEGRATION FAILURE

### Scenario: Image uploads fail

**Diagnosis:**

```bash
# Check Cloudinary credentials in app
flyctl ssh console -a tattoo-contest
env | grep CLOUDINARY

# Test connection
curl -s -u "$CLOUDINARY_API_KEY:$CLOUDINARY_API_SECRET" \
  "https://api.cloudinary.com/v1_1/$CLOUDINARY_CLOUD_NAME/resources/image" | jq '.'
```

**Recovery:**

1. **Verify Credentials**

   ```bash
   # Check .env file has correct values
   cat /app/.env | grep CLOUDINARY
   
   # Update if needed (requires redeploy)
   ```

2. **Fallback to Local Storage**
   - The app automatically falls back to `/uploads/` if Cloudinary fails
   - Check that uploads directory has write permissions:

   ```bash
   flyctl ssh console -a tattoo-contest
   ls -ld /app/uploads
   chmod 755 /app/uploads
   ```

3. **Reconnect to Cloudinary**

   ```bash
   # Redeploy to refresh credentials
   flyctl deploy --remote-only -a tattoo-contest
   ```

---

## 4. SOCKET.IO REAL-TIME FAILURES

### Scenario: Live feed not updating

**Detection:**

- Users report submissions appearing with delay
- Admin panel not receiving real-time winner updates

**Diagnosis:**

```bash
# Check Socket.io errors in logs
flyctl logs -a tattoo-contest | grep -i socket

# Monitor connection count (requires metrics export)
curl https://tattoo-contest.fly.dev/api/metrics
```

**Recovery:**

1. **Restart Connection Handler**

   ```bash
   # Force client reconnection by restarting app
   flyctl machines restart <machine-id> -a tattoo-contest
   ```

2. **Check WebSocket Support**

   ```bash
   # Verify port 443 allows WebSocket upgrades
   curl -i -N -H "Connection: Upgrade" \
     -H "Upgrade: websocket" \
     https://tattoo-contest.fly.dev/
   ```

3. **Monitor Socket Connections**

   ```bash
   # From SSH console, check connections
   flyctl ssh console -a tattoo-contest
   netstat -an | grep ESTABLISHED | wc -l
   exit
   ```

---

## 5. DATABASE/DATA FILE ISSUES

### Scenario: Permissions or corruption issues

**Prevention - Set Correct Permissions:**

```bash
flyctl ssh console -a tattoo-contest
chmod 644 data.json
chown nobody:nogroup data.json
exit
```

**Recovery:**

1. **Verify File Access**

   ```bash
   flyctl ssh console -a tattoo-contest
   ls -l data.json
   cat data.json | jq 'keys'
   exit
   ```

2. **Rebuild from Empty**

   ```bash
   flyctl ssh console -a tattoo-contest
   rm data.json
   exit
   
   # App will recreate on first submission
   flyctl machines restart <machine-id> -a tattoo-contest
   
   # Wait for first submission to create file
   sleep 30
   flyctl ssh console -a tattoo-contest
   ls -l data.json
   exit
   ```

---

## 6. FLYIO DEPLOYMENT ISSUES

### Scenario: Deployment fails or rollback needed

**Deployment Failure:**

```bash
# Check Fly.io build logs
flyctl logs -a tattoo-contest --level error

# Retry deployment
flyctl deploy --remote-only -a tattoo-contest
```

**Rollback to Previous Version:**

```bash
# List recent releases
flyctl releases -a tattoo-contest --limit 10

# Rollback to specific image
flyctl releases rollback -a tattoo-contest

# Or deploy specific commit
git checkout <commit-hash>
flyctl deploy --remote-only -a tattoo-contest
```

**Check Deployment Status:**

```bash
# Monitor current deployment
flyctl status -a tattoo-contest

# Watch build progress
flyctl deploy --remote-only -a tattoo-contest --verbose
```

---

## 7. SCALING & RESOURCE ISSUES

### Scenario: App slow or out of memory

**Diagnosis:**

```bash
# Check current machine specs
flyctl machines list -a tattoo-contest

# Monitor memory usage
flyctl ssh console -a tattoo-contest
free -h
ps aux --sort=-%mem | head -10
exit
```

**Recovery:**

1. **Increase VM Size**

   ```bash
   flyctl machines update <machine-id> \
     --memory 512 \
     -a tattoo-contest
   ```

2. **Clear Old Data**

   ```bash
   flyctl ssh console -a tattoo-contest
   # Remove old uploads older than 30 days
   find uploads/ -type f -mtime +30 -delete
   exit
   ```

3. **Restart with Clean State**

   ```bash
   flyctl machines restart <machine-id> -a tattoo-contest
   ```

---

## 8. CERTIFICATE/HTTPS ISSUES

### Scenario: SSL certificate expired or invalid

**Detection:**

```bash
# Check certificate expiry
openssl s_client -connect tattoo-contest.fly.dev:443 -servername tattoo-contest.fly.dev | grep -A 2 "Validity"
```

**Recovery:**

1. **Renew Certificate**

   ```bash
   flyctl certs create -a tattoo-contest tattoo-contest.fly.dev
   ```

2. **Verify DNS**

   ```bash
   flyctl certs list -a tattoo-contest
   # Follow any DNS update instructions
   ```

3. **Restart App**

   ```bash
   flyctl machines restart <machine-id> -a tattoo-contest
   ```

---

## 9. CATEGORY MANAGEMENT ISSUES

### Scenario: Categories missing or corrupted

**Recovery:**

1. **View Current Categories**

   ```bash
   curl https://tattoo-contest.fly.dev/categories.json | jq '.'
   ```

2. **Restore Default Categories**

   ```bash
   flyctl ssh console -a tattoo-contest
   
   # Check categories.json
   cat categories.json
   
   # Restore if needed
   cat > categories.json << 'EOF'
   [
     { "id": "worst", "name": "Worst Tattoo" },
     { "id": "best", "name": "Best Tattoo" }
   ]
   EOF
   
   exit
   
   # Restart
   flyctl machines restart <machine-id> -a tattoo-contest
   ```

---

## 10. ADMIN PASSWORD ISSUES

### Scenario: Forgot admin password or need to reset

**Resolution:**

1. **Update Password via SSH**

   ```bash
   flyctl ssh console -a tattoo-contest
   
   # Edit .env file
   nano .env
   # Change ADMIN_PASSWORD=pins2025lol to new password
   # Save and exit
   
   exit
   
   # Restart app to load new password
   flyctl machines restart <machine-id> -a tattoo-contest
   ```

2. **Or set via Deploy**

   ```bash
   flyctl secrets set ADMIN_PASSWORD="newpassword" -a tattoo-contest
   flyctl deploy --remote-only -a tattoo-contest
   ```

---

## 11. MONITORING CHECKLIST

**Daily:**

- [ ] Check app status: `flyctl status -a tattoo-contest`
- [ ] Verify recent logs: `flyctl logs -a tattoo-contest --limit 50`
- [ ] Check /health endpoint: `curl https://tattoo-contest.fly.dev/health`

**Weekly:**

- [ ] Backup data: `flyctl ssh console -a tattoo-contest && cp data.json /tmp/backup_$(date +%s).json`
- [ ] Test recovery procedures
- [ ] Review metrics: `curl https://tattoo-contest.fly.dev/api/metrics`

**Monthly:**

- [ ] Test full disaster recovery
- [ ] Review and update this runbook
- [ ] Check certificate expiry: `flyctl certs list -a tattoo-contest`

---

## 12. ESCALATION CONTACTS

| Issue | Contact | Action |
|-------|---------|--------|
| Cloudinary down | Cloudinary support | Switch to local uploads, monitor status |
| Fly.io down | Fly.io status page | Wait or contact support |
| DNS issues | Domain registrar | Verify DNS records |
| Critical bug | Development team | Deploy hotfix |

---

## AUTOMATION SCRIPTS

**Health Check Cron Job:**

```bash
# Add to crontab (every 5 minutes)
*/5 * * * * curl -s https://tattoo-contest.fly.dev/health >> /var/log/tattoo-health.log 2>&1

# Alert if unhealthy
```

**Automated Backup:**

```bash
# Run daily at 2 AM
0 2 * * * /home/user/scripts/backup-tattoo-contest.sh
```

**See scripts/ directory for full automation tools.**
