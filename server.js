42
require('dotenv').config();
const express = require('express');
const http = require('http');
const path = require('path');
const multer = require('multer');
const cloudinary = require('cloudinary').v2;
const cors = require('cors');
const session = require('express-session');
const fs = require('fs');
const AtomicPersistence = require('./lib/atomic-persistence');
const RealtimeReliability = require('./lib/realtime-reliability');

const app = express();
const server = http.createServer(app);
const { Server } = require('socket.io');
const io = new Server(server);

// Initialize real-time reliability
const realtime = new RealtimeReliability(io, {
  heartbeatInterval: 30000,      // Send heartbeat every 30 seconds
  heartbeatTimeout: 45000,       // Disconnect if no pong after 45 seconds
  maxQueueSize: 1000,            // Max 1000 messages per offline client
  initialBackoffDelay: 1000,     // Start with 1 second delay
  backoffMultiplier: 2,          // Double the delay each retry
  maxBackoffDelay: 30000         // Cap at 30 seconds
});

const PORT = process.env.PORT || 3000;
const DATA_FILE = path.join(__dirname, 'data.json');
const UPLOADS_DIR = path.join(__dirname, 'uploads');

// Initialize atomic persistence
const persistence = new AtomicPersistence(__dirname, 'data.json');

// Ensure upload directory exists
if (!fs.existsSync(UPLOADS_DIR)) {
  fs.mkdirSync(UPLOADS_DIR, { recursive: true });
  console.log('✓ Created uploads directory');
}

cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key: process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET,
});

app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(session({
  secret: 'tattoo-secret',
  resave: false,
  saveUninitialized: true,
}));

// Admin page route
app.get('/admin', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'admin.html'));
});

// Serve static
app.use('/', express.static(path.join(__dirname, 'public')));

// Simple in-memory datastore with atomic file persistence
const categories = require('./categories.json');
let submissions = {}; // category -> array
let winners = {}; // category -> array of 2 ids

// Load from file with recovery
function loadData() {
  try {
    const data = persistence.loadWithRecovery();
    submissions = data.submissions || {};
    winners = data.winners || {};
    console.log('✅ Data loaded with atomic persistence');
  } catch (err) {
    console.error('Failed to load data:', err.message);
    submissions = {};
    winners = {};
  }
}

// Save to file with atomic transaction
function saveData(operationName = 'save') {
  try {
    const data = { submissions, winners };
    const result = persistence.saveTransaction(data, operationName);
    return result;
  } catch (err) {
    console.error('❌ CRITICAL SAVE FAILURE:', err.message);
    throw err;
  }
}

loadData();
for (const c of categories) {
  if (!submissions[c.id]) submissions[c.id] = [];
  if (!winners[c.id]) winners[c.id] = [];
}

