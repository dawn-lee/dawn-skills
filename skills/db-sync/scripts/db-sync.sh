#!/usr/bin/env bash
set -euo pipefail

# ============================================================
# db-sync.sh - DataGrip-aware Database Sync Tool
# ============================================================
# Reads DataGrip data source configurations and syncs tables
# between databases using Docker's mysqldump/mysql.
#
# Usage:
#   Interactive:  bash db-sync.sh
#   Direct:       bash db-sync.sh --source "rds@cic-arch-dev" \
#                   --target "mysql@localhost-root-local" \
#                   --src-schema arch_app_ds --tgt-schema app_arch \
#                   --tables "user,user_to_app"
# ============================================================

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
CONF_FILE="$HOME/.config/db-sync/db-sync.conf"
DATAGRIP_DIR="${DATAGRIP_DIR:-$HOME/Documents/datagrip/.idea}"
DATASOURCES_XML="$DATAGRIP_DIR/dataSources.xml"
DATASOURCES_LOCAL_XML="$DATAGRIP_DIR/dataSources.local.xml"

# Runtime globals (populated by parse_sources)
declare -a DS_NAMES=()
declare -A DS_HOST=() DS_PORT=() DS_USER=() DS_IP=() DS_DBMS=()
declare -A SCHEMA_MAP=()

# Password cache
declare -A PASSWORDS=()

