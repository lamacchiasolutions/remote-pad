@echo off
setlocal
pushd "%~dp0" || exit /b 1
docker --context desktop-linux info >nul 2>&1
if errorlevel 1 (
    echo Open Docker Desktop in Linux containers mode and wait for the engine to start, then run this launcher again.
    goto failed
)
docker --context desktop-linux compose -f compose.yaml up --detach --wait
if errorlevel 1 goto failed
echo PS5 player is ready. Choose Open PS5 in Remote Pad, then Take control.
echo Your local player password is
docker --context desktop-linux compose -f compose.yaml exec -T player node -p "require('/data/config.json').password"
if errorlevel 1 goto failed
echo You can close this window after copying the password. To stop the player, stop remote-pad-ps5 in Docker Desktop.
pause
popd
exit /b 0
:failed
echo The PS5 player could not start. See Help - PS5 setup in Remote Pad.
pause
popd
exit /b 1
