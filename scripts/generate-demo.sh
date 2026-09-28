#!/usr/bin/env sh
set -eu
ffmpeg -hide_banner -loglevel error -f lavfi -i testsrc2=size=1280x720:rate=20 -t 8 -c:v libx265 -preset ultrafast -x265-params pools=2:frame-threads=2:keyint=20:bframes=0:log-level=error -pix_fmt yuv420p -tag:v hvc1 -an -y public/media/demo.mp4
