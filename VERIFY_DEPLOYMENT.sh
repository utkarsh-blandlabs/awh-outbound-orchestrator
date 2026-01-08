#!/bin/bash
# Quick script to verify if transfer fix is deployed

echo "========================================="
echo "CHECKING IF TRANSFER FIX IS DEPLOYED"
echo "========================================="
echo ""

echo "1. Checking for 'Transfer detected' logs (indicates fix is active):"
ssh ubuntu@client.blandlabs.ai "cd awh-outbound-orchestrator && pm2 logs awh-orchestrator --lines 500 --nostream | grep 'Transfer detected'" | tail -5

echo ""
echo "2. Checking for 'SAFETY.*active call' logs (indicates active call detection):"
ssh ubuntu@client.blandlabs.ai "cd awh-outbound-orchestrator && pm2 logs awh-orchestrator --lines 500 --nostream | grep -i 'SAFETY.*active call'" | tail -5

echo ""
echo "3. Checking PM2 restart time (when was server last restarted):"
ssh ubuntu@client.blandlabs.ai "pm2 list | grep awh-orchestrator"

echo ""
echo "4. Checking if CallStateManager persistence is enabled:"
ssh ubuntu@client.blandlabs.ai "cd awh-outbound-orchestrator && pm2 logs awh-orchestrator --lines 500 --nostream | grep 'CallStateManager persistence enabled'" | tail -2

echo ""
echo "========================================="
echo "VERIFICATION COMPLETE"
echo "========================================="
echo ""
echo "If you see:"
echo "  ✅ 'Transfer detected - keeping line protected' -> Transfer fix is DEPLOYED"
echo "  ✅ 'SAFETY: Skipping redial - active call detected' -> Active call detection is WORKING"
echo "  ✅ 'CallStateManager persistence enabled' -> Hot deployment fix is DEPLOYED"
echo ""
echo "If you DON'T see these logs, the fix is NOT deployed yet."
