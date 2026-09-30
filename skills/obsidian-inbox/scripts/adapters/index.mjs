/**
 * agent registry —— 把 cfg.agentAdapter 映射到具体 adapter 模块。
 *
 * 设计：归档端只依赖 { listSessions, findTranscriptPath? }，
 * 所以新接一个 agent 只需在 adapters/ 加一个文件 + 在这里登记。
 *
 * 支持的 agent（见 SKILL.md「多 agent 归档」）：
 *   dsh    默认，DSH 会话（投影 + transcript 兜底）
 *   qoder  Qoder-CN（~/.qoder-cn/projects）
 *   claude Claude Code（~/.claude/projects，无 jsonl 时回退 history.jsonl）
 *   codex  Codex CLI/desktop（~/.codex/archived_sessions）
 *   cursor Cursor（SQLite，暂未实现 — 见 SKILL.md）
 *   workbuddy WorkBuddy（~/.workbuddy/workbuddy.db 的 sessions 表，SQLite 元数据）
 *
 * cfg.agentAdapter 可以是单个 id，或逗号分隔的多个 id（按序合并）。
 * 默认 'dsh'，保持原行为。
 */
import * as dsh from './dsh.mjs';
import * as qoder from './qoder.mjs';
import * as claude from './claude.mjs';
import * as codex from './codex.mjs';
import * as workbuddy from './workbuddy.mjs';

const REGISTRY = {
  dsh: { mod: dsh, transcript: true },
  qoder: { mod: qoder },
  claude: { mod: claude },
  codex: { mod: codex },
  workbuddy: { mod: workbuddy },
};

export const AVAILABLE = Object.keys(REGISTRY);
export const DEFAULT = 'dsh';

/** 把 cfg.agentAdapter 解析成已登记的 adapter id 列表（未登记的忽略并告警）。 */
export function resolveAgents(cfg) {
  const raw = typeof cfg.agentAdapter === 'string' && cfg.agentAdapter.trim()
    ? cfg.agentAdapter : DEFAULT;
  const ids = raw.split(',').map((s) => s.trim()).filter(Boolean);
  const found = [];
  const unknown = [];
  for (const id of ids) {
    if (REGISTRY[id]) { if (!found.includes(id)) found.push(id); }
    else unknown.push(id);
  }
  if (unknown.length) {
    throw new Error(`未登记的 agentAdapter：${unknown.join('、')}；可用：${AVAILABLE.join('、')}`);
  }
  if (!found.length) return [REGISTRY[DEFAULT] ? DEFAULT : Object.keys(REGISTRY)[0]];
  return found;
}

/** 返回配置启用的 adapter 模块（带 id）。找不到 transcript 支持时用默认 dsh。 */
export function getAdapters(cfg) {
  return resolveAgents(cfg).map((id) => ({ id, ...REGISTRY[id] }));
}

/** 归档端回退 transcript 时用：找第一个支持 transcript 的 adapter。 */
export function transcriptAdapter(cfg) {
  const list = getAdapters(cfg);
  return list.find((a) => a.transcript) || REGISTRY[DEFAULT] ? list.find((a) => a.transcript) || { id: DEFAULT, ...REGISTRY[DEFAULT] } : null;
}
