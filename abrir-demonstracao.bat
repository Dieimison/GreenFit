@echo off
chcp 65001 >nul
title Green Fit - DEMONSTRACAO (porta 5705)
cd /d "%~dp0"

where php >nul 2>nul
if %errorlevel% neq 0 (
    if exist "C:\php\php.exe" ( set "PATH=C:\php;%PATH%" ) else ( echo Nao encontrei o PHP. Veja o LEIA-ME.txt. & pause & exit /b 1 )
)

set "GREENFIT_DB=%~dp0demo\demo.sqlite"
set "GREENFIT_LOG=%~dp0demo\erros.log"
set "GREENFIT_BACKUPS=%~dp0demo\backups"
if not exist "%~dp0demo" mkdir "%~dp0demo"

if not exist "%GREENFIT_DB%" (
    echo.
    echo  Montando o banco de demonstracao pela primeira vez - leva uns 2 minutos...
    echo  - cardapio, equipe, clientes, 60 dias de vendas e pedidos online -
    echo.
    set "GREENFIT_SENHA_INICIAL=Inicial-Demo-2026x"
    php dados\aplicar-estrutura.php "%GREENFIT_DB%" >nul || ( echo FALHOU ao criar o banco. & pause & exit /b 1 )
    php dados\dados-demonstracao.php criar "%GREENFIT_DB%" || ( echo FALHOU ao montar a demonstracao. & del "%GREENFIT_DB%" & pause & exit /b 1 )
)

echo.
echo  DEMONSTRACAO do Green Fit - banco de mentira (faixa "BANCO DE TESTE" ligada).
echo.
echo  Painel:      http://127.0.0.1:5705
echo               p / p                         (acesso rapido: admin, so na demonstracao)
echo               admin / Fit-Teste-2026x       (tudo)
echo               cozinha / Forno-Verde-2026x (producao, estoque, pedidos)
echo               balcao / Caixa-Verde-2026x   (PDV, pedidos)
echo  Loja online: http://127.0.0.1:5705/loja    (abra no celular: veja o LEIA-ME)
echo               cliente@demo.com / Compra-Demo-2026  (ou crie uma conta nova)
echo.
echo  Para recomecar do zero: feche esta janela, apague demo\demo.sqlite e abra de novo.
echo  Para encerrar, feche esta janela.
echo.
rem Para abrir no celular (mesmo Wi-Fi): set ENDERECO=0.0.0.0 antes de rodar este arquivo.
if "%ENDERECO%"=="" set ENDERECO=127.0.0.1
start "" "http://127.0.0.1:5705/Login/index.html"
php -S %ENDERECO%:5705 servidor.php
