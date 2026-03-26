---
name: deploy
description: Deploy leadgen code to VPS. Commits current changes, pushes to VPS via git, VPS auto-restarts.
user_invocable: true
---

# Deploy to VPS

Deploy the current local code to the VPS. This skill:
1. Checks for uncommitted changes
2. Commits them with a descriptive message
3. Pushes to VPS via git remote (triggers post-receive hook = auto deploy + restart)
4. Verifies the process restarted correctly

## Steps

1. Run `git status` in `C:\Users\julie\leadgen` to see changes
2. If there are changes, stage and commit them (ask user for commit message if unclear)
3. Push to VPS:
   ```bash
   cd /c/Users/julie && GIT_SSH_COMMAND="ssh -i ~/.ssh/id_ed25519" git push vps master
   ```
4. Verify startup:
   ```bash
   ssh -i ~/.ssh/id_ed25519 ubuntu@146.59.233.252 "cat /home/openclaw/leadgen/logs/out.log && echo '---ERRORS---' && cat /home/openclaw/leadgen/logs/error.log"
   ```
5. Report success or failure to user

## Important
- NEVER deploy files individually with scp. Always use git push.
- The git root is `C:\Users\julie` (not `C:\Users\julie\leadgen`). The `cd /c/Users/julie` before push is required.
- The VPS post-receive hook handles the checkout and process restart automatically.
- If the push fails, check `ssh -i ~/.ssh/id_ed25519 ubuntu@146.59.233.252` connectivity first.
