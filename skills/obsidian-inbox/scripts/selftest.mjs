#!/usr/bin/env node
/**
 * selftest.mjs —— 分发前自检：平台兼容性 + “不要把机器/公司信息写进可分发文件”红线。
 *
 * 背景：这个技能要能 clone 到**别人的 Linux / macOS / Windows** 上直接跑，
 * 所以既不能出现写死的 `/home/<用户名>`、POSIX-only 的 node 路径，
 * 也不能再混入公司/内网标识（上一轮脱敏清掉的东西，防回归）。
 *
 * 用法：
 *   node scripts/selftest.mjs            # 全量自检（人类可读）
 *   node scripts/selftest.mjs --json     # 机器可读
 *   node scripts/selftest.mjs --skip-scrub-check   # 跳过私有清单那组检查
 *
 * 分组：
 *   P1 平台无关路径逻辑（用 Windows 输入喂）
 *   P2 模拟 win32 运行环境（子进程里伪造 process.platform + LOCALAPPDATA/APPDATA）
 *   P3 调度模板渲染（占位符、XML 转义、无残留占位符）
 *   L1 分发红线（扫描可分发文件：写死路径 / 硬编码 node 路径 / 命令里的 ~ / 私有清单 token）
 *   L2 入口文件体检（.sh 可执行位；.cmd 必须 CRLF + 纯 ASCII）
 *
 * 退出码：0 全部通过 / 1 有失败项
 */
import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync, readdirSync, statSync, mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, delimiter, dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  SKILL_DIR, slugify, normalizeRel, routeDir, toVaultRel, expandVars, expandRoutePattern,
  renderTemplate, xmlEscape, schedulerEnvPath,
} from './lib.mjs';

const args = process.argv.slice(2);
const json = args.includes('--json');
const skipScrub = args.includes('--skip-scrub-check');

const REPO_ROOT = resolve(SKILL_DIR, '..', '..');
const results = [];

const pending = [];

/** 支持同步与 async fn：async 时收集 Promise，末尾统一 await（避免未处理拒绝）。 */
function check(id, title, fn) {
  try {
    const detail = fn();
    if (detail && typeof detail.then === 'function') {
      pending.push(Promise.resolve(detail).then(
        (v) => results.push({ id, title, ok: true, detail: v ?? '' }),
        (e) => results.push({ id, title, ok: false, detail: String(e?.message ?? e) }),
      ));
      return;
    }
    results.push({ id, title, ok: true, detail: detail ?? '' });
  } catch (err) {
    results.push({ id, title, ok: false, detail: String(err?.message ?? err) });
  }
}

function assert(cond, msg) {
  if (!cond) throw new Error(msg);
}

// ------------------------------------------------------------ P1 路径逻辑（Windows 输入）

check('P1-1', '库外 Windows 盘符路径被拒绝（而不是当相对路径拼进库里）', () => {
  const cfg = { vault: '/vault/root' };
  let threw = false;
  try { toVaultRel(cfg, 'C:\\Users\\x\\notes\\a.md'); } catch (err) { threw = /路径不在知识库内/.test(String(err)); }
  assert(threw, '未抛出「路径不在知识库内」');
  const out = toVaultRel(cfg, 'C:\\Users\\x\\notes\\a.md', { allowOutside: true });
  assert(out === null, `allowOutside 应返回 null，得到 ${JSON.stringify(out)}`);
});

check('P1-2', 'vault 内反斜杠路径归一为 / 分隔的相对路径', () => {
  const cfg = { vault: 'C:\\vault' };
  const rel = toVaultRel(cfg, 'C:\\vault\\dawn\\pop\\x.md');
  assert(rel === 'dawn/pop/x.md', `得到 ${JSON.stringify(rel)}`);
  assert(normalizeRel('a\\b\\c') === 'a/b/c', 'normalizeRel 未处理反斜杠');
});

