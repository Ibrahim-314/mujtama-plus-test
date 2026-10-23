#!/usr/bin/env bash
# Installs Chromium + the shared libs it lacks into a persistent cache (no root needed).
# Survives sandbox resets that wipe /usr. Arch-aware (amd64/arm64).
set -euo pipefail
CACHE="${MP_BROWSER_CACHE:-/workspace/.cache}"
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
export PLAYWRIGHT_BROWSERS_PATH="$CACHE/ms-playwright"
LIBS="$CACHE/chromium-libs"; mkdir -p "$LIBS"
node "$ROOT/node_modules/playwright-core/cli.js" install chromium >/dev/null 2>&1 || true
CHROME=$(ls -d "$PLAYWRIGHT_BROWSERS_PATH"/chromium-*/chrome-linux/chrome 2>/dev/null | sort | tail -1)
[ -x "$CHROME" ] || { echo "chromium download failed"; exit 1; }
case "$(uname -m)" in aarch64|arm64) ARCH=arm64; MA=aarch64-linux-gnu;; *) ARCH=amd64; MA=x86_64-linux-gnu;; esac
declare -A SRC=( [libatk1.0-0t64]=a/at-spi2-core [libatk-bridge2.0-0t64]=a/at-spi2-core [libatspi2.0-0t64]=a/at-spi2-core
  [libxcomposite1]=libx/libxcomposite [libxdamage1]=libx/libxdamage [libxres1]=libx/libxres [libxkbcommon0]=libx/libxkbcommon
  [libxrandr2]=libx/libxrandr [libgbm1]=m/mesa [libasound2t64]=a/alsa-lib [libcups2t64]=c/cups [libpango-1.0-0]=p/pango1.0
  [libnss3]=n/nss [libnspr4]=n/nspr [libdrm2]=libd/libdrm [libxfixes3]=libx/libxfixes [libcairo2]=c/cairo )
TMP=$(mktemp -d); trap 'rm -rf "$TMP"' EXIT
for i in 1 2 3; do
  MISSING=$(LD_LIBRARY_PATH="$LIBS" ldd "$CHROME" | awk '/not found/{print $1}')
  [ -z "$MISSING" ] && break
  for pkg in "${!SRC[@]}"; do
    s=${SRC[$pkg]}; url="https://deb.debian.org/debian/pool/main/$s/"
    f=$(curl -sf "$url" | grep -o "${pkg}_[^\"]*_${ARCH}.deb" | sort -V | tail -1) || continue
    [ -n "$f" ] || continue
    curl -sfo "$TMP/$f" "$url$f" && dpkg-deb -x "$TMP/$f" "$TMP/x" || true
  done
  cp -an "$TMP"/x/usr/lib/$MA/*.so* "$LIBS"/ 2>/dev/null || true
done
LD_LIBRARY_PATH="$LIBS" ldd "$CHROME" | grep "not found" && { echo "still missing libs"; exit 1; }
echo "chromium ready: $CHROME"
