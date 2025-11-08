#!/bin/bash

# Tattoo Contest Fly.io Deployment Script
# Creates persistent volumes and deploys the application

set -e

APP_NAME="tattoo-contest"
REGION="iad"
INSTANCES=2

echo "╔════════════════════════════════════════════════════════════════════════════╗"
echo "║                   TATTOO CONTEST FLY.IO DEPLOYMENT                        ║"
echo "║                    Creating Volumes & Deploying App                        ║"
echo "╚════════════════════════════════════════════════════════════════════════════╝"
echo ""

# Check if flyctl is installed
if ! command -v flyctl &> /dev/null; then
    echo "❌ ERROR: flyctl is not installed"
    echo "   Please install Fly CLI: https://fly.io/docs/hands-on/install-flyctl/"
    exit 1
fi

echo "✅ flyctl is installed"
echo ""

# Step 1: Create contest_data volume
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "Step 1: Creating 'contest_data' volume (1 GB)"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "Command: fly volumes create contest_data -r $REGION -n $INSTANCES --app $APP_NAME"
echo ""
read -p "Create contest_data volume? (y/n) " -n 1 -r
echo
if [[ $REPLY =~ ^[Yy]$ ]]; then
    flyctl volumes create contest_data -r $REGION -n $INSTANCES --app $APP_NAME
    echo "✅ contest_data volume created"
else
    echo "⏭️  Skipped"
fi

echo ""

# Step 2: Create contest_backups volume
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "Step 2: Creating 'contest_backups' volume (2 GB)"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "Command: fly volumes create contest_backups -r $REGION -n $INSTANCES --app $APP_NAME"
echo ""
read -p "Create contest_backups volume? (y/n) " -n 1 -r
echo
if [[ $REPLY =~ ^[Yy]$ ]]; then
    flyctl volumes create contest_backups -r $REGION -n $INSTANCES --app $APP_NAME
    echo "✅ contest_backups volume created"
else
    echo "⏭️  Skipped"
fi

echo ""

# Step 3: Create contest_uploads volume
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "Step 3: Creating 'contest_uploads' volume (5 GB)"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "Command: fly volumes create contest_uploads -r $REGION -n $INSTANCES --app $APP_NAME"
echo ""
read -p "Create contest_uploads volume? (y/n) " -n 1 -r
echo
if [[ $REPLY =~ ^[Yy]$ ]]; then
    flyctl volumes create contest_uploads -r $REGION -n $INSTANCES --app $APP_NAME
    echo "✅ contest_uploads volume created"
else
    echo "⏭️  Skipped"
fi

echo ""

# Step 4: List created volumes
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "Verifying volumes..."
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
flyctl volumes list --app $APP_NAME

echo ""

# Step 5: Deploy
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "Step 4: Deploying application"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "Command: fly deploy --app $APP_NAME"
echo ""
read -p "Deploy application? (y/n) " -n 1 -r
echo
if [[ $REPLY =~ ^[Yy]$ ]]; then
    flyctl deploy --app $APP_NAME
    echo ""
    echo "✅ Application deployed"
else
    echo "⏭️  Deployment skipped"
    echo "   Run 'fly deploy --app $APP_NAME' when ready"
fi

echo ""
echo "╔════════════════════════════════════════════════════════════════════════════╗"
echo "║                        ✅ DEPLOYMENT COMPLETE                             ║"
echo "╚════════════════════════════════════════════════════════════════════════════╝"
echo ""
echo "Next steps:"
echo "  1. Monitor logs: fly logs --app $APP_NAME"
echo "  2. Check status: fly status --app $APP_NAME"
echo "  3. Test app: https://tattoo-contest.fly.dev/health"
echo ""
