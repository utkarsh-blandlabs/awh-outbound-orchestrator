#!/bin/bash

# ============================================================================
# Let's Encrypt SSL Setup Script for AWH Outbound Orchestrator
# ============================================================================
# Usage: ./install-ssl.sh your-domain.com /path/to/your-key.pem
#
# Example: ./install-ssl.sh awh-api.example.com ~/.ssh/awh-key.pem
#
# This script will:
# 1. Install Nginx and Certbot on EC2
# 2. Configure Nginx as reverse proxy
# 3. Obtain Let's Encrypt SSL certificate
# 4. Enable auto-renewal
# ============================================================================

set -e  # Exit on error

# Configuration
DOMAIN=$1
KEY_FILE=$2
EC2_IP="56.228.64.116"
EC2_USER="ubuntu"  # Change to 'ec2-user' for Amazon Linux

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# Functions
print_success() {
    echo -e "${GREEN}✅ $1${NC}"
}

print_error() {
    echo -e "${RED}❌ $1${NC}"
}

print_info() {
    echo -e "${YELLOW}ℹ️  $1${NC}"
}

# Validate arguments
if [ -z "$DOMAIN" ] || [ -z "$KEY_FILE" ]; then
    print_error "Missing required arguments"
    echo ""
    echo "Usage: ./install-ssl.sh <domain> <key-file>"
    echo ""
    echo "Example:"
    echo "  ./install-ssl.sh awh-api.example.com ~/.ssh/awh-key.pem"
    echo ""
    exit 1
fi

# Check if key file exists
if [ ! -f "$KEY_FILE" ]; then
    print_error "Key file not found: $KEY_FILE"
    exit 1
fi

# Check if domain resolves to EC2 IP
print_info "Checking DNS resolution for $DOMAIN..."
RESOLVED_IP=$(dig +short $DOMAIN | tail -n1)

if [ "$RESOLVED_IP" != "$EC2_IP" ]; then
    print_error "Domain $DOMAIN does not resolve to $EC2_IP"
    echo "  Current resolution: $RESOLVED_IP"
    echo "  Expected: $EC2_IP"
    echo ""
    echo "Please update your DNS settings and wait for propagation."
    echo ""
    read -p "Continue anyway? (y/N) " -n 1 -r
    echo
    if [[ ! $REPLY =~ ^[Yy]$ ]]; then
        exit 1
    fi
fi

print_success "DNS check passed"
echo ""
print_info "Setting up Let's Encrypt SSL for $DOMAIN on EC2 $EC2_IP"
echo ""

# SSH and run setup commands
ssh -i "$KEY_FILE" "$EC2_USER@$EC2_IP" bash << EOF
set -e

echo "🔄 Updating system packages..."
sudo apt update -y

echo "📦 Installing Nginx..."
sudo apt install nginx -y

echo "📦 Installing Certbot..."
sudo apt install certbot python3-certbot-nginx -y

echo "📝 Creating Nginx configuration..."
sudo tee /etc/nginx/sites-available/awh-orchestrator > /dev/null <<'NGINX_CONFIG'
# HTTP Server - Redirect to HTTPS
server {
    listen 80;
    server_name ${DOMAIN} www.${DOMAIN};

    # Let's Encrypt validation
    location /.well-known/acme-challenge/ {
        root /var/www/html;
    }

    # Redirect all HTTP to HTTPS
    location / {
        return 301 https://\\\$server_name\\\$request_uri;
    }
}

