#!/usr/bin/env node
/**
 * 源码仓库开发脚本：检查两个 skill 的 RULES_BASELINE.md 共享口径是否同步。
 * 只用于 dawn-skills 源码仓库，不随单个 skill 安装。
 * 用法：node scripts/check-rules-baseline-sync.mjs
 */
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { join, dirname } from 'node:path';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const files = {
  analysis: join(root, 'skills', 'football-analysis', 'RULES_BASELINE.md'),
  betting: join(root, 'skills', 'football-betting', 'RULES_BASELINE.md'),
};

const sharedRules = [
  { label: '比分带 Top8', pattern: /泊松\s*\*\*Top8\*\*/ },
  { label: 'U2.5 60% 仅为比分必要筛选', pattern: /U2\.5[^\n]*≥60%|≥60%[^\n]*比分/ },
  { label: '弱主胜 <40%', pattern: /<40%\s*才是真坑/ },
  { label: '伤停源优先级', pattern: /球队官网\s*>\s*体彩官方线索/ },
  { label: '短 H2H 不降档', pattern: /H2H≤3/ },
  { label: 'gap 定义', pattern: /gap\s*=\s*fair_soft\(fav\)\s*-\s*fair_sharp\(fav\)/ },
  { label: '强热低赔命中与价值分离', pattern: /强热[^\n]*低赔[^\n]*(负\s*EV|负价值)|强热主队[^\n]*竞彩低赔通常为负\s*EV/ },
];

const texts = {};
for (const [name, path] of Object.entries(files)) {
  texts[name] = await readFile(path, 'utf8');
}

let failed = false;
for (const rule of sharedRules) {
  for (const [name, text] of Object.entries(texts)) {
    if (!rule.pattern.test(text)) {
      failed = true;
      console.error(`[FAIL] ${files[name]} 缺少共享口径：${rule.label}`);
    }
  }
}

if (failed) {
  console.error('\n两个 skill 的 RULES_BASELINE.md 不同步。请先更新 football-analysis，再同步 football-betting 的共享副本。');
  process.exit(1);
}
console.log('[OK] football-analysis / football-betting 共享口径同步。');
