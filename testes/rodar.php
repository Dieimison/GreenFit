<?php
/**
 * testes/rodar.php - roda TODOS os testes do Green Fit (quem chama e o
 * testesodar.bat). Nunca toca no dados\index.sqlite:
 *
 *   1. cria um banco NOVO temporario pelo dados\aplicar-estrutura.php e
 *      confere que rodar de novo diz "Nada a fazer" (instalacao idempotente);
 *   2. sobe o servidor numa porta livre, apontando para esse banco;
 *   3. roda, em ordem: fluxos.test.php (o dia da loja pela API de verdade:
 *      lotes, producao, PDV, pedido online, cupom, cashback, perdas, nota
 *      de entrada, permissoes), integridade.php (no banco que a suite
 *      sujou), os testes do front (testes\front\rodar.js) e os roteiros de
 *      tela (testes\front\e2e\rodar.js - Playwright; ele sobe o proprio
 *      servidor e banco de demonstracao);
 *   4. derruba o servidor, apaga o temporario e da o resultado:
 *        TUDO VERDE                          codigo 0, todas as etapas rodaram;
 *        VERDE COM ETAPA PULADA (e2e)        codigo 0, mas a tela NAO foi testada;
 *        FALHOU                              codigo 1.
 *
 * Saida de cada etapa: testes\saida\ (ou GREENFIT_SAIDA_TESTES).
 * Playwright: E2E_PLAYWRIGHT (caminho do pacote) ou node_modules; sem ele, 77 = PULADO.
 */

declare(strict_types=1);

require __DIR__ . '/../api/nucleo.php';

const SAIDA_PULADO = 77;   // combinado com testes\front\e2e\rodar.js

$raiz  = dirname(__DIR__);
$tmp   = sys_get_temp_dir() . DIRECTORY_SEPARATOR . 'greenfit-rodar-' . getmypid();
$saida = getenv('GREENFIT_SAIDA_TESTES') ?: __DIR__ . DIRECTORY_SEPARATOR . 'saida';
@mkdir($tmp, 0777, true);
@mkdir($saida, 0777, true);
$banco = $tmp . DIRECTORY_SEPARATOR . 'banco.sqlite';
$senhaInicial = 'Inicial-Teste-2026';
$senhaAdmin   = 'Testador-Fit-2026';

$ambiente = getenv() + [];
$ambiente['GREENFIT_DB']       = $banco;
$ambiente['GREENFIT_BACKUPS']  = $tmp . DIRECTORY_SEPARATOR . 'backups';
$ambiente['GREENFIT_SENHA_INICIAL'] = $senhaInicial;
$ambiente['GREENFIT_LOG'] = $saida . DIRECTORY_SEPARATOR . 'erros.log';
$ambiente['SAIDA_TESTES'] = $saida;

/** Roda um comando, mostra e grava a saida; devolve o codigo. */
function etapa(string $nome, array $comando, array $ambiente, string $pasta, string $saida): int
{
    echo "\n========== {$nome}\n";
    $proc = proc_open($comando, [0 => ['pipe', 'r'], 1 => ['pipe', 'w'], 2 => ['redirect', 1]], $pipes, $pasta, $ambiente);
    if (!is_resource($proc)) {
        echo "FALHOU: nao consegui rodar " . implode(' ', $comando) . "\n";
        return 1;
    }
    fclose($pipes[0]);
    $log = fopen($saida . DIRECTORY_SEPARATOR . $nome . '.txt', 'w');
    while (($linha = fgets($pipes[1])) !== false) {
        echo $linha;
        fwrite($log, $linha);
    }
    fclose($pipes[1]);
    fclose($log);
    $rc = proc_close($proc);
    echo "---------- {$nome}: " . ($rc === 0 ? 'OK' : ($rc === SAIDA_PULADO ? 'PULADO' : "FALHOU (codigo {$rc})")) . "\n";
    return $rc;
}

/** Etapa cujo arquivo TEM de existir: faltando, e falha (nunca "0 testes"). */
function etapaObrigatoria(string $nome, string $arquivo, array $comando, array $ambiente, string $pasta, string $saida): int
{
    if (!is_file($pasta . DIRECTORY_SEPARATOR . $arquivo)) {
        echo "\n========== {$nome}\nFALHOU: nao achei {$arquivo} - sem ele esta etapa nao prova nada.\n";
        return 1;
    }
    return etapa($nome, $comando, $ambiente, $pasta, $saida);
}

$resultado = [];
$node = trim((string) shell_exec('node --version 2>&1'));
if (!preg_match('/^v\d+/', $node)) {
    echo "FALHOU: o Node.js nao foi encontrado (a suite de API e os testes do front precisam dele).\n";
    exit(1);
}

