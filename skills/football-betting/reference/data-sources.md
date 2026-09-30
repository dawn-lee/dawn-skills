# 数据源参考（football-betting）

> 本文件是 football-betting 的取价参考。若同时安装了 football-analysis，完整数据源分层以其 `reference/data-sources.md` 为准；本文件保持自包含，不依赖外部路径。
> 伤停口径以 `football-analysis/reference/injury-protocol.md` 为准；若未安装 football-analysis，应停止投注并先安装依赖。

## soccerpunter — 免费拿当前真 Pinnacle 1X2

**URL**: `https://www.soccerpunter.com/h2h/{team-a}-vs-{team-b}/{idA}/{idB}/`
- 团队 id 从搜索拿
- 页面 "1x2 odds" 段给**美式赔率**，每列 logo 标注公司（Pinnacle / Betfair / bwin / 10Bet）
- 美式→小数：负 = `100/|odds|+1`，正 = `odds/100+1`
- 每行各列可能不同公司 → 找**三列同标 Pinnacle** 的行才是纯 sharp；混公司行只能做近似
- `firecrawl_scrape` 会因页大落盘到 tool-results，用 grep 提 1x2 odds 段

**红线**：算 gap 时 `fair_sharp` 必须是**该场次当前 Pinnacle 线**，不能用"历史 Pinnacle vs 不同对手"代理——对手强度不同会出假超买信号（2026-07-31 踩坑）。

## betexplorer — 1X2/OU/AH 各书商当前赔率

betexplorer 单场赔率页的 JS 渲染抓不到 OU/AH，但底层 AJAX 端点用普通 curl 直接返回干净 JSON：

```
GET https://www.betexplorer.com/match-odds/{match_id}/{stage_id}/{bet_type}/bestOdds/?lang=en
```

| 参数 | 值 |
|---|---|
| `bet_type` | `1x2` / `ou`（大小球）/ `ah`（亚盘） |
| `stage_id` | `11`（Football 主 stage，通用） |
| `match_id` | betexplorer 页面 URL 末段（如 `jc2tZnb4`） |

**返回结构**：`{"odds":"<html>"}`
- OU/AH：每个 `<tr>` = 一家书商 × 一个盘口线
- OU 线值：`data-hcp="E-2-2-0-{线}-0"`
- AH 线值：`E-5-2-0-{让球}-0`，用**最平衡线**（两赔率差最小、排除死线 <1.1）

**坑**：
- AH "0"（平手）行在部分场次异常 → 不用离 0 最近的线，用最平衡线
- **无 Pinnacle** → sharp 用 **Betfair Exchange**（`data-bookie="betfair exchange"`）
- 各书商含 1xBet/Bet365/Betfair/bwin 等 ~18 家，OR 约 103-106%

**采集脚本**：`FDP_ROOT/scripts/analysis/_be-ouah-summary.ts`（2026-08-07 验证）

## 伤停/停赛数据源（2026-08-09 复盘重写）

**可信度分级（按 2026-08-09 实测）**：
| 源 | 可靠性 | 实测 |
|---|---|---|
| 球队官网/官方公告 | ✅✅ 最高（最终裁决） | Ure/Hansen 转会缺阵与停赛，官网唯一确认 |
| 体彩官方伤停 | ✅ 官方线索 | 可能滞后/跨赛季残留，必须官网复核 |
| fotmob/库 Injury | ⚠️ 线索 | 阵容页陈旧，漏转会缺阵/停赛 |

**采集协议（强制）**：
1. **官网优先**：伤停/停赛以球队官网/官方公告为最终结论；体彩官方只作线索，聚合站不能作结论
2. **球星单查**：任何涉及超级球星/核心球员（如 Neymar、Paqueta）的场次，必须单独搜该球员"停赛/伤/回归"最新消息——聚合站常漏球星停赛
3. **交叉验证**：聚合站报"无伤停"≠真的无伤停，用 DDG/官方源复核（尤其巴甲/葡超等非主流联赛）
4. **多伤停阈值**：同位置（后卫/中场）≥3 人伤 → 该队方向置信度降两档（见 SKILL.md 红旗清单）
5. **黄牌停赛**：聚合站对"累计黄牌自动停赛"覆盖差，需官方查（Neymar 第 3 黄就是聚合站漏的）
