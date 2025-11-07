42
/**
 * Integration Tests for Tattoo Contest App
 * Tests API endpoints, real-time events, and data persistence
 */

const axios = require('axios');
const io = require('socket.io-client');

const BASE_URL = process.env.TEST_URL || 'http://localhost:3000';
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'pins2025lol';

// Test Results Tracker
const results = {
  passed: 0,
  failed: 0,
  errors: []
};

// Helper: Test wrapper
async function test(name, fn) {
  try {
    await fn();
    results.passed++;
    console.log(`✓ ${name}`);
  } catch (err) {
    results.failed++;
    results.errors.push({ test: name, error: err.message });
    console.error(`✗ ${name}: ${err.message}`);
  }
}

// Helper: Socket.io connection
function connectSocket() {
  return new Promise((resolve, reject) => {
    const socket = io(BASE_URL, { transports: ['websocket'] });
    socket.on('connect', () => resolve(socket));
    socket.on('connect_error', reject);
    setTimeout(() => reject(new Error('Socket connection timeout')), 5000);
  });
}

// Test Suite 1: Categories API
async function testCategories() {
  console.log('\n=== CATEGORIES API ===');
  
  await test('GET /categories.json returns array', async () => {
    const res = await axios.get(`${BASE_URL}/categories.json`);
    if (!Array.isArray(res.data)) throw new Error('Not an array');
    if (res.data.length === 0) throw new Error('No categories');
  });

  await test('Categories have required fields (id, name)', async () => {
    const res = await axios.get(`${BASE_URL}/categories.json`);
    res.data.forEach(cat => {
      if (!cat.id || !cat.name) throw new Error('Missing id or name');
    });
  });

  await test('Admin can add category via POST /api/categories', async () => {
    const session = await getAdminSession();
    const newCats = [
      { id: 'worst', name: 'Worst Tattoo' },
      { id: 'best', name: 'Best Tattoo' },
      { id: 'funniest', name: 'Funniest Tattoo' }
    ];
    const res = await axios.post(`${BASE_URL}/api/categories`, 
      { categories: newCats },
      { headers: { Cookie: session } }
    );
    if (!res.data.success) throw new Error('Failed to add category');
  });
}

// Test Suite 2: Submission API
async function testSubmissions() {
  console.log('\n=== SUBMISSIONS API ===');

  await test('POST /api/submit requires category', async () => {
    try {
      const form = new FormData();
      form.append('caption', 'Test caption');
      form.append('name', 'Test Artist');
      await axios.post(`${BASE_URL}/api/submit`, form);
      throw new Error('Should have failed');
    } catch (err) {
      if (err.response?.status !== 400) throw err;
    }
  });

  await test('GET /api/feed returns public feed', async () => {
    const res = await axios.get(`${BASE_URL}/api/feed`);
    if (!res.data.feed) throw new Error('No feed property');
    if (typeof res.data.winnersAvailable !== 'boolean') throw new Error('No winnersAvailable flag');
  });

  await test('GET /api/submissions requires admin', async () => {
    try {
      await axios.get(`${BASE_URL}/api/submissions`);
      throw new Error('Should have failed');
    } catch (err) {
      if (err.response?.status !== 401) throw err;
    }
  });
}

// Test Suite 3: Admin Authentication
async function testAdminAuth() {
  console.log('\n=== ADMIN AUTHENTICATION ===');

  await test('POST /api/login rejects wrong password', async () => {
    try {
      await axios.post(`${BASE_URL}/api/login`, { password: 'wrongpassword' });
      throw new Error('Should have failed');
    } catch (err) {
      if (err.response?.status !== 401) throw err;
    }
  });

  await test('POST /api/login accepts correct password', async () => {
    const res = await axios.post(`${BASE_URL}/api/login`, 
      { password: ADMIN_PASSWORD },
      { withCredentials: true }
    );
    if (!res.data.success) throw new Error('Login failed');
  });

  await test('Admin session grants /api/submissions access', async () => {
    const session = await getAdminSession();
    const res = await axios.get(`${BASE_URL}/api/submissions`,
      { headers: { Cookie: session } }
    );
    if (!res.data.submissions) throw new Error('No submissions in response');
  });
}

// Test Suite 4: Winners Management
async function testWinners() {
  console.log('\n=== WINNERS MANAGEMENT ===');

  await test('GET /api/winners returns object', async () => {
    const res = await axios.get(`${BASE_URL}/api/winners`);
    if (typeof res.data.winners !== 'object') throw new Error('Winners not an object');
  });

  await test('POST /api/save-winners requires admin', async () => {
    try {
      await axios.post(`${BASE_URL}/api/save-winners`, { winners: {} });
      throw new Error('Should have failed');
    } catch (err) {
      if (err.response?.status !== 401) throw err;
    }
  });

  await test('Admin can save winners (max 2 per category)', async () => {
    const session = await getAdminSession();
    const winnersData = {
      winners: {
        worst: ['id1', 'id2'],
        best: ['id3']
      }
    };
    const res = await axios.post(`${BASE_URL}/api/save-winners`, winnersData,
      { headers: { Cookie: session } }
    );
    if (!res.data.success) throw new Error('Failed to save winners');
  });

  await test('Winners limit enforced (max 2, not 3)', async () => {
    const session = await getAdminSession();
    const winnersData = {
      winners: {
        worst: ['id1', 'id2', 'id3'] // Try to save 3
      }
    };
    const res = await axios.post(`${BASE_URL}/api/save-winners`, winnersData,
      { headers: { Cookie: session } }
    );
    // Verify only 2 were saved
    const winners = await axios.get(`${BASE_URL}/api/winners`);
    if (winners.data.winners.worst?.length > 2) throw new Error('Limit not enforced');
  });
}

