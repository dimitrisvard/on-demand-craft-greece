#!/bin/bash
# Convert source images to optimized WebP variants for the homepage / hero / services / industries.
# Output goes alongside the originals so we keep PNG/JPG fallbacks for older browsers.

set -e
SRC_DIR="$(dirname "$0")/../public/lovable-uploads"
cd "$SRC_DIR"

# $1 = source file, $2 = max width, $3 = quality
mkwebp() {
  local src="$1" w="$2" q="${3:-78}"
  local base="${src%.*}"
  local out="${base}-${w}.webp"
  if [ ! -f "$src" ]; then
    echo "skip (missing): $src"
    return
  fi
  cwebp -quiet -q "$q" -resize "$w" 0 "$src" -o "$out"
  echo "  $(printf '%-12s' "${w}px") $(stat -c%s "$out") bytes  $out"
}

echo "== Workflow step images (square, displayed ~252x252) =="
for f in f239043e-a42b-4b5f-8fa3-8c964cdf24ab.png \
         d6fe3791-124e-467d-b139-0de39711af5e.png \
         16c64550-bebe-424d-b0a9-1897d23c0968.png \
         e684a8c7-882d-4e2a-b7f1-c2390897e274.png; do
  mkwebp "$f" 504 78
  mkwebp "$f" 252 78
done

echo
echo "== Service card images (16:9, displayed ~450x225) =="
for f in 200d9297-1d4c-4f58-a7d0-492ec78f506b.png \
         59f13e48-0a66-4e3a-a3c3-e9db4fa53d08.png \
         b31d113f-4829-4150-b985-c71d1f99dd5f.png \
         e4960d66-a6c4-46ae-ab67-f061530c38cb.png \
         solidworks-rapid-prototyping.png; do
  mkwebp "$f" 900 78
  mkwebp "$f" 450 78
done

echo
echo "== Sheet metal (portrait, displayed ~400x600) =="
mkwebp "f6ea9e7f-263a-4ab2-a37b-8b5f4f41a537.png" 800 78
mkwebp "f6ea9e7f-263a-4ab2-a37b-8b5f4f41a537.png" 400 78

echo
echo "== Trusted companies (displayed ~404-469 x 220) =="
for f in aerospace-and-defence.jpg \
         automotive.jpg \
         medical-industry.jpg \
         industrial-automation.jpg; do
  mkwebp "$f" 800 75
  mkwebp "$f" 400 75
done

echo
echo "== Industries grid (displayed ~3-5 cols, ~200-300 wide) =="
for f in b8cf7ba7-ff7c-4b2f-b0f3-6e2a22c67a56.png \
         60e70592-dead-43bf-8e13-84721335759b.png \
         af68ca9b-890c-4621-9c34-647ab740638a.png \
         3039d310-f098-41d9-bd6d-f0bbd96cd6d0.png \
         5e121727-74d3-4cd9-a408-cbc38c44eb3d.png \
         826bb430-78bf-44d2-bd1a-51ffc0114f0c.png \
         b85d87d8-d572-45bb-96f5-0fc03ef5527b.png \
         a47a5177-0329-402a-97c3-aa30856e045f.png \
         87b2d570-3452-484d-95f7-9f5f5e34302b.png \
         f9f6c191-3f92-4b8d-be22-0c26f59e729b.png; do
  mkwebp "$f" 600 75
  mkwebp "$f" 300 75
done

echo
echo "== Logo (displayed ~172x48) =="
mkwebp "a27a8329-2c4a-4b05-b1c4-b200b903617e.png" 344 85

echo
echo "== Hero background (full viewport) =="
mkwebp "b17e4baa-4be2-4892-a725-5871867d3dc3.png" 1600 72
mkwebp "b17e4baa-4be2-4892-a725-5871867d3dc3.png" 800 72

echo
echo "Done."
