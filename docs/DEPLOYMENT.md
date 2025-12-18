# Deployment Guide

## Branch Strategy

This repository uses a **dual-deployment strategy** with separate branches for testing and production:

### 🧪 Staging Environment (Render)
- **Branch:** `async-orchestrator`
- **Platform:** Render
- **URL:** [Your Render Service URL]
- **Auto-Deploy:** ✅ Enabled
- **Purpose:** Testing, development, and staging

### 🚀 Production Environment (AWS EC2)
- **Branch:** `prod`
- **Platform:** AWS EC2
- **URL:** https://blandlabs.utkarshjaiswal.dev
- **Auto-Deploy:** ✅ Enabled via GitHub Actions
- **Purpose:** Production traffic

---

## Deployment Workflows

### Staging Deployment (Render)

**Trigger:** Push to `async-orchestrator` branch

**Process:**
1. Push code to `async-orchestrator` branch
2. GitHub Actions runs build checks
3. Render auto-deploys from branch (configured via `render.yaml`)
4. Service restarts automatically
5. Verify at Render service URL

**Manual Deploy:**
```bash
# From async-orchestrator branch
git push origin async-orchestrator

# Or trigger from GitHub UI
# Go to Actions → Deploy to Render → Run workflow
```

**Configuration:**
- Managed via `render.yaml` in repository
- Environment variables set in Render Dashboard
- Health check: `GET /health`

---

### Production Deployment (AWS EC2)

**Trigger:** Push to `prod` branch

**Process:**
1. Merge changes from `async-orchestrator` to `prod`
2. Push to `prod` branch
3. GitHub Actions workflow triggered
4. Build and package application
5. Deploy to EC2 via SSH
6. PM2 restarts application
7. Health check verification

**Manual Deploy:**
```bash
# Merge staging to production
git checkout prod
git merge async-orchestrator
git push origin prod

# Or trigger from GitHub UI
# Go to Actions → Deploy to EC2 → Run workflow
```

**Configuration:**
- Managed via `.github/workflows/deploy-to-ec2.yml`
- Requires GitHub Secrets:
  - `EC2_SSH_AWH_PRIVATE_KEY`
  - `EC2_HOST`
  - `EC2_USER`
- Environment variables in `.env` on EC2 server

---

## Deployment Process

### Testing Changes (Staging)

1. **Develop on feature branch:**
   ```bash
   git checkout -b feature/your-feature
   # Make changes
   git commit -m "Add new feature"
   ```

2. **Merge to staging:**
   ```bash
   git checkout async-orchestrator
   git merge feature/your-feature
   git push origin async-orchestrator
   ```

3. **Verify on Render:**
   - Monitor deployment in Render Dashboard
   - Test at staging URL
   - Check logs for errors
   - Verify all features working

### Promoting to Production

1. **After staging verification:**
   ```bash
   git checkout prod
   git merge async-orchestrator
   ```

2. **Review changes:**
   ```bash
   git log --oneline async-orchestrator..prod
   git diff prod..async-orchestrator
   ```

3. **Deploy to production:**
   ```bash
   git push origin prod
   ```

4. **Monitor deployment:**
   - Watch GitHub Actions workflow
   - Check EC2 logs: `pm2 logs awh-orchestrator`
   - Verify health check
   - Monitor error logs

---

## Environment-Specific Configuration

### Render (Staging)
```env
NODE_ENV=development
LOG_LEVEL=debug
BLAND_WEBHOOK_URL=https://your-render-app.onrender.com/webhooks/bland-callback
```

### AWS EC2 (Production)
```env
NODE_ENV=production
LOG_LEVEL=info
BLAND_WEBHOOK_URL=https://blandlabs.utkarshjaiswal.dev/webhooks/bland-callback
```

---

## Rollback Procedures

### Render Rollback
1. Go to Render Dashboard
2. Select service → Deployments
3. Click "Rollback" on previous successful deployment
4. Or revert commit and push:
   ```bash
   git revert <commit-hash>
   git push origin async-orchestrator
   ```

