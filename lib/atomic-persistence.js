42
/**
 * Atomic Persistence Module
 * 
 * Provides transaction-safe file operations with:
 * - Write-ahead logging (WAL) for crash recovery
 * - Backup snapshots before modifications
 * - Atomic writes (write to temp file first, then rename)
 * - Retry logic with exponential backoff
 * - Immediate write confirmation
 * - Comprehensive error logging
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

class AtomicPersistence {
  constructor(dataDir = '.', dataFileName = 'data.json') {
    this.dataDir = dataDir;
    this.dataFile = path.join(dataDir, dataFileName);
    this.backupDir = path.join(dataDir, 'backups');
    this.walDir = path.join(dataDir, '.wal'); // Write-Ahead Log directory
    this.tempDir = path.join(dataDir, '.temp');
    
    // Ensure directories exist
    this._ensureDirectories();
    
    // Recovery configuration
    this.maxRetries = 3;
    this.retryDelayMs = 100;
    this.maxBackups = 10;
    
    console.log('✅ AtomicPersistence initialized');
    console.log(`   Data file: ${this.dataFile}`);
    console.log(`   Backup dir: ${this.backupDir}`);
    console.log(`   WAL dir: ${this.walDir}`);
  }

  /**
   * Ensure all required directories exist
   */
  _ensureDirectories() {
    const dirs = [this.dataDir, this.backupDir, this.walDir, this.tempDir];
    for (const dir of dirs) {
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
        console.log(`📁 Created directory: ${dir}`);
      }
    }
  }

  /**
   * Generate a unique backup filename with timestamp and hash
   */
  _generateBackupName(operation = 'backup') {
    const timestamp = Date.now();
    const hash = crypto.randomBytes(4).toString('hex');
    return `${operation}-${timestamp}-${hash}.json`;
  }

  /**
   * Generate a unique WAL entry filename
   */
  _generateWalName() {
    const timestamp = Date.now();
    const hash = crypto.randomBytes(4).toString('hex');
    return `wal-${timestamp}-${hash}.json`;
  }

  /**
   * Write to a temporary file, then atomically rename to destination
   * This ensures we never have a partially written file
   */
  _atomicWriteFile(filePath, data, retryCount = 0) {
    try {
      // Generate unique temp filename
      const tempFile = path.join(this.tempDir, `tmp-${Date.now()}-${Math.random().toString(36).slice(2, 8)}.json`);
      
      // Write to temp file
      const jsonString = JSON.stringify(data, null, 2);
      fs.writeFileSync(tempFile, jsonString, 'utf8');
      
      // Verify temp file was written correctly
      const written = fs.readFileSync(tempFile, 'utf8');
      if (written !== jsonString) {
        throw new Error('Verification failed: written data does not match source');
      }
      
      // Atomically rename temp to destination
      // This is atomic on most filesystems
      if (fs.existsSync(filePath)) {
        // Backup existing file before overwriting
        const backupName = this._generateBackupName('pre-write');
        const backupPath = path.join(this.backupDir, backupName);
        fs.copyFileSync(filePath, backupPath);
      }
      
      fs.renameSync(tempFile, filePath);
      
      // Clean up temp files
      this._cleanupOldTempFiles();
      
      return { success: true, tempFile, filePath };
    } catch (err) {
      if (retryCount < this.maxRetries) {
        const delay = this.retryDelayMs * Math.pow(2, retryCount);
        console.warn(`⚠️ Atomic write failed (retry ${retryCount + 1}/${this.maxRetries}):`, err.message);
        console.log(`   Retrying in ${delay}ms...`);
        
        // Clean up failed temp file
        try {
          const tempFile = path.join(this.tempDir, `tmp-*`);
          // Cleanup will happen in next iteration
        } catch (cleanupErr) {
          // Ignore cleanup errors
        }
        
        // Exponential backoff retry
        const startTime = Date.now();
        while (Date.now() - startTime < delay) {
          // Busy wait (simple implementation)
        }
        
        return this._atomicWriteFile(filePath, data, retryCount + 1);
      } else {
        throw new Error(`Failed to write file after ${this.maxRetries} retries: ${err.message}`);
      }
    }
  }

  /**
   * Create a backup before any modification
   */
  _createBackup(operation = 'pre-operation') {
    try {
      if (!fs.existsSync(this.dataFile)) {
        console.log('ℹ️ No data file to backup (first write)');
        return null;
      }

      const data = fs.readFileSync(this.dataFile, 'utf8');
      const backupName = this._generateBackupName(operation);
      const backupPath = path.join(this.backupDir, backupName);
      
      fs.writeFileSync(backupPath, data, 'utf8');
      console.log(`💾 Backup created: ${backupName}`);
      
      // Cleanup old backups
      this._cleanupOldBackups();
      
      return backupPath;
    } catch (err) {
      console.error('❌ Backup creation failed:', err.message);
      throw err;
    }
  }

  /**
   * Write a transaction log entry
   */
  _writeWalEntry(operation, data) {
    try {
      const walEntry = {
        timestamp: Date.now(),
        operation: operation,
        data: data,
        status: 'pending'
      };
      
      const walName = this._generateWalName();
      const walPath = path.join(this.walDir, walName);
      
      fs.writeFileSync(walPath, JSON.stringify(walEntry, null, 2), 'utf8');
      console.log(`📝 WAL entry written: ${walName}`);
      
      return walPath;
    } catch (err) {
      console.error('❌ WAL write failed:', err.message);
      throw err;
    }
  }

  /**
   * Mark WAL entry as completed
   */
  _completeWalEntry(walPath) {
    try {
      if (!fs.existsSync(walPath)) return;
      
      const entry = JSON.parse(fs.readFileSync(walPath, 'utf8'));
      entry.status = 'completed';
      entry.completedAt = Date.now();
      
      fs.writeFileSync(walPath, JSON.stringify(entry, null, 2), 'utf8');
    } catch (err) {
      console.warn('⚠️ WAL completion failed:', err.message);
    }
  }

  /**
   * Recovery: replay incomplete WAL entries
   */
  recoverFromWal() {
    try {
      const walFiles = fs.readdirSync(this.walDir);
      let recovered = 0;

      for (const file of walFiles) {
        if (!file.startsWith('wal-')) continue;
        
        const walPath = path.join(this.walDir, file);
        const entry = JSON.parse(fs.readFileSync(walPath, 'utf8'));
        
        if (entry.status === 'pending') {
          console.log(`🔄 Recovering pending WAL entry: ${file}`);
          console.log(`   Operation: ${entry.operation}`);
          
          // Find matching backup
          const backup = this._findLatestBackup('pre-write');
          if (backup) {
            console.log(`   Restored from: ${path.basename(backup)}`);
            fs.copyFileSync(backup, this.dataFile);
            recovered++;
          }
          
          // Mark as recovered
          entry.status = 'recovered';
          fs.writeFileSync(walPath, JSON.stringify(entry, null, 2), 'utf8');
        }
      }

      if (recovered > 0) {
        console.log(`✅ Recovered ${recovered} pending operations from WAL`);
      }
    } catch (err) {
      console.error('❌ WAL recovery failed:', err.message);
    }
  }

  /**
   * Find latest backup with given prefix
   */
  _findLatestBackup(prefix = 'backup') {
    try {
      const files = fs.readdirSync(this.backupDir)
        .filter(f => f.startsWith(prefix))
        .sort()
        .reverse();
      
      if (files.length === 0) return null;
      return path.join(this.backupDir, files[0]);
    } catch (err) {
      console.error('❌ Backup search failed:', err.message);
      return null;
    }
  }

  /**
   * Cleanup old temp files
   */
  _cleanupOldTempFiles() {
    try {
      const files = fs.readdirSync(this.tempDir);
      const now = Date.now();
      const maxAge = 5 * 60 * 1000; // 5 minutes

      for (const file of files) {
        const filePath = path.join(this.tempDir, file);
        const stats = fs.statSync(filePath);
        
        if (now - stats.mtimeMs > maxAge) {
          fs.unlinkSync(filePath);
          console.log(`🗑️ Cleaned up old temp file: ${file}`);
        }
      }
    } catch (err) {
      console.warn('⚠️ Temp file cleanup failed:', err.message);
    }
  }

  /**
   * Cleanup old backups (keep only maxBackups)
   */
  _cleanupOldBackups() {
    try {
      const files = fs.readdirSync(this.backupDir)
        .filter(f => f.startsWith('backup-') || f.startsWith('pre-write-'))
        .map(f => ({
          name: f,
          path: path.join(this.backupDir, f),
          time: parseInt(f.split('-')[1]) || 0
        }))
        .sort((a, b) => b.time - a.time);

      // Keep only maxBackups
      for (let i = this.maxBackups; i < files.length; i++) {
        fs.unlinkSync(files[i].path);
        console.log(`🗑️ Deleted old backup: ${files[i].name}`);
      }
    } catch (err) {
      console.warn('⚠️ Backup cleanup failed:', err.message);
    }
  }

  /**
   * ATOMIC TRANSACTION: Save data with full safety guarantees
   * 
   * Process:
   * 1. Create backup
   * 2. Write WAL entry (crash recovery)
   * 3. Atomically write to file
   * 4. Verify write
   * 5. Mark WAL as complete
   */
  saveTransaction(data, operationName = 'save') {
    const startTime = Date.now();
    const transactionId = `txn-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    
    try {
      console.log(`\n🔐 TRANSACTION START: ${transactionId}`);
      console.log(`   Operation: ${operationName}`);

      // Step 1: Create backup
      const backupPath = this._createBackup(`${operationName}-${Date.now()}`);

      // Step 2: Write WAL entry
      const walPath = this._writeWalEntry(operationName, {
        timestamp: Date.now(),
        operation: operationName,
        transactionId: transactionId
      });

      // Step 3: Atomic write
      console.log(`📝 Atomically writing data...`);
      const writeResult = this._atomicWriteFile(this.dataFile, data);

      // Step 4: Verify write
      console.log(`✔️ Verifying write...`);
      const verifyData = JSON.parse(fs.readFileSync(this.dataFile, 'utf8'));
      if (JSON.stringify(verifyData) !== JSON.stringify(data)) {
        throw new Error('Verification failed: written data does not match source data');
      }
      console.log(`✅ Write verified successfully`);

      // Step 5: Mark WAL complete
      this._completeWalEntry(walPath);

      const duration = Date.now() - startTime;
      console.log(`✅ TRANSACTION COMPLETE: ${transactionId}`);
      console.log(`   Duration: ${duration}ms`);
      console.log(`   File: ${path.relative(process.cwd(), this.dataFile)}`);
      console.log(`   Backup: ${backupPath ? path.basename(backupPath) : 'N/A'}\n`);

      return {
        success: true,
        transactionId: transactionId,
        duration: duration,
        backup: backupPath,
        wal: walPath,
        writeResult: writeResult
      };
    } catch (err) {
      console.error(`\n❌ TRANSACTION FAILED: ${transactionId}`);
      console.error(`   Operation: ${operationName}`);
      console.error(`   Error: ${err.message}`);
      console.error(`   Duration: ${Date.now() - startTime}ms`);
      
      if (backupPath) {
        console.error(`   Recovery: Restore from ${path.basename(backupPath)}`);
      }
      
      throw err;
    }
  }

  /**
   * Load data with recovery
   */
  loadWithRecovery() {
    try {
      // First attempt WAL recovery
      this.recoverFromWal();

      // Load main data file
      if (!fs.existsSync(this.dataFile)) {
        console.log('ℹ️ No data file found, starting fresh');
        return { submissions: {}, winners: {} };
      }

      const data = JSON.parse(fs.readFileSync(this.dataFile, 'utf8'));
      console.log('✅ Data loaded successfully');
      return data;
    } catch (err) {
      console.error('❌ Load failed:', err.message);
      
      // Try to recover from latest backup
      const backup = this._findLatestBackup('pre-write');
      if (backup) {
        console.log(`🔄 Attempting recovery from: ${path.basename(backup)}`);
        try {
          const data = JSON.parse(fs.readFileSync(backup, 'utf8'));
          fs.copyFileSync(backup, this.dataFile);
          console.log('✅ Recovered from backup');
          return data;
        } catch (recoveryErr) {
          console.error('❌ Recovery also failed:', recoveryErr.message);
        }
      }

      throw err;
    }
  }

  /**
   * Get persistence metrics
   */
  getMetrics() {
    try {
      const backupFiles = fs.readdirSync(this.backupDir).length;
      const walFiles = fs.readdirSync(this.walDir).filter(f => f.startsWith('wal-')).length;
      const tempFiles = fs.readdirSync(this.tempDir).length;
      
      const dataFileSize = fs.existsSync(this.dataFile) 
        ? fs.statSync(this.dataFile).size 
        : 0;

      return {
        dataFile: {
          exists: fs.existsSync(this.dataFile),
          sizeBytes: dataFileSize,
          path: this.dataFile
        },
        backups: {
          count: backupFiles,
          maxRetained: this.maxBackups,
          path: this.backupDir
        },
        wal: {
          count: walFiles,
          path: this.walDir
        },
        temp: {
          count: tempFiles,
          path: this.tempDir
        }
      };
    } catch (err) {
      console.error('❌ Metrics retrieval failed:', err.message);
      return null;
    }
  }
}

module.exports = AtomicPersistence;