// Multer for handling multipart uploads
const storage = multer.diskStorage({
  destination: function (req, file, cb) {
    cb(null, UPLOADS_DIR);
  },
  filename: function (req, file, cb) {
    // Generate descriptive filename: timestamp-random.extension
    const ext = path.extname(file.originalname);
    const name = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}${ext}`;
    cb(null, name);
  }
});

const upload = multer({
  storage: storage,
  limits: {
    fileSize: 10 * 1024 * 1024 // 10MB limit
  },
  fileFilter: function (req, file, cb) {
    // Only accept image files
    if (file.mimetype.startsWith('image/')) {
      cb(null, true);
    } else {
      cb(new Error('Only image files are allowed'));
    }
  }
});

// Health check endpoints for monitoring
app.get('/health', (req, res) => {
  const health = {
    status: 'healthy',
    timestamp: new Date().toISOString(),
    uptime: process.uptime(),
    memory: process.memoryUsage(),
    categories: categories.length,
    submissions: Object.values(submissions).reduce((a, b) => a + b.length, 0),
    winners: Object.entries(winners).map(([cat, arr]) => ({ category: cat, count: arr.length }))
  };
  res.json(health);
});

// Detailed metrics endpoint (requires admin)
app.get('/api/metrics', requireAdmin, (req, res) => {
  const persistenceMetrics = persistence.getMetrics();
  const metrics = {
    timestamp: new Date().toISOString(),
    uptime: process.uptime(),
    memoryUsage: process.memoryUsage(),
    categories: {
      count: categories.length,
      list: categories
    },
    submissions: {
      total: Object.values(submissions).reduce((a, b) => a + b.length, 0),
      byCategory: Object.entries(submissions).map(([cat, arr]) => ({
        category: cat,
        count: arr.length,
        oldest: arr.length > 0 ? arr[arr.length - 1].createdAt : null,
        newest: arr.length > 0 ? arr[0].createdAt : null
      }))
    },
    winners: {
      total: Object.values(winners).reduce((a, b) => a + b.length, 0),
      byCategory: Object.entries(winners).map(([cat, arr]) => ({
        category: cat,
        count: arr.length
      }))
    },
    dataFile: {
      exists: fs.existsSync(DATA_FILE),
      sizeBytes: fs.existsSync(DATA_FILE) ? fs.statSync(DATA_FILE).size : 0
    },
    persistence: persistenceMetrics
  };
  res.json(metrics);
});

// Readiness check (for Kubernetes/orchestration)
app.get('/ready', (req, res) => {
  const isReady = 
    categories.length > 0 &&
    Object.keys(submissions).length > 0 &&
    fs.existsSync(DATA_FILE);
  
  if (isReady) {
    res.json({ ready: true });
  } else {
    res.status(503).json({ ready: false, reason: 'Data not fully loaded' });
  }
});

// expose categories to the frontend
app.get('/categories.json', (req, res) => res.json(categories));

// Admin: update categories
app.post('/api/categories', requireAdmin, (req, res) => {
  const { categories: newCats } = req.body;
  if (!Array.isArray(newCats)) return res.status(400).json({ error: 'Invalid format' });
  
  // Update in-memory categories and add new ones to submissions
  categories.length = 0;
  newCats.forEach(c => {
    categories.push(c);
    if (!submissions[c.id]) submissions[c.id] = [];
    if (!winners[c.id]) winners[c.id] = [];
  });
  
  res.json({ success: true });
});

// API: submit
app.post('/api/submit', upload.single('photo'), async (req, res) => {
  const submissionId = `sub-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  
  try {
    console.log(`\n📨 SUBMISSION START: ${submissionId}`);
    const { category, caption, name, phone } = req.body;
    
    if (!category || !submissions[category]) {
      return res.status(400).json({ error: 'Invalid category' });
    }

    // Upload to Cloudinary if configured, with local fallback
    let imageUrl = null;
    let storageMethod = 'none';

    if (req.file) {
      console.log(`📸 File received: ${req.file.filename} (${req.file.size} bytes)`);
      
      // Try Cloudinary first if configured
      if (process.env.CLOUDINARY_CLOUD_NAME && process.env.CLOUDINARY_API_KEY && process.env.CLOUDINARY_API_SECRET) {
        try {
          console.log('📤 Uploading to Cloudinary...');
          const result = await cloudinary.uploader.upload(req.file.path, { 
            folder: 'tattoo-contest',
            resource_type: 'auto'
          });
          imageUrl = result.secure_url;
          storageMethod = 'cloudinary';
          console.log('✅ Cloudinary upload successful:', imageUrl);
          
          // Delete local temp file after successful Cloudinary upload
          fs.unlink(req.file.path, (err) => {
            if (err) console.warn('⚠️ Could not delete temp file:', err.message);
          });
        } catch (cloudErr) {
          console.error('❌ Cloudinary upload failed:', cloudErr.message);
          console.error('   Error code:', cloudErr.http_code);
          console.error('   Error status:', cloudErr.status);
          console.log('🔄 Falling back to local storage...');
          
          // Fallback to local storage on Cloudinary failure
          imageUrl = `/uploads/${req.file.filename}`;
          storageMethod = 'local-fallback';
          console.log(`✅ Using local fallback storage: ${imageUrl}`);
        }
      } else {
        // Cloudinary not configured, use local storage
        imageUrl = `/uploads/${req.file.filename}`;
        storageMethod = 'local-primary';
        console.log('📁 Cloudinary not configured, using local storage:', imageUrl);
      }
    } else {
      console.warn('⚠️ No file uploaded with submission');
    }

    // Create submission entry
    const entry = {
      id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      category,
      caption: caption || '',
      name: name || '',
      phone: phone || '',
      imageUrl: imageUrl || null,
      storageMethod: storageMethod,
      createdAt: Date.now(),
      submissionId: submissionId  // For tracking in logs
    };

    console.log(`💾 Adding submission to in-memory store...`);
    // Save to in-memory store
    submissions[category].unshift(entry);
    
    // CRITICAL: ATOMIC TRANSACTION - Save to file with full safety guarantees
    console.log(`🔐 Starting atomic write transaction...`);
    let saveResult;
    try {
      saveResult = saveData(`submission-${category}-${entry.id}`);
      console.log(`✅ Atomic transaction completed successfully`);
      console.log(`   Transaction ID: ${saveResult.transactionId}`);
      console.log(`   Backup: ${saveResult.backup ? 'created' : 'none'}`);
    } catch (saveErr) {
      console.error(`❌ CRITICAL: Atomic save failed! Attempting recovery...`);
      console.error(`   Error: ${saveErr.message}`);
      
      // RECOVERY: Reload from file (should have backup)
      try {
        console.log(`🔄 Reloading data from file for recovery...`);
        loadData();
        console.log(`✅ Data reloaded, in-memory state restored`);
      } catch (reloadErr) {
        console.error(`❌ CRITICAL: Recovery failed! Data may be inconsistent.`);
        console.error(`   ${reloadErr.message}`);
        throw new Error('Data persistence failed and recovery was unsuccessful');
      }
    }

    console.log(`✅ Submission persisted: ${entry.id}`);
    console.log(`   Storage: ${storageMethod}`);
    console.log(`   Total in ${category}: ${submissions[category].length}`);

    // Emit to all connected clients in real-time with reliability
    const publicEntry = { 
      id: entry.id, 
      category: entry.category, 
      caption: entry.caption, 
      imageUrl: entry.imageUrl, 
      createdAt: entry.createdAt, 
      artist: 'Anonymous Artist' 
    };
    
    const broadcastResult = realtime.broadcastMessage('newSubmission', publicEntry, { queue: true });
    console.log(`📡 Real-time update broadcast: ${broadcastResult.deliveredTo.length} delivered, ${broadcastResult.queuedFor.length} queued`);

    console.log(`✅ SUBMISSION COMPLETE: ${submissionId}\n`);
    
    res.json({ 
      success: true, 
      entry, 
      storageMethod,
      submissionId: submissionId,
      persistenceConfirmed: true,
      transactionId: saveResult.transactionId
    });
  } catch (err) {
    console.error(`\n❌ SUBMISSION FAILED: ${submissionId}`);
    console.error(`   Error: ${err.message}`);
    console.error(`   Stack: ${err.stack}\n`);
    
    // Clean up temp file on error
    if (req.file) {
      fs.unlink(req.file.path, (err) => {
        if (err) console.warn('⚠️ Could not delete temp file on error:', err.message);
      });
    }
    
    res.status(500).json({ 
      error: 'Upload failed: ' + err.message,
      note: 'Submission may not have been saved. Please try again.',
      submissionId: submissionId
    });
  }
});

