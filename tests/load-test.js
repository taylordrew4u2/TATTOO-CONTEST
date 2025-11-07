42
/**
 * Load Testing for Tattoo Contest App
 * Simulates peak concurrent users with realistic event patterns
 */

const axios = require('axios');
const io = require('socket.io-client');

const BASE_URL = process.env.TEST_URL || 'http://localhost:3000';
const CONCURRENT_USERS = parseInt(process.env.CONCURRENT_USERS || '50');
const DURATION_SECONDS = parseInt(process.env.DURATION || '60');
const SUBMISSION_RATE = parseFloat(process.env.SUBMISSION_RATE || '0.2'); // submissions per second

// Metrics
const metrics = {
  totalRequests: 0,
  successRequests: 0,
  failedRequests: 0,
  avgResponseTime: 0,
  maxResponseTime: 0,
  minResponseTime: Infinity,
  responseTimes: [],
  socketConnections: 0,
  socketErrors: 0,
  startTime: Date.now()
};

// Simulate a single user session
async function simulateUserSession(userId) {
  try {
    // 1. Connect via Socket.io
    const socket = await new Promise((resolve, reject) => {
      const s = io(BASE_URL, { 
        transports: ['websocket'],
        reconnection: true,
        reconnectionDelay: 100
      });
      s.on('connect', () => resolve(s));
      s.on('connect_error', reject);
      setTimeout(() => reject(new Error('Connect timeout')), 5000);
    });
    
    metrics.socketConnections++;
    
    // 2. Fetch categories
    await measureRequest(async () => {
      await axios.get(`${BASE_URL}/categories.json`);
    });

    // 3. Listen for real-time events
    socket.on('newSubmission', (entry) => {
      // Simulate viewing submission
    });

    // 4. Periodically check feed
    const feedInterval = setInterval(async () => {
      await measureRequest(async () => {
        await axios.get(`${BASE_URL}/api/feed`);
      });
    }, 3000 + Math.random() * 5000); // Every 3-8 seconds

    // 5. Randomly submit (based on SUBMISSION_RATE)
    if (Math.random() < SUBMISSION_RATE / CONCURRENT_USERS) {
      const categories = await axios.get(`${BASE_URL}/categories.json`);
      const cat = categories.data[Math.floor(Math.random() * categories.data.length)];
      
      // Simulate file upload (mock)
      await measureRequest(async () => {
        const formData = new FormData();
        formData.append('category', cat.id);
        formData.append('caption', `Test submission ${userId}-${Date.now()}`);
        formData.append('name', `Artist ${userId}`);
        formData.append('phone', '555-0000');
        // In real scenario, would append actual file
        try {
          await axios.post(`${BASE_URL}/api/submit`, formData);
        } catch (err) {
          // Expected if no file
        }
      });
    }

    // Keep connection alive for session duration
    await new Promise(resolve => setTimeout(resolve, (DURATION_SECONDS * 1000) / CONCURRENT_USERS));

    clearInterval(feedInterval);
    socket.disconnect();
  } catch (err) {
    metrics.socketErrors++;
    console.error(`User ${userId} error: ${err.message}`);
  }
}

// Measure request performance
async function measureRequest(fn) {
  const start = Date.now();
  try {
    await fn();
    const duration = Date.now() - start;
    metrics.totalRequests++;
    metrics.successRequests++;
    metrics.responseTimes.push(duration);
    metrics.maxResponseTime = Math.max(metrics.maxResponseTime, duration);
    metrics.minResponseTime = Math.min(metrics.minResponseTime, duration);
  } catch (err) {
    metrics.totalRequests++;
    metrics.failedRequests++;
  }
}