# HTTPS Server - Reverse Proxy to Node.js
server {
    listen 443 ssl http2;
    server_name ${DOMAIN} www.${DOMAIN};

    # SSL certificates (will be configured by Certbot)
    ssl_protocols TLSv1.2 TLSv1.3;
    ssl_ciphers HIGH:!aNULL:!MD5;
    ssl_prefer_server_ciphers on;

    # Security headers
    add_header Strict-Transport-Security "max-age=31536000; includeSubDomains" always;
    add_header X-Frame-Options "SAMEORIGIN" always;
    add_header X-Content-Type-Options "nosniff" always;
    add_header X-XSS-Protection "1; mode=block" always;

    # Client max body size (for large webhook payloads)
    client_max_body_size 10M;

    # Proxy settings
    proxy_http_version 1.1;
    proxy_set_header Upgrade \\\$http_upgrade;
    proxy_set_header Connection 'upgrade';
    proxy_set_header Host \\\$host;
    proxy_set_header X-Real-IP \\\$remote_addr;
    proxy_set_header X-Forwarded-For \\\$proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto \\\$scheme;
    proxy_cache_bypass \\\$http_upgrade;

    # Timeouts
    proxy_connect_timeout 60s;
    proxy_send_timeout 60s;
    proxy_read_timeout 60s;

    # All routes proxy to Node.js
    location / {
        proxy_pass http://localhost:3000;
    }

    # Webhook endpoints (extended timeouts)
    location /webhooks/ {
        proxy_pass http://localhost:3000;
        proxy_connect_timeout 120s;
        proxy_send_timeout 120s;
        proxy_read_timeout 120s;
    }

    # Admin API endpoints
    location /api/admin/ {
        proxy_pass http://localhost:3000;
    }
}
NGINX_CONFIG

echo "🔗 Enabling site..."
sudo ln -sf /etc/nginx/sites-available/awh-orchestrator /etc/nginx/sites-enabled/

echo "🧪 Testing Nginx configuration..."
sudo nginx -t

echo "🔄 Restarting Nginx..."
sudo systemctl restart nginx
sudo systemctl enable nginx

echo "📜 Obtaining SSL certificate from Let's Encrypt..."
sudo certbot --nginx --non-interactive --agree-tos --no-eff-email \\
    --email admin@${DOMAIN} \\
    -d ${DOMAIN} -d www.${DOMAIN} \\
    --redirect

echo "✅ SSL certificate installed successfully!"

echo "🔄 Setting up auto-renewal..."
sudo systemctl enable certbot.timer
sudo systemctl start certbot.timer

echo "🧪 Testing auto-renewal (dry run)..."
sudo certbot renew --dry-run

echo ""
echo "=========================================="
echo "🎉 SSL Setup Complete!"
echo "=========================================="
echo ""
echo "Your site is now available at:"
echo "  🌐 https://${DOMAIN}"
echo ""
echo "Test your API:"
echo "  curl https://${DOMAIN}/health"
echo ""
echo "Certificate details:"
sudo certbot certificates
echo ""
echo "Next steps:"
echo "1. Update .env file with: BLAND_WEBHOOK_URL=https://${DOMAIN}/webhooks/bland-callback"
echo "2. Update Bland.ai dashboard webhook URL"
echo "3. Update Convoso webhook URLs"
echo "4. Restart app: pm2 restart awh-orchestrator"
echo ""
EOF

print_success "Setup complete on EC2!"
echo ""
print_info "Testing HTTPS endpoint..."

sleep 3

# Test the endpoint
HEALTH_RESPONSE=$(curl -s -k "https://${DOMAIN}/health" || echo "failed")

if [[ $HEALTH_RESPONSE == *"ok"* ]]; then
    print_success "HTTPS endpoint is working!"
    echo ""
    echo "Response:"
    echo "$HEALTH_RESPONSE" | python3 -m json.tool 2>/dev/null || echo "$HEALTH_RESPONSE"
else
    print_error "HTTPS endpoint test failed"
    echo "Response: $HEALTH_RESPONSE"
fi

echo ""
echo "=========================================="
echo "📋 Summary"
echo "=========================================="
echo ""
echo "Domain:      $DOMAIN"
echo "EC2 IP:      $EC2_IP"
echo "Status:      SSL Installed"
echo ""
echo "URLs to update:"
echo "  1. .env file: BLAND_WEBHOOK_URL=https://${DOMAIN}/webhooks/bland-callback"
echo "  2. Bland.ai dashboard webhook"
echo "  3. Admin API: https://${DOMAIN}/api/admin/..."
echo ""
echo "Quick test:"
echo "  curl https://${DOMAIN}/health"
echo "  curl https://${DOMAIN}/api/admin/health?api_key=YOUR_KEY"
echo ""
print_success "All done! 🎉"