// Serve uploaded files if using local fallback
app.use('/uploads', express.static(path.join(__dirname, 'uploads')));

// Admin login
app.post('/api/login', (req, res) => {
  const { password } = req.body;
  if (password === (process.env.ADMIN_PASSWORD || 'pins2025lol')) {
    req.session.loggedIn = true;
    return res.json({ success: true });
  }
  res.status(401).json({ error: 'Invalid password' });
});

function requireAdmin(req, res, next) {
  if (req.session && req.session.loggedIn) return next();
  return res.status(401).json({ error: 'Unauthorized' });
}

// Admin: get all submissions
app.get('/api/submissions', requireAdmin, (req, res) => {
  console.log(`Admin fetching submissions:`, Object.entries(submissions).map(([k, v]) => `${k}: ${v.length}`));
  res.json({ submissions });
});

// Public: get public feed (masking names)
app.get('/api/feed', (req, res) => {
  const result = {};
  for (const k of Object.keys(submissions)) {
    result[k] = submissions[k].map(e => ({ id: e.id, caption: e.caption, imageUrl: e.imageUrl, artist: 'Anonymous Artist', createdAt: e.createdAt }));
  }
  res.json({ feed: result, winnersAvailable: Object.values(winners).some(arr => arr.length>0) });
});

// Public: get winners
app.get('/api/winners', (req, res) => {
  const result = {};
  for (const cat of categories) {
    result[cat.id] = (winners[cat.id] || []).map(id => {
      const entry = submissions[cat.id].find(s => s.id === id) || null;
      if (!entry) return null;
      return { id: entry.id, caption: entry.caption, imageUrl: entry.imageUrl };
    }).filter(Boolean);
  }
  res.json({ winners: result });
});

