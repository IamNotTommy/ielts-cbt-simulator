#!/bin/bash
# 双击启动英语机考模拟器（macOS）
cd "$(dirname "$0")" || exit 1

if ! command -v python3 >/dev/null 2>&1; then
  echo "未找到 python3。"
  echo "请先安装 Xcode 命令行工具（在终端运行：xcode-select --install），或安装 Python 3。"
  read -r -p "按回车退出..."
  exit 1
fi

export PYTHONIOENCODING=utf-8
exec python3 launcher.py "$@"