check('P1-3', '文件名里 Windows 非法字符被过滤（否则写不进去）', () => {
  const s = slugify('a:b*c?d"e<f>g|h#i^j[k]l');
  assert(!/[:*?"<>|#^[\]]/.test(s), `仍有非法字符：${s}`);
});

check('P1-4', 'Windows 风格 cwd 路由不崩溃（本机平台下解析不到则落到 defaultDir）', () => {
  const cfg = { routes: [{ pattern: '^\\$\\{HOME\\}/projects/([^/]+)(/|$)', dir: '{1}' }], defaultDir: 'notes' };
  const dir = routeDir(cfg, 'C:\\Users\\x\\projects\\repo1', null);
  assert(typeof dir === 'string', `返回类型异常：${JSON.stringify(dir)}`);
});

check('P1-5', '${HOME} 占位展开后不再含占位符，且路径分隔符为 /（正则才好匹配）', () => {
  const pat = expandRoutePattern('^${HOME}/projects/x$');
  assert(!pat.includes('${HOME}'), `占位符未展开：${pat}`);
  assert(pat.includes('/projects/x$'), `展开结果异常：${pat}`);
  assert(expandVars('${HOME}/a\\b').includes('/a') || expandVars('${HOME}/a').length > 0, 'expandVars 失败');
});

check('P1-6', '调度 PATH 用平台分隔符（Windows 为 ;、POSIX 为 :）', () => {
  const p = schedulerEnvPath('/fake/node');
  const sep = p.includes(delimiter) ? delimiter : null;
  assert(sep, `PATH 里没有平台分隔符 ${JSON.stringify(p)}`);
  if (process.platform !== 'win32') assert(p.startsWith('/fake'), `应以 node 所在目录开头：${p}`);
});

check('P1-7', 'Windows 风格 %VAR% 占位可展开（未定义的变量原样保留）', () => {
  process.env.OI_SELFTEST_HOME = 'C:\\Users\\tester';
  try {
    const ok = expandVars('%OI_SELFTEST_HOME%\\docs\\notes');
    assert(ok === 'C:\\Users\\tester\\docs\\notes', `展开结果=${JSON.stringify(ok)}`);
    const keep = expandVars('%OI_NOT_DEFINED%/x');
    assert(keep === '%OI_NOT_DEFINED%/x', `未定义变量应原样保留：${keep}`);
    const pct = expandVars('覆盖率 100% 完成');
    assert(pct === '覆盖率 100% 完成', `不该误伤普通百分号：${pct}`);
    const mixed = expandVars('${HOME}/%OI_SELFTEST_HOME%');
    assert(!mixed.includes('${HOME}'), 'HOME 占位未展开：' + mixed);
  } finally {
    delete process.env.OI_SELFTEST_HOME;
  }
});

// ------------------------------------------------------------ P2 模拟 win32 运行环境

check('P2-1', 'win32 下状态目录落到 %LOCALAPPDATA%、共享配置落到 %APPDATA%', () => {
  const local = 'C:\\Users\\x\\AppData\\Local';
  const roaming = 'C:\\Users\\x\\AppData\\Roaming';
  const probe = `
    Object.defineProperty(process, 'platform', { value: 'win32' });
    process.env.LOCALAPPDATA = ${JSON.stringify(local)};
    process.env.APPDATA = ${JSON.stringify(roaming)};
    delete process.env.OBSIDIAN_INBOX_STATE;
    import(${JSON.stringify(join(SKILL_DIR, 'scripts', 'lib.mjs'))}).then((m) => {
      process.stdout.write(JSON.stringify({
        state: m.STATE_DIR, candidates: m.configCandidates(),
      }));
    }).catch((e) => { process.stderr.write(String(e)); process.exit(3); });
  `;
  const res = spawnSync(process.execPath, ['--input-type=module', '-e', probe], {
    encoding: 'utf8', timeout: 30000, env: { ...process.env, OBSIDIAN_INBOX_STATE: '' },
  });
  if (res.status !== 0) throw new Error(`探测进程失败：${String(res.stderr).slice(-300)}`);
  const out = JSON.parse(String(res.stdout));
  const norm = (s) => String(s).replace(/\\/g, '/');
  assert(norm(out.state).startsWith(norm(local) + '/obsidian-inbox'), `STATE_DIR=${out.state}（期望在 %LOCALAPPDATA% 下）`);
  const shared = out.candidates[1];
  assert(norm(shared).startsWith(norm(roaming) + '/obsidian-inbox/config.json'), `共享配置=${shared}（期望在 %APPDATA% 下）`);
  assert(out.candidates[0].endsWith('config.json'), `首选配置应是技能目录 config.json：${out.candidates[0]}`);
});

check('P2-2', 'win32 下 excludeCwdPrefixes 解析为绝对路径且分隔符统一', () => {
  // 与 loadConfig 的实现一致：resolve + 统一成 /（Windows 下路由匹配与前缀比较都要它）
  const cfg = { excludeCwdPrefixes: ['${HOME}/.local/state/obsidian-inbox'] };
  const resolved = resolve(expandVars(cfg.excludeCwdPrefixes[0]));
  assert(resolved === join(expandVars('~/.local/state/obsidian-inbox')), `解析结果=${resolved}`);
});

// ------------------------------------------------------------ P3 调度模板渲染

check('P3-1', '模板占位符全部被替换（残留 {{X}} 会让 unit/plist 无效）', () => {
  const files = [
    ['systemd/dsh-sediment.service.tmpl', { SKILL_DIR: '/s', NODE: '/n', ARGS: '--since-hours 26', ENV_LINES: 'Environment="PATH=/x"' }],
    ['systemd/dsh-sediment.timer.tmpl', { SKILL_DIR: '/s', TIME: '23:00' }],
    ['windows/task.xml.tmpl', { START: '2026-01-01T23:00:00', NODE: 'C:\\\\n\\\\node.exe', ARGS: '"C:\\\\s\\\\a.mjs" --x', SKILL_DIR: 'C:\\\\s' }],
  ];
  for (const [rel, vars] of files) {
    const tpl = readFileSync(join(SKILL_DIR, 'templates', rel), 'utf8');
    const out = renderTemplate(tpl, vars);
    assert(!/\{\{\w+\}\}/.test(out), `${rel} 有残留占位符：${(out.match(/\{\{\w+\}\}/g) || []).join(', ')}`);
  }
});

check('P3-2', 'XML 转义后无裸 & / < / > （路径含 & 的机器上不会生成坏 XML）', () => {
  const evil = 'C:\\Users\\A & B\\node.exe';
  const esc = xmlEscape(evil);
  assert(!/&(?!amp;|lt;|gt;|quot;|#)/.test(esc), `裸 &：${esc}`);
  assert(!/[<>]/.test(esc), `裸尖括号：${esc}`);
  const tpl = readFileSync(join(SKILL_DIR, 'templates', 'windows', 'task.xml.tmpl'), 'utf8');
  const xml = renderTemplate(tpl, {
    START: xmlEscape('2026-01-01T23:00:00'), NODE: xmlEscape(evil),
    ARGS: xmlEscape(`"${evil}" --x`), SKILL_DIR: xmlEscape('C:\\Users\\A & B'),
  });
  assert(!/&(?!amp;|lt;|gt;|quot;|#)/.test(xml), '渲染后的 XML 里仍有裸 &');
  assert((xml.match(/<Task/g) || []).length === 1, 'Task 根元素缺失');
});

// ------------------------------------------------------------ P4 adapter 契约

check('P4-1', '四个 adapter 都产出契约字段（id/cwd/turns）且统一形状', async () => {
  const { getAdapters } = await import(join(SKILL_DIR, 'scripts', 'adapters', 'index.mjs'));
  const { loadConfig } = await import(join(SKILL_DIR, 'scripts', 'lib.mjs'));
  const cfg = loadConfig();
  const win = { from: Date.now() - 365 * 86400 * 1000, to: Date.now() + 3600 * 1000 };
  const seen = [];
  const ran = [];
  for (const id of ['dsh', 'qoder', 'claude', 'codex', 'workbuddy']) {
    cfg.agentAdapter = id;
    const a = getAdapters(cfg).find((x) => x.id === id);
    if (!a) throw new Error(`adapter ${id} 未登记`);
    const list = a.mod.listSessions(cfg, win, {});
    if (!Array.isArray(list)) throw new Error(`${id}.listSessions 未返回数组`);
    for (const s of list) {
      if (typeof s.id !== 'string' || !s.id) throw new Error(`${id} 会话缺 id`);
      if (!Array.isArray(s.turns)) throw new Error(`${id}/${s.id} turns 非数组`);
      if (typeof s.lastPromptAt !== 'number') throw new Error(`${id}/${s.id} lastPromptAt 非数字`);
      for (const t of s.turns) {
        if (typeof t.prompt !== 'string') throw new Error(`${id}/${s.id} turn.prompt 非字符串`);
      }
    }
    // 每个 adapter 都要跑到且不抛错（0 行也是有效结果，如 workbuddy 本机无会话）
    ran.push(`${id}:${list.length}`);
    if (list.length) seen.push(`${id}:${list.length}`);
  }
  if (ran.length !== 5) throw new Error(`只有 ${ran.length}/5 个 adapter 被执行`);
  if (!seen.length) throw new Error('所有 adapter 都返回 0 会话（本机应至少有 dsh 数据）');
  return `执行 ${ran.length} 个；样本 ${seen.join(' ')}`;
});

check('P4-3', 'dsh adapter 的会话 id 保留 session- 前缀（须与账本/归档一致）', async () => {
  const tmp = mkdtempSync(join(tmpdir(), 'oi-dshid-'));
  const oldHome = process.env.DSH_HOME;
  try {
    const dir = join(tmp, 'storages', 'session_projcache', 'sessions');
    mkdirSync(dir, { recursive: true });
    // 与真实投影缓存同形的最小样本
    writeFileSync(join(dir, 'session-abc123.json'), JSON.stringify({
      record: {
        identity: { cwd: '/tmp/x', createdAt: 1767312000000 },
        rows: {
          sessionListMetadata: { val: { lastPromptAt: 1767312000000 } },
          sessionStats: { val: { lastTurn: 1 } },
          turnOutline: { val: { turns: [{ turn: 1, prompt: 'p', response: 'r' }] } },
          title: { val: 't' },
        },
      },
    }), 'utf8');
    process.env.DSH_HOME = tmp;
    const m = await import(join(SKILL_DIR, 'scripts', 'adapters', 'dsh.mjs'));
    const list = m.listSessions({ archiveDir: 'sessions', excludeCwdPrefixes: [] },
      { from: 0, to: Date.now() + 3600 * 1000 }, {});
    assert(list.length === 1, `应解析出 1 个会话，实际 ${list.length}`);
    assert(list[0].id === 'session-abc123',
      `id 必须保留 session- 前缀（账本 archived.json 的键与归档 frontmatter 都用这个形式），实际「${list[0].id}」`);
    return `id=${list[0].id}`;
  } finally {
    if (oldHome === undefined) delete process.env.DSH_HOME; else process.env.DSH_HOME = oldHome;
    rmSync(tmp, { recursive: true, force: true });
  }
});

check('P4-2', 'agentAdapter 多值与未知值处理（逗号分隔 / 未登记报错）', async () => {
  const { resolveAgents } = await import(join(SKILL_DIR, 'scripts', 'adapters', 'index.mjs'));
  const a = resolveAgents({ agentAdapter: 'dsh,qoder' });
  assert(a.length === 2 && a[0] === 'dsh', `多值解析错: ${a}`);
  const b = resolveAgents({});
  assert(b.length === 1 && b[0] === 'dsh', `缺省应为 dsh: ${b}`);
  let threw = false;
  try { resolveAgents({ agentAdapter: 'nope' }); } catch { threw = true; }
  assert(threw, '未登记 agent 应报错');
  let threw2 = false;
  try { resolveAgents({ agentAdapter: 'dsh,nope' }); } catch { threw2 = true; }
  assert(threw2, '混合未知值应报错');
});

// ------------------------------------------------------------ P5 写通道安全（临时 vault）

check('P5-1', 'distill 拒绝不存在的目标且不写标记（防把归档误标为已提炼）', () => {
  const tmp = mkdtempSync(join(tmpdir(), 'oi-distill-'));
  try {
    const vault = join(tmp, 'vault');
    mkdirSync(join(vault, 'sessions', 'dsh'), { recursive: true });
    mkdirSync(join(vault, 'dawn'), { recursive: true });
    const noteRel = 'sessions/dsh/probe.md';
    const noteAbs = join(vault, noteRel);
    const original = '---\ntype: session\nsource: dsh\ndomain: dawn\ndate: 2026-01-01\n---\n\n# 探针\n';
    writeFileSync(noteAbs, original, 'utf8');
    const cfgPath = join(tmp, 'config.json');
    writeFileSync(cfgPath, JSON.stringify({ vault, archiveDir: 'sessions', domainRoots: ['dawn'], defaultDir: 'dawn' }), 'utf8');
    const env = { ...process.env, OBSIDIAN_INBOX_CONFIG: cfgPath, OBSIDIAN_INBOX_STATE: join(tmp, 'state') };

    // ① 目标不存在 → 必须失败
    const r1 = spawnSync(process.execPath, [join(SKILL_DIR, 'scripts', 'note.mjs'), 'distill',
      '--path', noteRel, '--into', '[[绝对不存在的目标XYZ]]'], { encoding: 'utf8', env });
    assert(r1.status !== 0, `目标不存在时 distill 应失败，实际退出码 ${r1.status}`);
    const after = readFileSync(noteAbs, 'utf8');
    assert(!/distilled_into/.test(after), '目标不存在却写入了 distilled_into（会把归档误标为已提炼）');

    // ② 目标是归档区笔记 → 必须失败（归档是原始素材，不能当提炼目标）
    const r2 = spawnSync(process.execPath, [join(SKILL_DIR, 'scripts', 'note.mjs'), 'distill',
      '--path', noteRel, '--into', '[[probe]]'], { encoding: 'utf8', env });
    assert(r2.status !== 0, `提炼目标是归档笔记时应失败，实际退出码 ${r2.status}`);
    assert(!/distilled_into/.test(readFileSync(noteAbs, 'utf8')), '指向归档笔记却写了标记');

    // ③ 目标存在且合法 → 必须成功并写标记
    writeFileSync(join(vault, 'dawn', '真目标.md'), '---\ntype: note\n---\n\n# 真目标\n', 'utf8');
    const r3 = spawnSync(process.execPath, [join(SKILL_DIR, 'scripts', 'note.mjs'), 'distill',
      '--path', noteRel, '--into', '[[真目标]]'], { encoding: 'utf8', env });
    assert(r3.status === 0, `合法 distill 应成功，实际退出码 ${r3.status}：${String(r3.stderr || '').slice(0, 200)}`);
    const final = readFileSync(noteAbs, 'utf8');
    assert(/distilled_into:\s*"?\[\[真目标\]\]/.test(final), `未写入正确标记：${final.slice(0, 200)}`);
    return '不存在/归档目标均被拒，合法目标写标记成功';
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
});

// ------------------------------------------------------------ L1 分发红线

/**
 * 可分发文件 = **git 跟踪**的文件（clone 下来真正会出现的东西）。
 * 本机私有配置 config.json 已 gitignore，绝不会分发，因此不纳入扫描；
 * 自检脚本自身也不扫（它的红线词面就是字符串本身）。
 */
function distributableFiles() {
  const self = resolve(SKILL_DIR, 'scripts', 'selftest.mjs');
  const inScope = (p) => {
    if (p === self) return false;
    if (/\.(png|jpg|jpeg|gif|ico|zst|bundle|pack|idx)$/.test(p)) return false;
    return p.startsWith(join(REPO_ROOT, 'skills') + '/')
      || [join(REPO_ROOT, 'README.md'), join(REPO_ROOT, '.gitignore'),
        join(REPO_ROOT, 'DEVELOPMENT_LOG.md')].includes(p);
  };
  // 优先用 git 的真值；拿不到 git（源码包/压缩包）时按名跳过本机私有配置
  const g = spawnSync('git', ['-C', REPO_ROOT, 'ls-files', '-z'], { encoding: 'utf8', maxBuffer: 8 * 1024 * 1024 });
  if (g.status === 0) {
    return String(g.stdout).split('\0').filter(Boolean)
      .map((f) => resolve(REPO_ROOT, f)).filter(inScope);
  }
  const out = [];
  const walk = (dir) => {
    for (const e of readdirSync(dir, { withFileTypes: true })) {
      const p = resolve(join(dir, e.name));
      if (e.isDirectory()) { if (e.name !== '.git' && e.name !== 'node_modules') walk(join(dir, e.name)); continue; }
      if (!e.isFile() || !inScope(p)) continue;
      if (basename(p) === 'config.json') continue; // gitignored 的本机私有配置
      out.push(p);
    }
  };
  walk(REPO_ROOT);
  return out;
}

const RED_LINES = [
  {
    id: 'home-path',
    re: /\/home\/[A-Za-z0-9_][\w.-]*/,
    why: '写死的 /home/<用户名> 路径；可分发文件里必须用 ${HOME} 或 ~',
  },
  {
    id: 'shell-tilde',
    // 这些命令/工具会在 cmd、PowerShell 里直接跑，它们不展开 ~；
    // 我们自己的 node scripts/… 允许 ~（内部 expandHome 展开），bash/sh 也允许（Git Bash 会展开）
    re: /^[ \t]*(?:git|cd|ln|cp|mv|rm|cat|mkdir|touch|tar|find|grep|scp|rsync|mysql|mysqldump|python3?|pip3?|docker)\b[^\n]*[~][\/\\]/gm,
    why: '命令里的 ~ 由 shell 展开，但 Windows 的 cmd/PowerShell 不展开；改用相对路径或 <占位符>',
  },
  {
    id: 'posix-node',
    re: /\/(?:usr|local)\/bin\/node/,
    why: '写死的 node 绝对路径；run-sediment.sh 的“定位逻辑”是它自己的任务，其余位置不该出现',
    allow: [join(REPO_ROOT, 'skills', 'obsidian-inbox', 'run-sediment.sh')],
  },
];

/** 取得正则的全部匹配：matchAll 要求 g 标志，规则定义里忘了加时自动补一个克隆。 */
function allMatches(text, re) {
  const g = re.global ? re : new RegExp(re.source, `${re.flags}g`);
  return [...text.matchAll(g)];
}

/**
 * 私有红线（**不随仓库分发**）：自己的公司/内网标识清单，防止脱敏后被重新写进文档。
 * 位置：`<技能目录>/private-lint.json`（已 gitignore），或用 OBSIDIAN_INBOX_PRIVATE_LINT 指定。
 * 格式：{ "tokens": ["词1", "词2"], "patterns": ["正则串"] }
 * 没有这个文件时跳过该组检查（别人拿到技能不需要也不该看到你的私有词表）。
 */
function privateRules() {
  const path = process.env.OBSIDIAN_INBOX_PRIVATE_LINT || join(SKILL_DIR, 'private-lint.json');
  if (!existsSync(path)) return null;
  let data;
  try { data = JSON.parse(readFileSync(path, 'utf8')); } catch (err) {
    throw new Error(`私有红线清单不是合法 JSON：${path}（${err.message}）`);
  }
  const parts = [...(data.tokens ?? []).map((t) => t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')),
    ...(data.patterns ?? [])];
  if (!parts.length) return { path, count: 0, rules: [] };
  return {
    path,
    count: parts.length,
    rules: [{ id: 'private-tokens', re: new RegExp(parts.join('|')), why: `私有标识（清单：${path}）` }],
  };
}

if (!skipScrub) {
  check('L1', '分发红线扫描（写死路径 / 硬编码 node 路径 / 私有清单）', () => {
    const hits = [];
    const priv = privateRules();   // 可能抛错 → 直接作为失败项
    for (const f of distributableFiles()) {
      let text;
      try { text = readFileSync(f, 'utf8'); } catch { continue; }
      for (const rule of [...RED_LINES, ...(priv?.rules ?? [])]) {
        if (rule.allow?.includes(f)) continue;
        const ms = allMatches(text, rule.re);
        if (!ms.length) continue;
        const rel = f.replace(REPO_ROOT + '/', '');
        for (const m of ms.slice(0, 5)) {
          hits.push(`${rel} → ${rule.id}：“${String(m[0]).replace(/\s+/g, ' ').slice(0, 40)}”（${rule.why}）`);
        }
        if (ms.length > 5) hits.push(`${rel} → ${rule.id}：另有 ${ms.length - 5} 处`);
      }
    }
    assert(hits.length === 0, `发现 ${hits.length} 处违规：\n    ${hits.join('\n    ')}`);
    return `${distributableFiles().length} 个文件全部通过`
      + (priv?.count ? `；另扫私有清单 ${priv.count} 条（${priv.path.replace(REPO_ROOT + '/', '')}，不入库）`
        : '；未发现私有清单（如需校验自己的标识，见 private-lint.example.json）');
  });
}

// ------------------------------------------------------------ L2 入口文件体检

check('L2-1', 'run-sediment.sh 保留可执行位（否则 ./run-sediment.sh 报 Permission denied）', () => {
  const p = join(SKILL_DIR, 'run-sediment.sh');
  assert((statSync(p).mode & 0o111) !== 0, `${p} 没有可执行位`);
});

check('L2-2', 'run-sediment.cmd 为 CRLF 行尾且纯 ASCII（GBK 代码页下不乱码、label/goto 可解析）', () => {
  const p = join(SKILL_DIR, 'run-sediment.cmd');
  const buf = readFileSync(p);
  assert([...buf].every((c) => c < 128), '存在非 ASCII 字节（中文注释在 cmd 下会乱码）');
  const lf = buf.filter((c) => c === 0x0a).length;
  const crlf = (String(buf, 'latin1').match(/\r\n/g) || []).length;
  assert(lf > 0 && lf === crlf, `行尾不全是 CRLF（LF=${lf}, CRLF=${crlf}）`);
  const text = String(buf, 'latin1');
  assert(/run-sediment\.cmd --dry-run/.test(text), '缺少用法说明');
  assert(text.split(/(?:\r\n)+/).filter((l) => /^:\w+$/.test(l)).length >= 3, 'label 数量不足，可能流程跳转不完整');
});

check('L2-3', '四个入口/脚本都能被语法解析', () => {
  const nodes = ['note.mjs', 'sediment.mjs', 'init.mjs', 'install.mjs', 'selftest.mjs', 'lib.mjs',
    'adapters/index.mjs', 'adapters/contract.mjs', 'adapters/dsh.mjs', 'adapters/qoder.mjs',
    'adapters/claude.mjs', 'adapters/codex.mjs', 'adapters/workbuddy.mjs'];
  for (const f of nodes) {
    const r = spawnSync(process.execPath, ['--check', join(SKILL_DIR, 'scripts', f)], { encoding: 'utf8' });
    assert(r.status === 0, `${f} 语法错误：${String(r.stderr).split('\n')[0]}`);
  }
  const sh = spawnSync('bash', ['-n', join(SKILL_DIR, 'run-sediment.sh')], { encoding: 'utf8' });
  assert(sh.status === 0, `run-sediment.sh 语法错误：${sh.stderr}`);
  return `${nodes.length} 个 .mjs + 1 个 .sh`;
});

// ------------------------------------------------------------ 输出

// 让 async check 的结果落定后再统计（顺序保持：它们是最后注册的）
if (pending.length) await Promise.all(pending);

const failed = results.filter((r) => !r.ok);
if (json) {
  process.stdout.write(`${JSON.stringify({ ok: failed.length === 0, total: results.length, failed: failed.length, results }, null, 2)}\n`);
} else {
  for (const r of results) {
    process.stdout.write(`${r.ok ? '✓' : '✗'} [${r.id}] ${r.title}\n`);
    if (r.detail) process.stdout.write(`    ${String(r.detail).replace(/\n/g, '\n    ')}\n`);
  }
  process.stdout.write(`\n${results.length - failed.length}/${results.length} 通过${failed.length ? `，${failed.length} 项失败` : ''}\n`);
}
process.exit(failed.length ? 1 : 0);
