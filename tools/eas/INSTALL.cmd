@echo off
chcp 65001 >nul
where py >nul 2>nul
if not errorlevel 1 (
  py -3 "%~dp0install_windows.py"
) else (
  where python >nul 2>nul
  if errorlevel 1 (
    echo Python을 찾지 못했습니다. 기존 PyCharm 프로젝트의 Python으로 install_windows.py를 실행하세요.
  ) else (
    python "%~dp0install_windows.py"
  )
)
pause
