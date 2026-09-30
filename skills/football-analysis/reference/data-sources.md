# 数据源与取价参考

> 主协议只声明“缺什么数据降什么级”。本文档是具体来源与采集坑。
> `FDP_ROOT` 解析顺序：环境变量 `FDP_ROOT` → 用户会话指定 → 开发机默认 `<FDP_ROOT>`。不存在时先确认，不臆测。

## 1. 数据源分层

| 层级 | 需求 | 来源 | 缺则 |
|------|------|------|------|
| 必选 | 胜平负 + CRS + 让球赔率 | `FDP_ROOT` 库内 `OddsHistory` | 无法分析 |
| 必选 | 赔率时间线 | 同表 GROUP BY | 无异动判断 |
| 必选 | 积分榜 + 主客拆分 | ESPN / 库内 Standing / 体彩官方接口 | 主场优势靠猜 |
| 按需 | 俱乐部背景 + 教练变动 | 维基百科赛季页 | 新帅因素可能忽略 |
| 按需 | H2H | 库内 `HistoricalResult` / 体彩 `_sporttery-detail.ts` | 只作参考，不做排序提权 |
| 按需 | 市场均价（非真 sharp） | footystats | gap 不可用 |
| 可选 | 战术数据 xG/控球/射门 | 库内 `TeamStats`（按 team_id+match_date 时序查，无 match_id）；`scripts/jobs/backfill-fotmob-stats.ts` + `scripts/jobs/collect-fotmob-match-xg.ts` | 无 xG → 默认 `variance_up` + λ 保守 |
| 可选 | 半场条件概率 | 库内 `Match` + `Competition` | 用通用规则 |
| 可选 | 阵容/伤病 | 球队官网 > 体彩官方 > fotmob/库 Injury | 标注“阵容未知”；见 `injury-protocol.md` |

## 2. sharp 线：soccerpunter（免费当前 Pinnacle 1X2）

- URL：`https://www.soccerpunter.com/h2h/{team-a}-vs-{team-b}/{idA}/{idB}/`
- 页面 “1x2 odds” 段给美式赔率，每列 logo 标注公司。
- 美式→小数：负 = `100/|odds|+1`，正 = `odds/100+1`。
- 找**三列同标 Pinnacle** 的行才是纯 sharp；混公司行只能做近似。
- 页面大时抓取结果落盘后 grep “1x2 odds” 段。

**红线**：算 gap 的 `fair_sharp` 必须是该场次当前 Pinnacle 线，不能用“历史 Pinnacle vs 不同对手”代理。

## 3. sharp/OU/AH：betexplorer

```
GET https://www.betexplorer.com/match-odds/{match_id}/{stage_id}/{bet_type}/bestOdds/?lang=en
```

| 参数 | 值 |
|---|---|
| `bet_type` | `1x2` / `ou` / `ah` |
| `stage_id` | `11`（Football 主 stage，通用） |
| `match_id` | betexplorer 页面 URL 末段（如 `jc2tZnb4`） |

- 返回 `{"odds":"<html>"}`；每个 `<tr>` = 一家书商 × 一个盘口线。
- OU 线：`data-hcp="E-2-2-0-{线}-0"`；AH 线：`E-5-2-0-{让球}-0`，用最平衡线（两赔率差最小，排除死线 <1.1）。
- **无 Pinnacle** → sharp 用 **Betfair Exchange**（`data-bookie="betfair exchange"`）。
- 采集脚本：`scripts/analysis/_be-ouah-summary.ts`。

## 4. soft 线

- 竞彩：`FDP_ROOT` 库内 `OddsHistory` / 体彩官方接口。
- Bet365 等浮动抽水公司仅作 cross-value 对比，不可替代当前场次竞彩价。

## 5. 体彩官方接口

见 `reference/sporttery-official-api.md`。伤停优先级和交叉核对见 `reference/injury-protocol.md`。

## 6. 采集纪律

- 所有来源标注出处，定量数据标注覆盖度（如“12/16 场 = 75%”）。
- 无 sharp 源时明确声明「无 sharp 线」，`gap=null`。
- 赔率时间线、积分榜、H2H、教练四项全部具备后才进入预测；否则标注“数据不完整”。
- 赔率时间线快照：1 次→终盘；2–3 次→点；≥5 次且跨日→可用作异动分析。
