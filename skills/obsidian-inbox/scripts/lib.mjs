/**
 * obsidian-inbox 共享库：vault 路由、frontmatter、原子写入、检索、追加。
 *
 * 约定：
 * - 所有写入都走 atomicWrite（同目录 tmp + rename），避免半截文件被 Obsidian 索引。
 * - 只写 .md，且从不触碰 .obsidian / .trash / .smart-env。
 */
import {
  readFileSync, writeFileSync, existsSync, mkdirSync, readdirSync, statSync,
  renameSync, rmSync,
} from 'node:fs';
import { dirname, join, resolve, relative, basename, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { homedir } from 'node:os';

export const SKILL_DIR = resolve(dirname(fileURLToPath(import.meta.url)), '..');
export const CONFIG_PATH = join(SKILL_DIR, 'config.json');
/**
 * 运行期状态（归档账本、日志、headless 工作目录）**不放在技能源码里**，
 * 避免技能以软链方式接入 ~/.agents/skills 时把状态写进 git 工作区。
 * 默认 $XDG_STATE_HOME/obsidian-inbox，可用 OBSIDIAN_INBOX_STATE 覆盖。
 */
export const STATE_DIR = process.env.OBSIDIAN_INBOX_STATE
  ? resolve(process.env.OBSIDIAN_INBOX_STATE)
  : join(process.env.XDG_STATE_HOME || join(homedir(), '.local', 'state'), 'obsidian-inbox');

export function expandHome(p) {
  if (!p) return p;
  if (p === '~') return homedir();
  if (p.startsWith('~/')) return join(homedir(), p.slice(2));
  return p;
}

export function loadConfig() {
  const raw = JSON.parse(readFileSync(CONFIG_PATH, 'utf8'));
  const cfg = { ...raw };
  cfg.vault = resolve(expandHome(cfg.vault));
  cfg.defaultDir = cfg.defaultDir || 'dawn';
  cfg.archiveDir = cfg.archiveDir ?? 'dsh-sessions';
  cfg.routes = Array.isArray(cfg.routes) ? cfg.routes : [];
  cfg.searchExclude = cfg.searchExclude || ['.obsidian', '.trash', '.smart-env', '.git'];
  cfg.excludeCwdPrefixes = cfg.excludeCwdPrefixes || [];
  cfg.domainRoots = (cfg.domainRoots || []).map((r) => normalizeRel(r));
  cfg.domainNotes = cfg.domainNotes || {};
  if (!existsSync(cfg.vault)) throw new Error(`vault 不存在：${cfg.vault}`);
  return cfg;
}

export function normalizeRel(p) {
  return String(p ?? '')
    .replace(/\\/g, '/')
    .replace(/^\.?\//, '')
    .replace(/\/+$/, '');
}

export function safeDecode(s) {
  try { return decodeURIComponent(s); } catch { return s; }
}

function vaultRoot(cfg) {
  return cfg.vault.replace(/\/+$/, '');
}

/**
 * 把路径解析成 vault 相对路径。
 *
 * 关键防护：以 vault 根开头的绝对路径会被**转成相对路径**。这是本技能最容易踩的坑——
 * Obsidian 把 Markdown 链接里以 `/` 开头的目标当成**库内相对路径**，一旦把
 * `~/Documents/Obsidian Vault/dawn/pop/x.md` 原样写进去，点击会在库里
 * 建出 `<库根>~/...` 的嵌套空文件。写入侧同样不能把绝对路径当相对路径拼。
 *
 * @param allowOutside 库外绝对路径时返回 null 而不是抛错。
 */
export function toVaultRel(cfg, p, { allowOutside = false } = {}) {
  const raw = String(p ?? '').trim();
  if (!raw) return '';
  const decoded = safeDecode(raw).replace(/^file:\/\//, '');
  if (decoded.startsWith('/') || /^[A-Za-z]:[\\/]/.test(decoded)) {
    const normalized = decoded.replace(/\\/g, '/');
    const root = vaultRoot(cfg);
    if (normalized === root) return '';
    if (normalized.startsWith(`${root}/`)) return normalizeRel(normalized.slice(root.length + 1));
    if (allowOutside) return null;
    throw new Error(`路径不在知识库内：${raw}（知识库为 ${root}）`);
  }
  return normalizeRel(decoded);
}

/** 显式 --dir > cwd 正则路由 > defaultDir；返回 vault 相对目录（可能是 ''）。
 *  路由的 dir 支持 `{1}`、`{2}` 占位，取正则捕获组（用于 `work/<域>` 这类动态落位）。 */
export function routeDir(cfg, cwd, explicitDir) {
  if (explicitDir && explicitDir !== true) return toVaultRel(cfg, explicitDir);
  const c = cwd ? resolve(expandHome(String(cwd))) : '';
  for (const r of cfg.routes) {
    let re;
    try { re = new RegExp(r.pattern); } catch { continue; }
    const m = c ? re.exec(c) : null;
    if (!m) continue;
    return normalizeRel(String(r.dir ?? '').replace(/\{(\d+)\}/g, (_, i) => m[Number(i)] ?? ''));
  }
  return normalizeRel(cfg.defaultDir);
}

/** 业务域清单：直接读 companyDomainSource 下的子目录，不写死，新增域自动生效。 */
export function companyDomains(cfg) {
  if (!cfg.companyDomainSource) return [];
  try {
    return readdirSync(expandHome(cfg.companyDomainSource), { withFileTypes: true })
      .filter((e) => e.isDirectory() && !e.name.startsWith('.'))
      .map((e) => e.name)
      .sort();
  } catch {
    return [];
  }
}

function assertKnownCompanyDomain(cfg, rel, source) {
  const domains = companyDomains(cfg);
  if (!domains.length) return;
  const seg = rel.split('/')[1];
  if (domains.includes(seg)) return;
  throw new Error(
    `work/${seg} 不是已知的业务域（来源：${source}）；`
    + `现有业务域：${domains.map((d) => `work/${d}`).join('、')}`,
  );
}

/** 列出某目录下已有的子目录（报错提示与路由展示用）。 */
export function listSubdirs(cfg, relDir) {
  const abs = join(cfg.vault, normalizeRel(relDir));
  try {
    return readdirSync(abs, { withFileTypes: true })
      .filter((e) => e.isDirectory() && !e.name.startsWith('.'))
      .map((e) => `${normalizeRel(relDir)}/${e.name}`)
      .sort();
  } catch {
    return [];
  }
}

/**
 * 领域根（dawn / work）只作容器，笔记必须落到下一级：
 * - `dawn` 下按主题建子目录；`work` 下第二级必须是真实存在的业务域。
 * 直接往容器根写，领域目录会被零散笔记淹没，也没法按主题检索。
 */
export function assertNoteDir(cfg, relDir, source) {
  const rel = normalizeRel(relDir);
  if (!cfg.domainRoots.includes(rel)) {
    if (rel.startsWith('work/')) assertKnownCompanyDomain(cfg, rel, source);
    return rel;
  }
  const subs = listSubdirs(cfg, rel);
  const domains = companyDomains(cfg);
  const hint = rel === 'work' && domains.length
    ? `业务域应为：${domains.map((d) => `work/${d}`).join('、')}`
    : (subs.length
      ? `现有子目录：${subs.join('、')}`
      : '该领域还没有子目录，请先按主题建一个（如 dawn/pop、dawn/docker）');
  throw new Error(`${rel} 是领域容器，不能直接把笔记放在根下（来源：${source}）；请指定下一级。${hint}`);
}

/**
 * 落位目录必须是**已存在**的，或者调用方显式声明要新建（`--mkdir`）。
 * 例外：`work/<已知业务域>` 属于用户既定的分类体系（域清单来自 projects/work），直接放行。
 *
 * 目的：新建分类是不可逆的目录污染，不许"随手建一个看起来合理的"；
 * 拿不准就先问用户，得到明确同意后再带 --mkdir 写入。
 */
export function assertDirReady(cfg, relDir, { create = false, source = '' } = {}) {
  const rel = normalizeRel(relDir);
  if (!rel || existsSync(join(cfg.vault, rel))) return rel;
  if (rel.startsWith('work/') && companyDomains(cfg).includes(rel.split('/')[1])) return rel;
  if (create) return rel;
  const parent = rel.split('/').slice(0, -1).join('/');
  const siblings = listSubdirs(cfg, parent);
  throw new Error(
    `目录 ${rel} 在知识库里不存在，写入等于新建一个分类（来源：${source}）。`
    + '确认这个分类合适后再加 --mkdir；拿不准就先问用户。'
    + (siblings.length ? `同级已有：${siblings.join('、')}` : ''),
  );
}

const ILLEGAL_FS = /[\\/:*?"<>|#^[\]]/g;

export function slugify(title, maxLen = 80) {
  let s = String(title ?? '').replace(/[\u0000-\u001f]/g, '');
  s = s.replace(ILLEGAL_FS, ' ');
  s = s.replace(/\s+/g, ' ').trim();
  s = s.replace(/^\.+/, '').trim();
  if (s.length > maxLen) s = s.slice(0, maxLen).trim();
  return s || '未命名笔记';
}

/** 归一化用于查重比较：去标点、去空白、转小写。 */
export function normalizeForCompare(s) {
  return String(s ?? '')
    .toLowerCase()
    .replace(/[\s\-_.,;:!?，。；：！？、"'“”‘’()（）[\]【】]/g, '');
}

const RISKY_YAML = [':', '#', '{', '}', '[', ']', '&', '*', '!', '|', '>', "'", '"', '%', '@', '`', ',', '\n', '\t', '\\'];

function yamlScalar(v) {
  const s = String(v);
  const risky = s.trim() !== s || s === '' || RISKY_YAML.some((c) => s.includes(c))
    || /^(true|false|null|~|yes|no|on|off)$/i.test(s) || /^-?\d+(\.\d+)?$/.test(s);
  return risky ? JSON.stringify(s) : s;
}

/** 生成 YAML frontmatter 块（不含尾部空行）。空值自动省略。 */
export function buildFrontmatter(fields) {
  const lines = ['---'];
  for (const [k, v] of Object.entries(fields)) {
    if (v === undefined || v === null || v === '') continue;
    if (typeof v === 'boolean') { lines.push(`${k}: ${v}`); continue; }
    if (Array.isArray(v)) {
      const items = v.filter((x) => x !== undefined && x !== null && String(x) !== '');
      if (!items.length) continue;
      lines.push(`${k}:`);
      for (const item of items) lines.push(`  - ${yamlScalar(item)}`);
    } else {
      lines.push(`${k}: ${yamlScalar(v)}`);
    }
  }
  lines.push('---');
  return lines.join('\n');
}

export function atomicWrite(absPath, content) {
  mkdirSync(dirname(absPath), { recursive: true });
  const tmp = `${absPath}.tmp-${process.pid}-${Date.now()}`;
  writeFileSync(tmp, content, 'utf8');
  try {
    renameSync(tmp, absPath);
  } catch (err) {
    try { rmSync(tmp, { force: true }); } catch {}
    throw err;
  }
  return absPath;
}

export function parseFrontmatter(raw) {
  if (!raw.startsWith('---')) return { fields: {}, body: raw };
  const end = raw.indexOf('\n---', 3);
  if (end === -1) return { fields: {}, body: raw };
  const fm = raw.slice(3, end).trim();
  const bodyStart = raw.indexOf('\n', end + 1);
  const body = bodyStart === -1 ? '' : raw.slice(bodyStart + 1);
  const fields = {};
  let listKey = null;
  for (const line of fm.split('\n')) {
    const m = line.match(/^([A-Za-z0-9_\u4e00-\u9fff-]+):\s*(.*)$/);
    if (m) {
      const [, k, v] = m;
      if (v === '') { fields[k] = []; listKey = k; } else { fields[k] = v.replace(/^["']|["']$/g, ''); listKey = null; }
      continue;
    }
    const li = line.match(/^\s+-\s+(.*)$/);
    if (li && listKey) fields[listKey].push(li[1].replace(/^["']|["']$/g, ''));
  }
  return { fields, body };
}

export function readNote(absPath) {
  const raw = readFileSync(absPath, 'utf8');
  const { fields, body } = parseFrontmatter(raw);
  return { raw, fields, body, title: basename(absPath, '.md') };
}

export function* walkNotes(cfg, dir = cfg.vault) {
  let entries;
  try { entries = readdirSync(dir, { withFileTypes: true }); } catch { return; }
  for (const e of entries) {
    const abs = join(dir, e.name);
    const rel = relative(cfg.vault, abs).split(sep).join('/');
    if (cfg.searchExclude.some((x) => rel === x || rel.startsWith(`${x}/`))) continue;
    if (e.isDirectory()) {
      if (e.name.startsWith('.')) continue;
      yield* walkNotes(cfg, abs);
    } else if (e.isFile() && e.name.toLowerCase().endsWith('.md')) {
      yield abs;
    }
  }
}

function snippetAround(raw, term, width = 90) {
  const idx = raw.toLowerCase().indexOf(String(term).toLowerCase());
  if (idx === -1) return '';
  const start = Math.max(0, idx - Math.floor(width / 3));
  const text = raw.slice(start, start + width).replace(/\s+/g, ' ').trim();
  return `${start > 0 ? '…' : ''}${text}${start + width < raw.length ? '…' : ''}`;
}

/** 关键词检索（子串匹配，对中文友好）；标题/路径/正文加权。 */
export function searchNotes(cfg, query, limit = 10, opts = {}) {
  const terms = String(query ?? '').split(/[\s,，]+/).filter(Boolean);
  if (!terms.length) return [];
  const results = [];
  for (const abs of walkNotes(cfg)) {
    let st;
    try { st = statSync(abs); } catch { continue; }
    if (st.size > 512 * 1024) continue;
    let raw;
    try { raw = readFileSync(abs, 'utf8'); } catch { continue; }
    const lower = raw.toLowerCase();
    const rel = relative(cfg.vault, abs).split(sep).join('/');
    const title = basename(abs, '.md');
    const lowerTitle = title.toLowerCase();
    const lowerRel = rel.toLowerCase();
    let score = 0;
    const matched = [];
    for (const t of terms) {
      const lt = t.toLowerCase();
      let termScore = 0;
      if (lowerTitle.includes(lt)) termScore += 10;
      if (lowerRel.includes(lt)) termScore += 4;
      let idx = -1;
      let count = 0;
      while (count < 5 && (idx = lower.indexOf(lt, idx + 1)) !== -1) count++;
      if (count) termScore += count * 2;
      if (termScore) { score += termScore; matched.push(t); }
    }
    if (!score) continue;
    results.push({ path: rel, absPath: abs, title, score, matched, snippet: snippetAround(raw, terms[0]) });
  }
  results.sort((a, b) => b.score - a.score || a.path.localeCompare(b.path));
  return results.slice(0, Math.max(1, limit));
}

/** 按文件名（归一化）在 vault 内查重，返回相对路径数组。 */
export function findExistingByTitle(cfg, title) {
  const target = normalizeForCompare(title);
  const hits = [];
  for (const abs of walkNotes(cfg)) {
    if (normalizeForCompare(basename(abs, '.md')) === target) {
      hits.push(relative(cfg.vault, abs).split(sep).join('/'));
    }
  }
  return hits.sort();
}

/** 追加内容：给了 section 就写进该二级标题段末尾，否则追加到文件末尾。 */
export function appendSection(absPath, section, content) {
  const raw = readFileSync(absPath, 'utf8');
  const cleaned = String(content ?? '').trim();
  if (!cleaned) return absPath;
  if (!section) {
    return atomicWrite(absPath, `${raw.replace(/\s+$/, '')}\n\n${cleaned}\n`);
  }
  const esc = String(section).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const headingRe = new RegExp(`^#{1,6}\\s*${esc}\\s*$`);
  const lines = raw.split('\n');
  let start = -1;
  for (let i = 0; i < lines.length; i++) if (headingRe.test(lines[i])) start = i;
  if (start === -1) {
    return atomicWrite(absPath, `${raw.replace(/\s+$/, '')}\n\n## ${section}\n\n${cleaned}\n`);
  }
  const level = (lines[start].match(/^#+/) || ['##'])[0].length;
  let end = lines.length;
  for (let i = start + 1; i < lines.length; i++) {
    const m = lines[i].match(/^(#+)\s/);
    if (m && m[1].length <= level) { end = i; break; }
  }
  const out = [...lines.slice(0, end), '', cleaned, '', ...lines.slice(end)];
  return atomicWrite(absPath, out.join('\n').replace(/\n{4,}/g, '\n\n\n').replace(/\s+$/, '') + '\n');
}

/** vault 内的绝对路径；库外绝对路径直接报错，避免写到知识库之外。 */
export function vaultAbs(cfg, relPath) {
  return join(cfg.vault, toVaultRel(cfg, relPath));
}

/** vault 内所有笔记的相对路径（排序后），供「引用清单」使用。 */
export function listNoteIndex(cfg, limit = 400) {
  const all = [];
  for (const abs of walkNotes(cfg)) all.push(relative(cfg.vault, abs).split(sep).join('/'));
  all.sort();
  return all.slice(0, Math.max(1, limit));
}

/**
 * 把正文里会被 Obsidian 误解的 Markdown 链接降级，避免“点一下就凭空建出嵌套空文件”：
 * - 指向库内已有笔记的链接 → `[[笔记名]]`（链接文字与笔记名不同则写 `[[名|文字]]`）；
 * - 其余路径型链接（库外绝对路径、库内不存在的路径）→ 行内代码，不可点击；
 * - `http(s)` / `mailto` / `tel` / 锚点链接与既有 `[[wikilink]]` 原样保留。
 */
export function sanitizeBodyLinks(cfg, body) {
  const root = vaultRoot(cfg);
  const wikilinkFor = (candidate, text) => {
    const rel = normalizeRel(candidate);
    if (!rel || !existsSync(join(cfg.vault, rel))) return null;
    const name = basename(rel, '.md');
    const label = String(text ?? '').trim().replace(/\.md$/i, '');
    return label && label !== name ? `[[${name}|${label}]]` : `[[${name}]]`;
  };
  return String(body ?? '').replace(
    /\[([^\]\n]*)\]\(([^)\s]+)(?:\s+"[^"]*")?\)/g,
    (whole, text, target) => {
      if (/^(https?:|mailto:|tel:|#)/i.test(target)) return whole;
      const decoded = safeDecode(target.replace(/^file:\/\//, '')).replace(/\\/g, '/');
      if (decoded.startsWith('/')) {
        if (decoded === root || decoded.startsWith(`${root}/`)) {
          return wikilinkFor(decoded.slice(root.length), text) ?? `\`${decoded}\``;
        }
        return `\`${decoded}\``;
      }
      return wikilinkFor(decoded, text) ?? `\`${decoded}\``;
    },
  );
}

export function fmtTime(ms, withTime = true) {
  if (!ms) return '';
  const d = new Date(Number(ms));
  const pad = (n) => String(n).padStart(2, '0');
  const date = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  return withTime ? `${date} ${pad(d.getHours())}:${pad(d.getMinutes())}` : date;
}

export function parseArgs(argv) {
  const out = { _: [] };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith('--')) {
      const key = a.slice(2);
      const next = argv[i + 1];
      if (next === undefined || (next.startsWith('--') && next.length > 2)) out[key] = true;
      else { out[key] = next; i++; }
    } else {
      out._.push(a);
    }
  }
  return out;
}

export function readStdin() {
  try { return readFileSync(0, 'utf8'); } catch { return ''; }
}

export function readBodyArg(args) {
  if (typeof args.body === 'string') return args.body;
  const bf = args['body-file'];
  if (typeof bf === 'string') return bf === '-' ? readStdin() : readFileSync(expandHome(bf), 'utf8');
  if (bf === true) return readStdin();
  if (!process.stdin.isTTY) {
    const data = readStdin();
    if (data.trim()) return data;
  }
  return '';
}
