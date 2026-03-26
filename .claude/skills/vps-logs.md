---
name: vps-logs
description: Check VPS leadgen logs — stdout, errors, and recent Supabase task logs
user_invocable: true
---

# Check VPS Logs

Quick access to VPS leadgen logs.

## Steps

1. Show process status:
   ```bash
   ssh -i ~/.ssh/id_ed25519 ubuntu@146.59.233.252 "ps aux | grep 'leadgen/src/index' | grep -v grep"
   ```

2. Show recent stdout + errors:
   ```bash
   ssh -i ~/.ssh/id_ed25519 ubuntu@146.59.233.252 "echo '=== STDOUT ===' && tail -20 /home/openclaw/leadgen/logs/out.log && echo '=== ERRORS ===' && tail -20 /home/openclaw/leadgen/logs/error.log"
   ```

3. Show last 20 Supabase task logs:
   ```bash
   ssh -i ~/.ssh/id_ed25519 ubuntu@146.59.233.252 "export PATH=/home/ubuntu/.nvm/versions/node/v20.20.1/bin:\$PATH && cd /home/openclaw/leadgen && node -e \"
   const { createClient } = require('@supabase/supabase-js');
   require('dotenv').config();
   const sb = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);
   (async () => {
     const { data } = await sb.from('logs').select('*').order('created_at', { ascending: false }).limit(20);
     data?.forEach(l => console.log(l.created_at?.substring(0,19), '|', l.level, '|', l.task, '|', l.message?.substring(0, 120)));
   })();
   \""
   ```

4. Summarize findings to user
