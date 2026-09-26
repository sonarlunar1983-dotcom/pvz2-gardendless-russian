@echo off
setlocal
set GOOS=windows
set GOARCH=amd64
go build -trimpath -ldflags="-H windowsgui -s -w" -o PvZ2_Gardendless_Font_Fixer_1.0.exe .
if errorlevel 1 exit /b 1
echo Built: PvZ2_Gardendless_Font_Fixer_1.0.exe
