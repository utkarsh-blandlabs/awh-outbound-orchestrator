#!/bin/bash

##############################################################################
# EC2 Initial Setup Script
# Run this script on your EC2 instance after first SSH connection
#
# Usage:
#   wget https://raw.githubusercontent.com/YOUR_REPO/ec2-setup.sh
#   chmod +x ec2-setup.sh
#   ./ec2-setup.sh
#
# Or copy/paste this script directly into EC2 terminal
##############################################################################

set -e  # Exit on any error

# Colors
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m'

echo -e "${GREEN}========================================${NC}"
echo -e "${GREEN}AWH Orchestrator - EC2 Setup${NC}"
echo -e "${GREEN}========================================${NC}"
echo ""

# Update system
echo -e "${YELLOW}Step 1: Updating system packages...${NC}"
sudo apt update && sudo apt upgrade -y
echo -e "${GREEN}✓ System updated${NC}"
echo ""

# Install Node.js 20.x
echo -e "${YELLOW}Step 2: Installing Node.js 20.x...${NC}"
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt install -y nodejs
echo -e "${GREEN}✓ Node.js installed: $(node --version)${NC}"
echo ""

# Install PM2
echo -e "${YELLOW}Step 3: Installing PM2...${NC}"
sudo npm install -g pm2
echo -e "${GREEN}✓ PM2 installed: $(pm2 --version)${NC}"
echo ""

# Install Nginx
echo -e "${YELLOW}Step 4: Installing Nginx...${NC}"
sudo apt install -y nginx
echo -e "${GREEN}✓ Nginx installed: $(nginx -v 2>&1)${NC}"
echo ""

# Install Git
echo -e "${YELLOW}Step 5: Installing Git...${NC}"
sudo apt install -y git
echo -e "${GREEN}✓ Git installed: $(git --version)${NC}"
echo ""

# Install additional useful tools
echo -e "${YELLOW}Step 6: Installing monitoring tools...${NC}"
sudo apt install -y htop curl wget unzip
echo -e "${GREEN}✓ Tools installed${NC}"
echo ""

# Create application directory
echo -e "${YELLOW}Step 7: Creating application directory...${NC}"
sudo mkdir -p /var/www/awh-orchestrator
sudo chown -R ubuntu:ubuntu /var/www/awh-orchestrator
echo -e "${GREEN}✓ Directory created: /var/www/awh-orchestrator${NC}"
echo ""

# Setup firewall (optional)
echo -e "${YELLOW}Step 8: Configuring firewall...${NC}"
sudo ufw allow 22/tcp    # SSH
sudo ufw allow 80/tcp    # HTTP
sudo ufw allow 443/tcp   # HTTPS
sudo ufw allow 3000/tcp  # Node.js (temporary, for testing)
# Don't enable UFW yet - user might get locked out
echo -e "${GREEN}✓ Firewall rules configured (not enabled yet)${NC}"
echo -e "${YELLOW}  To enable: sudo ufw enable${NC}"
echo ""

# Setup PM2 startup script
echo -e "${YELLOW}Step 9: Configuring PM2 startup...${NC}"
pm2 startup | tail -n 1 | bash
echo -e "${GREEN}✓ PM2 startup configured${NC}"
echo ""

# Setup automatic security updates
echo -e "${YELLOW}Step 10: Enabling automatic security updates...${NC}"
sudo apt install -y unattended-upgrades
sudo dpkg-reconfigure -plow unattended-upgrades
echo -e "${GREEN}✓ Automatic updates enabled${NC}"
echo ""

# Create backup directory
echo -e "${YELLOW}Step 11: Creating backup directory...${NC}"
mkdir -p /home/ubuntu/backups
echo -e "${GREEN}✓ Backup directory created${NC}"
echo ""

# Display summary
echo ""
echo -e "${GREEN}========================================${NC}"
echo -e "${GREEN}Setup Complete!${NC}"
echo -e "${GREEN}========================================${NC}"
echo ""
echo "Installed versions:"
echo "  Node.js: $(node --version)"
echo "  npm: $(npm --version)"
echo "  PM2: $(pm2 --version)"
echo "  Nginx: $(nginx -v 2>&1 | cut -d '/' -f2)"
echo ""
echo "Next steps:"
echo "1. Deploy your application to /var/www/awh-orchestrator"
echo "2. Create .env file with environment variables"
echo "3. Run: cd /var/www/awh-orchestrator && npm install --production"
echo "4. Run: npm run build"
echo "5. Run: pm2 start ecosystem.config.js"
echo "6. Configure Nginx (see nginx.conf template)"
echo "7. Setup SSL with: sudo certbot --nginx"
echo ""
echo -e "${GREEN} EC2 instance is ready for deployment!${NC}"
