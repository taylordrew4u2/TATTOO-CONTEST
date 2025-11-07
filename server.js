42
require('dotenv').config();
const express = require('express');
const http = require('http');
const path = require('path');
const multer = require('multer');
const cloudinary = require('cloudinary').v2;
const cors = require('cors');
const session = require('express-session');

const app = express();
const server = http.createServer(app);
const { Server } = require('socket.io');
const io = new Server(server);

const PORT = process.env.PORT || 3000;

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

// Simple in-memory datastore (replace with DB in production)
const categories = require('./categories.json');
const submissions = {}; // category -> array
const winners = {}; // category -> array of 3 ids
for (const c of categories) {
  submissions[c.id] = [];
  winners[c.id] = [];
}

// Multer for handling multipart uploads
const upload = multer({ dest: path.join(__dirname, 'uploads/') });

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

    // Upload to Cloudinary if configured, else return local path
    let imageUrl = null;
    if (req.file) {
      if (process.env.CLOUDINARY_CLOUD_NAME && process.env.CLOUDINARY_API_KEY && process.env.CLOUDINARY_API_SECRET) {
        try {
          const result = await cloudinary.uploader.upload(req.file.path, { folder: 'tattoo-contest' });
          imageUrl = result.secure_url;
        } catch (cloudErr) {
          console.error('Cloudinary upload error:', cloudErr);
          // fallback to local if Cloudinary fails
          imageUrl = `/uploads/${req.file.filename}`;
        }
      } else {
        // fallback to server path (not for production)
        imageUrl = `/uploads/${req.file.filename}`;
      }
    }

    const entry = {
      id: `${Date.now()}-${Math.random().toString(36).slice(2,8)}`,
      category,
      caption: caption || '',
      name: name || '',
      phone: phone || '',
      imageUrl,
      createdAt: Date.now(),
    };
    submissions[category].unshift(entry);
    console.log(`✓ New submission in ${category}:`, entry.caption);
    console.log(`Total submissions:`, Object.values(submissions).reduce((a,b) => a + b.length, 0));
    const publicEntry = { id: entry.id, category: entry.category, caption: entry.caption, imageUrl: entry.imageUrl, createdAt: entry.createdAt, artist: 'Anonymous Artist' };
    io.emit('newSubmission', publicEntry);

    res.json({ success: true, entry });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Upload failed' });
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
  const data = req.body; // expect { winners: { categoryId: [id1,id2,id3], ... } }
  if (!data || !data.winners) return res.status(400).json({ error: 'Missing winners data' });
  for (const [cat, arr] of Object.entries(data.winners)) {
    winners[cat] = (arr || []).slice(0,3);
  }

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
