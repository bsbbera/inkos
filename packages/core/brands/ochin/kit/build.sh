#!/bin/sh
# Rebuild ochin-kit.js from the brand's working sources (Output/Brand/photo-film). Run after editing them.
H="$(cd "$(dirname "$0")" && pwd)"; PF="${1:-/c/Users/SUBHADIP/IDEAVERSE/Output/Brand/photo-film}"
{ echo "// Ochin shape kit for Quire builds: geo (trimmed) + shapes.js + finish.js + ochin-shape-tool.js."
  echo "// Generated from Output/Brand/photo-film by brands/ochin/kit/build.sh; edit the sources, not this."
  sh "$PF/geo-lite.sh"; echo; echo "globalThis.G = G;"
  cat "$PF/shapes.js"; echo; cat "$PF/finish.js"; echo; cat "$PF/ochin-shape-tool.js"; echo; echo "globalThis.ochinShape = ochinShape;"; } > "$H/ochin-kit.js"
node --check "$H/ochin-kit.js" && echo "$H/ochin-kit.js"
