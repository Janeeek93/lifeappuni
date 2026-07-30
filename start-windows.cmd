@echo off
rem ============================================================
rem  LifeOS - uruchomienie lokalnego serwera (Windows)
rem
rem  Po co: przegladarka blokuje pobieranie plikow CSV, gdy
rem  strona jest otwarta bezposrednio z dysku (file://). Ten
rem  skrypt startuje serwer i otwiera aplikacje pod adresem
rem  http://localhost:8787, gdzie wszystko dziala automatycznie.
rem
rem  Uzycie: kliknij dwukrotnie ten plik.
rem  Zatrzymanie: zamknij to okno albo nacisnij Ctrl+C.
rem ============================================================

setlocal
cd /d "%~dp0"

where node >nul 2>nul
if errorlevel 1 goto :no_node

if not exist "server.js" goto :no_server

echo.
echo   Uruchamiam LifeOS...
echo   Adres: http://localhost:8787/stats.html
echo.
echo   To okno musi pozostac otwarte. Zamkniecie go zatrzymuje serwer.
echo.

rem Przegladarke otwieramy z opoznieniem, zeby serwer zdazyl wstac.
start "" /min cmd /c "timeout /t 2 /nobreak >nul & start "" http://localhost:8787/stats.html"

node server.js
goto :end

:no_node
echo.
echo   Nie znaleziono Node.js.
echo.
echo   Aplikacja dziala takze bez niego - otworz stats.html jak dotad
echo   i skorzystaj z importu plikow CSV w sekcji "Zrodlo danych".
echo.
echo   Jesli wolisz wersje automatyczna, zainstaluj Node.js (wersja LTS)
echo   ze strony https://nodejs.org i uruchom ten plik ponownie.
echo.
pause
goto :end

:no_server
echo.
echo   Nie znaleziono pliku server.js w katalogu:
echo   %cd%
echo.
echo   Upewnij sie, ze ten skrypt lezy w tym samym folderze co reszta
echo   plikow aplikacji.
echo.
pause

:end
endlocal
