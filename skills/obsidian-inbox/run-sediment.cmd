@echo off
rem ============================================================
rem obsidian-inbox manual entry for Windows: locate node, run sediment.mjs
rem (equivalent to run-sediment.sh; daily scheduling is already registered by
rem  install.mjs as a Task Scheduler job, so this is for manual runs only)
rem
rem Usage:
rem   run-sediment.cmd --dry-run
rem   run-sediment.cmd --since-hours 72 --no-llm
rem   run-sediment.cmd --session session-xxx
rem If node is not in PATH, set it first:
rem   set OBSIDIAN_INBOX_NODE=C:\path\to\node.exe
rem ============================================================
setlocal
set "SKILL_DIR=%~dp0"

if defined OBSIDIAN_INBOX_NODE goto :use_env_node
where node >nul 2>nul
if errorlevel 1 goto :no_node
set "NODE_BIN=node"
goto :run

:use_env_node
set "NODE_BIN=%OBSIDIAN_INBOX_NODE%"

:run
"%NODE_BIN%" "%SKILL_DIR%scripts\sediment.mjs" %*
exit /b %ERRORLEVEL%

:no_node
echo obsidian-inbox: node not found in PATH. 1>&2
echo   set OBSIDIAN_INBOX_NODE=C:\path\to\node.exe 1>&2
exit /b 127
