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

const app = express();
const server = http.createServer(app);
const { Server } = require('socket.io');
const io = new Server(server);

const PORT = process.env.PORT || 3000;
const DATA_FILE = path.join(__dirname, 'data.json');
const UPLOADS_DIR = path.join(__dirname, 'uploads');

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

// Simple in-memory datastore with file persistence
const categories = require('./categories.json');
let submissions = {}; // category -> array
let winners = {}; // category -> array of 2 ids

// Load from file if exists
function loadData() {
  try {
    if (fs.existsSync(DATA_FILE)) {
      const data = JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
      submissions = data.submissions || {};
      winners = data.winners || {};
    }
  } catch (err) {
    console.error('Failed to load data:', err.message);
  }
}

// Save to file
function saveData() {
  try {
    fs.writeFileSync(DATA_FILE, JSON.stringify({ submissions, winners }, null, 2));
  } catch (err) {
    console.error('Failed to save data:', err.message);
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
    }
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
  try {
    const { category, caption, name, phone } = req.body;
    if (!category || !submissions[category]) return res.status(400).json({ error: 'Invalid category' });

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

    // Create submission entry (with imageUrl even if upload failed)
    const entry = {
      id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      category,
      caption: caption || '',
      name: name || '',
      phone: phone || '',
      imageUrl: imageUrl || null,
      storageMethod: storageMethod,
      createdAt: Date.now(),
    };

    // Save to in-memory store
    submissions[category].unshift(entry);
    
    // CRITICAL: Save to file immediately (fail-safe persistence)
    saveData();
    console.log(`✅ Submission saved to data.json in ${category}`);
    console.log(`   ID: ${entry.id} | Storage: ${storageMethod} | Total submissions: ${Object.values(submissions).reduce((a, b) => a + b.length, 0)}`);

    // Emit to all connected clients in real-time
    const publicEntry = { 
      id: entry.id, 
      category: entry.category, 
      caption: entry.caption, 
      imageUrl: entry.imageUrl, 
      createdAt: entry.createdAt, 
      artist: 'Anonymous Artist' 
    };
    io.emit('newSubmission', publicEntry);

    res.json({ success: true, entry, storageMethod });
  } catch (err) {
    console.error('❌ CRITICAL: Upload handler error:', err.message);
    console.error('   Stack:', err.stack);
    
    // Clean up temp file on error
    if (req.file) {
      fs.unlink(req.file.path, (err) => {
        if (err) console.warn('⚠️ Could not delete temp file on error:', err.message);
      });
    }
    
    res.status(500).json({ 
      error: 'Upload failed: ' + err.message,
      note: 'Submission was not saved. Please try again.'
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
  const data = req.body; // expect { winners: { categoryId: [id1,id2], ... } }
  if (!data || !data.winners) return res.status(400).json({ error: 'Missing winners data' });
  for (const [cat, arr] of Object.entries(data.winners)) {
    winners[cat] = (arr || []).slice(0,2);
  }
  saveData();

  // broadcast winners update
  io.emit('winnersUpdated', { winners });

  res.json({ success: true });
});

// Start socket
io.on('connection', (socket) => {
  // no-op; clients will receive events
});

server.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
