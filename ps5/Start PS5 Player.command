#!/bin/sh
set -eu
cd "$(dirname "$0")"
docker_cli=/Applications/Docker.app/Contents/Resources/bin/docker
if [ ! -x "$docker_cli" ]; then docker_cli=$(command -v docker || true); fi
if [ -z "$docker_cli" ] || ! "$docker_cli" --context desktop-linux info >/dev/null 2>&1; then
    echo 'Open Docker Desktop and wait for the engine to start, then run this launcher again.'
    exit 1
fi
"$docker_cli" --context desktop-linux compose -f compose.yaml up --detach --wait
echo 'PS5 player is ready. In Remote Pad, choose Open PS5 Remote Play, then Take control (我要操控).'
echo 'Your local player password is'
"$docker_cli" --context desktop-linux compose -f compose.yaml exec -T player node -p "require('/data/config.json').password"
echo 'You can close this window after copying the password. To stop the player, stop remote-pad-ps5 in Docker Desktop.'
