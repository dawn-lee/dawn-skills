---
name: db-sync
description: 在数据库之间同步表数据。读取 DataGrip 配置自动发现数据源，通过 Docker MySQL 执行 mysqldump 管道同步并校验行数。当用户说"同步数据"、"sync data"、"导数据"、"db-sync"时使用。
---

# Database Sync Skill

通过本 skill 目录下的 `scripts/db-sync.sh` 在数据库之间同步表数据。
同步方向：从任意 DataGrip 数据源 **同步到本地 MySQL**（优先用本地 mysql 客户端，无则用 Docker MySQL 容器；目标始终是本地的 root）。

## 核心流程

1. **发现数据源** - 解析 DataGrip 配置 (`~/Documents/datagrip/.idea/dataSources.xml`)
2. **用户选择** - 让用户选定源、schema、表（目标固定为本地）
3. **执行同步** - 调用脚本完成 mysqldump -> mysql 管道 + 行数校验

## 严格规则

- **始终先展示数据源列表**，让用户选择源，不要猜测
- **同步方向确认** - 执行前必须向用户确认：源、schema、表列表（目标为本地容器）
- **目标 schema** - 如不存在会自动创建（direct 与 interactive 模式均会 `CREATE DATABASE IF NOT EXISTS`）
- **目标固定为本地** - 脚本始终写入本地 MySQL（本地客户端或 Docker 容器的 root）；交互模式可选目标数据源，但当前仅作展示，实际写入本地
- **密码管理** - 远程数据源密码首次使用时交互输入，缓存到 `~/.config/db-sync/db-sync.conf`（格式 `<数据源名>:<密码>`，自动生成，600 权限，**勿提交**）

## 使用方式

### 方式一：直接调用脚本（推荐）

当用户已明确指定源、schema 和表时，直接调用（路径相对于本 skill 目录）：

```bash
bash scripts/db-sync.sh \
  --source "数据源名称" \
  --src-schema 源库名 \
  --tgt-schema 目标库名 \
  --tables "table1,table2,table3"
```

`--target` 仍可传入（向后兼容）但当前被忽略，目标恒为本地 Docker MySQL。

### 方式二：展示选项后调用

当用户未明确指定时：

1. 先读取并展示 DataGrip 数据源配置：

```bash
python3 -c "
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
| `--tgt-schema NAME` | 目标数据库/schema（本地容器） |
| `--tables t1,t2,...` | 逗号分隔的表名 |
| `--datagrip-dir DIR` | 自定义 DataGrip .idea 目录 |
| `--target NAME` | （已忽略，向后兼容）目标恒为本地 Docker MySQL |

## 同步与校验说明

- **同步语义**：使用 `mysqldump --replace`，即 `REPLACE INTO`。重跑会按主键覆盖，但**不会删除目标中源已不存在的行**；需要完全镜像时，先手动 DROP 目标表再同步。
- **校验**：仅比对源与目标的行数（`SELECT COUNT(*)`）。行数一致不代表内容一致，不会发现数据漂移或 schema 差异。

## 前提条件

- **执行后端**：优先使用本地 `mysql`/`mysqldump` 客户端；本地没有时自动回退到 Docker MySQL 容器
- 本地后端：目标为宿主机 MySQL（localhost），root 密码首次使用时交互输入
- Docker 后端：目标为容器内 MySQL，root 密码优先从 `docker inspect` 的 `MYSQL_ROOT_PASSWORD` 读取，否则手动输入
- 远程数据源首次使用时输入密码（之后自动缓存到 `~/.config/db-sync/db-sync.conf`）

## 输出示例

```
Docker container: mysql

Syncing 5 tables: rds@cic-arch-dev.arch_app_ds -> localhost.app_arch
  ▶ project_management ... OK
  ▶ t_arch_department ... OK
  ▶ t_arch_team ... OK
  ▶ user ... OK
  ▶ user_to_app ... OK

Row count verification:
  ✓ project_management: 131 rows
  ✓ t_arch_department: 30 rows
  ✓ t_arch_team: 68 rows
  ✓ user: 277 rows
  ✓ user_to_app: 693 rows
```
