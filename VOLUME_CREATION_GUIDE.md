# 🎯 Fly.io Volume Creation Guide

Your deployment needs persistent volumes before it can run. **You need to create these volumes from your local machine** where you have the Fly CLI installed.

## ⚠️ Current Error

```
Error: Process group 'app' needs volumes with name 'contest_data' to fulfill mounts 
defined in fly.toml; Run `fly volume create contest_data -r REGION -n COUNT` for 
the following regions and counts: iad=2
```

## ✅ Solution: Create Volumes on Your Local Machine

### Prerequisites
1. **Install Fly CLI** if you haven't already:
   ```bash
   curl -L https://fly.io/install.sh | sh
   ```

2. **Login to Fly.io**:
   ```bash
   fly auth login
   ```

### Step 1: Create the Required Volume

Run this command **on your local machine**:

```bash
fly volume create contest_data -r iad -n 2 --app tattoo-contest
```

**What this does:**
- Creates a persistent volume named `contest_data`
- Places it in the `iad` (Iowa) region
- Creates 2 replicas for redundancy
- Allocates 1 GB of storage (default)

**Expected output:**
```
        ID: vol_xxxxxxxxxxxxxxxx
      Name: contest_data
    Status: created
      Size: 1 GB
    Region: iad
Created at: 2025-11-08T...
```

### Step 2: Verify the Volume

```bash
fly volumes list --app tattoo-contest
```

You should see:
```
NAME          SIZE  REGION  ID
contest_data  1 GB  iad     vol_xxxxxxxxxxxxxxxx
```

### Step 3: Retry Deployment

Once the volume is created, run the deployment again:

```bash
fly deploy --app tattoo-contest
```

Or use the exact command from your deployment attempt:

```bash
flyctl deploy -a tattoo-contest --image registry.fly.io/tattoo-contest:deployment-75e7828aa6c3a94c9b19a5d9b50a5d16 --depot-scope=app --config fly.toml
```

## 📋 Why We Need This Volume

The `fly.toml` configuration specifies that your app needs persistent storage:

```toml
[mounts]
source = "contest_data"
destination = "/data"
```

This volume stores:
- Contest entries (`/data/entries.json`)
- Contest state (`/data/state.json`)
- Application backups

Without this volume, data would be lost every time your app restarts.

## 🔗 Reference Documentation

See `docs/DEPLOYMENT_GUIDE.md` for complete deployment procedures and troubleshooting.

## ❓ Troubleshooting

**If volume creation fails with "already exists":**
```bash
# Check existing volumes
fly volumes list --app tattoo-contest

# If you need to delete an old volume first:
fly volume delete <VOLUME_ID> --app tattoo-contest
```

**If deployment still fails after volume creation:**
1. Verify volumes are created: `fly volumes list --app tattoo-contest`
2. Check app status: `fly status --app tattoo-contest`
3. Review logs: `fly logs --app tattoo-contest`
4. See `docs/DEPLOYMENT_GUIDE.md` for troubleshooting section

---

**Ready? Run the volume creation command on your local machine!** ⬆️
