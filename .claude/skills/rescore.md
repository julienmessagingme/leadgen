---
name: rescore
description: Re-score today's raw_signals without consuming BeReach credits. Uses raw_signals table.
user_invocable: true
---

# Re-score Today's Signals

Re-run the scoring pipeline on today's raw_signals WITHOUT re-collecting from BeReach.
Uses the `rescore-today.js` script on the VPS.

## Steps

1. Check how many raw_signals exist today:
   ```bash
   ssh -i ~/.ssh/id_ed25519 ubuntu@146.59.233.252 "export PATH=/home/ubuntu/.nvm/versions/node/v20.20.1/bin:\$PATH && cd /home/openclaw/leadgen && node -e \"
   const { createClient } = require('@supabase/supabase-js');
   require('dotenv').config();
   const sb = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);
   (async () => {
     const { count } = await sb.from('raw_signals').select('*', { count: 'exact', head: true }).gte('created_at', new Date().toISOString().split('T')[0] + 'T00:00:00');
     const { count: leadsCount } = await sb.from('leads').select('*', { count: 'exact', head: true }).gte('created_at', new Date().toISOString().split('T')[0] + 'T00:00:00');
     console.log('Raw signals today:', count);
     console.log('Leads already inserted today:', leadsCount);
   })();
   \""
   ```

2. Confirm with user before running

3. Run the rescore script (long-running, use background):
   ```bash
   ssh -i ~/.ssh/id_ed25519 ubuntu@146.59.233.252 "cd /home/openclaw/leadgen && export PATH=/home/ubuntu/.nvm/versions/node/v20.20.1/bin:\$PATH && node rescore-today.js 2>&1"
   ```

4. Report results when done

## Important
- This does NOT consume BeReach collection credits (no searchPostsByKeywords calls)
- It DOES consume BeReach enrichment credits (visitProfile + visitCompany for each signal)
- It DOES consume Anthropic API credits (Claude Haiku scoring for each signal)
- Daily lead limit of 50 applies (set in settings table)
