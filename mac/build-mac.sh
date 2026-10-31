#!/bin/bash
# 把前端 dist + Python 启动器打包成可分发的 macOS 压缩包
# 用法：bash mac/build-mac.sh [版本号]
set -euo pipefail

HERE="$(cd "$(dirname "$0")" && pwd)"
ROOT="$(cd "$HERE/.." && pwd)"
VERSION="${1:-2.0.3}"
DIST="$ROOT/dist"
OUT="$ROOT/mac-dist"
APP="$OUT/英语机考模拟器-Mac"

if [ ! -f "$DIST/index.html" ]; then
  echo "找不到 $DIST/index.html"
  echo "请先在仓库根目录运行：npm ci && npm run build"
  exit 1
fi

rm -rf "$OUT"
mkdir -p "$APP/网页应用"

# 前端构建产物
cp -R "$DIST/." "$APP/网页应用/"

# 启动器与文档
cp "$HERE/launcher.py" "$APP/"
cp "$HERE/启动模拟器.command" "$APP/"
cp "$HERE/解除隔离.command" "$APP/"
cp "$HERE/README.md" "$APP/README.md"
cp "$ROOT/docs/使用说明.txt" "$APP/使用说明.txt"
cp "$ROOT/docs/PACK_FORMAT.md" "$APP/PACK_FORMAT.md"
cp "$ROOT/LICENSE" "$APP/LICENSE"

chmod +x "$APP/启动模拟器.command" "$APP/解除隔离.command" "$APP/launcher.py"

cd "$OUT"
ZIP="ielts-cbt-simulator-${VERSION}-mac.zip"
rm -f "$ZIP"
zip -r -q "$ZIP" "英语机考模拟器-Mac"
echo ""
echo "完成：$OUT/$ZIP"
echo "大小：$(du -h "$ZIP" | cut -f1)"
