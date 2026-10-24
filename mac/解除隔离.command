#!/bin/bash
# 首次使用辅助：解除“来自 Internet”隔离属性，并给 .command 加上可执行权限
cd "$(dirname "$0")" || exit 1

xattr -dr com.apple.quarantine . 2>/dev/null
chmod +x ./*.command ./launcher.py 2>/dev/null

echo "已完成："
echo "  · 解除当前文件夹的 com.apple.quarantine 隔离属性"
echo "  · 给 启动模拟器.command / 解除隔离.command 加上可执行权限"
echo ""
echo "现在可以双击 启动模拟器.command 了。"
read -r -p "按回车关闭此窗口..."
