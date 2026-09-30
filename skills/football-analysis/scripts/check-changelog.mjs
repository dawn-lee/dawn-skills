#!/usr/bin/env node
/**
 * football-analysis changelog 写入规则校验（随 skill 安装/迁移）。
 * 用法：node scripts/check-changelog.mjs
 */
import { readdir, readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { join, dirname } from 'node:path';

const skillRoot = dirname(dirname(fileURLToPath(import.meta.url)));
const changelogDir = join(skillRoot, 'changelog');
const ALLOWED = new Set(['README.md', 'superseded.md']);
const DATE_FILE = /^\d{4}-\d{2}\.md$/;
const MAX_LINES = 200;
const FORBIDDEN_NAME = /^(analysis-|match-|bet-plan-|clv-|result-)/;
const FORBIDDEN_CONTENT = [/status:\s*(prediction|reviewed)/i, /match_id\s*:/i];

let failed = false;
const fail = (msg) => { failed = true; console.error(`[FAIL] ${msg}`); };

try {
  const files = await readdir(changelogDir);
  for (const file of files) {
    if (!(ALLOWED.has(file) || DATE_FILE.test(file)) || FORBIDDEN_NAME.test(file)) {
      fail(`${changelogDir}/${file}：文件名不符合规则（只允许 README.md / superseded.md / YYYY-MM.md）`);
      continue;
    }
    const path = join(changelogDir, file);
    const text = await readFile(path, 'utf8');
    const lines = text.split(/\r?\n/);
    if (DATE_FILE.test(file) && lines.length > MAX_LINES) {
      fail(`${path}：${lines.length} 行，超过 ${MAX_LINES} 行上限`);
    }
    if ((DATE_FILE.test(file) || file === 'superseded.md')) {
      for (const pattern of FORBIDDEN_CONTENT) {
        if (pattern.test(text)) fail(`${path}：命中禁止内容 ${pattern}`);
      }
    }
  }
} catch {
  fail(`缺少 changelog 目录：${changelogDir}`);
}

if (failed) { console.error('\nchangelog 写入规则校验未通过。'); process.exit(1); }
console.log(`[OK] ${changelogDir}`);
