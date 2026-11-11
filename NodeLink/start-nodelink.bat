@echo off
title NodeLink Server

:loop
echo Booting NodeLink with High CPU Priority...
start /B /WAIT /HIGH node --env-file=../.env --dns-result-order=ipv4first --max-semi-space-size=64 --max-old-space-size=512 --import tsx src/index.ts
echo.
echo [CRITICAL] NodeLink Server has crashed or stopped!
echo Restarting in 5 seconds to prevent CPU pegging...
timeout /t 5
goto loop
