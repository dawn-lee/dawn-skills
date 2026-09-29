---
name: db-sync
description: 将 DataGrip 中的 MySQL 数据源按表导入本地 MySQL，使用本地客户端或 Docker 并校验行数。适用于明确的 MySQL 到本地同步或 db-sync 请求；不适用于任意文件同步或远程目标数据库。
---

# Database Sync Skill

通过本 skill 目录下的 `scripts/db-sync.sh` 在数据库之间同步表数据。
设计用途：从 DataGrip 中的 MySQL 数据源 **导入本地 MySQL**（优先用本地 mysql 客户端，无则用 Docker MySQL 容器；目标连接使用 root）。脚本未显式固定目标 host/协议，运行前须核实实际连接端点符合本地目标要求。

## 核心流程

1. **发现数据源** - 解析 DataGrip 配置 (`~/Documents/datagrip/.idea/dataSources.xml`)
2. **确定范围** - 使用用户已指定的源、schema、表和本地目标；仅补问缺失或有歧义的参数
3. **执行同步** - 调用脚本完成 mysqldump -> mysql 管道 + 行数校验

## 严格规则

- **数据源匹配** - 先核对 DataGrip 配置；用户已明确指定且唯一匹配时直接使用，仅在未指定或有多个匹配时展示必要选项
- **同步授权** - 执行前确定源、schema、表列表和实际本地目标。已有明确同步授权不重复询问；若实际覆盖范围或重建表行为超出授权，先准备可审阅的范围说明，再确认该差异
- **目标 schema** - 如不存在会自动创建（direct 与 interactive 模式均会 `CREATE DATABASE IF NOT EXISTS`）
- **实际目标核实** - 交互菜单中的目标选择和 `--target` 不控制实际连接。目标 mysql 命令未指定 host/协议，也未屏蔽客户端默认配置；本地客户端或容器内配置可能影响端点。执行前以不泄露凭据的方式核实实际目标，不能仅凭菜单或日志中的 localhost 判断
- **非本地目标** - 用户要求远程目标时，不把该目标传给本脚本后宣称完成；改用支持该目标的工具，或说明当前脚本的具体限制
- **密码管理** - 远程数据源密码首次使用时交互输入，缓存到 `~/.config/db-sync/db-sync.conf`（格式 `<数据源名>:<密码>`，自动生成，600 权限，**勿提交**）

## 平台要求

| 平台 | 要求 |
|---|---|
| Linux / macOS | bash + `python3`（脚本按 `python3 → python → py -3` 自动找，可用 `PYTHON=...` 指定）+ 本地 `mysql`/`mysqldump` 客户端或 Docker |
| Windows | 需 **Git Bash**（Git for Windows 自带）或 **WSL**；Git Bash 里用 `python` 即可，其余同上 |

DataGrip 数据源默认读 `~/Documents/datagrip/.idea/dataSources.xml`；本机不在这个位置时用
`DATAGRIP_DIR` 环境变量或 `--datagrip-dir` 覆盖（Windows 上 DataGrip 项目的 `.idea`
常在 `%APPDATA%` 下或你的 DataGrip 工程目录里，形如 `--datagrip-dir "C:/path/to/project/.idea"`）。

## 使用方式

### 方式一：直接调用脚本（推荐）

当用户已明确指定源、schema 和表，且实际目标与导入语义符合授权时，调用（路径相对于本 skill 目录）：

```bash
bash scripts/db-sync.sh \
  --source "数据源名称" \
  --src-schema 源库名 \
  --tgt-schema 目标库名 \
  --tables "table1,table2,table3"
```

`--target` 为向后兼容参数，会被忽略；设计目标为本地 MySQL，但实际端点受所选客户端配置影响，不能用此参数指定或保证目标位置。

### 方式二：展示选项后调用

当用户未明确指定时：

1. 先读取并展示 DataGrip 数据源配置：

```bash
python3 -c "
# Windows(Git Bash) 把 python3 换成 python；脚本内部已自动按 python3 → python → py -3 查找
import xml.etree.ElementTree as ET
tree = ET.parse('$HOME/Documents/datagrip/.idea/dataSources.xml')
for ds in tree.findall('.//data-source'):
    name = ds.get('name')
    url = ds.findtext('jdbc-url', '')
    print(f'  {name}: {url}')
"
```

2. 让用户选择源、schema、表（默认模式下直接用纯文本询问；Plan 模式下可用 `request_user_input`）
3. 确认后调用脚本

### 方式三：让用户在终端交互运行

如果用户想要完整的交互式菜单体验，告诉用户在终端运行：

```bash
bash scripts/db-sync.sh
```

## 数据源配置位置

| 文件 | 内容 |
|---|---|
| `~/Documents/datagrip/.idea/dataSources.xml` | 连接 URL、驱动 |
| `~/Documents/datagrip/.idea/dataSources.local.xml` | 用户名、schema 映射 |
| `~/.config/db-sync/db-sync.conf` | 密码缓存（自动生成，600 权限，**勿提交**） |

## 脚本参数

| 参数 | 说明 |
|---|---|
| `--source NAME` | DataGrip 数据源名称 |
| `--src-schema NAME` | 源数据库/schema |
| `--tgt-schema NAME` | 目标数据库/schema（本地客户端或 Docker 后端） |
| `--tables t1,t2,...` | 逗号分隔的表名 |
| `--datagrip-dir DIR` | 自定义 DataGrip .idea 目录 |
| `--target NAME` | 已忽略，仅向后兼容；不能控制实际目标端点 |

## 同步与校验说明

- **同步语义**：脚本使用 `mysqldump --replace`，同时导出表结构，未显式关闭 DROP/CREATE 相关默认选项。不能据此承诺“保留目标独有行”或把它描述为纯增量合并；实际导出可能重建目标表。执行前核实当前客户端选项与导出语义。用户要求保留目标独有数据时，应使用明确支持该语义的方案，不直接运行当前脚本。
- **校验**：仅比对源与目标的行数（`SELECT COUNT(*)`）。行数一致不代表内容一致，不会发现数据漂移或 schema 差异。

## 前提条件

- **执行后端**：优先使用本地 `mysql`/`mysqldump` 客户端；本地没有时自动回退到 Docker MySQL 容器
- 本地后端：设计上连接宿主机 MySQL，实际端点需核实；root 密码首次使用时交互输入
- Docker 后端：设计上连接容器内 MySQL，实际端点需核实；root 密码优先从 `docker inspect` 的 `MYSQL_ROOT_PASSWORD` 读取，否则手动输入
- 远程数据源首次使用时输入密码（之后自动缓存到 `~/.config/db-sync/db-sync.conf`）

## 输出示例

```
Docker container: mysql

Syncing 5 tables: rds@db-dev.app_ds -> localhost.app
  ▶ projects ... OK
  ▶ t_department ... OK
  ▶ t_team ... OK
  ▶ user ... OK
  ▶ user_relation ... OK

Row count verification:
  ✓ projects: 131 rows
  ✓ t_department: 30 rows
  ✓ t_team: 68 rows
  ✓ user: 277 rows
  ✓ user_relation: 693 rows
```