# Colors
RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[0;33m'
BLUE='\033[0;34m'; CYAN='\033[0;36m'; BOLD='\033[1m'; NC='\033[0m'

# Suppress only the mysql "password on command line" warning; keep real errors.
filter_warn() { grep -v 'Using a password on the command line interface can be insecure' >&2 || true; }

# ============================================================
# Password Management
# ============================================================

load_config() {
  [[ -f "$CONF_FILE" ]] || return 0
  while IFS=':' read -r key val; do
    [[ "$key" =~ ^#.*$ || -z "$key" ]] && continue
    PASSWORDS["$key"]="$val"
  done < "$CONF_FILE"
}

get_password() {
  local label="$1" prompt="${2:-Password}"
  if [[ -n "${PASSWORDS[$label]:-}" ]]; then
    echo "${PASSWORDS[$label]}"
    return 0
  fi
  local pw
  echo -n -e "${YELLOW}$prompt: ${NC}" >&2
  read -r -s pw; echo >&2
  mkdir -p "$(dirname "$CONF_FILE")"
  echo "${label}:${pw}" >> "$CONF_FILE"
  chmod 600 "$CONF_FILE" 2>/dev/null || true
  PASSWORDS["$label"]="$pw"
  echo "$pw"
}

# ============================================================
# DataGrip Config Parsing (via python3 inline)
# ============================================================

parse_sources() {
  if [[ ! -f "$DATASOURCES_XML" ]]; then
    echo -e "${RED}DataGrip config not found: $DATASOURCES_XML${NC}" >&2
    echo "Set DATAGRIP_DIR to your .idea directory." >&2
    exit 1
  fi

  local local_xml="$DATASOURCES_LOCAL_XML"
  [[ -f "$local_xml" ]] || local_xml=""

  eval "$(python3 - "$DATASOURCES_XML" "$local_xml" << 'PYEOF'
import sys, xml.etree.ElementTree as ET

ds_xml, local_xml = sys.argv[1], sys.argv[2]

tree = ET.parse(ds_xml)
root = tree.getroot()

# Parse local overrides (user, schema)
local_info = {}
if local_xml:
    try:
        ltree = ET.parse(local_xml)
        for ds in ltree.iter("data-source"):
            name = ds.get("name", "")
            user_el = ds.find("user-name")
            schemas = []
            for s in ds.iter("name"):
                qn = s.get("qname", "")
                if qn and qn != "@":
                    schemas.append(qn)
            local_info[name] = {
                "user": user_el.text if user_el is not None else "",
                "schemas": schemas,
            }
    except Exception:
        pass

names, hosts, ports, users, dbms_list = [], [], [], [], []

for ds in root.findall(".//data-source"):
    name = ds.get("name", "unknown")
    jdbc_url = (ds.findtext("jdbc-url") or "").strip()
    driver = (ds.findtext("driver-ref") or "mysql").strip()

    # Parse jdbc:mysql://host:port
    url = jdbc_url.replace("jdbc:", "")
    host, port = "localhost", "3306"
    if "://" in url:
        addr = url.split("://")[1].split("/")[0].split("?")[0]
        parts = addr.split(":")
        host = parts[0]
        if len(parts) > 1:
            port = parts[1]

    # Get user from local info or default
    li = local_info.get(name, {})
    user = li.get("user", "") or "root"
    schemas = li.get("schemas", [])

    dbms_type = "OceanBase" if "oceanbase" in driver.lower() or "ob" in name.lower() else "MySQL"

    names.append(name)
    hosts.append(host)
    ports.append(port)
    users.append(user)
    dbms_list.append(dbms_type)

    # Emit bash associative array assignments
    safe_name = name.replace("'", "'\\''")
    print(f"DS_NAMES+=('{safe_name}')")
    print(f"DS_HOST['{safe_name}']='{host}'")
    print(f"DS_PORT['{safe_name}']='{port}'")
    print(f"DS_USER['{safe_name}']='{user}'")
    print(f"DS_DBMS['{safe_name}']='{dbms_type}'")

# Emit schema info as a separate variable
for name in names:
    li = local_info.get(name, {})
    schemas_str = ",".join(li.get("schemas", []))
    safe_name = name.replace("'", "'\\''")
    print(f"SCHEMA_MAP['{safe_name}']='{schemas_str}'")
PYEOF
)" 2>/dev/null || {
    echo -e "${RED}Failed to parse DataGrip config${NC}" >&2
    exit 1
  }

  if [[ ${#DS_NAMES[@]} -eq 0 ]]; then
    echo -e "${RED}No data sources found in DataGrip config${NC}" >&2
    exit 1
  fi
}

# ============================================================
# Docker MySQL Helpers
# ============================================================

find_docker_mysql() {
  local c
  c=$(docker ps --format '{{.Names}}' 2>/dev/null | grep -i mysql | head -1) || true
  if [[ -z "$c" ]]; then
    echo -e "${RED}No running Docker MySQL container found.${NC}" >&2
    echo "Start one or set DOCKER_MYSQL_CONTAINER env var." >&2
    exit 1
  fi
  echo "$c"
}

get_local_root_password() {
  local pw=""
  if [[ "$BACKEND" == "docker" ]]; then
    pw=$(docker inspect "$DOCKER_CONTAINER" --format '{{range .Config.Env}}{{println .}}{{end}}' 2>/dev/null \
      | grep MYSQL_ROOT_PASSWORD | cut -d= -f2-) || true
  fi
  if [[ -z "$pw" ]]; then
    pw=$(get_password "local:root" "Local MySQL root password")
  fi
  echo "$pw"
}

resolve_ip() {
  local hostname="$1"
  [[ "$hostname" == "localhost" || "$hostname" == "127.0.0.1" ]] && { echo "127.0.0.1"; return; }
  local ip
  ip=$(getent hosts "$hostname" 2>/dev/null | awk '{print $1; exit}') || true
  [[ -z "$ip" ]] && ip=$(host "$hostname" 2>/dev/null | grep "has address" | awk '{print $NF; exit}') || true
  echo "${ip:-$hostname}"
}

is_local() {
  local host="$1"
  [[ "$host" == "localhost" || "$host" == "127.0.0.1" ]]
}

# ============================================================
# Execution Backend: local mysql client if available, else docker
# ============================================================

BACKEND=""
DOCKER_CONTAINER=""

init_backend() {
  if command -v mysql &>/dev/null && command -v mysqldump &>/dev/null; then
    BACKEND="local"
    echo -e "${CYAN}Using local mysql client${NC}"
    return
  fi
  docker ps &>/dev/null || {
    echo -e "${RED}Neither a local mysql client nor a running Docker daemon was found.${NC}" >&2
    exit 1
  }
  BACKEND="docker"
  DOCKER_CONTAINER="$(find_docker_mysql)"
  echo -e "${CYAN}Docker container: $DOCKER_CONTAINER${NC}"
}

# mysql without stdin (queries)
mysql_query() {
  if [[ "$BACKEND" == "local" ]]; then mysql "$@"; else docker exec "$DOCKER_CONTAINER" mysql "$@"; fi
}

# mysql reading stdin (pipe target)
mysql_load() {
  if [[ "$BACKEND" == "local" ]]; then mysql "$@"; else docker exec -i "$DOCKER_CONTAINER" mysql "$@"; fi
}

# mysqldump
dump() {
  if [[ "$BACKEND" == "local" ]]; then mysqldump "$@"; else docker exec "$DOCKER_CONTAINER" mysyldump "$@"; fi
}

# ============================================================
# Table Listing
# ============================================================

list_tables() {
  local host="$1" port="$2" user="$3" password="$4" schema="$5"
  local run_host="$host"
  is_local "$host" || run_host=$(resolve_ip "$host")

  mysql_query -h "$run_host" -P "$port" -u "$user" -p"$password" \
    -N -e "SHOW TABLES" "$schema" 2>/dev/null || true
}

# ============================================================
# Sync Execution
# ============================================================

sync_one_table() {
  local src_host="$1" src_port="$2" src_user="$3" src_pw="$4" src_schema="$5" \
        tgt_pw="$6" tgt_schema="$7" table="$8"

  local src_run="$src_host"
  is_local "$src_host" || src_run=$(resolve_ip "$src_host")

  dump \
    -h "$src_run" -P "$src_port" -u "$src_user" -p"$src_pw" \
    --replace --single-transaction --set-gtid-purged=OFF \
    "$src_schema" "$table" 2> >(filter_warn) \
  | mysql_load \
    -u root -p"$tgt_pw" "$tgt_schema" 2> >(filter_warn)
}

verify_table() {
  local src_host="$1" src_port="$2" src_user="$3" src_pw="$4" src_schema="$5" \
        tgt_pw="$6" tgt_schema="$7" table="$8"

  local src_run="$src_host"
  is_local "$src_host" || src_run=$(resolve_ip "$src_host")

  local src_cnt tgt_cnt
  src_cnt=$(mysql_query -h "$src_run" -P "$src_port" -u "$src_user" \
    -p"$src_pw" -N -e "SELECT COUNT(*) FROM \`$table\`" "$src_schema" 2> >(filter_warn)) || src_cnt="ERR"
  tgt_cnt=$(mysql_query -u root -p"$tgt_pw" \
    -N -e "SELECT COUNT(*) FROM \`$table\`" "$tgt_schema" 2> >(filter_warn)) || tgt_cnt="ERR"

  if [[ "$src_cnt" == "$tgt_cnt" && "$src_cnt" != "ERR" ]]; then
    echo -e "  ${GREEN}✓ $table: $src_cnt rows${NC}"
  else
    echo -e "  ${RED}✗ $table: source=$src_cnt target=$tgt_cnt${NC}"
  fi
}

# ============================================================
# Interactive: Table Selection
# ============================================================

select_tables_interactive() {
  local host="$1" port="$2" user="$3" password="$4" schema="$5"

  echo -e "\n${BOLD}Fetching tables from $schema ...${NC}"
  local tables_str
  tables_str=$(list_tables "$host" "$port" "$user" "$password" "$schema")

  if [[ -z "$tables_str" ]]; then
    echo -e "${RED}No tables found or connection failed.${NC}"
    return 1
  fi

  local -a all_tables=()
  while IFS= read -r t; do
    [[ -n "$t" ]] && all_tables+=("$t")
  done <<< "$tables_str"

  echo -e "${GREEN}Found ${#all_tables[@]} tables${NC}"

  local -a selected=()
  echo -e "\n${BOLD}Select tables to sync:${NC}"
  echo "  Enter table numbers (comma-separated), range (1-5), or 'all':"

  while true; do
    echo -n -e "${CYAN}> ${NC}"
    read -r input
    case "$input" in
      all)
        selected=("${all_tables[@]}"); break ;;
      "")
        echo -e "${RED}Please enter a selection${NC}" ;;
      *)
        selected=()
        local valid=true
        IFS=',' read -ra parts <<< "$input"
        for p in "${parts[@]}"; do
          p="${p// /}"  # trim spaces
          if [[ "$p" =~ ^([0-9]+)-([0-9]+)$ ]]; then
            local lo="${BASH_REMATCH[1]}" hi="${BASH_REMATCH[2]}" i
            for ((i=lo; i<=hi && i<=${#all_tables[@]}; i++)); do
              selected+=("${all_tables[$((i-1))]}")
            done
          elif [[ "$p" =~ ^[0-9]+$ && "$p" -ge 1 && "$p" -le ${#all_tables[@]} ]]; then
            selected+=("${all_tables[$((p-1))]}")
          else
            echo -e "${RED}Invalid: $p${NC}"
            valid=false
          fi
        done
        if $valid && [[ ${#selected[@]} -gt 0 ]]; then break; fi
        ;;
    esac
  done

  # Output comma-separated
  local IFS=,; echo "${selected[*]}"
}

# ============================================================
# Interactive: Source/Target Selection
# ============================================================

print_sources() {
  echo -e "\n${BOLD}Available Data Sources:${NC}"
  echo -e "  ${CYAN}#  Name                       Host                                    User${NC}"
  echo "  ── ────────────────────────── ────────────────────────────────────── ────────────────────"
  for i in "${!DS_NAMES[@]}"; do
    local n="${DS_NAMES[$i]}"
    printf "  %-2d %-26s %-46s %s\n" "$((i+1))" "$n" "${DS_HOST[$n]}:${DS_PORT[$n]}" "${DS_USER[$n]}"
  done
}

select_source() {
  print_sources
  echo -e "\n${BOLD}Select source (number):${NC}"
  local sel
  while true; do
    echo -n -e "${CYAN}> ${NC}"
    read -r sel
    if [[ "$sel" =~ ^[0-9]+$ && "$sel" -ge 1 && "$sel" -le ${#DS_NAMES[@]} ]]; then
      echo "$((sel-1))"
      return
    fi
    echo -e "${RED}Invalid selection${NC}"
  done
}

select_target() {
  local src_idx="$1"
  print_sources
  echo -e "\n${BOLD}Select target (number, 0=custom):${NC}"
  local sel
  while true; do
    echo -n -e "${CYAN}> ${NC}"
    read -r sel
    if [[ "$sel" =~ ^[0-9]+$ && "$sel" -ge 0 && "$sel" -le ${#DS_NAMES[@]} ]]; then
      if [[ "$sel" -eq "$((src_idx+1))" ]]; then
        echo -e "${RED}Target cannot be the same as source${NC}"
        continue
      fi
      echo "$((sel-1))"
      return
    fi
    echo -e "${RED}Invalid selection${NC}"
  done
}

# ============================================================
# Main
# ============================================================

main() {
  local mode="interactive" src_name="" tgt_name="" tables_input=""
  local src_schema="" tgt_schema=""

  while [[ $# -gt 0 ]]; do
    case "$1" in
      --source)        src_name="$2";     shift 2 ;;
      --target)        tgt_name="$2";     shift 2 ;;
      --src-schema)    src_schema="$2";   shift 2 ;;
      --tgt-schema)    tgt_schema="$2";   shift 2 ;;
      --tables)        tables_input="$2"; shift 2 ;;
      --datagrip-dir)  DATAGRIP_DIR="$2"; DATASOURCES_XML="$2/dataSources.xml"
                       DATASOURCES_LOCAL_XML="$2/dataSources.local.xml"; shift 2 ;;
      --help|-h)
        echo "Usage: $0 [OPTIONS]"
        echo ""
        echo "Options:"
        echo "  --source NAME       Source DataGrip data source name"
        echo "  --target NAME       (ignored) target is always local MySQL"
        echo "  --src-schema NAME   Source database/schema name"
        echo "  --tgt-schema NAME   Target database/schema name"
        echo "  --tables t1,t2,...  Comma-separated table names"
        echo "  --datagrip-dir DIR  Path to DataGrip .idea dir"
        echo ""
        echo "Without options, runs in interactive mode."
        exit 0
        ;;
      *) echo "Unknown option: $1"; exit 1 ;;
    esac
  done

  # Target is always the local MySQL container (root).
  # --target is accepted for back-compat but unused in direct mode.
  [[ -n "$src_name" && -n "$tables_input" ]] && mode="direct"

  # Preflight: prefer local mysql client, fall back to Docker MySQL container
  init_backend

  load_config
  parse_sources

  local local_pw
  local_pw=$(get_local_root_password)

  # ---- Direct Mode ----
  if [[ "$mode" == "direct" ]]; then
    local src_host="${DS_HOST[$src_name]:-}" src_port="${DS_PORT[$src_name]:-3306}"
    local src_user="${DS_USER[$src_name]:-root}"

    [[ -z "$src_host" ]] && { echo -e "${RED}Source '$src_name' not found${NC}"; exit 1; }

    local src_pw=""
    is_local "$src_host" || src_pw=$(get_password "$src_name" "Password for $src_name")

    [[ -z "$src_schema" ]] && { echo -e "${RED}--src-schema required${NC}"; exit 1; }
    [[ -z "$tgt_schema" ]] && { echo -e "${RED}--tgt-schema required${NC}"; exit 1; }

    # Ensure target schema exists (matches interactive mode)
    mysql_query -u root -p"$local_pw" \
      -e "CREATE DATABASE IF NOT EXISTS \`$tgt_schema\`" 2>/dev/null

    IFS=',' read -ra tbls <<< "$tables_input"
    echo -e "\n${BOLD}Syncing ${#tbls[@]} tables: $src_name.$src_schema → localhost.$tgt_schema${NC}"

    for t in "${tbls[@]}"; do
      t="${t// /}"
      echo -ne "  ${CYAN}▶ $t${NC} ... "
      if sync_one_table "$src_host" "$src_port" "$src_user" "$src_pw" \
                        "$src_schema" "$local_pw" "$tgt_schema" "$t"; then
        echo -e "${GREEN}OK${NC}"
      else
        echo -e "${RED}FAILED${NC}"
      fi
    done

    echo -e "\n${BOLD}Row count verification:${NC}"
    for t in "${tbls[@]}"; do
      t="${t// /}"
      verify_table "$src_host" "$src_port" "$src_user" "$src_pw" \
                   "$src_schema" "$local_pw" "$tgt_schema" "$t"
    done
    return
  fi

  # ---- Interactive Mode ----
  echo -e "\n${BOLD}${CYAN}══════════════════════════════════════${NC}"
  echo -e "${BOLD}${CYAN}   Database Sync Tool${NC}"
  echo -e "${BOLD}${CYAN}══════════════════════════════════════${NC}"

  # Source
  local src_idx
  src_idx=$(select_source)
  src_name="${DS_NAMES[$src_idx]}"
  src_schema=""

  # Prompt for source schema
  local known_schemas="${SCHEMA_MAP[$src_name]:-}"
  if [[ -n "$known_schemas" ]]; then
    echo -e "\n${BOLD}Known schemas for $src_name:${NC} $known_schemas"
  fi
  echo -n -e "${BOLD}Source schema/database: ${NC}"
  read -r src_schema

  local src_host="${DS_HOST[$src_name]}" src_port="${DS_PORT[$src_name]}"
  local src_user="${DS_USER[$src_name]}"
  local src_pw=""
  is_local "$src_host" || src_pw=$(get_password "$src_name" "Password for $src_name")

  # Target
  local tgt_idx tgt_host tgt_port tgt_user
  tgt_idx=$(select_target "$src_idx")

  if [[ "$tgt_idx" -lt 0 ]]; then
    tgt_name="custom"
    tgt_host="localhost"
    tgt_port="33060"
    tgt_user="root"
  else
    tgt_name="${DS_NAMES[$tgt_idx]}"
    tgt_host="${DS_HOST[$tgt_name]}"
    tgt_port="${DS_PORT[$tgt_name]}"
    tgt_user="${DS_USER[$tgt_name]}"
  fi

  echo -n -e "${BOLD}Target schema/database: ${NC}"
  read -r tgt_schema

  # Ensure target schema exists
  mysql_query -u root -p"$local_pw" \
    -e "CREATE DATABASE IF NOT EXISTS \`$tgt_schema\`" 2>/dev/null

  # Tables
  local tables_csv
  tables_csv=$(select_tables_interactive "$src_host" "$src_port" "$src_user" "$src_pw" "$src_schema")
  IFS=',' read -ra tbls <<< "$tables_csv"

  # Confirm (target is always the local MySQL; selected target datasource is informational)
  echo -e "\n${BOLD}Sync plan:${NC}"
  echo -e "  From:   ${CYAN}$src_name${NC} ($src_host:$src_port) / ${BOLD}$src_schema${NC}"
  echo -e "  To:     ${CYAN}localhost${NC} (local MySQL) / ${BOLD}$tgt_schema${NC}"
  echo -e "  Tables: ${YELLOW}${tbls[*]}${NC}"
  echo ""
  echo -n -e "${BOLD}Confirm? [Y/n] ${NC}"
  read -r confirm
  [[ "$confirm" =~ ^[Nn] ]] && { echo "Cancelled."; return; }

  # Execute
  echo ""
  for t in "${tbls[@]}"; do
    echo -ne "  ${CYAN}▶ $t${NC} ... "
    if sync_one_table "$src_host" "$src_port" "$src_user" "$src_pw" \
                      "$src_schema" "$local_pw" "$tgt_schema" "$t"; then
      echo -e "${GREEN}OK${NC}"
    else
      echo -e "${RED}FAILED${NC}"
    fi
  done

  # Verify
  echo -e "\n${BOLD}Row count verification:${NC}"
  for t in "${tbls[@]}"; do
    verify_table "$src_host" "$src_port" "$src_user" "$src_pw" \
                 "$src_schema" "$local_pw" "$tgt_schema" "$t"
  done

  echo -e "\n${GREEN}${BOLD}Done!${NC}"
}

main "$@"
