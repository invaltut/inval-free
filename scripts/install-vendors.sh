#!/usr/bin/env bash
set -euo pipefail

if ! command -v curl >/dev/null || ! command -v gzip >/dev/null; then
  echo 'ERROR: curl and gzip are required' >&2
  exit 1
fi

OUT="${1:?Usage: bash scripts/install-vendors.sh otmena-prikaza/vendor}"
mkdir -p "$OUT/pdfjs" "$OUT/tesseract" "$OUT/tesseract-core" "$OUT/lang" "$OUT/licenses"

fetch() {
  local dest="$1"; shift
  local url
  if [[ -s "$dest" ]]; then
    printf 'CACHED %s (%s bytes)\n' "${dest##*/}" "$(stat -c %s "$dest")"
    return 0
  fi
  for url in "$@"; do
    echo "DOWNLOAD $(basename "$dest") from ${url%%\?*}"
    if curl -fL -sS --retry 2 --retry-delay 2 --connect-timeout 15 --max-time 120 \
      --output "${dest}.part" "$url" && test -s "${dest}.part"; then
      mv "${dest}.part" "$dest"
      return 0
    fi
    rm -f "${dest}.part"
  done
  echo "ERROR: unable to download $(basename "$dest")" >&2
  return 1
}

pdf_version=4.9.155
for file in pdf.mjs pdf.worker.mjs; do
  fetch "$OUT/pdfjs/$file" \
    "https://cdn.jsdelivr.net/npm/pdfjs-dist@${pdf_version}/build/$file" \
    "https://unpkg.com/pdfjs-dist@${pdf_version}/build/$file"
done

tess_version=5.1.1
core_version=5.0.0
for file in tesseract.min.js worker.min.js; do
  fetch "$OUT/tesseract/$file" \
    "https://cdn.jsdelivr.net/npm/tesseract.js@${tess_version}/dist/$file" \
    "https://unpkg.com/tesseract.js@${tess_version}/dist/$file"
done
for file in \
  tesseract-core.wasm.js \
  tesseract-core-simd.wasm.js \
  tesseract-core-lstm.wasm.js \
  tesseract-core-simd-lstm.wasm.js; do
  fetch "$OUT/tesseract-core/$file" \
    "https://cdn.jsdelivr.net/npm/tesseract.js-core@${core_version}/$file" \
    "https://unpkg.com/tesseract.js-core@${core_version}/$file"
done

for lang in rus eng; do
  fetch "$OUT/lang/${lang}.traineddata.gz" \
    "https://cdn.jsdelivr.net/npm/@tesseract.js-data/${lang}@1.0.0/4.0.0_best_int/${lang}.traineddata.gz" \
    "https://unpkg.com/@tesseract.js-data/${lang}@1.0.0/4.0.0_best_int/${lang}.traineddata.gz" \
    "https://raw.githubusercontent.com/naptha/tessdata/gh-pages/4.0.0_fast/${lang}.traineddata.gz"
  gzip -t "$OUT/lang/${lang}.traineddata.gz"
done

for spec in \
  "pdfjs-dist@${pdf_version}/LICENSE:pdfjs-LICENSE.txt" \
  "tesseract.js@${tess_version}/LICENSE:tesseract-LICENSE.txt" \
  "tesseract.js-core@${core_version}/LICENSE:tesseract-core-LICENSE.txt"; do
  pkg="${spec%%/*}"
  rem="${spec#*/}"
  file="${rem%%:*}"
  name="${rem##*:}"
  fetch "$OUT/licenses/$name" "https://cdn.jsdelivr.net/npm/$pkg/$file" "https://unpkg.com/$pkg/$file" || true
done

# Compare with the deployed site's file checksums, if present.
if [[ -f VENDOR_SHA256SUMS ]]; then
  sha256sum -c VENDOR_SHA256SUMS || {
    echo 'WARNING: downloaded vendor bytes differ from the exported deployment' >&2
    echo 'Inspect the downloaded versions before trusting the result.' >&2
    exit 1
  }
fi

echo 'VENDORS_READY=OK'
