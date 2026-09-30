# DEPENDENCIES

- `football-analysis`（必需）
  - football-betting 只消费 `AnalysisResult`，不独立做比赛分析。
  - 安装时两者必须同时安装；若分析层不可用，应停止投注并先执行/安装 football-analysis。

## 外部数据依赖

- `FDP_ROOT`（football-data-platform）
  - 解析顺序：环境变量 `FDP_ROOT` → 用户会话指定 → 开发机默认 `<FDP_ROOT>`。
  - 未配置且路径不存在时，先向用户确认，不得臆测。
