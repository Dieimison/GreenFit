<?php
/**
 * api/rotas/loja.php - a loja online do Green Fit: o app do cliente e o
 * lado do painel (o quadro de pedidos).
 *
 * CLIENTE (telas em Loja\; sessao PROPRIA, cookie GREENFITLOJA so em
 * /api/loja - a conta do cliente nunca abre o painel):
 *   GET  /api/loja/vitrine                cardapio, categorias, horarios, bairros, regras de entrega e pagamento
 *   GET  /api/loja/pratos/{id}            um prato publicado (com os adicionais)
 *   GET  /api/loja/fotos/{id}             a foto (so de prato publicado)
 *   POST /api/loja/conta                  criar conta {nome, email, telefone, senha, cpf?, objetivo?, meta_kcal?}
 *   PUT  /api/loja/conta                  meu perfil {nome, telefone, objetivo, meta_kcal, restricoes, aceita_novidades}
 *   POST /api/loja/entrar {email, senha}  POST /api/loja/sair   GET /api/loja/sessao
 *   GET|POST /api/loja/enderecos          DELETE /api/loja/enderecos/{id}
 *   GET  /api/loja/favoritos              POST /api/loja/favoritos {prato_id}  DELETE /api/loja/favoritos/{prato_id}
 *   POST /api/loja/carrinho               o carrinho calculado pelo servidor (precos, taxa, cupom, cashback)
 *   GET  /api/loja/cashback               saldo e extrato
 *   GET|POST /api/loja/encomendas         GET /api/loja/encomendas/{id} (o pedido e o acompanhamento)
 *   POST /api/loja/encomendas/{id}/cancelar   (so antes de a loja confirmar)
 *   POST /api/loja/encomendas/{id}/avaliar    {nota 1-5, comentario} (depois de entregue, uma vez)
 *
 * PAINEL (sessao do painel; a equipe opera se a chave loja.cozinha_ve_pedidos deixar):
 *   GET  /api/encomendas[?status=|?quadro=1]   GET /api/encomendas/{id}
 *   POST /api/encomendas/{id}/confirmar   Pix conferido ou pedido aceito: nasce a VENDA
 *   POST /api/encomendas/{id}/avancar     {para}: em preparo -> pronto -> saiu -> entregue
 *   POST /api/encomendas/{id}/cancelar    {motivo}; ja vendido: a venda cai junto (estorno so admin)
 *   GET|PUT /api/loja-ajustes (admin)     GET|PUT /api/horarios (admin)
 *
 * O pedido so RESERVA as porcoes ate a loja confirmar (reservadoDoPrato).
 * O PDV respeita a reserva. No "confirmado", a venda e gravada pela MESMA
 * gravarVenda do PDV: os lotes que vencem primeiro saem, e nasce a conta a
 * receber (ja paga no Pix; pendente no pagamento na entrega, baixada
 * sozinha quando o pedido e entregue).
 */

declare(strict_types=1);

const SESSAO_LOJA_NOME = 'GREENFITLOJA';
const MOTIVO_PRAZO_VENCIDO = 'O prazo para pagar o Pix passou e o pedido foi cancelado. Nada foi cobrado.';
const CASHBACK_MAXIMO_DO_PEDIDO = 0.5;   // o cashback paga no maximo metade dos pratos

// ------------------------------------------------------------------
// Sessao do cliente
// ------------------------------------------------------------------
function iniciarSessaoLoja(): void
{
    if (session_status() === PHP_SESSION_ACTIVE) {
        return;
    }
    ini_set('session.gc_maxlifetime', (string) (30 * 86400));
    ini_set('session.use_strict_mode', '1');
    session_name(SESSAO_LOJA_NOME);
    session_set_cookie_params([
        'lifetime' => 30 * 86400,   // o cliente do app nao quer entrar toda vez
        'path'     => '/api/loja',
        'httponly' => true,
        'samesite' => 'Strict',
        'secure'   => requisicaoHttps(),
    ]);
    session_start();
}

function encerrarSessaoLoja(): void
{
    iniciarSessaoLoja();
    $_SESSION = [];
    $p = session_get_cookie_params();
    setcookie(session_name(), '', ['expires' => time() - 3600, 'path' => $p['path'],
        'secure' => $p['secure'], 'httponly' => $p['httponly'], 'samesite' => $p['samesite']]);
    session_destroy();
}

/** A conta logada no app, ou null. */
function contaDaSessao(): ?array
{
    iniciarSessaoLoja();
    $id = $_SESSION['loja_conta_id'] ?? null;
    if (!$id) {
        return null;
    }
    return consultarUm('SELECT * FROM loja_contas WHERE id = ? AND ativo = 1', [$id]);
}

function abrirSessaoLoja(int $contaId): void
{
    iniciarSessaoLoja();
    session_regenerate_id(true);
    $_SESSION['loja_conta_id'] = $contaId;
    $_SESSION['loja_login_em'] = time();
}

