# 体彩官网「对阵详情页」官方数据接口（sporttery official detail APIs）

> 支撑分析协议「伤停采集协议」的**球队官网最终裁决、体彩官方线索优先**要求。体彩竞彩官网在对阵详情页（`/jc/zqdz/`）提供官方伤停/近况/H2H/积分榜/赛程，数据优于聚合站（fotmob/转会的滞后）。2026-08-10 由逆向页面前端 `zqdz.js`/`zqbsComponent.js` 发现。

## 什么时候用
- 每批 /football-analysis 分析前，用官方伤停/近况交叉核对
- **伤停必须查它**（作为官方线索；最终结论以球队官网为准）

## 页面 URL
```
https://www.sporttery.cn/jc/zqdz/index.html?showType=2&mid={sportteryMatchId}
```
`showType`: 1 比赛信息 / 2 比赛数据 / 3 固定奖金 / 4 直播

## 关键前置：拿 sportteryMatchId
`getMatchCalculatorV1.qry`（现有插件已在采）响应 `subMatchList[].matchId` 即 sportteryMatchId。
三场示例：001=2040794 / 002=2040795 / 003=2040796（每次开盘会变，勿硬编码）。

## 5 个官方数据接口（均 GET，需浏览器头 + Referer 指 zqdz 页）

| 接口 | 参数 | 返回 | 独特性 |
|------|------|------|--------|
| `gateway/uniform/football/getInjurySuspensionV1.qry` | `sportteryMatchId={mid}` | home/away 各 `injuriesAndSuspensionsList[]`：personName/playerPositionDesc/injuryFlag/suspensionFlag/uniformNo | ✅ **唯一官方伤停源** |
| `gateway/uniform/football/getMatchFeatureV1.qry?termLimits=10&` | `sportteryMatchId={mid}` | last（近10）/eachHomeAway（主客）/sameHomeAway（同主客）/goalAvg/lossGoalAvg | 与库内 MatchFeature 冗余 |
| `gateway/uniform/football/getResultHistoryV1.qry` | `sportteryMatchId={mid}` | matchList + statistics（胜平负概率） | 与 Match 表 H2H 冗余 |
| `gateway/uniform/football/getMatchTablesV2.qry` | `sportteryMatchId={mid}` | homeTables/awayTables | 与 Standing 冗余 |
| `gateway/uniform/football/getFutureMatchesV1.qry` | `sportteryMatchId={mid}` | home/away.matchList（未来赛程） | 与 Match SCHEDULED 冗余 |

- 请求头：`User-Agent` Chrome + `Referer: https://www.sporttery.cn/jc/zqdz/index.html` + `Origin: https://www.sporttery.cn`
- 通用信封：`errorCode=="0"` 成功，`value` 为数据
- **已有现成脚本**：`FDP_ROOT/scripts/sporttery/_sporttery-detail.ts`（传入一批 sportteryMatchId 即打印全量官方报告）

## ⚠️ 数据质量警示（2026-08-10 实证，务必遵守）

**体彩官方伤停数据是交叉核对线索，不是 ground truth——"空"和"有"都可能失真：**

- **返回"空" ≠ 无伤停**：001/002 接口为空，但球队官网确认 **Sirius 头号射手 Robbie Ure（转会谈判缺阵）**、**Bromma Mads Hansen 停赛**——体彩全漏
- **返回"有" ≠ 权威**：003 葡国民接口列 4 人伤（Liziero/Baeza/Matheus Dias/Nourani），但**葡国民主帅赛前发布会称仅 Ulisses+José Gomes 2 名后卫缺阵**，4 人训练全勤——体彩名单为跨赛季残留
- **fotmob 阵容页陈旧**：漏"转会谈判缺阵"（Ure 仍在名单）、"已离队球员"（Gabriel Veron/Paulinho Bóia 已不在葡国民官网阵容）

**交叉核对协议（伤停必做）：**
1. 体彩 `getInjurySuspensionV1` → 官方伤停基线（空=待官网补，有=待官网核）
2. **球队官网**（俱乐部站 + **主帅赛前发布会/训练报告**）→ 确认缺阵：转会离队、停赛、伤病、甚至"已不在阵容"
3. 分歧时以**球队官网为最高优先级**（Ure/Hansen 案例"空"、葡国民 4 人案例"有"，均以官网为准）
4. 官网未查到时，体彩"有"名单只能作 `variance_up` 线索，不得当确定缺阵

## 逆向方法（端点变更时重建）
1. 抓 `sporttery.cn/jc/zqdz/index.html?mid={id}` 找 `<script src>`（主 JS `jc/zqdz.js`）
2. 抓该 JS，找 import 的组件（`zqbsComponent.js`=比赛数据）
3. grep `get[A-Za-z]+V[0-9]+\.qry` 得端点名；看 `sendUrl`/`midStr` 得参数（`sportteryMatchId=` 当 URL 带 `mid`）
