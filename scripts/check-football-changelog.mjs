#!/usr/bin/env node
/**
 * 源码仓库级便利脚本：依次运行两个 skill 自带的 changelog 校验。
 * 安装单个 skill 时请使用 skill 内脚本：
 *   - skills/football-analysis/scripts/check-changelog.mjs
 *   - skills/football-betting/scripts/check-changelog.mjs
 */
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { join, dirname } from 'node:path';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const targets = [
  join(root, 'skills', 'football-analysis', 'scripts', 'check-changelog.mjs'),
  join(root, 'skills', 'football-betting', 'scripts', 'check-changelog.mjs'),
];

let code = 0;
for (const target of targets) {
  const r = spawnSync(process.execPath, [target], { stdio: 'inherit' });
  if (r.status !== 0) code = r.status ?? 1;
}
process.exit(code);
