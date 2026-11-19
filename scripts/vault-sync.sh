#!/bin/zsh
# Keeps the agent vault folder (its own git repo, e.g. inside your Obsidian vault)
# in sync with GitHub: commits your Obsidian edits, pulls what the agents wrote, pushes.
# Usage: vault-sync.sh "/path/to/your/vault/Agent Village"
# Run it every few minutes (see scripts/com.agentvillage.vault-sync.plist.template).
set -u
D="${1:-${AGENT_VAULT_DIR:-}}"
[ -n "$D" ] || { echo "usage: vault-sync.sh <vault folder>"; exit 2; }
cd "$D" 2>/dev/null || exit 0
export GIT_SSH_COMMAND="ssh -o BatchMode=yes -o ConnectTimeout=15"
ts() { date -u +%FT%TZ; }
git add -A
git diff --cached --quiet || git commit -q -m "Vault edits $(ts)"
if ! git pull -q --rebase --autostash; then
  git rebase --abort 2>/dev/null
  echo "$(ts) pull failed (conflict or offline) - nothing lost, will retry"
  exit 1
fi
git push -q 2>/dev/null || echo "$(ts) push failed (offline?) - will retry"
