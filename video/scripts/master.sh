#!/bin/sh
# Final mix: two-pass loudness normalisation to -14 LUFS / -1 dBTP (YouTube's target). Video is copied untouched.
#   sh scripts/master.sh out/flaglens-demo-raw.mp4 out/flaglens-demo.mp4
set -e
IN=$1; OUT=$2
STATS=$(ffmpeg -hide_banner -nostats -i "$IN" -af loudnorm=I=-14:TP=-1:LRA=11:print_format=json -f null - 2>&1 | sed -n '/{/,/}/p')
val() { echo "$STATS" | grep "\"$1\"" | sed 's/.*: "\(.*\)".*/\1/'; }
ffmpeg -y -hide_banner -loglevel error -i "$IN" -c:v copy \
  -af "loudnorm=I=-14:TP=-1:LRA=11:measured_I=$(val input_i):measured_TP=$(val input_tp):measured_LRA=$(val input_lra):measured_thresh=$(val input_thresh):offset=$(val target_offset):linear=true,aresample=48000" \
  -c:a aac -b:a 320k -movflags +faststart "$OUT"
echo "mastered → $OUT"
