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
- 🚀 Real-time updates via Socket.io
- 📁 File upload with validation (image-only, 10MB max)
- 🌄 Cloudinary integration + local fallback storage
- � **Atomic database operations with zero data loss** (NEW)
- 💾 **Transaction-safe persistence with WAL recovery** (NEW)
- �📊 Health check endpoints and performance monitoring
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

## 🐳 Docker

The app is fully containerized with a production-ready Dockerfile:

```bash
docker build -t tattoo-contest .
docker run -p 3000:3000 tattoo-contest
```

## 📞 Support

For issues or questions, refer to:
1. `docs/DISASTER_RECOVERY.md` for troubleshooting
2. `docs/QUICK_REFERENCE.md` for quick answers
3. `docs/FILE_STORAGE_FIXES.md` for file upload issues

---

**Status:** ✅ Production-ready | **Last Updated:** November 2025

````