function saldoCashback(int $contaId): float
{
    return round((float) consultarUm("SELECT COALESCE(SUM(CASE WHEN tipo = 'uso' THEN -valor ELSE valor END), 0) AS s
                                        FROM cashback WHERE conta_id = ?", [$contaId])['s'], 2);
}

/** O que a tela da loja pode saber da conta (nada de hash, nada de cliente_id). */
function contaParaTela(array $c): array
{
    return ['id' => (int) $c['id'], 'nome' => $c['nome'], 'email' => $c['email'], 'telefone' => $c['telefone'],
            'cpf' => $c['cpf'], 'objetivo' => $c['objetivo'], 'meta_kcal' => $c['meta_kcal'] === null ? null : (int) $c['meta_kcal'],
            'restricoes' => $c['restricoes'], 'aceita_novidades' => (int) $c['aceita_novidades'] === 1,
            'cashback' => saldoCashback((int) $c['id']),
            'favoritos' => array_map('intval', array_column(consultar('SELECT prato_id FROM favoritos WHERE conta_id = ?', [$c['id']]), 'prato_id')),
            'pedidos' => (int) consultarUm("SELECT COUNT(*) AS q FROM encomendas WHERE conta_id = ? AND status <> 'cancelada'", [$c['id']])['q']];
}

// ------------------------------------------------------------------
// Conferencia dos campos do cliente
// ------------------------------------------------------------------
function emailDoCorpo(array $corpo): string
{
    $email = mb_strtolower((string) obrigatorio($corpo, 'email', 'E-mail'));
    if (mb_strlen($email) > 120 || filter_var($email, FILTER_VALIDATE_EMAIL) === false) {
        throw new ErroApi(400, 'Confira o e-mail: ele precisa ser do jeito nome@provedor.com.');
    }
    return $email;
}

/** Telefone com DDD: 10 ou 11 numeros (o resto e tirado). */
function telefoneDoCorpo(array $corpo, string $campo, bool $exigido): ?string
{
    $bruto = txt($corpo, $campo, 'Telefone');
    if ($bruto === null) {
        if ($exigido) {
            throw new ErroApi(400, 'Informe um celular com DDD: é por ele que a loja fala com você sobre o pedido.');
        }
        return null;
    }
    $numeros = (string) preg_replace('/\D/', '', $bruto);
    if (strlen($numeros) < 10 || strlen($numeros) > 11) {
        throw new ErroApi(400, 'O telefone precisa ter o DDD e o número (10 ou 11 dígitos), como (48) 99999-0000.');
    }
    return $numeros;
}

function cpfDoCorpo(array $corpo): ?string
{
    $bruto = txt($corpo, 'cpf', 'CPF');
    if ($bruto === null) {
        return null;
    }
    $cpf = (string) preg_replace('/\D/', '', $bruto);
    if (!cpfValido($cpf)) {
        throw new ErroApi(400, 'Este CPF não confere. Confira os números (ou deixe o campo vazio).');
    }
    return $cpf;
}

function cpfValido(string $cpf): bool
{
    if (!preg_match('/^\d{11}$/', $cpf) || preg_match('/^(\d)\1{10}$/', $cpf)) {
        return false;
    }
    for ($t = 9; $t < 11; $t++) {
        $soma = 0;
        for ($i = 0; $i < $t; $i++) {
            $soma += (int) $cpf[$i] * ($t + 1 - $i);
        }
        if ((int) $cpf[$t] !== ((10 * $soma) % 11) % 10) {
            return false;
        }
    }
    return true;
}

/** Texto com teto de tamanho (o que passa e recusado, nunca cortado em silencio). */
function textoCurto(array $corpo, string $campo, string $rotulo, int $maximo, bool $exigido = false): ?string
{
    $valor = $exigido ? obrigatorio($corpo, $campo, $rotulo) : txt($corpo, $campo, $rotulo);
    if ($valor !== null && mb_strlen($valor) > $maximo) {
        throw new ErroApi(400, "O campo \"{$rotulo}\" passou de {$maximo} caracteres.");
    }
    return $valor;
}

/** Perfil de saude da conta: objetivo, meta de kcal, restricoes. */
function perfilDoCorpo(array $corpo, ?array $atual): array
{
    $objetivo = array_key_exists('objetivo', $corpo) ? txt($corpo, 'objetivo') : ($atual['objetivo'] ?? null);
    if ($objetivo !== null && !in_array($objetivo, valoresDe('objetivos'), true)) {
        throw new ErroApi(400, 'Objetivo inválido.');
    }
    $meta = array_key_exists('meta_kcal', $corpo) ? inteiro($corpo, 'meta_kcal', 'Meta de calorias por dia', 800, 6000, null)
          : ($atual['meta_kcal'] ?? null);
    return [
        'objetivo' => $objetivo, 'meta_kcal' => $meta,
        'restricoes' => array_key_exists('restricoes', $corpo) ? textoCurto($corpo, 'restricoes', 'Restrições', 200) : ($atual['restricoes'] ?? null),
        'aceita_novidades' => array_key_exists('aceita_novidades', $corpo) ? (int) (bool) $corpo['aceita_novidades'] : (int) ($atual['aceita_novidades'] ?? 0),
    ];
}

/** Endereco de entrega conferido: o bairro TEM de ser um dos atendidos. */
function enderecoDoCorpo(array $e): array
{
    $bairroId = idDoCatalogo($e, 'bairro_id', null);
    $bairro = $bairroId ? consultarUm('SELECT * FROM loja_bairros WHERE id = ? AND ativo = 1', [$bairroId]) : null;
    if (!$bairro) {
        throw new ErroApi(400, 'Escolha o seu bairro na lista. Se ele não está lá, ainda não entregamos aí: você pode retirar na loja.');
    }
    $cep = (string) preg_replace('/\D/', '', (string) (txt($e, 'cep', 'CEP') ?? ''));
    if ($cep !== '' && strlen($cep) !== 8) {
        throw new ErroApi(400, 'O CEP precisa ter 8 números (ou deixe em branco).');
    }
    return [
        'apelido'      => textoCurto($e, 'apelido', 'Apelido (Casa, Trabalho)', 30),
        'destinatario' => textoCurto($e, 'destinatario', 'Quem recebe', 100, true),
        'cep'          => $cep === '' ? null : $cep,
        'logradouro'   => textoCurto($e, 'logradouro', 'Rua', 120, true),
        'numero'       => textoCurto($e, 'numero', 'Número', 10, true),
        'complemento'  => textoCurto($e, 'complemento', 'Complemento', 60),
        'referencia'   => textoCurto($e, 'referencia', 'Ponto de referência', 100),
        'bairro_id'    => (int) $bairro['id'],
        'bairro'       => $bairro['nome'],
        'cidade'       => $bairro['cidade'],
        'uf'           => 'SC',
    ];
}

function cepFormatado(?string $cep): string
{
    return $cep !== null && strlen($cep) === 8 ? substr($cep, 0, 5) . '-' . substr($cep, 5) : (string) $cep;
}

// ------------------------------------------------------------------
// Ajustes, horario, reserva
// ------------------------------------------------------------------
function ajustesLoja(): array
{
    $a = consultarUm('SELECT * FROM loja_ajustes WHERE id = 1');
    if (!$a) {
        executarSql('INSERT OR IGNORE INTO loja_ajustes (id) VALUES (1)');
        $a = consultarUm('SELECT * FROM loja_ajustes WHERE id = 1');
    }
    return $a;
}

function nomeDaVitrine(array $a): string
{
    return $a['nome_vitrine'] ?: (empresaAtual()['nome'] ?? null) ?: 'Green Fit';
}

function horarios(): array
{
    $saida = [];
    foreach (consultar('SELECT * FROM loja_horarios ORDER BY dia') as $h) {
        $saida[(int) $h['dia']] = ['dia' => (int) $h['dia'], 'nome' => rotuloDe('dias_semana', (string) $h['dia']),
                                   'aberto' => (int) $h['aberto'] === 1, 'abre' => $h['abre'], 'fecha' => $h['fecha']];
    }
    return $saida;
}

/** O momento esta dentro do horario de funcionamento daquele dia? */
function dentroDoHorario(int $momento): bool
{
    $h = horarios()[(int) date('w', $momento)] ?? null;
    if (!$h || !$h['aberto']) {
        return false;
    }
    $hm = date('H:i', $momento);
    return $hm >= $h['abre'] && $hm < $h['fecha'];
}

/*
 * Aberta agora = a loja esta ligada (Ajustes) E dentro do horario. O texto
 * e o que o app mostra no topo ("Aberto · fecha às 21:00").
 */
function funcionamento(array $a): array
{
    if ((int) $a['aberta'] !== 1) {
        return ['aberta_agora' => false, 'texto' => 'Loja fechada no momento', 'aceita_pedidos' => false];
    }
    $agora = time();
    $hs = horarios();
    $hoje = $hs[(int) date('w', $agora)] ?? null;
    if (dentroDoHorario($agora)) {
        return ['aberta_agora' => true, 'texto' => 'Aberto · fecha às ' . $hoje['fecha'], 'aceita_pedidos' => true];
    }
    // Proxima abertura: hoje mais tarde, ou um dos proximos 7 dias.
    for ($d = 0; $d < 8; $d++) {
        $dia = strtotime("+{$d} days", $agora);
        $h = $hs[(int) date('w', $dia)] ?? null;
        if (!$h || !$h['aberto'] || ($d === 0 && date('H:i', $agora) >= $h['abre'])) {
            continue;
        }
        $quando = $d === 0 ? 'hoje' : ($d === 1 ? 'amanhã' : mb_strtolower($h['nome']));
        $aceita = (int) $a['aceita_agendamento'] === 1;
        return ['aberta_agora' => false, 'texto' => 'Fechado · abre ' . $quando . ' às ' . $h['abre'] . ($aceita ? ' (dá para agendar)' : ''),
                'aceita_pedidos' => $aceita];
    }
    return ['aberta_agora' => false, 'texto' => 'Fechado', 'aceita_pedidos' => false];
}

/*
 * Pedido Pix que passou do prazo e cancelado aqui, na hora em que alguem
 * olha (app, quadro, pedido novo): a reserva cai sozinha, sem tarefa agendada.
 */
function expirarEncomendas(): void
{
    $vencidas = consultar("SELECT id FROM encomendas WHERE status = 'aguardando_pagamento' AND pagar_ate < ?", [agora()]);
    foreach ($vencidas as $v) {
        emTransacao(function () use ($v) {
            $mudou = executarSql("UPDATE encomendas SET status = 'cancelada', motivo_cancelamento = ?, atualizado_em = ?
                                   WHERE id = ? AND status = 'aguardando_pagamento'", [MOTIVO_PRAZO_VENCIDO, agora(), $v['id']]);
            if ($mudou) {
                devolverCashbackUsado((int) $v['id']);
                registrarEvento((int) $v['id'], 'cancelada', MOTIVO_PRAZO_VENCIDO, null);
            }
        });
    }
}

function registrarEvento(int $encomendaId, string $status, ?string $observacao, ?int $usuarioId): void
{
    executarSql('INSERT INTO encomenda_eventos (encomenda_id, status, momento, observacao, usuario_id) VALUES (?, ?, ?, ?, ?)',
                [$encomendaId, $status, agora(), $observacao, $usuarioId]);
}

/** O cashback usado num pedido cancelado volta para a conta. */
function devolverCashbackUsado(int $encomendaId): void
{
    $e = consultarUm('SELECT conta_id, numero, cashback_usado FROM encomendas WHERE id = ?', [$encomendaId]);
    if ($e && (float) $e['cashback_usado'] > 0
        && !consultarUm("SELECT 1 FROM cashback WHERE encomenda_id = ? AND tipo = 'estorno'", [$encomendaId])) {
        executarSql("INSERT INTO cashback (conta_id, encomenda_id, tipo, valor, descricao) VALUES (?, ?, 'estorno', ?, ?)",
                    [$e['conta_id'], $encomendaId, (float) $e['cashback_usado'], 'Pedido ' . $e['numero'] . ' cancelado']);
    }
}

// ------------------------------------------------------------------
// Cardapio para o cliente
// ------------------------------------------------------------------
/** Os grupos de adicionais de um prato, com as opcoes ativas. */
function gruposDoPrato(int $pratoId): array
{
    return array_map(function ($g) {
        $opcoes = array_map(fn ($a) => ['id' => (int) $a['id'], 'nome' => $a['nome'], 'preco' => (float) $a['preco'],
                                        'kcal' => (int) $a['kcal'], 'proteinas' => (float) $a['proteinas']],
            consultar('SELECT * FROM adicionais WHERE grupo_id = ? AND ativo = 1 ORDER BY ordem, id', [$g['id']]));
        return ['id' => (int) $g['id'], 'nome' => $g['nome'], 'descricao' => $g['descricao'],
                'minimo' => (int) $g['minimo'], 'maximo' => (int) $g['maximo'], 'opcoes' => $opcoes];
    }, consultar('SELECT g.* FROM prato_grupos pg JOIN grupos_adicionais g ON g.id = pg.grupo_id
                   WHERE pg.prato_id = ? AND g.ativo = 1 ORDER BY pg.ordem, g.nome', [$pratoId]));
}

/** O que o cliente ve de um prato: sem custo, sem lote. */
function pratoParaVitrine(array $p, bool $comGrupos = false): array
{
    $t = pratoParaTela($p, false);
    $saida = ['id' => $t['id'], 'nome' => $t['nome'], 'categoria_id' => $t['categoria_id'], 'categoria' => $t['categoria'],
              'descricao' => $t['descricao'], 'porcao_g' => $t['porcao_g'], 'kcal' => $t['kcal'], 'proteinas' => $t['proteinas'],
              'carboidratos' => $t['carboidratos'], 'gorduras' => $t['gorduras'], 'fibras' => $t['fibras'], 'sodio_mg' => $t['sodio_mg'],
              'ingredientes' => $t['ingredientes'], 'alergenicos' => $t['alergenicos'], 'tags' => $t['tags'],
              'conservacao' => $t['conservacao'], 'validade_dias' => $t['validade_dias'], 'modo_preparo' => $t['modo_preparo'],
              'preco' => $t['preco'], 'preco_promocional' => $t['preco_promocional'], 'preco_atual' => $t['preco_atual'],
              'destaque' => $t['destaque'] === 1, 'feito_na_hora' => $t['feito_na_hora'] === 1,
              'disponivel' => $t['vendavel'], 'nota' => $t['nota'], 'avaliacoes' => $t['avaliacoes'], 'fotos' => $t['fotos'],
              'mais_vendido' => $t['vendidos_30d'] >= 10,
              'tem_adicionais' => (bool) consultarUm('SELECT 1 FROM prato_grupos pg JOIN grupos_adicionais g ON g.id = pg.grupo_id
                                                       WHERE pg.prato_id = ? AND g.ativo = 1 LIMIT 1', [$t['id']])];
    if ($comGrupos) {
        $saida['grupos'] = gruposDoPrato((int) $t['id']);
    }
    return $saida;
}

function vitrine(): array
{
    expirarEncomendas();
    $a = ajustesLoja();
    $pratos = array_map(fn ($p) => pratoParaVitrine($p, true),
        consultar(SQL_PRATOS . ' WHERE p.publicado = 1 AND p.ativo = 1 AND p.preco > 0 ORDER BY c.ordem, p.ordem, p.nome'));
    $usadas = array_unique(array_filter(array_column($pratos, 'categoria_id')));
    $categorias = array_values(array_filter(array_map(fn ($c) => ['id' => (int) $c['id'], 'nome' => $c['nome'], 'descricao' => $c['descricao']],
        consultar('SELECT * FROM categorias WHERE ativo = 1 ORDER BY ordem, nome')), fn ($c) => in_array($c['id'], $usadas, true)));
    $nota = consultarUm('SELECT ROUND(AVG(avaliacao_nota), 1) AS n, COUNT(avaliacao_nota) AS q FROM encomendas WHERE avaliacao_nota IS NOT NULL');
    return ['loja' => [
        'nome' => nomeDaVitrine($a), 'slogan' => $a['slogan'], 'aviso' => $a['mensagem_aviso'],
        'pedido_minimo' => (float) $a['pedido_minimo'], 'frete_gratis_acima' => (float) $a['frete_gratis_acima'],
        'tempo_preparo_min' => (int) $a['tempo_preparo_min'],
        'aceita_entrega' => (int) $a['aceita_entrega'] === 1, 'aceita_retirada' => (int) $a['aceita_retirada'] === 1,
        'endereco_retirada' => $a['endereco_retirada'],
        'aceita_pix' => (int) $a['aceita_pix'] === 1 && (string) $a['chave_pix'] !== '',
        'aceita_pagamento_entrega' => (int) $a['aceita_pagamento_entrega'] === 1,
        'prazo_pagamento_min' => (int) $a['prazo_pagamento_min'],
        'whatsapp' => $a['whatsapp'], 'instagram' => $a['instagram'],
        'cashback_percentual' => (int) $a['cashback_percentual'], 'aceita_agendamento' => (int) $a['aceita_agendamento'] === 1,
        'agenda_dias' => LOJA_AGENDA_DIAS,
        'nota' => $nota['n'] === null ? null : (float) $nota['n'], 'avaliacoes' => (int) $nota['q'],
    ] + funcionamento($a),
        'horarios' => array_values(horarios()),
        'bairros' => array_map(fn ($b) => ['id' => (int) $b['id'], 'nome' => $b['nome'], 'cidade' => $b['cidade'],
                                           'taxa' => (float) $b['taxa'], 'tempo_min' => (int) $b['tempo_min']],
                               consultar('SELECT * FROM loja_bairros WHERE ativo = 1 ORDER BY nome')),
        'categorias' => $categorias, 'pratos' => $pratos,
        'dominios' => ['tags_prato' => dominioParaTela('tags_prato'), 'objetivos' => dominioParaTela('objetivos'),
                       'pagamentos_loja' => dominioParaTela('pagamentos_loja'), 'conservacoes' => dominioParaTela('conservacoes'),
                       'status_encomenda' => dominioParaTela('status_encomenda')],
    ];
}

// ------------------------------------------------------------------
// Roteador do cliente: /api/loja/...
// ------------------------------------------------------------------
function tratarLoja(array $partes, string $metodo, array $corpo): void
{
    $recurso = strtolower($partes[0] ?? '');
    $id = null;
    if (isset($partes[1])) {
        if (!ctype_digit($partes[1]) || (int) $partes[1] < 1) {
            throw new ErroApi(404, 'Registro não encontrado.');
        }
        $id = (int) $partes[1];
    }
    $acao = isset($partes[2]) ? strtolower($partes[2]) : null;
    if (count($partes) > 3 || ($acao !== null && !($recurso === 'encomendas' && in_array($acao, ['cancelar', 'avaliar'], true)))) {
        throw new ErroApi(404, 'Rota não encontrada.');
    }

    // O que qualquer visitante ve.
    if ($recurso === 'vitrine' && $metodo === 'GET' && $id === null) {
        responder(200, ['ok' => true] + vitrine());
        return;
    }
    if ($recurso === 'pratos' && $metodo === 'GET' && $id !== null) {
        $p = consultarUm(SQL_PRATOS . ' WHERE p.id = ? AND p.publicado = 1 AND p.ativo = 1', [$id]);
        if (!$p) {
            throw new ErroApi(404, 'Este prato não está mais no cardápio.');
        }
        responder(200, ['ok' => true, 'prato' => pratoParaVitrine($p, true)]);
        return;
    }
    if ($recurso === 'fotos' && $metodo === 'GET' && $id !== null) {
        fotoDoPrato($id, true);
        return;
    }
    if ($recurso === 'conta' && $metodo === 'POST' && $id === null) {
        [$codigo, $resposta] = criarContaLoja($corpo);
        responder($codigo, $resposta);
        return;
    }
    if ($recurso === 'entrar' && $metodo === 'POST' && $id === null) {
        entrarNaLoja($corpo);
        return;
    }
    if ($recurso === 'sair' && $metodo === 'POST' && $id === null) {
        encerrarSessaoLoja();
        responder(200, ['ok' => true]);
        return;
    }

    $conta = contaDaSessao();
    if ($recurso === 'sessao' && $metodo === 'GET' && $id === null) {
        responder($conta ? 200 : 401, $conta ? ['ok' => true, 'conta' => contaParaTela($conta)]
                                             : ['ok' => false, 'erro' => 'Entre na sua conta.']);
        return;
    }
    if (!$conta) {
        responder(401, ['ok' => false, 'erro' => 'Entre na sua conta para continuar.']);
        return;
    }

    switch ($recurso) {
        case 'conta':
            exigir($metodo === 'PUT' && $id === null);
            [$codigo, $resposta] = atualizarContaLoja($conta, $corpo);
            break;
        case 'enderecos':
            [$codigo, $resposta] = enderecosDaConta($conta, $id, $metodo, $corpo);
            break;
        case 'favoritos':
            [$codigo, $resposta] = favoritosDaConta($conta, $id, $metodo, $corpo);
            break;
        case 'carrinho':
            exigir($metodo === 'POST' && $id === null);
            $calc = calcularPedido($conta, $corpo, false);
            [$codigo, $resposta] = [200, ['ok' => true, 'carrinho' => carrinhoParaTela($calc)]];
            break;
        case 'cashback':
            exigir($metodo === 'GET' && $id === null);
            [$codigo, $resposta] = [200, ['ok' => true, 'saldo' => saldoCashback((int) $conta['id']),
                'extrato' => array_map(fn ($c) => ['tipo' => $c['tipo'], 'rotulo' => rotuloDe('tipos_cashback', $c['tipo']),
                                                   'valor' => (float) $c['valor'], 'descricao' => $c['descricao'], 'criado_em' => $c['criado_em']],
                    consultar('SELECT * FROM cashback WHERE conta_id = ? ORDER BY id DESC LIMIT 50', [$conta['id']]))]];
            break;
        case 'encomendas':
            [$codigo, $resposta] = encomendasDoCliente($conta, $id, $acao, $metodo, $corpo);
            break;
        default:
            throw new ErroApi(404, 'Rota não encontrada: /api/loja/' . $recurso);
    }
    responder($codigo, $resposta);
}

// ------------------------------------------------------------------
// Conta: criar, entrar, perfil
// ------------------------------------------------------------------
function criarContaLoja(array $corpo): array
{
    $nome = textoCurto($corpo, 'nome', 'Nome', 100, true);
    $email = emailDoCorpo($corpo);
    $telefone = telefoneDoCorpo($corpo, 'telefone', true);
    $cpf = cpfDoCorpo($corpo);
    $senha = is_string($corpo['senha'] ?? null) ? $corpo['senha'] : '';
    $fraca = senhaFraca($senha, (string) strstr($email, '@', true));
    if ($fraca !== null) {
        throw new ErroApi(400, str_replace('o login', 'o seu e-mail', $fraca));
    }
    if (consultarUm('SELECT id FROM loja_contas WHERE email = ?', [$email])) {
        throw new ErroApi(400, 'Já existe uma conta com este e-mail. Use "Entrar" (ou outro e-mail).');
    }
    $perfil = perfilDoCorpo($corpo, null);
    executarSql('INSERT INTO loja_contas (email, nome, telefone, cpf, senha_hash, objetivo, meta_kcal, restricoes, aceita_novidades, ultimo_acesso)
                 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
                [$email, $nome, $telefone, $cpf, gerarHash($senha), $perfil['objetivo'], $perfil['meta_kcal'], $perfil['restricoes'],
                 $perfil['aceita_novidades'], agora()]);
    $id = (int) banco()->lastInsertId();
    abrirSessaoLoja($id);
    return [201, ['ok' => true, 'mensagem' => 'Conta criada. Bem-vindo(a) à ' . nomeDaVitrine(ajustesLoja()) . '!',
                  'conta' => contaParaTela(consultarUm('SELECT * FROM loja_contas WHERE id = ?', [$id]))]];
}

function atualizarContaLoja(array $conta, array $corpo): array
{
    $nome = array_key_exists('nome', $corpo) ? textoCurto($corpo, 'nome', 'Nome', 100, true) : $conta['nome'];
    $telefone = array_key_exists('telefone', $corpo) ? telefoneDoCorpo($corpo, 'telefone', true) : $conta['telefone'];
    $perfil = perfilDoCorpo($corpo, $conta);
    executarSql('UPDATE loja_contas SET nome = ?, telefone = ?, objetivo = ?, meta_kcal = ?, restricoes = ?, aceita_novidades = ? WHERE id = ?',
                [$nome, $telefone, $perfil['objetivo'], $perfil['meta_kcal'], $perfil['restricoes'], $perfil['aceita_novidades'], $conta['id']]);
    return [200, ['ok' => true, 'mensagem' => 'Perfil atualizado.',
                  'conta' => contaParaTela(consultarUm('SELECT * FROM loja_contas WHERE id = ?', [$conta['id']]))]];
}

/* O mesmo limite do login do painel, na mesma tabela, com o prefixo "loja:". */
function entrarNaLoja(array $corpo): void
{
    $email = mb_strtolower((string) (txt($corpo, 'email') ?? ''));
    $senha = is_string($corpo['senha'] ?? null) ? $corpo['senha'] : '';
    if ($email === '' || $senha === '') {
        responder(400, ['ok' => false, 'erro' => 'Informe e-mail e senha.']);
        return;
    }
    $chave = 'loja:' . $email;
    $ip = ipDoCliente();
    $espera = minutosDeBloqueio($chave, $ip);
    if ($espera > 0) {
        responder(429, ['ok' => false, 'erro' => "Muitas tentativas. Tente de novo em {$espera} minutos."]);
        return;
    }
    $linha = consultarUm('SELECT * FROM loja_contas WHERE email = ? AND ativo = 1', [$email]);
    $certa = conferirSenha($senha, $linha['senha_hash'] ?? HASH_FALSO) && $linha !== null;
    if (!$certa) {
        registrarTentativaErrada($chave, $ip);
        $espera = minutosDeBloqueio($chave, $ip);
        if ($espera > 0) {
            responder(429, ['ok' => false, 'erro' => "Muitas tentativas. Tente de novo em {$espera} minutos."]);
            return;
        }
        $restam = tentativasRestantes($chave);
        responder(401, ['ok' => false, 'erro' => $restam === null ? 'E-mail ou senha incorretos.'
            : "E-mail ou senha incorretos. Restam {$restam} tentativa(s) antes de bloquear por " . LOGIN_BLOQUEIO_MIN . ' minutos.']);
        return;
    }
    limparTentativas($chave);
    executarSql('UPDATE loja_contas SET ultimo_acesso = ? WHERE id = ?', [agora(), $linha['id']]);
    abrirSessaoLoja((int) $linha['id']);
    responder(200, ['ok' => true, 'conta' => contaParaTela($linha)]);
}

// ------------------------------------------------------------------
// Enderecos e favoritos
// ------------------------------------------------------------------
function enderecosDaConta(array $conta, ?int $id, string $metodo, array $corpo): array
{
    if ($metodo === 'GET' && $id === null) {
        return [200, ['ok' => true, 'itens' => array_map(function ($e) {
            $b = $e['bairro_id'] ? consultarUm('SELECT ativo, taxa, tempo_min FROM loja_bairros WHERE id = ?', [$e['bairro_id']]) : null;
            $e['atendido'] = $b && (int) $b['ativo'] === 1;
            $e['taxa'] = $b ? (float) $b['taxa'] : null;
            $e['bairro_id'] = $e['bairro_id'] === null ? null : (int) $e['bairro_id'];
            return $e;
        }, consultar('SELECT * FROM loja_enderecos WHERE conta_id = ? ORDER BY id DESC', [$conta['id']]))]];
    }
    if ($metodo === 'POST' && $id === null) {
        $novo = salvarEndereco((int) $conta['id'], enderecoDoCorpo($corpo));
        return [201, ['ok' => true, 'id' => $novo, 'mensagem' => 'Endereço guardado.']];
    }
    if ($metodo === 'DELETE' && $id !== null) {
        if (!executarSql('DELETE FROM loja_enderecos WHERE id = ? AND conta_id = ?', [$id, $conta['id']])) {
            throw new ErroApi(404, 'Endereço não encontrado.');
        }
        return [200, ['ok' => true, 'mensagem' => 'Endereço apagado.']];
    }
    throw new ErroApi(405, 'Método não permitido para esta rota.');
}

/** Guarda o endereco (o mesmo de novo nao repete: devolve o que ja existe). */
function salvarEndereco(int $contaId, array $e): int
{
    $igual = consultarUm('SELECT id FROM loja_enderecos WHERE conta_id = ? AND bairro_id = ? AND minusculas(logradouro) = minusculas(?)
                            AND minusculas(numero) = minusculas(?) AND COALESCE(minusculas(complemento), \'\') = COALESCE(minusculas(?), \'\')',
                         [$contaId, $e['bairro_id'], $e['logradouro'], $e['numero'], $e['complemento']]);
    if ($igual) {
        return (int) $igual['id'];
    }
    executarSql('INSERT INTO loja_enderecos (conta_id, apelido, destinatario, cep, logradouro, numero, complemento, referencia, bairro_id, bairro, cidade, uf)
                 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
                [$contaId, $e['apelido'], $e['destinatario'], $e['cep'], $e['logradouro'], $e['numero'], $e['complemento'], $e['referencia'],
                 $e['bairro_id'], $e['bairro'], $e['cidade'], $e['uf']]);
    return (int) banco()->lastInsertId();
}

function favoritosDaConta(array $conta, ?int $id, string $metodo, array $corpo): array
{
    if ($metodo === 'GET') {
        return [200, ['ok' => true, 'itens' => array_map('intval', array_column(
            consultar('SELECT prato_id FROM favoritos WHERE conta_id = ? ORDER BY criado_em DESC', [$conta['id']]), 'prato_id'))]];
    }
    if ($metodo === 'POST' && $id === null) {
        $pratoId = idDoCatalogo($corpo, 'prato_id', null);
        if (!$pratoId || !consultarUm('SELECT id FROM pratos WHERE id = ? AND publicado = 1', [$pratoId])) {
            throw new ErroApi(400, 'Prato não encontrado.');
        }
        executarSql('INSERT OR IGNORE INTO favoritos (conta_id, prato_id) VALUES (?, ?)', [$conta['id'], $pratoId]);
        return [201, ['ok' => true, 'mensagem' => 'Guardado nos favoritos.']];
    }
    if ($metodo === 'DELETE' && $id !== null) {
        executarSql('DELETE FROM favoritos WHERE conta_id = ? AND prato_id = ?', [$conta['id'], $id]);
        return [200, ['ok' => true, 'mensagem' => 'Tirado dos favoritos.']];
    }
    throw new ErroApi(405, 'Método não permitido para esta rota.');
}

// ------------------------------------------------------------------
// O carrinho calculado pelo servidor (usado pela previa e pelo pedido)
// ------------------------------------------------------------------
/*
 * Confere tudo o que o pedido tem e faz as contas. $paraGravar = true
 * exige o que so o pedido de verdade precisa (endereco, pagamento).
 * Devolve linhas, totais e o que vai para a tabela.
 */
function calcularPedido(array $conta, array $corpo, bool $paraGravar): array
{
    $a = ajustesLoja();
    $itens = $corpo['itens'] ?? null;
    if (!is_array($itens) || !$itens) {
        throw new ErroApi(400, 'O carrinho está vazio.');
    }
    if (count($itens) > LOJA_ITENS_MAX) {
        throw new ErroApi(400, 'Um pedido leva no máximo ' . LOJA_ITENS_MAX . ' linhas.');
    }

    $linhas = [];
    $porPrato = [];
    $avisos = [];
    foreach (array_values($itens) as $n => $item) {
        if (!is_array($item)) {
            throw new ErroApi(400, 'Item do carrinho inválido.');
        }
        $pratoId = idDoCatalogo($item, 'prato_id', null);
        $p = $pratoId ? consultarUm(SQL_PRATOS . ' WHERE p.id = ? AND p.publicado = 1 AND p.ativo = 1', [$pratoId]) : null;
        if (!$p) {
            throw new ErroApi(400, 'Um prato do carrinho saiu do cardápio. Tire-o do carrinho e tente de novo.');
        }
        $quantidade = (int) inteiro($item, 'quantidade', 'Quantidade', 1, LOJA_QUANTIDADE_MAX, 1);
        // Adicionais: [id, ...] ou [{id, quantidade}], conferidos contra os grupos do prato.
        $escolhidos = [];
        foreach ((array) ($item['adicionais'] ?? []) as $ad) {
            $adId = is_array($ad) ? idDoCatalogo($ad, 'id', null) : (is_scalar($ad) ? (int) $ad : 0);
            $adQ = is_array($ad) ? (int) inteiro($ad, 'quantidade', 'Quantidade do adicional', 1, 10, 1) : 1;
            if ($adId) {
                $escolhidos[$adId] = ($escolhidos[$adId] ?? 0) + $adQ;
            }
        }
        $grupos = gruposDoPrato((int) $p['id']);
        $adicionais = [];
        $acrescimo = 0.0;
        $kcalExtra = 0;
        $protExtra = 0.0;
        foreach ($grupos as $g) {
            $noGrupo = 0;
            foreach ($g['opcoes'] as $o) {
                if (isset($escolhidos[$o['id']])) {
                    $q = $escolhidos[$o['id']];
                    $noGrupo += $q;
                    $adicionais[] = ['adicional_id' => $o['id'], 'grupo' => $g['nome'], 'nome' => $o['nome'], 'preco' => $o['preco'], 'quantidade' => $q];
                    $acrescimo += $o['preco'] * $q;
                    $kcalExtra += $o['kcal'] * $q;
                    $protExtra += $o['proteinas'] * $q;
                    unset($escolhidos[$o['id']]);
                }
            }
            if ($noGrupo < $g['minimo']) {
                throw new ErroApi(400, '"' . $p['nome'] . '": escolha ' . ($g['minimo'] === 1 ? 'uma opção' : $g['minimo'] . ' opções')
                    . ' em "' . $g['nome'] . '".');
            }
            if ($noGrupo > $g['maximo']) {
                throw new ErroApi(400, '"' . $p['nome'] . '": em "' . $g['nome'] . '" dá para escolher no máximo ' . $g['maximo'] . '.');
            }
        }
        if ($escolhidos) {
            throw new ErroApi(400, '"' . $p['nome'] . '": um adicional escolhido não está mais disponível. Abra o prato e escolha de novo.');
        }
        $unitario = round(precoDoPrato($p) + $acrescimo, 2);
        $observacao = textoCurto($item, 'observacao', 'Observação do prato', 140);
        $linhas[] = [
            'prato_id' => (int) $p['id'], 'nome' => $p['nome'], 'quantidade' => $quantidade, 'unitario' => $unitario,
            'subtotal' => round($unitario * $quantidade, 2), 'observacao' => $observacao, 'adicionais' => $adicionais,
            'kcal' => $p['kcal'] === null ? null : (int) $p['kcal'] + $kcalExtra,
            'proteinas' => $p['proteinas'] === null ? null : round((float) $p['proteinas'] + $protExtra, 1),
            'carboidratos' => $p['carboidratos'] === null ? null : (float) $p['carboidratos'],
            'gorduras' => $p['gorduras'] === null ? null : (float) $p['gorduras'],
            'foto' => ($f = consultarUm('SELECT id FROM prato_fotos WHERE prato_id = ? ORDER BY ordem, id LIMIT 1', [$p['id']])) ? (int) $f['id'] : null,
            'feito_na_hora' => (int) $p['feito_na_hora'] === 1,
        ];
        if (!(int) $p['feito_na_hora']) {
            $porPrato[(int) $p['id']] = ['nome' => $p['nome'], 'q' => ($porPrato[(int) $p['id']]['q'] ?? 0) + $quantidade, 'p' => $p];
        }
    }
    foreach ($porPrato as $pid => $x) {
        $livre = disponivelDoPrato($x['p']);
        if ($x['q'] > $livre) {
            throw new ErroApi(400, $livre > 0 ? 'De "' . $x['nome'] . '" só restam ' . $livre . ' porção(ões). Ajuste a quantidade no carrinho.'
                                              : '"' . $x['nome'] . '" acabou de esgotar. Tire-o do carrinho para continuar.');
        }
    }
    $produtos = round(array_sum(array_column($linhas, 'subtotal')), 2);

    // Entrega ou retirada.
    $tipoEntrega = txt($corpo, 'tipo_entrega') ?? ((int) $a['aceita_entrega'] ? 'entrega' : 'retirada');
    if (!in_array($tipoEntrega, valoresDe('tipos_entrega'), true)) {
        throw new ErroApi(400, 'Escolha entrega ou retirada.');
    }
    if ($tipoEntrega === 'entrega' && !(int) $a['aceita_entrega']) {
        throw new ErroApi(400, 'No momento a loja não está fazendo entregas: escolha retirar na loja.');
    }
    if ($tipoEntrega === 'retirada' && !(int) $a['aceita_retirada']) {
        throw new ErroApi(400, 'Esta loja não tem retirada no balcão: escolha entrega.');
    }
    $endereco = null;
    $bairro = null;
    if ($tipoEntrega === 'entrega') {
        $enderecoId = idDoCatalogo($corpo, 'endereco_id', null);
        if ($enderecoId) {
            $endereco = consultarUm('SELECT * FROM loja_enderecos WHERE id = ? AND conta_id = ?', [$enderecoId, $conta['id']]);
            if (!$endereco) {
                throw new ErroApi(400, 'Escolha um endereço da sua conta.');
            }
            $bairro = $endereco['bairro_id'] ? consultarUm('SELECT * FROM loja_bairros WHERE id = ? AND ativo = 1', [$endereco['bairro_id']]) : null;
            if (!$bairro) {
                throw new ErroApi(400, 'Ainda não entregamos no bairro deste endereço (' . $endereco['bairro'] . '). Escolha outro endereço ou retire na loja.');
            }
        } elseif (is_array($corpo['endereco'] ?? null)) {
            $endereco = enderecoDoCorpo($corpo['endereco']);
            $bairro = consultarUm('SELECT * FROM loja_bairros WHERE id = ?', [$endereco['bairro_id']]);
        } elseif (veio($corpo, 'bairro_id')) {
            $bairro = consultarUm('SELECT * FROM loja_bairros WHERE id = ? AND ativo = 1', [(int) $corpo['bairro_id']]);
        }
        if ($paraGravar && !$endereco) {
            throw new ErroApi(400, 'Informe o endereço de entrega.');
        }
    }
    $taxa = $bairro ? round((float) $bairro['taxa'], 2) : 0.0;
    $freteGratis = (float) $a['frete_gratis_acima'] > 0 && emCentavos($produtos) >= emCentavos((float) $a['frete_gratis_acima']);
    if ($freteGratis) {
        $taxa = 0.0;
    }

    // Cupom (desconto nos pratos, ou a taxa de entrega).
    $cupom = null;
    $desconto = 0.0;
    $codigo = txt($corpo, 'cupom');
    if ($codigo !== null) {
        $cupom = cupomValido($codigo, $conta, $produtos);
        if ($cupom['tipo'] === 'percentual') {
            $desconto = round($produtos * (float) $cupom['valor'] / 100, 2);
        } elseif ($cupom['tipo'] === 'valor') {
            $desconto = min(round((float) $cupom['valor'], 2), $produtos);
        } else {
            if ($tipoEntrega !== 'entrega') {
                throw new ErroApi(400, 'O cupom ' . $cupom['codigo'] . ' é de entrega grátis: ele vale só para pedido com entrega.');
            }
            $desconto = $taxa;   // a taxa entra e o desconto a anula: o relatorio ve o que o cupom custou
        }
    }

    // Cashback: paga no maximo metade dos pratos.
    $saldo = saldoCashback((int) $conta['id']);
    $cashback = 0.0;
    if (!empty($corpo['usar_cashback']) && $saldo > 0) {
        $cashback = min($saldo, round(($produtos - min($desconto, $produtos)) * CASHBACK_MAXIMO_DO_PEDIDO, 2));
    }
    $total = round($produtos + $taxa - $desconto - $cashback, 2);
    conferirTeto($total, 'O total do pedido');

    if ($paraGravar && (float) $a['pedido_minimo'] > 0 && emCentavos($produtos) < emCentavos((float) $a['pedido_minimo'])) {
        throw new ErroApi(400, 'O pedido mínimo é de ' . moedaBr((float) $a['pedido_minimo']) . ' em pratos. Falta '
            . moedaBr((float) $a['pedido_minimo'] - $produtos) . '.');
    }
    if ((float) $a['frete_gratis_acima'] > 0 && !$freteGratis && $tipoEntrega === 'entrega' && !($cupom && $cupom['tipo'] === 'frete')) {
        $avisos[] = 'Faltam ' . moedaBr((float) $a['frete_gratis_acima'] - $produtos) . ' para a entrega grátis.';
    }

    $kcal = 0;
    $prot = 0.0;
    foreach ($linhas as $l) {
        $kcal += (int) ($l['kcal'] ?? 0) * $l['quantidade'];
        $prot += (float) ($l['proteinas'] ?? 0) * $l['quantidade'];
    }
    return [
        'ajustes' => $a, 'linhas' => $linhas, 'produtos' => $produtos, 'tipo_entrega' => $tipoEntrega, 'endereco' => $endereco,
        'bairro' => $bairro, 'taxa' => $taxa, 'frete_gratis' => $freteGratis, 'cupom' => $cupom, 'desconto' => $desconto,
        'cashback_saldo' => $saldo, 'cashback' => $cashback, 'total' => $total, 'avisos' => $avisos,
        'nutricao' => ['kcal' => $kcal, 'proteinas' => round($prot, 1)],
        'cashback_previsto' => (int) $a['cashback_percentual'] > 0 ? round(($produtos - $desconto) * (int) $a['cashback_percentual'] / 100, 2) : 0.0,
    ];
}

function carrinhoParaTela(array $c): array
{
    return ['linhas' => $c['linhas'], 'produtos' => $c['produtos'], 'tipo_entrega' => $c['tipo_entrega'], 'taxa' => $c['taxa'],
            'frete_gratis' => $c['frete_gratis'], 'bairro' => $c['bairro'] ? $c['bairro']['nome'] : null,
            'tempo_entrega_min' => (int) $c['ajustes']['tempo_preparo_min'] + ($c['bairro'] ? (int) $c['bairro']['tempo_min'] : 0),
            'cupom' => $c['cupom'] ? ['codigo' => $c['cupom']['codigo'], 'tipo' => $c['cupom']['tipo'], 'descricao' => $c['cupom']['descricao']] : null,
            'desconto' => $c['desconto'], 'cashback_saldo' => $c['cashback_saldo'], 'cashback' => $c['cashback'], 'total' => $c['total'],
            'avisos' => $c['avisos'], 'nutricao' => $c['nutricao'], 'cashback_previsto' => $c['cashback_previsto'],
            'pedido_minimo' => (float) $c['ajustes']['pedido_minimo']];
}

/** O cupom, se ele vale para esta conta e este pedido (senao, 400 dizendo por que). */
function cupomValido(string $codigo, array $conta, float $produtos): array
{
    $c = consultarUm('SELECT * FROM cupons WHERE codigo = ? AND ativo = 1', [strtoupper(trim($codigo))]);
    if (!$c) {
        throw new ErroApi(400, 'Cupom "' . strtoupper(trim($codigo)) . '" não encontrado. Confira as letras.');
    }
    $hoje = date('Y-m-d');
    if (($c['inicio'] && $hoje < $c['inicio']) || ($c['fim'] && $hoje > $c['fim'])) {
        throw new ErroApi(400, 'O cupom ' . $c['codigo'] . ' está fora da validade' . ($c['fim'] ? ' (até ' . dataBr($c['fim']) . ')' : '') . '.');
    }
    if ((float) $c['pedido_minimo'] > 0 && emCentavos($produtos) < emCentavos((float) $c['pedido_minimo'])) {
        throw new ErroApi(400, 'O cupom ' . $c['codigo'] . ' vale para pedidos a partir de ' . moedaBr((float) $c['pedido_minimo']) . ' em pratos.');
    }
    $ativos = "status <> 'cancelada'";
    if ($c['limite_usos'] !== null && (int) consultarUm("SELECT COUNT(*) AS q FROM encomendas WHERE cupom_id = ? AND {$ativos}", [$c['id']])['q'] >= (int) $c['limite_usos']) {
        throw new ErroApi(400, 'O cupom ' . $c['codigo'] . ' já foi usado o máximo de vezes.');
    }
    if ((int) consultarUm("SELECT COUNT(*) AS q FROM encomendas WHERE cupom_id = ? AND conta_id = ? AND {$ativos}", [$c['id'], $conta['id']])['q']
        >= (int) $c['limite_por_cliente']) {
        throw new ErroApi(400, 'Você já usou o cupom ' . $c['codigo'] . '.');
    }
    if ((int) $c['primeira_compra'] && consultarUm("SELECT 1 FROM encomendas WHERE conta_id = ? AND {$ativos} LIMIT 1", [$conta['id']])) {
        throw new ErroApi(400, 'O cupom ' . $c['codigo'] . ' é só para a primeira compra.');
    }
    return $c;
}

// ------------------------------------------------------------------
// Pedidos do cliente
// ------------------------------------------------------------------
function encomendasDoCliente(array $conta, ?int $id, ?string $acao, string $metodo, array $corpo): array
{
    expirarEncomendas();
    if ($metodo === 'GET' && $id === null) {
        $lista = consultar('SELECT * FROM encomendas WHERE conta_id = ? ORDER BY criado_em DESC, id DESC LIMIT 100', [$conta['id']]);
        return [200, ['ok' => true, 'itens' => array_map(fn ($e) => resumoEncomenda($e), $lista)]];
    }
    if ($metodo === 'GET' && $id !== null && $acao === null) {
        return [200, ['ok' => true, 'encomenda' => detalheEncomenda(encomendaDaConta($conta, $id), false)]];
    }
    if ($metodo === 'POST' && $id === null) {
        return criarEncomenda($conta, $corpo);
    }
    if ($metodo === 'POST' && $id !== null && $acao === 'cancelar') {
        $e = encomendaDaConta($conta, $id);
        if (!in_array($e['status'], STATUS_ENCOMENDA_RESERVA, true)) {
            throw new ErroApi(400, 'A loja já confirmou o seu pedido e ele está "' . rotuloDe('status_encomenda', $e['status']) . '". '
                . 'Para cancelar agora, fale com a loja pelo WhatsApp.');
        }
        emTransacao(function () use ($e) {
            executarSql("UPDATE encomendas SET status = 'cancelada', motivo_cancelamento = ?, atualizado_em = ? WHERE id = ?",
                        ['Cancelado pelo cliente.', agora(), $e['id']]);
            devolverCashbackUsado((int) $e['id']);
            registrarEvento((int) $e['id'], 'cancelada', 'Cancelado pelo cliente.', null);
        });
        return [200, ['ok' => true, 'mensagem' => 'Pedido cancelado. Nada foi cobrado.']];
    }
    if ($metodo === 'POST' && $id !== null && $acao === 'avaliar') {
        $e = encomendaDaConta($conta, $id);
        if ($e['status'] !== 'entregue') {
            throw new ErroApi(400, 'Dá para avaliar depois que o pedido for entregue.');
        }
        if ($e['avaliacao_nota'] !== null) {
            throw new ErroApi(400, 'Você já avaliou este pedido. Obrigado!');
        }
        $nota = inteiro($corpo, 'nota', 'Nota', 1, 5, null);
        if (!$nota) {
            throw new ErroApi(400, 'Escolha de 1 a 5 estrelas.');
        }
        executarSql('UPDATE encomendas SET avaliacao_nota = ?, avaliacao_comentario = ?, avaliado_em = ? WHERE id = ?',
                    [$nota, textoCurto($corpo, 'comentario', 'Comentário', 300), agora(), $e['id']]);
        return [200, ['ok' => true, 'mensagem' => 'Obrigado pela avaliação! Ela ajuda a cozinha a melhorar.']];
    }
    throw new ErroApi(405, 'Método não permitido para esta rota.');
}

function encomendaDaConta(array $conta, int $id): array
{
    $e = consultarUm('SELECT * FROM encomendas WHERE id = ? AND conta_id = ?', [$id, $conta['id']]);
    if (!$e) {
        throw new ErroApi(404, 'Pedido não encontrado.');
    }
    return $e;
}

/** Agendamento: AAAA-MM-DD HH:MM, nos proximos dias, no horario da loja, com tempo de preparo. */
function agendamentoDoCorpo(array $corpo, array $a): ?string
{
    $valor = txt($corpo, 'agendado_para');
    if ($valor === null) {
        return null;
    }
    if (!(int) $a['aceita_agendamento']) {
        throw new ErroApi(400, 'Esta loja não aceita pedido agendado.');
    }
    if (!preg_match('/^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2})/', $valor, $m) || !checkdate((int) $m[2], (int) $m[3], (int) $m[1])) {
        throw new ErroApi(400, 'Data e hora do agendamento inválidas.');
    }
    $momento = mktime((int) $m[4], (int) $m[5], 0, (int) $m[2], (int) $m[3], (int) $m[1]);
    if ($momento < time() + (int) $a['tempo_preparo_min'] * 60) {
        throw new ErroApi(400, 'Agende para depois de ' . date('H:i', time() + (int) $a['tempo_preparo_min'] * 60)
            . ': a cozinha precisa de ' . (int) $a['tempo_preparo_min'] . ' minutos.');
    }
    if ($momento > strtotime('+' . LOJA_AGENDA_DIAS . ' days')) {
        throw new ErroApi(400, 'Dá para agendar até ' . LOJA_AGENDA_DIAS . ' dias para frente.');
    }
    if (!dentroDoHorario($momento)) {
        throw new ErroApi(400, 'A loja está fechada nesse horário. Veja os horários de funcionamento.');
    }
    return date('Y-m-d H:i', $momento);
}

function criarEncomenda(array $conta, array $corpo): array
{
    $a = ajustesLoja();
    $func = funcionamento($a);
    if (!$func['aceita_pedidos']) {
        throw new ErroApi(400, 'A loja não está aceitando pedidos agora. ' . $func['texto'] . '.');
    }
    $agendado = agendamentoDoCorpo($corpo, $a);
    if (!$func['aberta_agora'] && $agendado === null) {
        throw new ErroApi(400, 'A loja está fechada agora (' . $func['texto'] . '). Escolha um horário para agendar o pedido.');
    }
    $pagamento = txt($corpo, 'pagamento') ?? 'pix';
    if (!in_array($pagamento, valoresDe('pagamentos_loja'), true)) {
        throw new ErroApi(400, 'Escolha a forma de pagamento.');
    }
    if ($pagamento === 'pix' && (!(int) $a['aceita_pix'] || (string) $a['chave_pix'] === '')) {
        throw new ErroApi(400, 'O Pix online não está disponível agora. Escolha pagar na entrega.');
    }
    if ($pagamento !== 'pix' && !(int) $a['aceita_pagamento_entrega']) {
        throw new ErroApi(400, 'Esta loja recebe só por Pix no pedido.');
    }

    expirarEncomendas();
    $c = calcularPedido($conta, $corpo, true);
    $troco = null;
    if ($pagamento === 'dinheiro_entrega' && veio($corpo, 'troco_para')) {
        $troco = dinheiro($corpo, 'troco_para', 'Troco para');
        if (emCentavos($troco) < emCentavos($c['total'])) {
            throw new ErroApi(400, 'O troco precisa ser para um valor maior que o total (' . moedaBr($c['total']) . ').');
        }
    }
    $telefone = telefoneDoCorpo($corpo, 'telefone', false) ?? $conta['telefone'];
    $observacoes = textoCurto($corpo, 'observacoes', 'Observação', 300);
    $agoraTs = time();
    $pagarAte = $pagamento === 'pix' ? date('Y-m-d H:i:s', $agoraTs + (int) $a['prazo_pagamento_min'] * 60) : null;
    $tempo = (int) $a['tempo_preparo_min'] + ($c['bairro'] ? (int) $c['bairro']['tempo_min'] : 0);
    $previsao = $agendado ? $agendado . ':00' : date('Y-m-d H:i:s', $agoraTs + $tempo * 60);

    return emTransacao(function () use ($conta, $corpo, $c, $pagamento, $troco, $telefone, $observacoes, $pagarAte, $previsao, $agendado) {
        $end = $c['endereco'];
        if ($end && empty($end['id'])) {
            salvarEndereco((int) $conta['id'], $end);
        }
        $numero = proximoNumero('encomendas', 'GF');
        executarSql(
            'INSERT INTO encomendas (numero, conta_id, status, tipo_entrega, pagamento, troco_para, valor_produtos, desconto, cashback_usado,
                                     taxa_entrega, valor_total, cupom_id, cupom_codigo, bairro_id, entrega_destinatario, entrega_cep,
                                     entrega_logradouro, entrega_numero, entrega_complemento, entrega_referencia, entrega_bairro,
                                     entrega_cidade, entrega_uf, entrega_telefone, observacoes, agendado_para, pagar_ate, previsao,
                                     criado_em, atualizado_em)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
            [$numero, $conta['id'], $pagamento === 'pix' ? 'aguardando_pagamento' : 'aguardando_aceite', $c['tipo_entrega'], $pagamento, $troco,
             $c['produtos'], $c['desconto'], $c['cashback'], $c['taxa'], $c['total'], $c['cupom']['id'] ?? null, $c['cupom']['codigo'] ?? null,
             $c['bairro']['id'] ?? null, $end['destinatario'] ?? null, $end['cep'] ?? null, $end['logradouro'] ?? null, $end['numero'] ?? null,
             $end['complemento'] ?? null, $end['referencia'] ?? null, $end['bairro'] ?? null, $end['cidade'] ?? null, $end['uf'] ?? null,
             $telefone, $observacoes, $agendado, $pagarAte, $previsao, agora(), agora()]);
        $id = (int) banco()->lastInsertId();
        foreach ($c['linhas'] as $l) {
            executarSql('INSERT INTO encomenda_itens (encomenda_id, prato_id, descricao, quantidade, valor_unitario, subtotal, observacao,
                                                      kcal, proteinas, carboidratos, gorduras)
                         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
                        [$id, $l['prato_id'], $l['nome'], $l['quantidade'], $l['unitario'], $l['subtotal'], $l['observacao'],
                         $l['kcal'], $l['proteinas'], $l['carboidratos'], $l['gorduras']]);
            $itemId = (int) banco()->lastInsertId();
            foreach ($l['adicionais'] as $ad) {
                executarSql('INSERT INTO encomenda_item_adicionais (item_id, adicional_id, grupo, nome, preco, quantidade) VALUES (?, ?, ?, ?, ?, ?)',
                            [$itemId, $ad['adicional_id'], $ad['grupo'], $ad['nome'], $ad['preco'], $ad['quantidade']]);
            }
        }
        if ($c['cashback'] > 0) {
            executarSql("INSERT INTO cashback (conta_id, encomenda_id, tipo, valor, descricao) VALUES (?, ?, 'uso', ?, ?)",
                        [$conta['id'], $id, $c['cashback'], 'Usado no pedido ' . $numero]);
        }
        registrarEvento($id, $pagamento === 'pix' ? 'aguardando_pagamento' : 'aguardando_aceite',
            $pagamento === 'pix' ? 'Pedido recebido. Pague o Pix para a cozinha começar.' : 'Pedido recebido. A loja já vai confirmar.', null);

        // Conferido DEPOIS de gravar (a reserva deste pedido ja conta): dois clientes
        // pedindo a ultima porcao ao mesmo tempo nao levam os dois.
        foreach ($c['linhas'] as $l) {
            if ($l['feito_na_hora']) {
                continue;
            }
            $disp = (int) consultarUm('SELECT disponivel FROM vw_estoque_pratos WHERE prato_id = ?', [$l['prato_id']])['disponivel'];
            if (reservadoDoPrato($l['prato_id']) > $disp) {
                throw new ErroApi(400, '"' . $l['nome'] . '" acabou de esgotar enquanto você pedia. Ajuste o carrinho e tente de novo.');
            }
        }
        $a = $c['ajustes'];
        return [201, ['ok' => true, 'id' => $id, 'numero' => $numero,
                      'mensagem' => $pagamento === 'pix'
                          ? 'Pedido ' . $numero . ' feito! Pague o Pix até ' . date('H:i', strtotime($pagarAte)) . ' para a cozinha começar.'
                          : 'Pedido ' . $numero . ' feito! A loja já vai confirmar.']];
    });
}

/** Uma linha da lista "Meus pedidos" (e do quadro do painel). */
function resumoEncomenda(array $e): array
{
    $itens = consultar('SELECT descricao, quantidade FROM encomenda_itens WHERE encomenda_id = ? ORDER BY id', [$e['id']]);
    $foto = consultarUm('SELECT f.id FROM encomenda_itens ei JOIN prato_fotos f ON f.prato_id = ei.prato_id
                          WHERE ei.encomenda_id = ? ORDER BY ei.id, f.ordem, f.id LIMIT 1', [$e['id']]);
    return ['id' => (int) $e['id'], 'numero' => $e['numero'], 'status' => $e['status'],
            'status_rotulo' => rotuloDe('status_encomenda', $e['status']),
            'tipo_entrega' => $e['tipo_entrega'], 'pagamento' => $e['pagamento'], 'pagamento_rotulo' => rotuloDe('pagamentos_loja', $e['pagamento']),
            'valor_total' => (float) $e['valor_total'], 'criado_em' => $e['criado_em'], 'pagar_ate' => $e['pagar_ate'],
            'previsao' => $e['previsao'], 'agendado_para' => $e['agendado_para'], 'atualizado_em' => $e['atualizado_em'],
            'itens_texto' => implode(', ', array_map(fn ($i) => $i['quantidade'] . 'x ' . $i['descricao'], $itens)),
            'unidades' => array_sum(array_map(fn ($i) => (int) $i['quantidade'], $itens)),
            'entrega_bairro' => $e['entrega_bairro'], 'foto' => $foto ? (int) $foto['id'] : null,
            'avaliacao_nota' => $e['avaliacao_nota'] === null ? null : (int) $e['avaliacao_nota'],
            'avaliacao_comentario' => $e['avaliacao_comentario'], 'avaliado_em' => $e['avaliado_em']];
}

/** A trilha que vale para este pedido (entrega ou retirada). */
function trilhaDe(array $e): array
{
    return $e['tipo_entrega'] === 'retirada' ? TRILHA_RETIRADA : TRILHA_ENTREGA;
}

/*
 * O pedido inteiro: itens (com adicionais e observacao), nutricao, endereco,
 * o pagamento (enquanto aguarda), os passos com a hora de cada um e os
 * eventos. $admin junta quem fez cada passo, a conta e a venda gerada.
 */
function detalheEncomenda(array $e, bool $admin): array
{
    $a = ajustesLoja();
    $saida = resumoEncomenda($e) + [
        'valor_produtos' => (float) $e['valor_produtos'], 'desconto' => (float) $e['desconto'], 'cashback_usado' => (float) $e['cashback_usado'],
        'taxa_entrega' => (float) $e['taxa_entrega'], 'cupom_codigo' => $e['cupom_codigo'], 'troco_para' => $e['troco_para'] === null ? null : (float) $e['troco_para'],
        'observacoes' => $e['observacoes'], 'motivo_cancelamento' => $e['motivo_cancelamento'],
        'avaliacao_comentario' => $e['avaliacao_comentario'], 'cashback_gerado' => (float) $e['cashback_gerado'],
        'entrega' => $e['tipo_entrega'] === 'entrega' ? [
            'destinatario' => $e['entrega_destinatario'], 'cep' => cepFormatado($e['entrega_cep']), 'logradouro' => $e['entrega_logradouro'],
            'numero' => $e['entrega_numero'], 'complemento' => $e['entrega_complemento'], 'referencia' => $e['entrega_referencia'],
            'bairro' => $e['entrega_bairro'], 'cidade' => $e['entrega_cidade'], 'uf' => $e['entrega_uf']] : null,
        'telefone' => $e['entrega_telefone'],
        'retirada' => $e['tipo_entrega'] === 'retirada' ? $a['endereco_retirada'] : null,
        'whatsapp_loja' => $a['whatsapp'],
    ];
    $kcal = 0;
    $prot = 0.0;
    $saida['itens'] = array_map(function ($i) use (&$kcal, &$prot) {
        $kcal += (int) ($i['kcal'] ?? 0) * (int) $i['quantidade'];
        $prot += (float) ($i['proteinas'] ?? 0) * (int) $i['quantidade'];
        $foto = consultarUm('SELECT id FROM prato_fotos WHERE prato_id = ? ORDER BY ordem, id LIMIT 1', [$i['prato_id']]);
        return ['prato_id' => (int) $i['prato_id'], 'descricao' => $i['descricao'], 'quantidade' => (int) $i['quantidade'],
                'valor_unitario' => (float) $i['valor_unitario'], 'subtotal' => (float) $i['subtotal'], 'observacao' => $i['observacao'],
                'kcal' => $i['kcal'] === null ? null : (int) $i['kcal'], 'proteinas' => $i['proteinas'] === null ? null : (float) $i['proteinas'],
                'foto' => $foto ? (int) $foto['id'] : null,
                'adicionais' => array_map(fn ($ad) => ['id' => $ad['adicional_id'] === null ? null : (int) $ad['adicional_id'],
                                                       'grupo' => $ad['grupo'], 'nome' => $ad['nome'],
                                                       'preco' => (float) $ad['preco'], 'quantidade' => (int) $ad['quantidade']],
                    consultar('SELECT * FROM encomenda_item_adicionais WHERE item_id = ? ORDER BY id', [$i['id']]))];
    }, consultar('SELECT * FROM encomenda_itens WHERE encomenda_id = ? ORDER BY id', [$e['id']]));
    $saida['nutricao'] = ['kcal' => $kcal, 'proteinas' => round($prot, 1)];

    $eventos = consultar('SELECT ev.*, u.nome AS usuario FROM encomenda_eventos ev LEFT JOIN usuarios u ON u.id = ev.usuario_id
                           WHERE ev.encomenda_id = ? ORDER BY ev.id', [$e['id']]);
    $saida['eventos'] = array_map(function ($ev) use ($admin) {
        $linha = ['status' => $ev['status'], 'rotulo' => rotuloDe('status_encomenda', $ev['status']), 'momento' => $ev['momento'],
                  'observacao' => $ev['observacao']];
        if ($admin) {
            $linha['usuario'] = $ev['usuario'];
        }
        return $linha;
    }, array_reverse($eventos));

    $quando = [];
    foreach ($eventos as $ev) {
        $quando[$ev['status']] = $quando[$ev['status']] ?? $ev['momento'];
    }
    $trilha = trilhaDe($e);
    $posicao = array_search($e['status'], $trilha, true);
    $saida['trilha'] = array_map(fn ($s, $i) => ['status' => $s, 'rotulo' => rotuloDe('status_encomenda', $s),
        'momento' => $quando[$s] ?? null, 'feito' => $posicao !== false && $i <= $posicao, 'atual' => $posicao === $i],
        $trilha, array_keys($trilha));
    $saida['proximo'] = $posicao !== false && $posicao + 1 < count($trilha) ? $trilha[$posicao + 1] : null;
    $saida['proximo_rotulo'] = $saida['proximo'] ? rotuloDe('status_encomenda', $saida['proximo']) : null;
    $saida['pode_cancelar'] = $admin ? !in_array($e['status'], ['entregue', 'cancelada'], true)
                                     : in_array($e['status'], STATUS_ENCOMENDA_RESERVA, true);
    $saida['pode_avaliar'] = !$admin && $e['status'] === 'entregue' && $e['avaliacao_nota'] === null;
    $saida['pode_confirmar'] = in_array($e['status'], STATUS_ENCOMENDA_RESERVA, true);

    if ($e['status'] === 'aguardando_pagamento') {
        $saida['pix'] = ['chave' => $a['chave_pix'], 'recebedor' => $a['recebedor_pix'], 'valor' => (float) $e['valor_total'],
                         'pagar_ate' => $e['pagar_ate']];
    }
    if ($admin) {
        $conta = consultarUm('SELECT id, nome, email, telefone, cpf, cliente_id, restricoes, objetivo FROM loja_contas WHERE id = ?', [$e['conta_id']]);
        $conta['pedidos'] = (int) consultarUm("SELECT COUNT(*) AS q FROM encomendas WHERE conta_id = ? AND status <> 'cancelada'", [$e['conta_id']])['q'];
        $saida['conta'] = $conta;
        $saida['venda'] = $e['venda_id'] ? consultarUm('SELECT id, numero, status FROM vendas WHERE id = ?', [$e['venda_id']]) : null;
        $saida['minutos'] = (int) floor((time() - strtotime($e['criado_em'])) / 60);
    }
    return $saida;
}

// ------------------------------------------------------------------
// Painel: o quadro de pedidos
// ------------------------------------------------------------------
function encomendasAdmin(?int $id, ?string $acao, string $metodo, array $corpo, array $consulta, array $usuario): array
{
    if ($usuario['perfil'] !== 'admin' && !chaveLigada('loja.cozinha_ve_pedidos')) {
        throw new ErroApi(403, 'Os pedidos online estão só com o administrador nesta loja (Empresa e regras > Regras).');
    }
    expirarEncomendas();
    if ($metodo === 'GET' && $acao === null) {
        if ($id !== null) {
            $e = consultarUm('SELECT * FROM encomendas WHERE id = ?', [$id]);
            if (!$e) {
                throw new ErroApi(404, 'Pedido não encontrado.');
            }
            return [200, ['ok' => true, 'encomenda' => detalheEncomenda($e, true)]];
        }
        // ?quadro=1: os abertos e os que terminaram hoje, com itens e adicionais (o cartao da cozinha).
        if (!empty($consulta['quadro'])) {
            $hoje = date('Y-m-d');
            $lista = consultar('SELECT * FROM encomendas WHERE status IN (' . vagas(STATUS_ENCOMENDA_ABERTOS) . ')
                                   OR (status IN (\'entregue\', \'cancelada\') AND substr(atualizado_em, 1, 10) = ?)
                                ORDER BY COALESCE(agendado_para, criado_em), id', array_merge(STATUS_ENCOMENDA_ABERTOS, [$hoje]));
            return [200, ['ok' => true, 'agora' => agora(), 'itens' => array_map(fn ($e) => detalheEncomenda($e, true), $lista)]];
        }
        $status = is_string($consulta['status'] ?? null) ? $consulta['status'] : '';
        $filtro = in_array($status, valoresDe('status_encomenda'), true) ? ' WHERE e.status = ?' : '';
        $lista = consultar('SELECT e.*, c.nome AS cliente, c.email, c.telefone AS telefone_conta FROM encomendas e JOIN loja_contas c ON c.id = e.conta_id'
                           . $filtro . ' ORDER BY e.criado_em DESC, e.id DESC LIMIT 500', $filtro ? [$status] : []);
        $contagem = [];
        foreach (consultar('SELECT status, COUNT(*) AS q FROM encomendas GROUP BY status') as $c) {
            $contagem[$c['status']] = (int) $c['q'];
        }
        return [200, ['ok' => true, 'contagem' => $contagem, 'itens' => array_map(fn ($e) => resumoEncomenda($e) + [
            'cliente' => $e['cliente'], 'email' => $e['email'], 'telefone' => $e['entrega_telefone'] ?: $e['telefone_conta']], $lista)]];
    }
    exigir($metodo === 'POST' && $id !== null);
    switch ($acao) {
        case 'confirmar':
            return confirmarEncomenda($id, $corpo, $usuario);
        case 'avancar':
            return avancarEncomenda($id, $corpo, $usuario);
        case 'cancelar':
            return cancelarEncomenda($id, $corpo, $usuario);
    }
    throw new ErroApi(404, 'Rota não encontrada.');
}

/*
 * O cliente da loja vira cliente do cadastro no primeiro pedido confirmado
 * (e e ele que aparece na venda e no financeiro).
 */
function clienteDaConta(array $conta, array $e): int
{
    if ($conta['cliente_id'] && consultarUm('SELECT id FROM clientes WHERE id = ?', [$conta['cliente_id']])) {
        return (int) $conta['cliente_id'];
    }
    $endereco = $e['tipo_entrega'] === 'entrega'
        ? $e['entrega_logradouro'] . ', ' . $e['entrega_numero'] . ($e['entrega_complemento'] ? ' - ' . $e['entrega_complemento'] : '')
          . ' - ' . $e['entrega_bairro'] . ' - ' . $e['entrega_cidade'] . '/' . $e['entrega_uf'] : null;
    executarSql('INSERT INTO clientes (nome, telefone, documento, email, endereco, bairro, objetivo, restricoes, observacoes)
                 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
                [$conta['nome'], $conta['telefone'], $conta['cpf'], $conta['email'], $endereco, $e['entrega_bairro'],
                 $conta['objetivo'], $conta['restricoes'], 'Cliente da loja online.']);
    $clienteId = (int) banco()->lastInsertId();
    executarSql('UPDATE loja_contas SET cliente_id = ? WHERE id = ?', [$clienteId, $conta['id']]);
    return $clienteId;
}

function encomendaParaMudar(int $id): array
{
    $e = consultarUm('SELECT * FROM encomendas WHERE id = ?', [$id]);
    if (!$e) {
        throw new ErroApi(404, 'Pedido não encontrado.');
    }
    return $e;
}

/*
 * Pix conferido (aguardando_pagamento) ou pedido aceito (aguardando_aceite):
 * a reserva sai, os lotes que vencem primeiro baixam e nasce a venda, com a
 * conta a receber ja paga (Pix) ou pendente (pagamento na entrega).
 */
function confirmarEncomenda(int $id, array $corpo, array $usuario): array
{
    $observacao = textoCurto($corpo, 'observacao', 'Observação', 300);
    return emTransacao(function () use ($id, $observacao, $usuario) {
        $e = encomendaParaMudar($id);
        if (!in_array($e['status'], STATUS_ENCOMENDA_RESERVA, true)) {
            throw new ErroApi(409, $e['status'] === 'cancelada'
                ? 'Este pedido está cancelado (' . ($e['motivo_cancelamento'] ?: 'sem motivo') . ').'
                : 'Este pedido já foi confirmado (agora está "' . rotuloDe('status_encomenda', $e['status']) . '").');
        }
        $conta = consultarUm('SELECT * FROM loja_contas WHERE id = ?', [$e['conta_id']]);
        $clienteId = clienteDaConta($conta, $e);

        // A reserva deste pedido sai antes de baixar (senao as porcoes contariam duas vezes).
        $data = agora();
        executarSql("UPDATE encomendas SET status = 'confirmado', atualizado_em = ? WHERE id = ?", [$data, $id]);

        $itens = [];
        foreach (consultar('SELECT * FROM encomenda_itens WHERE encomenda_id = ? ORDER BY id', [$id]) as $i) {
            $ads = consultar('SELECT nome, quantidade FROM encomenda_item_adicionais WHERE item_id = ?', [$i['id']]);
            $itens[] = ['prato_id' => (int) $i['prato_id'], 'quantidade' => (int) $i['quantidade'], 'valor_unitario' => (float) $i['valor_unitario'],
                        'descricao' => $i['descricao'],
                        'adicionais' => $ads ? implode(', ', array_map(fn ($ad) => ($ad['quantidade'] > 1 ? $ad['quantidade'] . 'x ' : '') . $ad['nome'], $ads)) : null];
        }
        if ((float) $e['taxa_entrega'] > 0) {
            $itens[] = ['descricao' => 'Taxa de entrega - ' . $e['entrega_bairro'], 'quantidade' => 1, 'valor_unitario' => (float) $e['taxa_entrega']];
        }
        try {
            $linhas = prepararItensDeSaida($itens, $id);
        } catch (ErroApi $erro) {
            throw new ErroApi(400, $erro->getMessage() . ' Produza ou dê entrada no prato, ou cancele o pedido (o cliente vê no app).');
        }
        $bruto = round(array_sum(array_column($linhas, 'subtotal')), 2);
        $desconto = round((float) $e['desconto'] + (float) $e['cashback_usado'], 2);
        $total = (float) $e['valor_total'];
        $custo = round(array_sum(array_map(fn ($l) => $l['custo'] * $l['quantidade'], $linhas)), 2);
        [$formaId, $forma] = formaPeloNome(FORMA_DO_PAGAMENTO_LOJA[$e['pagamento']]);
        $pix = $e['pagamento'] === 'pix';

        $vendaId = gravarVenda(['cliente_id' => $clienteId, 'usuario_id' => $usuario['id'], 'bruto' => $bruto, 'desconto' => $desconto,
            'total' => $total, 'custo' => $custo, 'forma' => $forma, 'forma_id' => $formaId, 'parcelas' => 1, 'data' => $data,
            'observacoes' => 'Loja online: pedido ' . $e['numero'] . ($e['cupom_codigo'] ? ' (cupom ' . $e['cupom_codigo'] . ')' : '')], $linhas);
        conferirSaldos(array_column($linhas, 'entrada_id'),
            'Alguma porção foi vendida no balcão ao mesmo tempo. Produza mais ou cancele o pedido.');
        gerarLancamentosDaVenda($vendaId, $total, 1, $forma, $formaId, $clienteId, substr($data, 0, 10), (int) $usuario['id'], $pix);

        executarSql('UPDATE encomendas SET venda_id = ? WHERE id = ?', [$vendaId, $id]);
        registrarEvento($id, 'confirmado', $observacao ?? ($pix ? 'Pagamento confirmado. A cozinha já recebeu o seu pedido.'
                                                               : 'A loja confirmou o seu pedido.'), (int) $usuario['id']);
        $numeroVenda = consultarUm('SELECT numero FROM vendas WHERE id = ?', [$vendaId])['numero'];
        return [200, ['ok' => true, 'venda_id' => $vendaId,
                      'mensagem' => 'Pedido ' . $e['numero'] . ' confirmado. Venda ' . $numeroVenda . ' registrada e o estoque baixado.']];
    });
}

function avancarEncomenda(int $id, array $corpo, array $usuario): array
{
    $observacao = textoCurto($corpo, 'observacao', 'Observação', 300);
    $para = txt($corpo, 'para');
    return emTransacao(function () use ($id, $observacao, $para, $usuario) {
        $e = encomendaParaMudar($id);
        if (in_array($e['status'], STATUS_ENCOMENDA_RESERVA, true)) {
            throw new ErroApi(400, $e['status'] === 'aguardando_pagamento'
                ? 'Confirme o Pix primeiro: o preparo só começa depois do pagamento.' : 'Aceite o pedido primeiro.');
        }
        $trilha = trilhaDe($e);
        $posicao = array_search($e['status'], $trilha, true);
        if ($posicao === false || $posicao + 1 >= count($trilha)) {
            throw new ErroApi(400, 'Este pedido já está "' . rotuloDe('status_encomenda', $e['status']) . '": não há próximo passo.');
        }
        $proximo = $trilha[$posicao + 1];
        if ($para !== null && $para !== $proximo) {
            throw new ErroApi(409, 'O pedido já está "' . rotuloDe('status_encomenda', $e['status']) . '" (alguém avançou antes). '
                . 'O quadro foi atualizado; confira antes de avançar de novo.');
        }
        executarSql('UPDATE encomendas SET status = ?, atualizado_em = ? WHERE id = ?', [$proximo, agora(), $id]);
        $retirada = $e['tipo_entrega'] === 'retirada';
        $padrao = ['em_preparo' => 'A cozinha está preparando o seu pedido.',
                   'pronto' => $retirada ? 'Pronto! Pode vir buscar.' : 'Pronto e embalado, aguardando o entregador.',
                   'saiu_entrega' => 'Saiu para entrega. Fique de olho no telefone!',
                   'entregue' => $retirada ? 'Retirado na loja. Bom apetite!' : 'Entregue. Bom apetite!'];
        $mensagem = 'Pedido ' . $e['numero'] . ': ' . rotuloDe('status_encomenda', $proximo) . '.';
        if ($proximo === 'entregue') {
            // Pagamento na entrega: o dinheiro entrou agora (a conta a receber recebe baixa sozinha).
            if ($e['pagamento'] !== 'pix' && $e['venda_id']) {
                foreach (consultar("SELECT * FROM lancamentos WHERE venda_id = ? AND status = 'pendente'", [$e['venda_id']]) as $l) {
                    gravarLancamento((int) $l['id'], $l, ['status' => 'pago', 'data_pagamento' => agora()] + $l, (int) $usuario['id'],
                                     'recebido na entrega do pedido ' . $e['numero']);
                }
                $mensagem .= ' O pagamento na entrega foi baixado no Financeiro.';
            }
            $pct = (int) ajustesLoja()['cashback_percentual'];
            if ($pct > 0) {
                $credito = round(((float) $e['valor_produtos'] - min((float) $e['desconto'], (float) $e['valor_produtos'])) * $pct / 100, 2);
                if ($credito > 0) {
                    executarSql("INSERT INTO cashback (conta_id, encomenda_id, tipo, valor, descricao) VALUES (?, ?, 'credito', ?, ?)",
                                [$e['conta_id'], $id, $credito, $pct . '% do pedido ' . $e['numero']]);
                    executarSql('UPDATE encomendas SET cashback_gerado = ? WHERE id = ?', [$credito, $id]);
                    $observacao = ($observacao ?? $padrao['entregue']) . ' Você ganhou ' . moedaBr($credito) . ' de cashback para o próximo pedido.';
                }
            }
        }
        registrarEvento($id, $proximo, $observacao ?? ($padrao[$proximo] ?? null), (int) $usuario['id']);
        return [200, ['ok' => true, 'status' => $proximo, 'mensagem' => $mensagem]];
    });
}

function cancelarEncomenda(int $id, array $corpo, array $usuario): array
{
    $motivo = textoCurto($corpo, 'motivo', 'Motivo', 300, true);
    return emTransacao(function () use ($id, $motivo, $usuario) {
        $e = encomendaParaMudar($id);
        if (in_array($e['status'], ['entregue', 'cancelada'], true)) {
            throw new ErroApi(400, 'Pedido "' . rotuloDe('status_encomenda', $e['status']) . '" não pode ser cancelado.');
        }
        $mensagem = 'Pedido ' . $e['numero'] . ' cancelado.';
        if ($e['venda_id']) {
            $recebido = (float) consultarUm("SELECT COALESCE(SUM(valor), 0) AS v FROM lancamentos
                                              WHERE venda_id = ? AND tipo = 'receber' AND status = 'pago'", [$e['venda_id']])['v'];
            if ($recebido > 0 && $usuario['perfil'] !== 'admin') {
                throw new ErroApi(403, 'Este pedido já foi pago (' . moedaBr($recebido) . '). Cancelar é estorno: só o administrador faz.');
            }
            atualizarVenda((int) $e['venda_id'], ['status' => 'cancelada'], $usuario, true);
            $mensagem .= ' A venda foi cancelada e as porções voltaram ao estoque.'
                       . ($recebido > 0 ? ' O valor recebido foi estornado no Financeiro: devolva o dinheiro ao cliente.' : '');
        }
        executarSql("UPDATE encomendas SET status = 'cancelada', motivo_cancelamento = ?, atualizado_em = ? WHERE id = ?",
                    [$motivo, agora(), $id]);
        devolverCashbackUsado($id);
        registrarEvento($id, 'cancelada', $motivo, (int) $usuario['id']);
        return [200, ['ok' => true, 'mensagem' => $mensagem]];
    });
}

// ------------------------------------------------------------------
// Ajustes e horarios (admin)
// ------------------------------------------------------------------
function ajustesDaLoja(?int $id, string $metodo, array $corpo, array $usuario): array
{
    if ($id !== null) {
        throw new ErroApi(404, 'Rota não encontrada.');
    }
    $a = ajustesLoja();
    if ($metodo === 'GET') {
        return [200, ['ok' => true, 'ajustes' => ajustesParaTela($a)]];
    }
    exigir($metodo === 'PUT');
    $liga = fn (string $c) => array_key_exists($c, $corpo) ? (!empty($corpo[$c]) && $corpo[$c] !== '0' ? 1 : 0) : (int) $a[$c];
    $texto = fn (string $c, string $rotulo, int $max) => array_key_exists($c, $corpo) ? textoCurto($corpo, $c, $rotulo, $max) : $a[$c];
    $novo = [
        'aberta' => $liga('aberta'),
        'nome_vitrine' => $texto('nome_vitrine', 'Nome no app', 80),
        'slogan' => $texto('slogan', 'Frase de apresentação', 140),
        'mensagem_aviso' => $texto('mensagem_aviso', 'Aviso no topo do app', 200),
        'pedido_minimo' => dinheiro($corpo, 'pedido_minimo', 'Pedido mínimo', (float) $a['pedido_minimo']),
        'frete_gratis_acima' => dinheiro($corpo, 'frete_gratis_acima', 'Entrega grátis a partir de', (float) $a['frete_gratis_acima']),
        'tempo_preparo_min' => inteiro($corpo, 'tempo_preparo_min', 'Tempo de preparo (minutos)', 5, 600, (int) $a['tempo_preparo_min']),
        'aceita_entrega' => $liga('aceita_entrega'), 'aceita_retirada' => $liga('aceita_retirada'),
        'endereco_retirada' => $texto('endereco_retirada', 'Endereço para retirada', 200),
        'aceita_pix' => $liga('aceita_pix'), 'aceita_pagamento_entrega' => $liga('aceita_pagamento_entrega'),
        'prazo_pagamento_min' => inteiro($corpo, 'prazo_pagamento_min', 'Prazo para pagar o Pix (minutos)', 5, 1440, (int) $a['prazo_pagamento_min']),
        'chave_pix' => $texto('chave_pix', 'Chave Pix', 120),
        'recebedor_pix' => $texto('recebedor_pix', 'Nome de quem recebe o Pix', 80),
        'whatsapp' => array_key_exists('whatsapp', $corpo) ? telefoneDoCorpo($corpo, 'whatsapp', false) : $a['whatsapp'],
        'instagram' => array_key_exists('instagram', $corpo) ? (($i = textoCurto($corpo, 'instagram', 'Instagram', 60)) === null ? null : ltrim($i, '@')) : $a['instagram'],
        'cashback_percentual' => inteiro($corpo, 'cashback_percentual', 'Cashback (%)', 0, 30, (int) $a['cashback_percentual']),
        'aceita_agendamento' => $liga('aceita_agendamento'),
    ];
    if (!$novo['aceita_entrega'] && !$novo['aceita_retirada']) {
        throw new ErroApi(400, 'Ligue entrega, retirada, ou as duas: sem nenhuma o cliente não tem como receber o pedido.');
    }
    if ($novo['aceita_retirada'] && !$novo['endereco_retirada']) {
        throw new ErroApi(400, 'Com retirada ligada, informe o endereço onde o cliente busca o pedido.');
    }
    if ($novo['aceita_pix'] && !$novo['chave_pix']) {
        throw new ErroApi(400, 'Com o Pix ligado, informe a chave Pix: é por ela que o cliente paga.');
    }
    if (!$novo['aceita_pix'] && !$novo['aceita_pagamento_entrega']) {
        throw new ErroApi(400, 'Ligue o Pix, o pagamento na entrega, ou os dois.');
    }
    if ($novo['aberta'] && $novo['aceita_entrega'] && !consultarUm('SELECT 1 FROM loja_bairros WHERE ativo = 1 LIMIT 1')) {
        throw new ErroApi(400, 'Para abrir com entrega, cadastre pelo menos um bairro atendido (Loja online > Bairros).');
    }
    $colunas = array_keys($novo);
    executarSql('UPDATE loja_ajustes SET ' . implode(' = ?, ', $colunas) . ' = ?, atualizado_em = ?, usuario_id = ? WHERE id = 1',
                array_merge(array_values($novo), [agora(), $usuario['id']]));
    return [200, ['ok' => true, 'ajustes' => ajustesParaTela(ajustesLoja()),
                  'mensagem' => $novo['aberta'] ? 'Ajustes gravados. A loja online está ABERTA para pedidos.'
                                                : 'Ajustes gravados. A loja online está FECHADA (o cardápio continua visível).']];
}

function ajustesParaTela(array $a): array
{
    $saida = $a;
    foreach (['aberta', 'aceita_entrega', 'aceita_retirada', 'aceita_pix', 'aceita_pagamento_entrega', 'aceita_agendamento'] as $c) {
        $saida[$c] = (int) $a[$c] === 1;
    }
    foreach (['pedido_minimo', 'frete_gratis_acima'] as $c) {
        $saida[$c] = (float) $a[$c];
    }
    foreach (['tempo_preparo_min', 'prazo_pagamento_min', 'cashback_percentual'] as $c) {
        $saida[$c] = (int) $a[$c];
    }
    $saida['nome'] = nomeDaVitrine($a);
    unset($saida['id'], $saida['usuario_id']);
    return $saida + ['funcionamento' => funcionamento($a)];
}

function horariosDaLoja(?int $id, string $metodo, array $corpo): array
{
    if ($id !== null) {
        throw new ErroApi(404, 'Rota não encontrada.');
    }
    if ($metodo === 'GET') {
        return [200, ['ok' => true, 'itens' => array_values(horarios())]];
    }
    exigir($metodo === 'PUT');
    $lista = $corpo['horarios'] ?? null;
    if (!is_array($lista)) {
        throw new ErroApi(400, 'Mande os horários dos dias da semana.');
    }
    return emTransacao(function () use ($lista) {
        foreach ($lista as $h) {
            if (!is_array($h)) {
                continue;
            }
            $dia = inteiro($h, 'dia', 'Dia', 0, 6, null);
            if ($dia === null) {
                continue;
            }
            $nome = rotuloDe('dias_semana', (string) $dia);
            $aberto = !empty($h['aberto']) ? 1 : 0;
            $abre = (string) ($h['abre'] ?? '11:00');
            $fecha = (string) ($h['fecha'] ?? '21:00');
            foreach ([$abre, $fecha] as $hora) {
                if (!preg_match('/^([01]\d|2[0-3]):[0-5]\d$/', $hora)) {
                    throw new ErroApi(400, $nome . ': horário inválido (' . $hora . '). Use HH:MM, como 11:00.');
                }
            }
            if ($aberto && $fecha <= $abre) {
                throw new ErroApi(400, $nome . ': o horário de fechar precisa ser depois do de abrir.');
            }
            executarSql('INSERT INTO loja_horarios (dia, aberto, abre, fecha) VALUES (?, ?, ?, ?)
                         ON CONFLICT (dia) DO UPDATE SET aberto = excluded.aberto, abre = excluded.abre, fecha = excluded.fecha',
                        [$dia, $aberto, $abre, $fecha]);
        }
        return [200, ['ok' => true, 'itens' => array_values(horarios()), 'mensagem' => 'Horários gravados.']];
    });
}
