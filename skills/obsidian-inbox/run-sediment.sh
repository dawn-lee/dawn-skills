#!/usr/bin/env bash
# obsidian-inbox 的定时任务入口：解析 node 环境后执行 sediment.mjs。
#
# 为什么还需要它：systemd / cron / launchd 用的是非登录环境，PATH 里没有 nvm、asdf、
# Homebrew 的 bin，直接写 `node ...` 常常找不到 node。这个包装脚本按常见位置找一遍再 exec。
#
# 注意：scripts/install.mjs 安装调度时会**直接把 node 的绝对路径**写进 unit/plist，
# 所以自动调度并不依赖本脚本；它主要给手动运行、cron 兜底和无安装器的场景用。
# 本脚本可能经 ~/.agents/skills/obsidian-inbox 软链被调用，`cd -P` 解析到仓库真实源码路径。
set -euo pipefail

SKILL_DIR="$(cd -P "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

find_node() {
  # 1) 显式指定优先
  if [ -n "${OBSIDIAN_INBOX_NODE:-}" ] && [ -x "${OBSIDIAN_INBOX_NODE}" ]; then
    printf '%s\n' "${OBSIDIAN_INBOX_NODE}"; return 0
  fi
  # 2) 版本管理器当前版本（nvm / asdf / fnm / volta / mise）
  local candidates=(
    "${NVM_DIR:-$HOME/.nvm}/current/bin/node"
    "$HOME/.asdf/shims/node"
    "$HOME/.local/share/fnm/aliases/default/bin/node"
    "$HOME/.volta/bin/node"
    "$HOME/.local/share/mise/shims/node"
    # 3) 包管理器固定位置（Apple Silicon 的 Homebrew 在 /opt/homebrew）
    "/opt/homebrew/bin/node"
    "/usr/local/bin/node"
    "/usr/bin/node"
    "/opt/local/bin/node"
  )
  local c
  for c in "${candidates[@]}"; do
    if [ -n "$c" ] && [ -x "$c" ]; then printf '%s\n' "$c"; return 0; fi
  done
  # 4) nvm 下已安装的最高版本
  local newest
  newest="$(ls -d "$HOME"/.nvm/versions/node/*/bin/node 2>/dev/null | sort -V | tail -1 || true)"
  if [ -n "$newest" ] && [ -x "$newest" ]; then printf '%s\n' "$newest"; return 0; fi
  # 5) 兜底：PATH 里碰运气
  command -v node 2>/dev/null || true
}

NODE_BIN="$(find_node)"
if [ -z "$NODE_BIN" ]; then
  echo "obsidian-inbox: 找不到 node 可执行文件；请设置 OBSIDIAN_INBOX_NODE=/path/to/node" >&2
  exit 127
fi

# 让 sediment 内部再 spawn dsh 时也能找到 node 与常见 CLI 目录
export PATH="$(dirname "$NODE_BIN"):$HOME/.local/bin:/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:$PATH"
exec "$NODE_BIN" "$SKILL_DIR/scripts/sediment.mjs" "$@"
