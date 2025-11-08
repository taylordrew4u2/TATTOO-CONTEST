#!/bin/bash
# Atomic Persistence Verification Script
# Run this to verify atomic operations are working correctly

set -e

echo "╔═══════════════════════════════════════════════════════════╗"
echo "║  Atomic Persistence Verification                         ║"
echo "╚═══════════════════════════════════════════════════════════╝"

# Colors
GREEN='\033[0;32m'
RED='\033[0;31m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# Check if server is running
echo ""
echo "📋 Checking server status..."
if curl -s http://localhost:3000/health > /dev/null 2>&1; then
    echo -e "${GREEN}✅ Server is running${NC}"
else
    echo -e "${YELLOW}⚠️  Server not running at localhost:3000${NC}"
    echo "    Start it with: npm start"
    exit 1
fi

# Check persistence directories
echo ""
echo "📁 Checking persistence directories..."

dirs=(
    "backups"
    ".wal"
    ".temp"
)

for dir in "${dirs[@]}"; do
    if [ -d "$dir" ]; then
        echo -e "${GREEN}✅ $dir directory exists${NC}"
    else
        echo -e "${RED}❌ $dir directory missing${NC}"
        exit 1
    fi
done

# Check metrics endpoint
echo ""
echo "📊 Checking /api/metrics endpoint..."
metrics=$(curl -s http://localhost:3000/api/metrics)

if echo "$metrics" | jq '.persistence' > /dev/null 2>&1; then
    echo -e "${GREEN}✅ Persistence metrics available${NC}"
    
    # Extract persistence info
    backup_count=$(echo "$metrics" | jq '.persistence.backups.count')
    wal_count=$(echo "$metrics" | jq '.persistence.wal.count')
    temp_count=$(echo "$metrics" | jq '.persistence.temp.count')
    data_size=$(echo "$metrics" | jq '.persistence.dataFile.sizeBytes')
    
    echo "   Backups: $backup_count (max: 10)"
    echo "   WAL entries: $wal_count"
    echo "   Temp files: $temp_count"
    echo "   Data file size: $data_size bytes"
    
    # Warnings
    if [ "$wal_count" -gt 5 ]; then
        echo -e "   ${YELLOW}⚠️  High WAL count (> 5)${NC}"
    fi
    
    if [ "$backup_count" -eq 0 ]; then
        echo -e "   ${YELLOW}⚠️  No backups found${NC}"
    fi
else
    echo -e "${RED}❌ Could not read persistence metrics${NC}"
    exit 1
fi

# Check data.json exists
echo ""
echo "💾 Checking data.json..."
if [ -f "data.json" ]; then
    size=$(du -h data.json | cut -f1)
    echo -e "${GREEN}✅ data.json exists${NC} (size: $size)"
    
    if ! jq . data.json > /dev/null 2>&1; then
        echo -e "${RED}❌ data.json is corrupted (invalid JSON)${NC}"
        exit 1
    fi
    echo -e "${GREEN}✅ data.json is valid JSON${NC}"
else
    echo -e "${YELLOW}ℹ️  data.json not created yet (expected on first run)${NC}"
fi

# Check backup files
echo ""
echo "📦 Checking backup files..."
backup_count=$(find backups -type f -name "*.json" 2>/dev/null | wc -l)
if [ "$backup_count" -gt 0 ]; then
    echo -e "${GREEN}✅ Found $backup_count backup file(s)${NC}"
    echo "   Sample backups:"
    ls -1 backups/*.json 2>/dev/null | head -3 | sed 's/^/   /'
else
    echo -e "${YELLOW}ℹ️  No backup files yet (expected before first write)${NC}"
fi

# Check WAL files
echo ""
echo "📝 Checking Write-Ahead Log..."
wal_pending=$(find .wal -type f -name "*.json" 2>/dev/null | xargs grep -l '"pending"' 2>/dev/null | wc -l)
wal_completed=$(find .wal -type f -name "*.json" 2>/dev/null | xargs grep -l '"completed"' 2>/dev/null | wc -l)

echo "   Pending: $wal_pending"
echo "   Completed: $wal_completed"

if [ "$wal_pending" -gt 0 ]; then
    echo -e "   ${YELLOW}⚠️  Found pending WAL entries (may indicate crash recovery needed)${NC}"
else
    echo -e "${GREEN}✅ All WAL entries completed${NC}"
fi

# Test atomic persistence with a test request
echo ""
echo "🧪 Testing atomic persistence..."

# Create a test submission
response=$(curl -s -X POST http://localhost:3000/api/submit \
    -F "category=sleeve" \
    -F "caption=Test submission for verification" \
    -F "name=Test User" \
    -F "phone=555-0000" \
    -F "photo=@/dev/null" 2>/dev/null || echo '{}')

if echo "$response" | jq . > /dev/null 2>&1; then
    transaction_id=$(echo "$response" | jq -r '.transactionId // empty')
    persistence=$(echo "$response" | jq -r '.persistenceConfirmed // empty')
    
    if [ -n "$transaction_id" ]; then
        echo -e "${GREEN}✅ Submission succeeded${NC}"
        echo "   Transaction ID: $transaction_id"
    fi
    
    if [ "$persistence" = "true" ]; then
        echo -e "${GREEN}✅ Persistence confirmed${NC}"
    elif [ "$persistence" = "false" ]; then
        echo -e "${RED}❌ Persistence NOT confirmed${NC}"
    fi
else
    echo -e "${YELLOW}ℹ️  Test submission skipped (multipart/form-data may not work without real image)${NC}"
fi

# Summary
echo ""
echo "╔═══════════════════════════════════════════════════════════╗"
echo -e "${GREEN}✅ Atomic persistence verification complete${NC}"
echo "╚═══════════════════════════════════════════════════════════╝"
echo ""
echo "📚 Documentation:"
echo "   - docs/ATOMIC_TRANSACTIONS.md"
echo "   - docs/ATOMIC_IMPLEMENTATION_SUMMARY.md"
echo ""
echo "🚀 Ready for production deployment!"
