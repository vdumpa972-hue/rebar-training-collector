@echo off
setlocal EnableExtensions
cd /d "%~dp0"

set "APP_NAME=rebar-training-collector"
set "BACKUP_DIR=C:\Users\vdumpa\backups\rebar-training-collector"
if not exist "%BACKUP_DIR%" mkdir "%BACKUP_DIR%"

if not exist "package.json" (
  echo ERROR: package.json not found.
  echo Run this BAT from the rebar-training-collector project root folder.
  pause
  exit /b 1
)

for /f %%i in ('powershell -NoProfile -Command "Get-Date -Format yyyy-MM-dd_HH-mm-ss"') do set "TS=%%i"
set "BACKUP_FILE=%BACKUP_DIR%\rebar-training-collector-%TS%.zip"

echo.
echo =========================
echo Creating backup
echo =========================
echo Backup file: %BACKUP_FILE%

powershell -NoProfile -ExecutionPolicy Bypass -Command ^
  "$ErrorActionPreference='Stop';" ^
  "$ProgressPreference='SilentlyContinue';" ^
  "$src = Get-Location;" ^
  "$dest = '%BACKUP_FILE%';" ^
  "$tmpName = '_backup_stage_' + [guid]::NewGuid().ToString();" ^
  "$tmp = Join-Path $src $tmpName;" ^
  "New-Item -ItemType Directory -Path $tmp | Out-Null;" ^
  "$exclude = @('node_modules','.next','.turbo','out','dist','coverage','.git','.vercel','source-zips','rebar-training-collector-zips','backups','android','ios',$tmpName);" ^
  "Get-ChildItem -Force | Where-Object { $exclude -notcontains $_.Name } | ForEach-Object { Copy-Item $_.FullName -Destination $tmp -Recurse -Force }" ^
  "; Compress-Archive -Path (Join-Path $tmp '*') -DestinationPath $dest -Force;" ^
  "Remove-Item $tmp -Recurse -Force"

if errorlevel 1 (
  echo.
  echo ERROR: Backup failed.
  pause
  exit /b 1
)

echo Backup created successfully.
echo.

echo =========================
echo Clearing local build cache
echo =========================

if exist ".next" rmdir /s /q ".next"
if exist ".turbo" rmdir /s /q ".turbo"
if exist "node_modules\.cache" rmdir /s /q "node_modules\.cache"

echo Cache cleanup finished.
echo.

echo =========================
echo Installing dependencies if needed
echo =========================

if not exist "node_modules" (
  call npm install
  if errorlevel 1 (
    echo.
    echo ERROR: npm install failed.
    echo Your backup is in: %BACKUP_FILE%
    pause
    exit /b 1
  )
)

echo.
echo =========================
echo Running build check
echo =========================

call npm run build

if errorlevel 1 (
  echo.
  echo ERROR: Build failed.
  echo Your backup is in: %BACKUP_FILE%
  pause
  exit /b 1
)

echo.
echo =========================
echo Build Size Summary
echo =========================

for /f %%i in ('powershell -NoProfile -Command "if (Test-Path '.next') { [math]::Round(((Get-ChildItem '.next' -Recurse -File | Measure-Object Length -Sum).Sum / 1MB), 2) } else { 0 }"') do set "NEXT_SIZE_MB=%%i"

echo Approximate local build size ^(.next^): %NEXT_SIZE_MB% MB

echo.
echo Largest files in .next:
powershell -NoProfile -Command ^
  "if (Test-Path '.next') { $files = Get-ChildItem '.next' -Recurse -File | Sort-Object Length -Descending | Select-Object -First 10 FullName,@{Name='SizeMB';Expression={[math]::Round($_.Length / 1MB, 2)}}; if ($files) { $files | Format-Table -AutoSize } else { Write-Host 'No files found in .next' } } else { Write-Host '.next folder not found' }"

echo.
echo =========================
echo Checking Vercel CLI
echo =========================

where vercel >nul 2>nul
if errorlevel 1 (
  echo ERROR: Vercel CLI is not installed.
  echo Run: npm i -g vercel
  echo Backup saved to: %BACKUP_FILE%
  pause
  exit /b 1
)

echo.
echo =========================
echo Deploying to Vercel Production
echo =========================

call vercel --prod

if errorlevel 1 (
  echo.
  echo ERROR: Vercel production deploy failed.
  echo Your backup is in: %BACKUP_FILE%
  pause
  exit /b 1
)

echo.
echo =========================
echo Production deploy completed
echo =========================
echo Backup saved to: %BACKUP_FILE%
echo.

pause
endlocal
