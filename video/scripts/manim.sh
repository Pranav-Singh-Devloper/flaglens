#!/bin/sh
# Renders the Manim concept scenes at 1920x1080, 60 fps, into public/manim/.
set -e
cd "$(dirname "$0")/.."
mkdir -p public/manim
for scene in StatesScene DriftScene StaleScene; do
  manim -r 1920,1080 --fps 60 --disable_caching --media_dir media -o "$scene" manim/scenes.py "$scene"
  cp "media/videos/scenes/1080p60/$scene.mp4" "public/manim/$scene.mp4"
done
