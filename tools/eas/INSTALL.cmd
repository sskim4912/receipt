@echo off
setlocal
where py >nul 2>nul
if errorlevel 1 goto use_python
py -3 "%~dp0install_windows.py"
goto finished
:use_python
where python >nul 2>nul
if errorlevel 1 goto missing_python
python "%~dp0install_windows.py"
goto finished
:missing_python
echo Python launcher not found. Run install_windows.py with your existing PyCharm Python.
:finished
pause
exit /b
