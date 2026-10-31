@echo off
setlocal
set setup_result=1
where py >nul 2>nul
if errorlevel 1 goto use_python
py -3 "%~dp0install_windows.py"
set setup_result=%errorlevel%
goto finished
:use_python
where python >nul 2>nul
if errorlevel 1 goto missing_python
python "%~dp0install_windows.py"
set setup_result=%errorlevel%
goto finished
:missing_python
echo Python launcher not found. Run install_windows.py with your existing PyCharm Python.
:finished
pause
exit /b %setup_result%
