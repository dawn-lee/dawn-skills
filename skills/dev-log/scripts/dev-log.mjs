#!/usr/bin/env node
/**
 * dev-log.mjs — DEVELOPMENT_LOG.md 读写脚本（node 零依赖）
 *
 * 子命令：
 *   snapshot                 打印 git status --porcelain + git diff --stat 真值变更清单
 *   add [--req ..] [--files ..] [--summary ..] [--issues ..]
 *       [--theme ..] [--commit <hash>] [--continue <N>] [--file <path>]
 *                             新增/续记一条 Session 条目（默认取数值 max 编号 +1）
 *   index [--file <path>]     解析条目并按主题重建头部索引（同号多条标 #N×次数）
 *   link <hash> [--session <N>] [--section <标题片段>] [--file <path>]
 *                             把 commit 挂到指定条目（默认 Session 内最新一段续记）
 *   query <词> [--file <path>] 只打印匹配条目的 Session 号 + 需求首句 + 文件列表
 *
 * 通用：
 *   --file <path>   显式指定 DEVELOPMENT_LOG.md；缺省从 cwd 向上查找
 *   -h / --help     帮助
 */
import fs from 'node:fs';
import path from 'node:path';
import { execSync } from 'node:child_process';

const HELP = `用法: dev-log.mjs <子命令> [选项]

snapshot
    git status --porcelain + git diff --stat 真值变更清单（Agent 据此填"改动文件"）

add --req "需求" --files "a.java - 修改, 简述; b.java - 新增" \\
    --summary "变更摘要" [--issues "问题1; 问题2"] [--theme "callgraph, 线程池"] \\
    [--commit <hash>] [--continue <N>] [--file <path>]
    新建条目默认取数值 max 编号 +1；--continue <N> 则在 Session #N 下追加"（续）"段落
    --theme/--summary/--issues/--commit 在新建与续记两种模式下都生效
    要求 --req 与 --files 必填

index [--file <path>]
    解析全部 Session 条目，按主题聚合重建头部索引；缺主题标签的按改动文件推断
    主题来源优先级：条目 **主题**：标签 > 文件名推断 > "未分类"

link <hash> [--session <N>] [--section <标题片段>] [--file <path>]
    给指定条目补一行 commit：<hash>
    默认挂到 Session 内"最新一段"（含续记，文件靠下 = 最新）；
    --section 按标题片段唯一匹配某一段（回填历史条目用）

query <词> [--file <path>]
    匹配 需求/变更摘要/改动文件/主题，只打印 编号 + 需求首句 + 文件列表

--file <path>  显式指定 DEVELOPMENT_LOG.md；缺省从 cwd 向上查找
-h / --help    帮助
`;

