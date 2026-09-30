#!/usr/bin/env node
/**
 * football-betting 启动前置检查（随 skill 安装）。
 * 用法：node scripts/preflight.mjs
 */
import { access } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { join, dirname } from 'node:path';

const skillRoot = dirname(dirname(fileURLToPath(import.meta.url)));
const analysisSkill = join(skillRoot, '..', 'football-analysis', 'SKILL.md');

let failed = false;
const fail = (msg) => { failed = true; console.error(`[FAIL] ${msg}`); };

try {
  await access(analysisSkill);
  console.log('[OK] 检测到依赖 football-analysis');
} catch {
  fail('未检测到 football-analysis。请先安装 football-analysis，再使用 football-betting。');
}

const fdpRoot = process.env.FDP_ROOT || '<FDP_ROOT>';
try {
  await access(fdpRoot);
  console.log(`[OK] FDP_ROOT 可用：${fdpRoot}`);
} catch {
  console.warn(`[WARN] FDP_ROOT 不存在：${fdpRoot}`);
  console.warn('       请设置环境变量 FDP_ROOT 或在使用时明确指定路径，否则不要开始分析/投注。');
}

if (failed) process.exit(1);
console.log('\npreflight 通过。');