// Admin: save winners
app.post('/api/save-winners', requireAdmin, (req, res) => {
  const winnersId = `winners-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  
  try {
    console.log(`\n🏆 WINNERS UPDATE START: ${winnersId}`);
    const data = req.body; // expect { winners: { categoryId: [id1,id2], ... } }
    if (!data || !data.winners) return res.status(400).json({ error: 'Missing winners data' });
    
    console.log(`📝 Updating winners in in-memory store...`);
    for (const [cat, arr] of Object.entries(data.winners)) {
      winners[cat] = (arr || []).slice(0, 2);
      console.log(`   ${cat}: ${winners[cat].length} winner(s)`);
    }
    
    // ATOMIC TRANSACTION: Save winners
    console.log(`🔐 Starting atomic write transaction...`);
    let saveResult;
    try {
      saveResult = saveData(`winners-update-${winnersId}`);
      console.log(`✅ Atomic transaction completed successfully`);
      console.log(`   Transaction ID: ${saveResult.transactionId}`);
    } catch (saveErr) {
      console.error(`❌ Winners save failed! Attempting recovery...`);
      try {
        console.log(`🔄 Reloading from backup...`);
        loadData();
        throw new Error('Winners save failed but data reloaded from backup');
      } catch (reloadErr) {
        throw new Error('Winners save failed and recovery unsuccessful');
      }
    }

    // broadcast winners update using reliability layer
    console.log(`📡 Broadcasting winners update with reliability layer...`);
    const broadcastResult = realtime.broadcastMessage('winnersUpdated', { winners }, { queue: true });
    console.log(`   Delivered to ${broadcastResult.deliveredTo.length}, queued for ${broadcastResult.queuedFor.length}`);

    console.log(`✅ WINNERS UPDATE COMPLETE: ${winnersId}\n`);
    res.json({ success: true, transactionId: saveResult.transactionId });
  } catch (err) {
    console.error(`\n❌ WINNERS UPDATE FAILED: ${winnersId}`);
    console.error(`   Error: ${err.message}\n`);
    res.status(500).json({ 
      error: 'Save failed: ' + err.message,
      winnersId: winnersId
    });
  }
});

// Initialize real-time connection handling
realtime.initializeConnections();

// Real-time endpoints for monitoring
app.get('/api/realtime-health', (req, res) => {
  const health = realtime.getHealthStatus();
  const statusCode = health.status === 'healthy' ? 200 : 503;
  res.status(statusCode).json(health);
});

app.get('/api/realtime-metrics', (req, res) => {
  const metrics = realtime.getMetrics();
  res.json(metrics);
});

app.get('/api/realtime-fallback', (req, res) => {
  const fallback = realtime.getFallbackStatus();
  const statusCode = fallback.available ? 200 : 503;
  res.status(statusCode).json(fallback);
});

// Graceful shutdown handling
process.on('SIGTERM', () => {
  console.log('\n🛑 SIGTERM received, gracefully shutting down...');
  realtime.shutdown();
  server.close(() => {
    console.log('✅ Server shut down gracefully');
    process.exit(0);
  });
});

process.on('SIGINT', () => {
  console.log('\n🛑 SIGINT received, gracefully shutting down...');
  realtime.shutdown();
  server.close(() => {
    console.log('✅ Server shut down gracefully');
    process.exit(0);
  });
});

// Cleanup expired messages periodically
setInterval(() => {
  realtime.cleanupExpiredMessages();
}, 60000); // Every minute

server.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
  console.log(`Real-time service: ${realtime.isAvailable() ? '✅ Available' : '⚠️ Degraded'}`);
});