### AWS EC2 Rollback
1. **Automatic backup:** Each deployment creates backup in `~/backups/`
2. **Manual rollback:**
   ```bash
   ssh ec2-user@your-ec2-host
   cd /var/www/awh-orchestrator
   # Restore from backup
   BACKUP_DIR=~/backups/awh-orchestrator-YYYYMMDD-HHMMSS
   sudo cp -r $BACKUP_DIR/* .
   pm2 restart awh-orchestrator
   ```
3. **Or revert and redeploy:**
   ```bash
   git checkout prod
   git revert <commit-hash>
   git push origin prod
   ```

---

## Health Checks

### Staging (Render)
```bash
curl https://your-render-app.onrender.com/health
```

### Production (AWS EC2)
```bash
curl https://blandlabs.utkarshjaiswal.dev/health
```

**Expected Response:**
```json
{
  "status": "ok",
  "timestamp": "2025-12-18T...",
  "uptime": 12345
}
```

---

## Monitoring

### Render Dashboard
- **URL:** https://dashboard.render.com
- **Metrics:** CPU, Memory, Request rate
- **Logs:** Real-time application logs
- **Events:** Deploy history

### AWS EC2
- **SSH Access:** `ssh ec2-user@<EC2_HOST>`
- **PM2 Status:** `pm2 status`
- **Logs:** `pm2 logs awh-orchestrator`
- **Restart:** `pm2 restart awh-orchestrator`

### Application Logs
```bash
# Render: View in Dashboard or via CLI
render logs -f

# AWS EC2: PM2 logs
pm2 logs awh-orchestrator --lines 100
```

---

## Troubleshooting

### Deployment Failed on Render
1. Check build logs in Render Dashboard
2. Verify `render.yaml` configuration
3. Check environment variables are set
4. Review application logs

### Deployment Failed on EC2
1. Check GitHub Actions logs
2. Verify SSH key and secrets
3. SSH to EC2 and check:
   ```bash
   pm2 status
   pm2 logs awh-orchestrator --err
   ls -la /var/www/awh-orchestrator
   ```

### Application Not Starting
1. **Check logs:** `pm2 logs awh-orchestrator`
2. **Verify .env:** Ensure all required variables set
3. **Check port:** Verify PORT=3000 is available
4. **Test locally:** `npm run build && npm start`

### Database/File Issues
1. **Render:** Check disk space and persistent storage
2. **EC2:**
   ```bash
   df -h  # Check disk space
   ls -la /var/www/awh-orchestrator/data
   ```

---

## GitHub Secrets Setup

Required secrets in GitHub repository settings:

### For AWS EC2 Deployment
- `EC2_SSH_AWH_PRIVATE_KEY`: SSH private key (base64 or plain text)
- `EC2_HOST`: EC2 instance IP or hostname
- `EC2_USER`: SSH user (usually `ec2-user`)

### For Render Deployment (Optional)
- `RENDER_DEPLOY_HOOK_URL`: Render deploy hook URL for manual triggers

**To add secrets:**
1. Go to GitHub repository → Settings → Secrets and variables → Actions
2. Click "New repository secret"
3. Add name and value
4. Save

---

## Pre-Deployment Checklist

Before deploying to **production**:

- [ ] All tests pass on staging
- [ ] Features verified on Render staging environment
- [ ] Breaking changes documented
- [ ] Database migrations completed (if any)
- [ ] Environment variables updated on EC2
- [ ] Team notified of deployment
- [ ] Rollback plan ready
- [ ] Monitor ready to check deployment

---

## Support

For deployment issues:
- **Render:** https://render.com/docs
- **AWS EC2:** Check CloudWatch logs or SSH to instance
- **GitHub Actions:** Review workflow logs in Actions tab
- **Team Contact:** [Your team contact info]