// Stress test: Rapid concurrent connections
async function stressTestConnections() {
  console.log(`\n📊 STRESS TEST: ${CONCURRENT_USERS} concurrent connections for ${DURATION_SECONDS}s`);
  console.log('Starting user simulations...\n');

  const startTime = Date.now();
  const promises = [];

  // Spawn users
  for (let i = 0; i < CONCURRENT_USERS; i++) {
    promises.push(simulateUserSession(i));
    // Stagger connection starts
    await new Promise(resolve => setTimeout(resolve, 100));
  }

  // Wait for test duration
  await new Promise(resolve => setTimeout(resolve, DURATION_SECONDS * 1000));

  // Wait for all sessions to complete
  await Promise.allSettled(promises);

  const totalTime = Date.now() - startTime;

  // Calculate stats
  const avgResponseTime = metrics.responseTimes.length > 0
    ? metrics.responseTimes.reduce((a, b) => a + b, 0) / metrics.responseTimes.length
    : 0;

  // Report results
  console.log('\n' + '='.repeat(60));
  console.log('LOAD TEST RESULTS');
  console.log('='.repeat(60));
  console.log(`Duration: ${(totalTime / 1000).toFixed(2)}s`);
  console.log(`Total Requests: ${metrics.totalRequests}`);
  console.log(`Successful: ${metrics.successRequests} (${(metrics.successRequests / metrics.totalRequests * 100).toFixed(1)}%)`);
  console.log(`Failed: ${metrics.failedRequests}`);
  console.log(`Requests/sec: ${(metrics.totalRequests / (totalTime / 1000)).toFixed(2)}`);
  console.log(`\nResponse Times:`);
  console.log(`  Min: ${metrics.minResponseTime}ms`);
  console.log(`  Avg: ${avgResponseTime.toFixed(2)}ms`);
  console.log(`  Max: ${metrics.maxResponseTime}ms`);
  console.log(`\nSocket.io:`);
  console.log(`  Connections: ${metrics.socketConnections}`);
  console.log(`  Errors: ${metrics.socketErrors}`);
  console.log('='.repeat(60));

  // Pass/Fail criteria
  const p95 = metrics.responseTimes.sort((a, b) => a - b)[Math.floor(metrics.responseTimes.length * 0.95)];
  const passed = {
    responseTimes: avgResponseTime < 500,
    p95ResponseTime: p95 < 1000,
    errorRate: (metrics.failedRequests / metrics.totalRequests) < 0.05,
    socketConnections: metrics.socketErrors === 0
  };

  console.log('\nPASS/FAIL:');
  console.log(`  Avg Response Time < 500ms: ${passed.responseTimes ? '✓' : '✗'}`);
  console.log(`  P95 Response Time < 1000ms: ${passed.p95ResponseTime ? '✓' : '✗'}`);
  console.log(`  Error Rate < 5%: ${passed.errorRate ? '✓' : '✗'}`);
  console.log(`  No Socket Errors: ${passed.socketConnections ? '✓' : '✗'}`);

  return Object.values(passed).every(v => v);
}

// Spike test: Sudden traffic surge
async function spikeTest() {
  console.log('\n📈 SPIKE TEST: 10x normal traffic surge');
  
  const normalUsers = CONCURRENT_USERS;
  const spikeUsers = normalUsers * 10;
  
  console.log(`Normal: ${normalUsers} users, Spike: ${spikeUsers} users\n`);

  // Run normal load
  const normalStart = Date.now();
  const normalMetrics = { ...metrics, responseTimes: [] };
  
  // Reset and run spike
  metrics.responseTimes = [];
  metrics.successRequests = 0;
  metrics.failedRequests = 0;
  
  const promises = [];
  for (let i = 0; i < spikeUsers; i++) {
    promises.push(simulateUserSession(i));
  }
  
  await Promise.allSettled(promises);
  
  const spikeTime = Date.now() - normalStart;
  const spikeAvgResponseTime = metrics.responseTimes.length > 0
    ? metrics.responseTimes.reduce((a, b) => a + b, 0) / metrics.responseTimes.length
    : 0;

  console.log('\nSPIKE TEST RESULTS:');
  console.log(`  Duration: ${(spikeTime / 1000).toFixed(2)}s`);
  console.log(`  Avg Response Time: ${spikeAvgResponseTime.toFixed(2)}ms`);
  console.log(`  Success Rate: ${(metrics.successRequests / (metrics.successRequests + metrics.failedRequests) * 100).toFixed(1)}%`);
  
  // Pass if system handles 10x surge with <10% failure rate
  const passed = (metrics.failedRequests / (metrics.successRequests + metrics.failedRequests)) < 0.1;
  console.log(`  Result: ${passed ? '✓ PASSED' : '✗ FAILED'}`);

  return passed;
}

// Memory leak detection: sustained load
async function memoryLeakTest() {
  console.log('\n🧠 MEMORY LEAK TEST: 5 minute sustained load');
  
  // Note: Requires monitoring external memory usage
  console.log('(Monitor memory usage in separate process)');
  
  const testDuration = 5 * 60 * 1000; // 5 minutes
  const startTime = Date.now();
  const memSamples = [];
  
  // Periodic memory checks (would need server instrumentation)
  const memInterval = setInterval(() => {
    const elapsed = (Date.now() - startTime) / 1000;
    console.log(`${elapsed.toFixed(0)}s: Requests=${metrics.totalRequests}, Success=${metrics.successRequests}`);
  }, 30000);

  // Run sustained load
  const promises = [];
  for (let i = 0; i < CONCURRENT_USERS; i++) {
    promises.push(simulateUserSession(i));
  }
  
  await Promise.allSettled(promises);
  clearInterval(memInterval);

  console.log('Memory leak test completed. Check for growing memory usage.');
}

// Main
async function runLoadTests() {
  console.log('🚀 Tattoo Contest Load Testing Suite');
  console.log(`URL: ${BASE_URL}`);
  console.log(`Concurrent Users: ${CONCURRENT_USERS}`);
  console.log(`Duration: ${DURATION_SECONDS}s`);
  console.log(`Submission Rate: ${SUBMISSION_RATE} per second\n`);

  try {
    const stressResult = await stressTestConnections();
    
    if (process.argv.includes('--spike')) {
      await spikeTest();
    }
    
    if (process.argv.includes('--memory')) {
      await memoryLeakTest();
    }

    process.exit(stressResult ? 0 : 1);
  } catch (err) {
    console.error('Test error:', err);
    process.exit(1);
  }
}

if (require.main === module) {
  runLoadTests();
}

module.exports = { stressTestConnections, spikeTest, memoryLeakTest };
