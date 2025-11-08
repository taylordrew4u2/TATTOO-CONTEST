#!/bin/bash

# Tattoo Contest - Fly.io Deployment Script
# This script handles volume creation and deployment

set -e

# Load the Fly token
if [ -f .env.fly ]; then
    export FLY_API_TOKEN=$(cat .env.fly | grep FLY_API_TOKEN | cut -d= -f2)
fi

if [ -z "$FLY_API_TOKEN" ]; then
    echo "❌ Error: FLY_API_TOKEN not set"
    echo "Please set FLY_API_TOKEN environment variable or create .env.fly file"
    exit 1
fi

APP_NAME="tattoo-contest"
REGION="iad"
REPLICAS="2"

echo "╔════════════════════════════════════════════════════════════════╗"
echo "║   Tattoo Contest - Fly.io Deployment                          ║"
echo "╚════════════════════════════════════════════════════════════════╝"
echo ""

# Step 1: Check if fly CLI is available
echo "📋 Step 1: Checking Fly CLI..."
if ! command -v fly &> /dev/null; then
    echo "❌ Error: Fly CLI not found. Install it from https://fly.io/docs/hands-on/install-flyctl/"
    exit 1
fi
echo "✅ Fly CLI found: $(fly version)"
echo ""

# Step 2: Verify authentication
echo "🔐 Step 2: Verifying Fly.io authentication..."
if ! fly auth whoami &> /dev/null; then
    echo "❌ Error: Not authenticated with Fly.io"
    echo "Run: fly auth login"
    exit 1
fi
echo "✅ Authenticated as: $(fly auth whoami)"
echo ""

# Step 3: Create volumes if they don't exist
echo "💾 Step 3: Creating persistent volumes..."

# Check existing volumes
EXISTING_VOLUMES=$(fly volumes list --app "$APP_NAME" 2>/dev/null || echo "")

if echo "$EXISTING_VOLUMES" | grep -q "contest_data"; then
    echo "✅ Volume 'contest_data' already exists"
else
    echo "   Creating volume 'contest_data'..."
    fly volume create contest_data -r "$REGION" -n "$REPLICAS" --app "$APP_NAME" --yes
    echo "✅ Volume 'contest_data' created"
fi

if echo "$EXISTING_VOLUMES" | grep -q "contest_backups"; then
    echo "✅ Volume 'contest_backups' already exists"
else
    echo "   Creating volume 'contest_backups'..."
    fly volume create contest_backups -r "$REGION" -n "$REPLICAS" --app "$APP_NAME" --yes
    echo "✅ Volume 'contest_backups' created"
fi

if echo "$EXISTING_VOLUMES" | grep -q "contest_uploads"; then
    echo "✅ Volume 'contest_uploads' already exists"
else
    echo "   Creating volume 'contest_uploads'..."
    fly volume create contest_uploads -r "$REGION" -n "$REPLICAS" --app "$APP_NAME" --yes
    echo "✅ Volume 'contest_uploads' created"
fi

echo ""

# Step 4: Verify volumes
echo "📍 Step 4: Verifying volumes..."
fly volumes list --app "$APP_NAME"
echo ""

# Step 5: Deploy
echo "🚀 Step 5: Deploying application..."
fly deploy --app "$APP_NAME"
echo ""

# Step 6: Check deployment status
echo "📊 Step 6: Checking deployment status..."
fly status --app "$APP_NAME"
echo ""

# Step 7: Display health endpoints
echo "✅ Deployment Complete!"
echo ""
echo "📚 Next steps:"
echo "   • Check logs: fly logs --app $APP_NAME"
echo "   • Visit app: https://$APP_NAME.fly.dev"
echo "   • Health check: curl https://$APP_NAME.fly.dev/health"
echo "   • Real-time health: curl https://$APP_NAME.fly.dev/api/realtime-health"
echo ""