// 1. banco novo + usuario legado de senha fraca
$resultado['instalar banco novo'] = etapa('instalar', [PHP_BINARY, $raiz . '/dados/aplicar-estrutura.php', $banco], $ambiente, $raiz, $saida);
$resultado['instalar de novo (Nada a fazer)'] = etapa('reinstalar', [PHP_BINARY, $raiz . '/dados/aplicar-estrutura.php', $banco], $ambiente, $raiz, $saida);
$pdo = abrirSqlite($banco);
$pdo->prepare("INSERT INTO usuarios (usuario, nome, senha_hash, perfil, ativo, trocar_senha) VALUES ('legado', 'Legado', ?, 'atendimento', 1, 0)")
    ->execute([gerarHash('2024')]);
$pdo = null;

// 2. servidor numa porta livre
$sonda = stream_socket_server('tcp://127.0.0.1:0');
$porta = (int) substr(strrchr(stream_socket_get_name($sonda, false), ':'), 1);
fclose($sonda);
$servidor = proc_open([PHP_BINARY, '-S', "127.0.0.1:{$porta}", 'servidor.php'],
    [0 => ['pipe', 'r'], 1 => ['file', $saida . '/servidor.txt', 'w'], 2 => ['file', $saida . '/servidor.txt', 'a']],
    $pipesServidor, $raiz, $ambiente);
$noAr = false;
for ($i = 0; $i < 50 && !$noAr; $i++) {
    usleep(200000);
    $s = @fsockopen('127.0.0.1', $porta, $en, $es, 0.5);
    if ($s) {
        fclose($s);
        $noAr = true;
    }
}
echo "\nservidor de teste em http://127.0.0.1:{$porta} (" . ($noAr ? 'no ar' : 'NAO SUBIU') . ")\n";

// 3. as etapas
$php = PHP_BINARY;
if ($noAr) {
    $resultado['fluxos da loja pela API'] = etapa('fluxos', [$php, 'testes/fluxos.test.php'], $ambiente + [
        'BASE_URL' => "http://127.0.0.1:{$porta}", 'ADMIN_SENHA_INICIAL' => $senhaInicial, 'ADMIN_SENHA' => $senhaAdmin,
        'FRACO_USER' => 'legado', 'FRACO_SENHA' => '2024',   // o usuario de senha fraca gravado no passo 1
    ], $raiz, $saida);
    $resultado['integridade do banco da suite'] = etapa('integridade', [$php, 'testes/integridade.php', $banco], $ambiente, $raiz, $saida);
    $resultado['testes do front'] = etapaObrigatoria('front', 'testes/front/rodar.js', ['node', 'testes/front/rodar.js'], $ambiente, $raiz, $saida);
} else {
    $resultado['servidor de teste'] = 1;
}

// 4. derruba o servidor da suite (o e2e sobe o dele)
proc_terminate($servidor);
proc_close($servidor);

// 5. roteiros de tela: sobem servidor e banco proprios; 77 = sem Playwright
$semBancoHerdado = $ambiente;
unset($semBancoHerdado['GREENFIT_DB']);
$resultado['roteiros de tela (e2e, Playwright)'] = etapaObrigatoria('e2e', 'testes/front/e2e/rodar.js',
    ['node', 'testes/front/e2e/rodar.js'],
    $semBancoHerdado + ['E2E_PHP' => PHP_BINARY, 'E2E_PRINTS' => $saida . DIRECTORY_SEPARATOR . 'e2e-prints'], $raiz, $saida);

$it = new RecursiveIteratorIterator(new RecursiveDirectoryIterator($tmp, FilesystemIterator::SKIP_DOTS), RecursiveIteratorIterator::CHILD_FIRST);
foreach ($it as $f) {
    $f->isDir() ? @rmdir($f->getPathname()) : @unlink($f->getPathname());
}
@rmdir($tmp);

echo "\n================ RESUMO\n";
$falhas = 0;
$pulados = [];
foreach ($resultado as $nome => $rc) {
    // so o e2e pode ser pulado (77 combinado com o front); 77 em outra etapa e falha
    $pulou = $rc === SAIDA_PULADO && $nome === 'roteiros de tela (e2e, Playwright)';
    printf("  %-44s %s\n", $nome, $rc === 0 ? 'OK' : ($pulou ? 'PULADO' : 'FALHOU'));
    if ($pulou) {
        $pulados[] = 'e2e';
    } elseif ($rc !== 0) {
        $falhas++;
    }
}
echo "\nsaida de cada etapa: {$saida}\n";
if ($falhas) {
    echo "\nFALHOU: {$falhas} etapa(s).\n";
    exit(1);
}
if ($pulados) {
    echo "\nVERDE COM ETAPA PULADA (" . implode(', ', $pulados) . ").\n"
       . "A tela NAO foi testada: instale o Playwright (ou defina E2E_PLAYWRIGHT) para o TUDO VERDE.\n";
    exit(0);
}
echo "\nTUDO VERDE.\n";
exit(0);
