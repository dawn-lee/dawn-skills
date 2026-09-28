#!/usr/bin/env bash
# obsidian-inbox 的定时任务入口：解析 node/nvm 环境后执行 sediment.mjs。
# systemd 用的是非登录环境，PATH 里没有 nvm / npx，所以在这里补齐。
# 本脚本可能经 ~/.agents/skills/obsidian-inbox 软链被调用，-P 解析到仓库里的真实源码路径。
set -euo pipefail

SKILL_DIR="$(cd -P "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

# node：优先 nvm current，其次已安装的最高版本，最后退回 PATH
NODE_BIN=""
for candidate in \
  "${NVM_DIR:-$HOME/.nvm}/current/bin/node" \
  "$(ls -d "$HOME"/.nvm/versions/node/*/bin/node 2>/dev/null | sort -V | tail -1 || true)" \
  "/usr/local/bin/node" \
  "/usr/bin/node"; do
  if [ -n "$candidate" ] && [ -x "$candidate" ]; then NODE_BIN="$candidate"; break; fi
done
if [ -z "$NODE_BIN" ]; then
  NODE_BIN="$(command -v node || true)"
fi
if [ -z "$NODE_BIN" ]; then
  echo "obsidian-inbox: 找不到 node 可执行文件" >&2
  exit 127
fi

export PATH="$(dirname "$NODE_BIN"):$HOME/.local/bin:/usr/local/bin:/usr/bin:/bin:$PATH"
exec "$NODE_BIN" "$SKILL_DIR/scripts/sediment.mjs" "$@"