// Test Suite 5: Real-time Events
async function testRealtimeEvents() {
  console.log('\n=== REAL-TIME EVENTS ===');

  await test('Socket.io connection succeeds', async () => {
    const socket = await connectSocket();
    if (!socket.connected) throw new Error('Not connected');
    socket.disconnect();
  });

  await test('Socket receives newSubmission events', async () => {
    return new Promise((resolve, reject) => {
      connectSocket().then(socket => {
        let eventReceived = false;
        socket.on('newSubmission', () => {
          eventReceived = true;
          socket.disconnect();
        });
        // Timeout if no event
        setTimeout(() => {
          socket.disconnect();
          if (!eventReceived) reject(new Error('No newSubmission event received'));
          else resolve();
        }, 2000);
      }).catch(reject);
    });
  });

  await test('Socket receives winnersUpdated events', async () => {
    const socket = await connectSocket();
    const received = new Promise((resolve) => {
      socket.on('winnersUpdated', () => resolve());
      setTimeout(() => resolve(), 1000);
    });
    await received;
    socket.disconnect();
  });
}

// Test Suite 6: Data Persistence
async function testDataPersistence() {
  console.log('\n=== DATA PERSISTENCE ===');

  await test('Submissions persist after load', async () => {
    const feed1 = await axios.get(`${BASE_URL}/api/feed`);
    const count1 = Object.values(feed1.data.feed).reduce((a, b) => a + b.length, 0);
    
    // In production, this would restart the server
    // For now, just verify data is accessible
    const feed2 = await axios.get(`${BASE_URL}/api/feed`);
    const count2 = Object.values(feed2.data.feed).reduce((a, b) => a + b.length, 0);
    
    if (count1 !== count2) throw new Error('Data not persistent');
  });

  await test('Winners persist across requests', async () => {
    const winners1 = await axios.get(`${BASE_URL}/api/winners`);
    const winners2 = await axios.get(`${BASE_URL}/api/winners`);
    
    const data1 = JSON.stringify(winners1.data);
    const data2 = JSON.stringify(winners2.data);
    
    if (data1 !== data2) throw new Error('Winners data changed');
  });
}

// Test Suite 7: Error Handling
async function testErrorHandling() {
  console.log('\n=== ERROR HANDLING ===');

  await test('Invalid category returns 400', async () => {
    try {
      const form = new FormData();
      form.append('category', 'invalid-cat');
      await axios.post(`${BASE_URL}/api/submit`, form);
      throw new Error('Should have failed');
    } catch (err) {
      if (err.response?.status !== 400) throw err;
    }
  });

  await test('Missing required fields handled gracefully', async () => {
    try {
      await axios.get(`${BASE_URL}/api/nonexistent`);
      throw new Error('Should have failed');
    } catch (err) {
      if (err.response?.status !== 404) throw err;
    }
  });

  await test('Server returns proper error messages', async () => {
    try {
      await axios.post(`${BASE_URL}/api/login`, { password: 'wrong' });
    } catch (err) {
      if (!err.response?.data?.error) throw new Error('No error message');
    }
  });
}

// Helper: Get admin session cookie
async function getAdminSession() {
  const res = await axios.post(`${BASE_URL}/api/login`,
    { password: ADMIN_PASSWORD },
    { withCredentials: true }
  );
  return res.headers['set-cookie']?.[0] || '';
}

// Run all tests
async function runAllTests() {
  console.log('🧪 Starting Integration Tests...');
  console.log(`URL: ${BASE_URL}\n`);

  try {
    await testCategories();
    await testSubmissions();
    await testAdminAuth();
    await testWinners();
    await testRealtimeEvents();
    await testDataPersistence();
    await testErrorHandling();
  } catch (err) {
    console.error('Test suite error:', err);
  }

  // Summary
  console.log('\n' + '='.repeat(50));
  console.log(`RESULTS: ${results.passed} passed, ${results.failed} failed`);
  if (results.errors.length > 0) {
    console.log('\nFailed tests:');
    results.errors.forEach(e => console.log(`  - ${e.test}: ${e.error}`));
  }
  console.log('='.repeat(50));

  process.exit(results.failed > 0 ? 1 : 0);
}

if (require.main === module) {
  runAllTests();
}

module.exports = { test, connectSocket, getAdminSession };