/* ---------- 定位日志文件 ---------- */
// allowCreate=true 时：--file 指向不存在的路径可直接返回（供 add 初始化）；否则报错退出
function findLogFile(explicit, allowCreate = false) {
  if (explicit) {
    const f = path.resolve(explicit);
    if (allowCreate || fs.existsSync(f)) return f;
    console.error(`[dev-log] 找不到文件: ${f}`);
    process.exit(1);
  }
  let dir = process.cwd();
  while (true) {
    const f = path.join(dir, 'DEVELOPMENT_LOG.md');
    if (fs.existsSync(f)) return f;
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  if (allowCreate) return path.join(process.cwd(), 'DEVELOPMENT_LOG.md');
  console.error('[dev-log] 从', process.cwd(), '向上未找到 DEVELOPMENT_LOG.md，请用 --file 指定');
  process.exit(1);
}

/* ---------- 解析条目 ---------- */
function parseEntries(content) {
  const lines = content.split('\n');
  let i = 0;
  while (i < lines.length && !/^## Session/.test(lines[i])) i++;
  const segs = [];
  let cur = null;
  for (; i < lines.length; i++) {
    if (/^## Session/.test(lines[i])) {
      if (cur) segs.push(cur);
      cur = { header: lines[i], body: [], line: i + 1 };
    } else if (cur) {
      cur.body.push(lines[i]);
    }
  }
  if (cur) segs.push(cur);

  return segs.map((s) => {
    const m = s.header.match(/^## Session\s*#?\s*(\d+)\s*[-—:]?\s*([\d\- :T]*)/);
    const body = s.body.join('\n');
    const req = body.match(/\*\*需求\*\*：\s*\n\s*([^\n]+)/);
    const theme = body.match(/\*\*主题\*\*：\s*([^\n]+)/) || body.match(/主题[:：]\s*([^\n]+)/);
    const commit = body.match(/\bcommit\b[\s*]*[:：]\s*([0-9a-f]+)/i);
    const summary = body.match(/\*\*变更摘要\*\*：\s*\n\s*([^\n]+)/);
    const files = [...body.matchAll(/^\s*[-*]\s*`([^`]+)`/gm)].map((x) => x[1]);
    return {
      num: m ? m[1] : '?',
      date: m && m[2] ? m[2].trim() : '',
      req: req ? req[1].trim() : '',
      theme: theme ? theme[1].trim() : '',
      commit: commit ? commit[1] : '',
      summary: summary ? summary[1].trim() : '',
      files,
      line: s.line,
    };
  });
}

/* ---------- 主题推断（按改动文件路径） ---------- */
const THEME_RULES = [
  [/callgraph|callergraph|callee|caller|调用链|调用图|graph/i, '调用链分析'],
  [/thread|concurrent|executor|线程/i, '线程池 / 并发'],
  [/druid|datasource|pool|连接池/i, '连接池'],
  [/schedule|scheduler|定时|fetchapp|ntp|cron/i, '调度 / 定时任务'],
  [/\.sql|sql\/|dboper|migration|迁移|database|表/i, '数据库 / SQL'],
  [/deploy|\.sh\b|publish|部署/i, '部署脚本'],
  [/enum|枚举/i, '枚举'],
  [/methoddiff|methodhash|diff|差异/i, 'MethodDiff / 差异'],
  [/log|日志|observability/i, '日志 / 可观测'],
  [/docs?\/|claude\.md|readme|文档/i, '文档'],
  [/frontend|api-reference|前端/i, '前端 / 文档'],
  [/gc|memory|oom|内存/i, '内存 / GC'],
  [/maven|mvn|gradle|build|编译|jar/i, '构建 / Maven'],
];
function inferTheme(files) {
  const joined = files.join(' ').toLowerCase();
  for (const [re, label] of THEME_RULES) if (re.test(joined)) return label;
  return '未分类';
}

/* ---------- 构建索引 ---------- */
const USAGE_LINE1 = '> **用法（给 AI）**：排查改动历史前先读下方「索引」，按主题定位 Session 再跳读；需要精确 diff 时用条目 `commit` 行执行 `git show <hash>`。';
const USAGE_LINE2 = '> 说明：索引由 `dev-log index` 维护；条目编号/内容请勿手改。同号多条并列以 `#N×次数` 标注。';

function buildHeadBlock(indexLines) {
  return `# Development Log

AI-assisted development change history.

${USAGE_LINE1}
${USAGE_LINE2}

## 索引（脚本生成）
${indexLines.join('\n')}

---
`;
}

/* ---------- snapshot ---------- */
function cmdSnapshot() {
  let porcelain = '';
  try { porcelain = execSync('git status --porcelain', { encoding: 'utf8' }); } catch (e) { porcelain = '(非 git 仓库或无输出)'; }
  let diffstat = '';
  try { diffstat = execSync('git diff --stat', { encoding: 'utf8' }); } catch (e) { diffstat = '(无 diff)'; }
  let diffstatCached = '';
  try { diffstatCached = execSync('git diff --cached --stat', { encoding: 'utf8' }); } catch (e) { diffstatCached = ''; }

  const out = ['## git status --porcelain'];
  if (porcelain.trim()) {
    for (const line of porcelain.trimEnd().split('\n')) {
      const st = line.slice(0, 2).trim();
      const file = line.slice(3).replace(/^"(.*)"$/, '$1');
      const kind = st === '??' ? '新增' : st.includes('D') ? '删除' : st.includes('R') ? '重命名' : '修改';
      out.push(`  ${kind}: ${file}`);
    }
  } else out.push('  （工作区干净）');
  if (diffstat.trim()) out.push('## git diff --stat\n' + diffstat.trimEnd());
  if (diffstatCached.trim()) out.push('## git diff --cached --stat\n' + diffstatCached.trimEnd());
  console.log(out.join('\n'));
}

/* ---------- add ---------- */
function parseArgs(args) {
  const opts = { _: [] };
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a.startsWith('--')) {
      const key = a.slice(2);
      const val = args[i + 1] && !args[i + 1].startsWith('--') ? args[++i] : '';
      opts[key] = val;
    } else opts._.push(a);
  }
  return opts;
}

function nowStamp() {
  const d = new Date();
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

function cmdAdd(opts) {
  const logFile = findLogFile(opts.file, true);
  let content;
  try {
    content = fs.readFileSync(logFile, 'utf8');
  } catch {
    // 文件不存在 → 用脚本生成文件头（标题/说明/用法/索引占位/---），SKILL.md 承诺"脚本会生成文件头"
    content = buildHeadBlock([]);
    fs.writeFileSync(logFile, content);
    console.log(`[dev-log] 已创建 ${logFile}`);
  }
  const entries = parseEntries(content);
  const req = opts.req, files = opts.files;
  if (!req || !files) {
    console.error('[dev-log] add 必填 --req 与 --files');
    process.exit(1);
  }
  const contN = opts.continue;

  if (contN) {
    // 续记：在 Session #N 下追加"（续）"段落，不新建编号
    // 同号多条时取最靠上的（文件顶部 = 最新）
    const target = entries.find((e) => e.num === String(contN));
    if (!target) { console.error(`[dev-log] 未找到 Session #${contN}，无法续记`); process.exit(1); }
    const fileList = files.split(';').map((f) => f.trim()).filter(Boolean);
    const items = fileList.map((f) => `- \`${f}\``).join('\n');
    // 与新建条目同构：可选 --theme/--summary/--issues/--commit 一并写入，不再静默丢弃
    const issueList = opts.issues
      ? opts.issues.split(';').map((s) => s.trim()).filter(Boolean).map((s) => `- ${s}`).join('\n')
      : '';
    const parts = [`### （续）${req}`, '', '**改动文件**：', items];
    if (opts.theme) parts.push('', `**主题**：${opts.theme}`);
    if (opts.summary) parts.push('', '**变更摘要**：', opts.summary);
    if (issueList) parts.push('', '**遇到的问题**：', issueList);
    if (opts.commit) parts.push('', `**commit**：${opts.commit}`);
    const lines = content.split('\n');
    // 在目标条目末尾（下一个 ## Session 或文件末尾）之前插入
    let insertIdx = lines.length;
    for (let i = target.line; i < lines.length; i++) {
      if (/^## Session/.test(lines[i])) { insertIdx = i; break; }
    }
    const insertion = [];
    if (insertIdx > 0 && lines[insertIdx - 1] !== '') insertion.push('');
    insertion.push(parts.join('\n'), '');
    lines.splice(insertIdx, 0, ...insertion);
    fs.writeFileSync(logFile, lines.join('\n'));
    console.log(`[dev-log] Session #${contN} 已追加续记段落${opts.summary ? '（含变更摘要）' : ''}${opts.commit ? `，commit ${opts.commit}` : ''}`);
    return;
  }

  // 新建：数值 max + 1
  const maxN = entries.reduce((mx, e) => { const n = parseInt(e.num, 10); return Number.isFinite(n) && n > mx ? n : mx; }, 0);
  const next = maxN + 1;
  const themeLine = opts.theme ? `\n**主题**：\n${opts.theme}\n` : '';
  const commitLine = opts.commit ? `\n**commit**：${opts.commit}\n` : '';
  const issues = opts.issues
    ? opts.issues.split(';').map((s) => s.trim()).filter(Boolean).map((s) => `- ${s}`).join('\n')
    : '- 无';
  const fileItems = files.split(';').map((f) => f.trim()).filter(Boolean).map((f) => `- \`${f}\``).join('\n');
  // 与既有日志保持一致：条目间以 `---` 分隔
  const entry = `## Session #${next} - ${nowStamp()}

**需求**：
${req}
${themeLine}
**改动文件**：
${fileItems}

**变更摘要**：
${opts.summary || ''}

**遇到的问题**：
${issues}
${commitLine}
---
`;
  // 插入到第一个 ## Session 标题之前（最新在前）
  const lines = content.split('\n');
  let insertIdx = lines.length;
  for (let i = 0; i < lines.length; i++) {
    if (/^## Session/.test(lines[i])) { insertIdx = i; break; }
  }
  lines.splice(insertIdx, 0, entry.trimEnd());
  fs.writeFileSync(logFile, lines.join('\n'));
  console.log(`[dev-log] 已插入 Session #${next}（共 ${entries.length + 1} 条）`);
}

/* ---------- index ---------- */
// 解析现有索引块：{主题: {编号: 次数}}；行格式 `- 主题: #1, #7×2, #80`
function parseExistingIndex(content) {
  const map = {};
  const m = content.match(/## 索引（脚本生成）\n([\s\S]*?)\n---/);
  if (!m) return map;
  for (const line of m[1].split('\n')) {
    const lm = line.match(/^-\s*(.+?):\s*(.+)$/);
    if (!lm) continue;
    const theme = lm[1].trim();
    const counts = {};
    for (const x of lm[2].matchAll(/#(\d+)(?:×(\d+))?/g)) {
      counts[x[1]] = Number(x[2] || 1);
    }
    map[theme] = counts;
  }
  return map;
}

function bump(groups, theme, num) {
  (groups[theme] ??= {})[num] = (groups[theme][num] || 0) + 1;
}

function cmdIndex(opts) {
  const logFile = findLogFile(opts.file);
  const content = fs.readFileSync(logFile, 'utf8');
  const entries = parseEntries(content);
  if (!entries.length) { console.error('[dev-log] 未解析到任何 Session 条目'); process.exit(1); }

  // 保留既有索引的主题→编号计数（如 LLM 语义打标版），只对"新出现条目"做推断，避免覆盖既有语义
  const groups = parseExistingIndex(content);
  const seenNums = new Set(Object.values(groups).flatMap((c) => Object.keys(c)));

  for (const e of entries) {
    const tags = e.theme ? e.theme.split(/[,，]/).map((s) => s.trim()).filter(Boolean) : [];
    if (tags.length) {
      for (const t of tags) {
        // 幂等：该主题下已存在此编号则跳过，避免重复运行 index 时把同一条目累加成 #N×2
        // （新条目编号唯一，不会误伤同号多条；旧数据同号多条的无主题条目走下方 seenNums 分支保持原计数）
        if (!(groups[t] && groups[t][e.num])) bump(groups, t, e.num);
      }
    } else if (!seenNums.has(e.num)) {
      bump(groups, inferTheme(e.files), e.num);
    }
    // 条目无标签且编号已在既有索引 → 沿用既有统计，不再重复推断
  }

  const indexLines = Object.entries(groups)
    .sort((a, b) => a[0].localeCompare(b[0], 'zh-Hans-CN'))
    .map(([th, counts]) => {
      const refs = Object.entries(counts)
        .sort((a, b) => Number(a[0]) - Number(b[0]))
        .map(([n, c]) => (c > 1 ? `#${n}×${c}` : `#${n}`))
        .join(', ');
      return `- ${th}: ${refs}`;
    });

  const head = buildHeadBlock(indexLines);
  const lines = content.split('\n');
  let firstSession = lines.findIndex((l) => /^## Session/.test(l));
  if (firstSession < 0) firstSession = lines.length;
  const body = lines.slice(firstSession).join('\n');
  fs.writeFileSync(logFile, (head + body).trimEnd() + '\n');
  console.log(`[dev-log] 索引已更新：${entries.length} 条，${indexLines.length} 个主题`);
}

/* ---------- link ---------- */
// 找到目标条目的正文区 [startIdx, endIdx)：0-based，startIdx = 标题下一行，endIdx = 下一 Session 标题行或文件末尾
function entryBodyRange(lines, entry) {
  const startIdx = entry.line; // line 是 1-based 标题行号，标题 0-based 索引 = line-1，正文从 line 开始
  let endIdx = lines.length;
  for (let i = startIdx; i < lines.length; i++) {
    if (/^## Session/.test(lines[i])) { endIdx = i; break; }
  }
  return [startIdx, endIdx];
}

function cmdLink(opts) {
  const logFile = findLogFile(opts.file);
  const content = fs.readFileSync(logFile, 'utf8');
  const hash = opts._[0];
  if (!/^[0-9a-f]{7,40}$/i.test(hash || '')) { console.error('[dev-log] 用法: dev-log.mjs link <hash> [--session N]'); process.exit(1); }
  const entries = parseEntries(content);
  if (!entries.length) { console.error('[dev-log] 无条目'); process.exit(1); }
  // 同号多条时取最靠上的（文件顶部 = 最新）
  const target = opts.session
    ? entries.find((e) => e.num === String(opts.session))
    : entries[0];
  if (!target) { console.error(`[dev-log] 未找到 Session #${opts.session}`); process.exit(1); }
  const lines = content.split('\n');
  const [startIdx, endIdx] = entryBodyRange(lines, target);

  // 段划分：Session 正文整体算第一段，其后每个 `### ` 标题起一段
  // （续记自上而下按时间递增，最新一段在最后）
  const segs = [];
  let segStart = startIdx;
  for (let i = startIdx; i < endIdx; i++) {
    if (/^### /.test(lines[i])) { segs.push([segStart, i]); segStart = i; }
  }
  segs.push([segStart, endIdx]);

  let seg;
  if (opts.section) {
    const hits = segs.filter(([s, e]) => lines.slice(s, e).some((l) => l.includes(opts.section)));
    if (hits.length !== 1) {
      const cands = segs.filter(([s]) => /^### /.test(lines[s])).map(([s]) => `  ${lines[s]}`).join('\n');
      console.error(`[dev-log] --section "${opts.section}" 匹配 ${hits.length} 段，需要唯一匹配（不给 --section 时默认挂最新一段）；候选：\n${cands}`);
      process.exit(1);
    }
    seg = hits[0];
  } else {
    seg = segs[segs.length - 1]; // 默认：最新一段（文件靠下 = 最新）
  }

  const [segLo, segHi] = seg;
  let commitIdx = -1;
  for (let i = segLo; i < segHi; i++) {
    if (/\bcommit\b[\s*]*[:：]/i.test(lines[i])) { commitIdx = i; break; }
  }
  if (commitIdx >= 0) {
    lines[commitIdx] = lines[commitIdx].replace(/[0-9a-f]{7,40}/i, hash);
  } else {
    // 去掉目标段末尾空行后插入 commit 行（前后留空行）
    let idx = segHi;
    while (idx > segLo && lines[idx - 1] === '') idx--;
    lines.splice(idx, 0, '', `**commit**：${hash}`, '');
  }
  fs.writeFileSync(logFile, lines.join('\n'));
  const label = /^### /.test(lines[segLo]) ? lines[segLo].slice(0, 64) : `Session #${target.num} 首段`;
  console.log(`[dev-log] ${label} — 已挂 commit ${hash}`);
}

/* ---------- query ---------- */
function cmdQuery(opts) {
  const logFile = findLogFile(opts.file);
  const content = fs.readFileSync(logFile, 'utf8');
  const term = (opts._[0] || '').toLowerCase();
  if (!term) { console.error('[dev-log] 用法: dev-log.mjs query <词>'); process.exit(1); }
  const entries = parseEntries(content);
  const matched = entries.filter((e) =>
    (e.req + ' ' + e.summary + ' ' + e.files.join(' ') + ' ' + e.theme).toLowerCase().includes(term)
  );
  if (!matched.length) { console.log(`[dev-log] 无匹配「${term}」的条目`); return; }
  for (const e of matched) {
    console.log(`#${e.num}${e.date ? ' ' + e.date : ''} ${e.req}`);
    if (e.files.length) console.log(`    ${e.files.slice(0, 6).join(', ')}${e.files.length > 6 ? ' …' : ''}`);
  }
  console.log(`[dev-log] 共 ${matched.length} 条匹配`);
}

/* ---------- main ---------- */
function main() {
  const args = process.argv.slice(2);
  if (!args.length || args[0] === '-h' || args[0] === '--help' || args[0] === 'help') {
    console.log(HELP);
    process.exit(args.length ? 0 : 1);
  }
  const cmd = args[0];
  const opts = parseArgs(args.slice(1));
  switch (cmd) {
    case 'snapshot': cmdSnapshot(); break;
    case 'add': cmdAdd(opts); break;
    case 'index': cmdIndex(opts); break;
    case 'link': cmdLink(opts); break;
    case 'query': cmdQuery(opts); break;
    default: console.error(`[dev-log] 未知子命令: ${cmd}\n${HELP}`); process.exit(1);
  }
}

main();
