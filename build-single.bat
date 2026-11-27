@echo off
setlocal
chcp 65001 >nul
cd /d "%~dp0"
title PICO-8 Fantasy Console - build de un solo HTML
echo ============================================================
echo   Generando UN UNICO archivo HTML (JS + CSS + todo incluido)
echo ============================================================

where node >nul 2>nul
if errorlevel 1 (
  echo.
  echo [AVISO] Node.js no esta instalado.
  if exist "dist\index.html" (
    echo Se usara la carpeta dist\ ya compilada.
    goto :inline
  )
  echo Instala Node.js desde https://nodejs.org y vuelve a ejecutar este .bat
  pause
  exit /b 1
)

if not exist "node_modules" (
  echo.
  echo [1/3] Instalando dependencias...
  call npm install
  if errorlevel 1 goto :fail
)

echo.
echo [2/3] Compilando el proyecto...
call npm run build
if errorlevel 1 goto :fail

:inline
echo.
echo [3/3] Unificando todos los archivos en un unico HTML...
if not exist "release" mkdir "release"
rem vite-plugin-singlefile ya deja dist\index.html con JS y CSS en linea.
rem inline.cjs ademas incrusta cualquier .js/.css suelto y lo copia a release\
where node >nul 2>nul
if errorlevel 1 (
  copy /y "dist\index.html" "release\pico8-fantasy-console.html" >nul
) else (
  node tools\inline.cjs
)
if errorlevel 1 goto :fail

echo.
echo ============================================================
echo  LISTO:  release\pico8-fantasy-console.html
echo  Un solo archivo. Abrelo con doble clic en cualquier navegador,
echo  sin servidor, sin instalar nada y sin conexion a internet.
echo ============================================================
pause
exit /b 0

:fail
echo.
echo [ERROR] Algo fallo durante el proceso.
pause
exit /b 1
