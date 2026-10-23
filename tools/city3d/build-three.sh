#!/bin/sh
# Rebuild public/city/three-city.js (three r169 + GLTFLoader, tree-shaken ESM). THREE_SRC = folder with three.module.js and addons/.
set -e
SRC=${THREE_SRC:-/workspace/work/city3d}
npx esbuild tools/city3d/three-entry.js --bundle --format=esm --minify --legal-comments=eof \
  --alias:three/addons=$SRC/addons --alias:three=$SRC/three.module.js --outfile=public/city/three-city.js
