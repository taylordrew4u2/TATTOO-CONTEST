````markdown
# TATTOO-CONTEST

A real-time tattoo contest web app where users submit photos to compete, and admins select winners with live updates.

**Live Demo:** https://tattoo-contest.fly.dev

## ✨ Features

### For Users
- 📸 Submit tattoo photos to contest categories with captions and contact info
- 🔴 Real-time live feed showing all submissions (artist names hidden for anonymity)
- 🏆 View winners on dedicated winners page
- Black, white, and red color scheme throughout

### For Admins
- 🔐 Secure login at `/admin` (password: `pins2025lol`)
- 📋 View all submissions with full details (artist name, phone)
- ⭐ Pick exactly 2 winners per category
- 📡 Changes broadcast live via Socket.io
- 🎯 Customize contest categories (add/delete)
- 💾 All data persists across server restarts

### Technical Features
- 🚀 **Real-time updates with Socket.io reliability layer** - Automatic reconnection, message queuing, heartbeat monitoring
- 🔄 **Graceful degradation** - Fallback recommendations when real-time unavailable
- 📁 File upload with validation (image-only, 10MB max)
- 🌄 Cloudinary integration + local fallback storage
- 🔐 **Atomic database operations with zero data loss** - WAL recovery, crash-safe transactions
- 💾 **Transaction-safe persistence** - Atomic writes with automatic backups
- � Health check endpoints and performance monitoring
- 🧪 50+ integration tests + load testing framework
- 📱 Responsive design with Socket.io real-time events

## 🔐 Data Safety (NEW!)

**Atomic Transactions:**
- Write-Ahead Logging (WAL) for crash recovery
- Automatic backup snapshots before every write
- Transaction-safe file operations (all-or-nothing)
- Write verification before client response
- Automatic retry with exponential backoff
- **Zero data loss guarantee** ✅

See `ATOMIC_IMPLEMENTATION_GUIDE.md` for details.

## 📦 Installation

```bash
npm install
```

## ▶️ Run Locally

```bash
npm start
```

Then open http://localhost:3000

## 🔑 Admin Access

- **URL:** http://localhost:3000/admin
- **Password:** `pins2025lol`

## 🚀 Deploy to Fly.io

```bash
flyctl deploy -a tattoo-contest
```

Or use the included `Dockerfile` and `fly.toml` configuration.

## ⚙️ Configuration

### Environment Variables (.env)
- `CLOUDINARY_CLOUD_NAME` - Your Cloudinary cloud name
- `CLOUDINARY_API_KEY` - Cloudinary API key
- `CLOUDINARY_API_SECRET` - Cloudinary API secret
- `PORT` - Server port (default: 3000)

**Current:** Pre-configured for production use

### File Storage
- **Upload Directory:** `./uploads/` (auto-created)
- **File Size Limit:** 10MB
- **Accepted Types:** Images only (PNG, JPG, GIF, WebP, etc.)
- **Storage Path:** Cloudinary (with local fallback)

## 📊 Endpoints

### Public APIs
- `GET /` - Main contest page
- `GET /winners` - Winners page
- `POST /api/submit` - Submit a photo (multipart/form-data)
- `GET /api/submissions` - Get all submissions

### Admin APIs
- `GET /admin` - Admin dashboard
- `GET /api/categories` - List categories
- `POST /api/categories` - Add category
- `DELETE /api/categories/:name` - Delete category
- `GET /api/admin-submissions` - Get all submissions (admin only)
- `PUT /api/winners` - Set winners

### Health Checks
- `GET /health` - Basic health check
- `GET /ready` - Readiness probe
- `GET /api/metrics` - Performance metrics

## 🧪 Testing

### Run Integration Tests
```bash
npm test
```

### Run Load Tests
```bash
npm run test:load
```

See `docs/TESTING_GUIDE.md` for comprehensive testing procedures.

## 📚 Documentation

