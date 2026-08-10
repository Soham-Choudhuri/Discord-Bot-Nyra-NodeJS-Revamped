@echo off
title NodeLink Server
echo Booting NodeLink with High CPU Priority...
start /high node --env-file=../.env --dns-result-order=ipv4first --import tsx src/index.ts
exit
