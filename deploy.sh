#!/bin/bash

##############################################################################
# AWS EC2 Deployment Script
# Deploys AWH Outbound Orchestrator to EC2 via SSH
#
# Usage:
#   ./deploy.sh <ec2-ip> <path-to-key.pem>
#
# Example:
#   ./deploy.sh 54.123.45.67 ~/Downloads/awh-key.pem
##############################################################################

set -e  # Exit on any error

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# Check arguments
if [ "$#" -ne 2 ]; then
    echo -e "${RED}Error: Missing arguments${NC}"
    echo "Usage: $0 <ec2-ip> <path-to-key.pem>"
    echo "Example: $0 54.123.45.67 ~/Downloads/awh-key.pem"
    exit 1
fi

EC2_IP=$1
KEY_FILE=$2
EC2_USER="ubuntu"
APP_DIR="/var/www/awh-orchestrator"
TEMP_DIR="/tmp/awh-deploy-$(date +%s)"

# Verify key file exists
if [ ! -f "$KEY_FILE" ]; then
    echo -e "${RED}Error: Key file not found: $KEY_FILE${NC}"
    exit 1
fi

echo -e "${GREEN}========================================${NC}"
echo -e "${GREEN}AWS EC2 Deployment Script${NC}"
echo -e "${GREEN}========================================${NC}"
echo ""
echo "EC2 IP: $EC2_IP"
echo "Key file: $KEY_FILE"
echo "Target directory: $APP_DIR"
echo ""

# Step 1: Build locally
echo -e "${YELLOW}Step 1: Building application locally...${NC}"
npm run build
echo -e "${GREEN}✓ Build complete${NC}"
echo ""

# Step 2: Create deployment package
echo -e "${YELLOW}Step 2: Creating deployment package...${NC}"
PACKAGE_NAME="awh-orchestrator-$(date +%Y%m%d-%H%M%S).tar.gz"
tar -czf "$PACKAGE_NAME" \
    --exclude='node_modules' \
    --exclude='.env' \
    --exclude='*.log' \
    --exclude='.git' \
    --exclude='*.tar.gz' \
    .

echo -e "${GREEN}✓ Package created: $PACKAGE_NAME${NC}"
echo ""

# Step 3: Upload to EC2
echo -e "${YELLOW}Step 3: Uploading to EC2...${NC}"
scp -i "$KEY_FILE" \
    -o StrictHostKeyChecking=no \
    "$PACKAGE_NAME" \
    "$EC2_USER@$EC2_IP:/tmp/"

echo -e "${GREEN}✓ Upload complete${NC}"
echo ""

# Step 4: Deploy on EC2
echo -e "${YELLOW}Step 4: Deploying on EC2...${NC}"

ssh -i "$KEY_FILE" \
    -o StrictHostKeyChecking=no \
    "$EC2_USER@$EC2_IP" << 'ENDSSH'

set -e

APP_DIR="/var/www/awh-orchestrator"
PACKAGE_NAME=$(ls -t /tmp/awh-orchestrator-*.tar.gz | head -1)

echo "📦 Found package: $PACKAGE_NAME"

# Backup current version if exists
if [ -d "$APP_DIR" ]; then
    echo "🔄 Backing up current version..."
    BACKUP_DIR="/var/www/awh-orchestrator-backup-$(date +%Y%m%d-%H%M%S)"
    cp -r "$APP_DIR" "$BACKUP_DIR"
    echo "✓ Backup created: $BACKUP_DIR"
fi

# Create directory if doesn't exist
mkdir -p "$APP_DIR"

# Extract new version
echo "📂 Extracting package..."
cd "$APP_DIR"

# Preserve .env if it exists
if [ -f ".env" ]; then
    cp .env /tmp/.env.backup
    echo "✓ Preserved .env file"
fi

# Extract
tar -xzf "$PACKAGE_NAME"

# Restore .env
if [ -f "/tmp/.env.backup" ]; then
    cp /tmp/.env.backup .env
    rm /tmp/.env.backup
    echo "✓ Restored .env file"
fi

# Install dependencies
echo "📥 Installing dependencies..."
npm install --production

# Create logs directory
mkdir -p logs

# Check if PM2 is running the app
if pm2 list | grep -q "awh-orchestrator"; then
    echo "🔄 Restarting PM2..."
    pm2 restart awh-orchestrator
else
    echo "🚀 Starting with PM2..."
    pm2 start ecosystem.config.js
    pm2 save
fi

# Show status
echo ""
echo "✅ Deployment complete!"
echo ""
pm2 status

# Cleanup
rm -f "$PACKAGE_NAME"

ENDSSH

echo -e "${GREEN}✓ Deployment complete on EC2${NC}"
echo ""

# Step 5: Verify deployment
echo -e "${YELLOW}Step 5: Verifying deployment...${NC}"

sleep 3  # Wait for app to start

# Test health endpoint
if curl -s --max-time 5 "http://$EC2_IP:3000/health" > /dev/null; then
    echo -e "${GREEN}✓ Application is responding${NC}"
    echo ""
    echo "Health check: http://$EC2_IP:3000/health"
else
    echo -e "${YELLOW}⚠ Warning: Could not reach health endpoint${NC}"
    echo "The app may still be starting up, or port 3000 may not be open in security group"
fi

# Cleanup local package
rm -f "$PACKAGE_NAME"

echo ""
echo -e "${GREEN}========================================${NC}"
echo -e "${GREEN}Deployment Summary${NC}"
echo -e "${GREEN}========================================${NC}"
echo ""
echo "Application deployed to: $EC2_IP"
echo "Health endpoint: http://$EC2_IP:3000/health"
echo "Admin API: http://$EC2_IP:3000/api/admin/health"
echo ""
echo "Next steps:"
echo "1. SSH to EC2: ssh -i $KEY_FILE ubuntu@$EC2_IP"
echo "2. Check logs: pm2 logs awh-orchestrator"
echo "3. Monitor: pm2 monit"
echo "4. Setup Nginx reverse proxy (see EC2_DEPLOYMENT_GUIDE.md)"
echo "5. Configure SSL with Let's Encrypt"
echo ""
echo -e "${GREEN}✅ Deployment complete!${NC}"
