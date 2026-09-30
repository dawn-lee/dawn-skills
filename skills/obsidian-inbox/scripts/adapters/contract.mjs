/**
 * 统一会话对象（contract）—— 所有 agent adapter 都要产出这个形状。
 * 归档端（collectSessions → buildDigest → LLM 精炼）只认这个对象，
 * 所以 adapter 层负责把各家格式映射进来，归档逻辑零改动。
 *
 * {
 *   id:            string   会话唯一 id（用于账本 keyed、--session 过滤）
 *   cwd:           string   会话工作目录（路由判领域用，可能为空）
 *   createdAt:     number   毫秒时间戳
 *   lastPromptAt:  number   毫秒时间戳（时间窗过滤、排序用）
 *   blank:         boolean  是否空会话（默认 false）
 *   title:         string   会话标题
 *   model:         string   模型名
 *   turns:         [{ turn, prompt, response }]   逐轮问答
 *   turnCount:     number   轮次
 * }
 */
export function makeSession({
  id, cwd = '', createdAt = 0, lastPromptAt = 0, blank = false,
  title = '', model = '', turns = [], turnCount,
}) {
  return {
    id, cwd, createdAt, lastPromptAt, blank, title, model,
    turns,
    turnCount: Number(turnCount) || turns.length,
  };
}

/**
 * 把 content 数组（Anthropic 风格 blocks）抽成纯文本。
 * 只取 type === 'text' 的 block；thinking / tool_use / tool_result 一律跳过
 * （与 DSH transcript 的 reasoning 跳过逻辑一致：那些不是可复用知识）。
 * content 也可能是纯字符串，直接返回。
 */
export function textOf(content) {
  if (typeof content === 'string') return content.trim();
  if (!Array.isArray(content)) return '';
  const parts = [];
  for (const b of content) {
    if (!b || typeof b !== 'object') continue;
    if (b.type === 'text' && typeof b.text === 'string') parts.push(b.text);
    // Codex 用 input_text / output_text 命名
    else if (b.type === 'input_text' && typeof b.text === 'string') parts.push(b.text);
    else if (b.type === 'output_text' && typeof b.text === 'string') parts.push(b.text);
  }
  return parts.join('\n').trim();
}

/**
 * 过滤各家 agent 注入的"噪音 prompt"—— 这些是 slash-command / 上下文注入，
 * 不是用户知识，若当 turn 会产生空 prompt 或污染归档。
 * 返回 null 表示该条应跳过。
 */
const NOISE_PATTERNS = [
  /^<local-command-caveat>/, /^<command-message>/, /^<command-name>/, /^<command-args>/,
  /^<(recommended_plugins|app-context|multi_agent_mode|environment_context)>/,
  /^#\s*\d+\s+\d+\.\d+\s+Installing/,          // 安装日志块
  /^#\s*Files? pasted by the user/, /^#\s*Files? pasted by/,
  /^\/model$/, /^\/clear$/, /^\/compact$/,          // Claude 斜杠命令
  /^<system-reminder>/, /^Caveat:\s*The messages below/,
  /^(codex|vscode|chat):\/\//i,                    // Codex 内部 thread 引用，不是人话 prompt
];
export function isNoisePrompt(text) {
  if (!text) return true;
  const t = text.trim();
  if (t.length < 2) return true;
  for (const re of NOISE_PATTERNS) if (re.test(t)) return true;
  return false;
}

/** 从首条用户消息提炼标题：去掉斜杠命令标记、换行、取前 N 字。 */
export function cleanTitle(prompt, max = 44) {
  let t = String(prompt || '').trim();
  t = t.replace(/^<[^>]+>/, '').replace(/^#\s*\d+[^\n]*\n?/, '').replace(/^\/\w+\s*/, '');
  t = t.replace(/\s+/g, ' ').trim();
  if (!t) return '';
  return t.length > max ? t.slice(0, max) + '…' : t;
}

/** 时间戳解析：ISO 字符串 / 毫秒 / 秒 都接受；解析失败返回 0。 */
export function toMs(v) {
  if (v === undefined || v === null) return 0;
  if (typeof v === 'number') return v > 1e12 ? v : (v > 1e9 ? v * 1000 : v);
  const n = Number(v);
  if (Number.isFinite(n)) return toMs(n);
  const t = Date.parse(String(v));
  return Number.isFinite(t) ? t : 0;
}

/** 时间窗判定（与原 collectSessions 一致：start <= lastPromptAt <= end）。 */
export function inWindow(s, win) {
  return s.lastPromptAt >= win.from && s.lastPromptAt <= win.to;
}

/**
 * 按 --excludeCwdPrefixes 过滤（cwd 为空时不过滤，交给归档端判 unclassified）。
 * Windows 的 cwd 来自会话元数据，是 `C:\x\y` 反斜杠写法，而配置里的前缀在 loadConfig
 * 阶段已归一成 `/` —— 直接 startsWith 永远不匹配（等于排除失效，实测会把 sediment
 * 自己的 headless 工作目录也当会话扫进来）。这里统一分隔符；win32 下再按大小写不敏感比。
 */
export function cwdExcluded(s, excludePrefixes) {
  if (!s.cwd) return false;
  const win = process.platform === 'win32';
  const norm = (p) => {
    const v = String(p).replace(/\\/g, '/');
    return win ? v.toLowerCase() : v;
  };
  const cwd = norm(s.cwd);
  return (excludePrefixes || []).some((p) => cwd.startsWith(norm(p)));
}