- **[ATOMIC_IMPLEMENTATION_GUIDE.md](ATOMIC_IMPLEMENTATION_GUIDE.md)** - Complete atomic transactions guide
- **[docs/ATOMIC_TRANSACTIONS.md](docs/ATOMIC_TRANSACTIONS.md)** - Architecture and scenarios
- **[docs/ATOMIC_IMPLEMENTATION_SUMMARY.md](docs/ATOMIC_IMPLEMENTATION_SUMMARY.md)** - Implementation details
- **[docs/REALTIME_RELIABILITY.md](docs/REALTIME_RELIABILITY.md)** - Socket.io reliability, heartbeat, message queuing (NEW)
- **[docs/PRODUCTION_DEPLOYMENT.md](docs/PRODUCTION_DEPLOYMENT.md)** - Production deployment guide, volumes, scaling, troubleshooting (NEW)
- **[docs/TESTING_GUIDE.md](docs/TESTING_GUIDE.md)** - Complete testing procedures
- **[FILE_STORAGE_FIXES.md](docs/FILE_STORAGE_FIXES.md)** - File upload configuration fixes
- **[DISASTER_RECOVERY.md](docs/DISASTER_RECOVERY.md)** - Failure scenarios and recovery (12 scenarios)
- **[IMPLEMENTATION_SUMMARY.md](docs/IMPLEMENTATION_SUMMARY.md)** - Technical overview
- **[QUICK_REFERENCE.md](docs/QUICK_REFERENCE.md)** - Quick lookup guide

## 🏗️ Tech Stack

- **Backend:** Express.js 4.18.2
- **Real-time:** Socket.io 4.7.2
- **Runtime:** Node.js 20-Alpine (Docker)
- **File Upload:** multer with custom disk storage
- **Image Hosting:** Cloudinary + local fallback
- **Session:** express-session
- **Testing:** Jest, Artillery (load testing)
- **Deployment:** Fly.io

## 📋 Data Persistence

- Submissions and winners saved to `data.json`
- Survives server restarts
- Auto-creates backup on significant changes

## � Real-Time Reliability (NEW!)

The application includes production-grade Socket.io reliability with:

- **Automatic Reconnection** - Exponential backoff (1s → 30s max)
- **Message Queuing** - Offline clients queue messages (max 1000 per client, 5 min TTL)
- **Heartbeat Monitoring** - Detects broken connections every 30 seconds
- **Graceful Degradation** - Recommends fallback strategies when real-time unavailable
- **Health Monitoring** - Real-time service health endpoints and metrics

**Health Endpoints:**
- `GET /api/realtime-health` - Service health (200 if healthy, 503 if degraded)
- `GET /api/realtime-metrics` - Connection and performance metrics
- `GET /api/realtime-fallback` - Fallback status and recommendations

See `docs/REALTIME_RELIABILITY.md` for architecture and configuration.

## 🚀 Production Deployment (NEW!)

Enhanced Fly.io configuration with:

- **Persistent Volumes**
  - `contest_data` (1 GB) - Submissions and winners database
  - `contest_backups` (2 GB) - Atomic backup snapshots
  - `contest_uploads` (5 GB) - User-uploaded images

- **Health Checks** - Three-tier health monitoring
  - Readiness check (`/ready`)
  - Liveness check (`/health`)
  - Real-time service check (`/api/realtime-health`)

- **Graceful Shutdown** - 30-second shutdown window
  - Notifies clients
  - Saves final state atomically
  - Closes connections cleanly

- **Zero-Downtime Deployment** - Safe rolling updates

**Key Commands:**
```bash
# Create volumes (one-time)
fly volumes create contest_data --app tattoo-contest --size 1
fly volumes create contest_backups --app tattoo-contest --size 2
fly volumes create contest_uploads --app tattoo-contest --size 5

# Deploy
fly deploy --app tattoo-contest

# Monitor
fly status --app tattoo-contest
fly logs --app tattoo-contest
```

See `docs/PRODUCTION_DEPLOYMENT.md` for complete deployment guide and troubleshooting.

## �🐳 Docker

The app is fully containerized with a production-ready Dockerfile:

```bash
docker build -t tattoo-contest .
docker run -p 3000:3000 tattoo-contest
```

## 📞 Support

For issues or questions, refer to:
1. `docs/PRODUCTION_DEPLOYMENT.md` for deployment troubleshooting
2. `docs/REALTIME_RELIABILITY.md` for real-time issues
3. `docs/DISASTER_RECOVERY.md` for failure scenarios
4. `docs/QUICK_REFERENCE.md` for quick answers
5. `docs/FILE_STORAGE_FIXES.md` for file upload issues

---

**Status:** ✅ Production-ready | **Features:** Atomic Transactions, Real-Time Reliability, Production Deployment | **Last Updated:** January 2025

````
