@echo off
setlocal EnableExtensions

REM ============================================================
REM Rebar Training Collector SOURCE-ONLY export
REM Includes ONLY files needed to rebuild/run the app.
REM Excludes generated/rebuildable outputs like node_modules and .next.
REM ============================================================

cd /d "%~dp0"

if not exist "package.json" (
  echo ERROR: package.json not found.
  echo Run this BAT from the rebar-training-collector project root folder.
  pause
  exit /b 1
)

set "OUTDIR=%~dp0..\rebar-training-collector-zips"
if not exist "%OUTDIR%" mkdir "%OUTDIR%"

for /f %%i in ('powershell -NoProfile -Command "Get-Date -Format yyyy-MM-dd_HH-mm-ss"') do set "TS=%%i"
set "ZIPFILE=%OUTDIR%\rebar-training-collector-source-only-%TS%.zip"
set "STAGE=%TEMP%\rebar_training_collector_export_%RANDOM%%RANDOM%"

if exist "%STAGE%" rmdir /s /q "%STAGE%"
mkdir "%STAGE%"

REM ============================================================
REM 1) Copy root rebuild/config/runtime files by pattern
REM ============================================================
for %%P in (
  *.json
  *.js
  *.mjs
  *.cjs
  *.ts
  *.tsx
  *.yaml
  *.yml
  *.md
  *.bat
  *.cmd
  *.ps1
  .env.example
  .env.local.example
  .eslintrc
  .eslintrc.*
  .prettierrc
  .prettierrc.*
  firestore.rules
  storage.rules
) do (
  for %%F in (%%P) do (
    if exist "%%F" copy /y "%%F" "%STAGE%\" >nul
  )
)

REM ============================================================
REM 2) Copy source folders only
REM ============================================================
for %%D in (
  app
  src
  pages
  components
  lib
  hooks
  types
  utils
  contexts
  services
  public
  styles
  prisma
  firebase
  scripts
) do (
  if exist "%%D" (
    robocopy "%%D" "%STAGE%\%%D" /E /NFL /NDL /NJH /NJS /NP ^
      /XD node_modules .next .turbo out dist coverage .git .vercel build release .gradle >nul
  )
)

REM ============================================================
REM 3) Remove generated/rebuildable junk if anything slipped in
REM ============================================================
if exist "%STAGE%\Users" rmdir /s /q "%STAGE%\Users" >nul 2>nul

powershell -NoProfile -ExecutionPolicy Bypass -Command ^
  "$stage='%STAGE%';" ^
  "$badDirs=@('node_modules','.next','.turbo','out','dist','coverage','.git','.vercel','.gradle','build','release','DerivedData','Pods','xcuserdata');" ^
  "Get-ChildItem $stage -Recurse -Force -Directory | Where-Object { $badDirs -contains $_.Name } | Sort-Object FullName -Descending | Remove-Item -Recurse -Force -ErrorAction SilentlyContinue;" ^
  "Get-ChildItem $stage -Recurse -Force -File | Where-Object { $_.Name -like '*.log' -or $_.Name -eq 'tsconfig.tsbuildinfo' -or $_.Extension -in '.aab','.apk','.ipa','.xcarchive' } | Remove-Item -Force -ErrorAction SilentlyContinue;"

REM ============================================================
REM 4) Create flat-root ZIP from inside staging folder
REM ============================================================
if exist "%ZIPFILE%" del "%ZIPFILE%"

powershell -NoProfile -ExecutionPolicy Bypass -Command ^
  "$ErrorActionPreference='Stop';" ^
  "$stage='%STAGE%';" ^
  "$zip='%ZIPFILE%';" ^
  "Push-Location $stage;" ^
  "Compress-Archive -Path * -DestinationPath $zip -Force;" ^
  "Pop-Location;"

set "ERR=%ERRORLEVEL%"
rmdir /s /q "%STAGE%" >nul 2>nul

if not "%ERR%"=="0" (
  echo.
  echo EXPORT FAILED.
  pause
  exit /b %ERR%
)

echo.
echo ZIP CREATED:
echo %ZIPFILE%
echo.
echo ZIP root should contain package.json, app, src, and public directly.
echo It should NOT contain Users, node_modules, .next, build, release, .vercel, or .git.
echo.
pause
endlocal
