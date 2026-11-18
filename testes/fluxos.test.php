<?php
/**
 * testes/fluxos.test.php - o dia de uma loja de comida fit, de ponta a
 * ponta, pela API de verdade (servidor em BASE_URL, banco temporario):
 *
 *   compra de insumos (lotes com validade) -> ficha tecnica -> ordem de
 *   producao (baixa pelo lote que vence primeiro) -> PDV -> pedido online
 *   com adicionais, cupom, reserva, Pix, preparo, entrega e cashback ->
 *   retirada com pagamento na entrega -> perdas e vencidos -> pedido de
 *   entrada com quantidade decimal da nota (fator) -> permissoes.
 *
 * Os valores esperados sao escritos a mao (o oraculo), nunca calculados
 * pela funcao testada.
 */

declare(strict_types=1);

require __DIR__ . '/caso.php';
require __DIR__ . '/http.php';

$base = getenv('BASE_URL') ?: 'http://127.0.0.1:5604';
$senhaInicial = getenv('ADMIN_SENHA_INICIAL') ?: 'Inicial-Teste-2026';
$senhaAdmin = getenv('ADMIN_SENHA') ?: 'Testador-Fit-2026';
$admin = new Cliente($base);
$cliente = new Cliente($base);
$hoje = date('Y-m-d');
$dias = fn (int $n) => date('Y-m-d', strtotime("{$hoje} {$n} days"));
$ids = [];

caso('admin entra e troca a senha inicial', function () use ($admin, $senhaInicial, $senhaAdmin) {
    [$c] = $admin->post('/api/login', ['usuario' => 'admin', 'senha' => $senhaInicial]);
    if ($c === 200) {
        $admin->ok('POST', '/api/trocar-senha', ['senha_atual' => $senhaInicial, 'senha_nova' => $senhaAdmin]);
    } else {
        $admin->ok('POST', '/api/login', ['usuario' => 'admin', 'senha' => $senhaAdmin]);
    }
    $s = $admin->ok('GET', '/api/sessao');
    igual($s['usuario']['perfil'], 'admin', 'perfil');
    igual($s['usuario']['trocar_senha'], false, 'senha ja trocada');
});

caso('senha fraca obriga a trocar, menos no banco de teste (acesso rapido p / p da demonstracao)', function () use ($admin, $base) {
    // A conta de senha fraca vem do rodar.php (FRACO_USER/FRACO_SENHA: "legado" / "2024",
    // gravada direto no banco; a API recusa senha assim). O e2e reusa esta suite so para
    // encher o banco dele, que nao tem essa conta: ai o caso e pulado, como o C200 da Master.
    $fraco = getenv('FRACO_USER');
    if (!$fraco) {
        echo "        (pulado: sem FRACO_USER)\n";
        return;
    }
    $entrar = function () use ($base, $fraco): array {
        $c = new Cliente($base);
        [$codigo, $r] = $c->post('/api/login', ['usuario' => $fraco, 'senha' => (string) getenv('FRACO_SENHA')]);
        igual($codigo, 200, 'login da conta de senha fraca');
        return [$c, (bool) $r['usuario']['trocar_senha']];
    };
    [$loja, $obrigado] = $entrar();
    igual($obrigado, true, 'banco da loja: senha fraca obriga a trocar');
    $loja->erro('GET', '/api/resumo', null, 403);
    $admin->ok('POST', '/api/chaves', ['chave' => 'sistema.banco_de_teste', 'escopo' => 'geral', 'valor' => '1']);
    try {
        [$teste, $obrigado] = $entrar();
        igual($obrigado, false, 'banco de teste: entra sem trocar');
        $teste->ok('GET', '/api/sessao');
    } finally {
        $admin->ok('POST', '/api/chaves', ['chave' => 'sistema.banco_de_teste', 'escopo' => 'geral', 'valor' => null]);
    }
    igual($entrar()[1], true, 'regra desligada de novo: volta a obrigar');
});

caso('dados\\homologacao.php: p / p admin, banco de teste (mesmo com a empresa desligando so para ela) e fiscal em homologacao; '
     . 'de novo nao muda nada; o banco da pasta so com --banco-da-pasta', function () {
    require_once dirname(__DIR__) . '/api/nucleo.php';   // abrirSqlite, conferirSenha
    $raiz = dirname(__DIR__);
    $pasta = sys_get_temp_dir() . DIRECTORY_SEPARATOR . 'greenfit-homologacao-' . getmypid();
    $antes = getenv('GREENFIT_BACKUPS');
    putenv('GREENFIT_BACKUPS=' . $pasta . DIRECTORY_SEPARATOR . 'backups');
    $roda = function (string ...$args) use ($raiz): array {
        exec('"' . PHP_BINARY . '" "' . $raiz . '/dados/homologacao.php" ' . implode(' ', array_map('escapeshellarg', $args)) . ' 2>&1', $saida, $rc);
        return [$rc, implode("\n", $saida)];
    };
    try {
        // A trava vem antes de abrir qualquer coisa: o banco da pasta nem e tocado.
        [$rc, $txt] = $roda($raiz . DIRECTORY_SEPARATOR . 'dados' . DIRECTORY_SEPARATOR . 'index.sqlite');
        verdade($rc === 1 && str_contains($txt, 'banco desta pasta'), 'banco da pasta sem confirmar: recusado: ' . $txt);

        $outro = bancoNovoTemporario($pasta);
        $pdo = abrirSqlite($outro);
        $pdo->exec("INSERT INTO empresa_fiscal (empresa_id, ambiente) VALUES (1, 'producao')");
        $pdo->exec("INSERT INTO chaves_empresa (empresa_id, chave, valor) VALUES (1, 'sistema.banco_de_teste', '0')");
        $pdo = null;
        [$rc, $txt] = $roda($outro);
        igual($rc, 0, 'homologacao rodou: ' . $txt);
        $pdo = abrirSqlite($outro);
        $p = $pdo->query("SELECT * FROM usuarios WHERE usuario = 'p'")->fetch();
        igual([$p['perfil'], (int) $p['ativo'], (int) $p['trocar_senha'], conferirSenha('p', $p['senha_hash'])],
              ['admin', 1, 0, true], 'usuario p');
        igual([$pdo->query("SELECT valor FROM chaves_geral WHERE chave = 'sistema.banco_de_teste'")->fetchColumn(),
               (int) $pdo->query("SELECT COUNT(*) FROM chaves_empresa WHERE chave = 'sistema.banco_de_teste'")->fetchColumn(),
               $pdo->query('SELECT ambiente FROM empresa_fiscal WHERE empresa_id = 1')->fetchColumn()],
              ['1', 0, 'homologacao'], 'regra geral ligada, excecao da empresa fora, fiscal em homologacao');
        igual([(int) $pdo->query("SELECT COUNT(*) FROM chaves_historico WHERE chave = 'sistema.banco_de_teste' AND usuario_id = {$p['id']}")->fetchColumn(),
               (int) $pdo->query("SELECT COUNT(*) FROM empresa_fiscal_historico WHERE campo = 'ambiente' AND depois = 'homologacao' AND usuario_id = {$p['id']}")->fetchColumn()],
              [2, 1], 'historico em nome do p (regra geral + excecao; ambiente fiscal)');
        $pdo = null;
        [$rc, $txt] = $roda($outro);
        verdade($rc === 0 && str_contains($txt, 'nada a mudar'), 'de novo: nada a mudar: ' . $txt);
    } finally {
        putenv($antes === false ? 'GREENFIT_BACKUPS' : 'GREENFIT_BACKUPS=' . $antes);
        foreach (array_merge(glob($pasta . '/backups/*') ?: [], glob($pasta . '/*.sqlite*') ?: []) as $f) {
            @unlink($f);
        }
        @rmdir($pasta . '/backups');
        @rmdir($pasta);
    }
});

caso('cadastros: insumos na unidade base, categorias e bairros de semente', function () use ($admin, &$ids) {
    $ids['frango'] = $admin->ok('POST', '/api/insumos', ['nome' => 'Peito de frango', 'categoria' => 'proteina', 'unidade' => 'g', 'estoque_minimo' => 2000])['id'];
    $ids['batata'] = $admin->ok('POST', '/api/insumos', ['nome' => 'Batata-doce', 'categoria' => 'carboidrato', 'unidade' => 'g', 'estoque_minimo' => 1000])['id'];
    $ids['pote'] = $admin->ok('POST', '/api/insumos', ['nome' => 'Pote 500 ml', 'categoria' => 'embalagem', 'unidade' => 'un', 'estoque_minimo' => 20])['id'];
    $erro = $admin->erro('POST', '/api/insumos', ['nome' => 'peito de FRANGO'], 400);
    verdade(str_contains($erro, 'Já existe'), 'insumo repetido (sem acento/caixa) e recusado: ' . $erro);
    $cat = array_column($admin->ok('GET', '/api/categorias')['itens'], 'id', 'nome');
    verdade(isset($cat['Marmitas fit']), 'categoria Marmitas fit semeada');
    $ids['cat_marmitas'] = $cat['Marmitas fit'];
    $ids['cat_bowls'] = $cat['Bowls e saladas'];
    $bairros = array_column($admin->ok('GET', '/api/bairros')['itens'], null, 'nome');
    igual((float) $bairros['Ingleses']['taxa'], 6.0, 'taxa de Ingleses');
    $ids['ingleses'] = (int) $bairros['Ingleses']['id'];
    $formas = array_column($admin->ok('GET', '/api/formas-pagamento')['itens'], 'id', 'nome');
    $ids['dinheiro'] = $formas['Dinheiro'];
    $ids['pix'] = $formas['Pix'];
});

caso('entradas de insumos: dois lotes de frango com validades diferentes', function () use ($admin, &$ids, $dias) {
    $ids['frango_a'] = $admin->ok('POST', '/api/entradas', ['tipo' => 'insumo', 'insumo_id' => $ids['frango'], 'quantidade' => 2000,
        'custo_total' => 64.00, 'validade' => $dias(3), 'gerar_conta_pagar' => 'pago', 'forma_pagamento_id' => $ids['pix']])['id'];
    $ids['frango_b'] = $admin->ok('POST', '/api/entradas', ['tipo' => 'insumo', 'insumo_id' => $ids['frango'], 'quantidade' => 3000,
        'custo_total' => 105.00, 'validade' => $dias(6)])['id'];
    $ids['batata_a'] = $admin->ok('POST', '/api/entradas', ['tipo' => 'insumo', 'insumo_id' => $ids['batata'], 'quantidade' => 5000, 'custo_total' => 40.00])['id'];
    $admin->ok('POST', '/api/entradas', ['tipo' => 'insumo', 'insumo_id' => $ids['pote'], 'quantidade' => 100, 'custo_total' => 50.00]);
    $e = $admin->ok('GET', '/api/entradas/' . $ids['frango_a'])['entrada'];
    igual($e['custo_unitario'], 0.032, 'custo por grama do lote A');
    igual($e['saldo'], 2000, 'saldo do lote A');
    $l = $admin->ok('GET', '/api/lancamentos?status=pago')['itens'];
    verdade((bool) array_filter($l, fn ($x) => (float) $x['valor'] === 64.0 && $x['tipo'] === 'pagar'), 'compra paga virou conta paga de 64,00');
});

caso('cardapio: grupos de adicionais e prato com ficha tecnica, selos e nutricao', function () use ($admin, &$ids) {
    $g1 = $admin->ok('POST', '/api/grupos-adicionais', ['nome' => 'Turbine seu prato', 'minimo' => 0, 'maximo' => 2, 'adicionais' => [
        ['nome' => 'Ovo cozido', 'preco' => 3.00, 'kcal' => 70, 'proteinas' => 6],
        ['nome' => 'Porção extra de frango', 'preco' => 8.00, 'kcal' => 165, 'proteinas' => 31]]]);
    $g2 = $admin->ok('POST', '/api/grupos-adicionais', ['nome' => 'Escolha o molho', 'minimo' => 1, 'maximo' => 1, 'adicionais' => [
        ['nome' => 'Mostarda e mel', 'preco' => 0, 'kcal' => 40], ['nome' => 'Iogurte com ervas', 'preco' => 0, 'kcal' => 30]]]);
    $ids['g_turbine'] = $g1['id'];
    $ids['g_molho'] = $g2['id'];
    $grupos = array_column($admin->ok('GET', '/api/grupos-adicionais')['itens'], null, 'id');
    $op = fn ($g, $nome) => array_values(array_filter($grupos[$g]['adicionais'], fn ($a) => $a['nome'] === $nome))[0]['id'];
    $ids['ovo'] = $op($ids['g_turbine'], 'Ovo cozido');
    $ids['mostarda'] = $op($ids['g_molho'], 'Mostarda e mel');
    $ids['iogurte'] = $op($ids['g_molho'], 'Iogurte com ervas');

    $ids['pratoA'] = $admin->ok('POST', '/api/pratos', [
        'nome' => 'Frango grelhado com batata-doce', 'categoria_id' => $ids['cat_marmitas'], 'preco' => 29.90, 'porcao_g' => 350,
        'kcal' => 420, 'proteinas' => 38, 'carboidratos' => 45, 'gorduras' => 8, 'validade_dias' => 4,
        'tags' => ['high_protein', 'sem_gluten'], 'conservacao' => 'resfriado',
        'ficha' => [['insumo_id' => $ids['frango'], 'quantidade' => 150], ['insumo_id' => $ids['batata'], 'quantidade' => 200],
                    ['insumo_id' => $ids['pote'], 'quantidade' => 1]],
        'grupos' => [$ids['g_turbine'], $ids['g_molho']]])['id'];
    $ids['pratoB'] = $admin->ok('POST', '/api/pratos', [
        'nome' => 'Salada Caesar fit', 'categoria_id' => $ids['cat_bowls'], 'preco' => 27.00, 'kcal' => 310, 'proteinas' => 28,
        'feito_na_hora' => 1, 'ficha' => [['insumo_id' => $ids['frango'], 'quantidade' => 100]]])['id'];
    $erro = $admin->erro('POST', '/api/pratos', ['nome' => 'Promo errada', 'preco' => 20, 'preco_promocional' => 25], 400);
    verdade(str_contains($erro, 'menor que o preço'), 'promocional maior que o preco e recusado');
    $p = $admin->ok('GET', '/api/pratos/' . $ids['pratoA'])['prato'];
    igual($p['tags'], ['high_protein', 'sem_gluten'], 'selos');
    igual(count($p['ficha']), 3, 'ficha com 3 insumos');
    igual($p['disponivel'], 0, 'sem producao, sem estoque');
});

caso('producao: baixa pelo lote que vence primeiro e cria o lote do prato', function () use ($admin, &$ids, $dias) {
    $r = $admin->ok('POST', '/api/producoes', ['prato_id' => $ids['pratoA'], 'quantidade' => 10, 'concluir' => 1]);
    $ids['prod1'] = $r['id'];
    $pr = $admin->ok('GET', '/api/producoes/' . $ids['prod1'])['producao'];
    igual($pr['status'], 'concluida', 'status');
    // 1500 g de frango do lote A (0,032) = 48,00 + 2000 g de batata (0,008) = 16,00 + 10 potes (0,50) = 5,00
    igual($pr['custo_total'], 69.0, 'custo da producao');
    igual($pr['validade'], $dias(4), 'validade = hoje + 4 dias');
    $lotes = array_column($pr['consumo'], 'entrada_id');
    verdade(in_array($ids['frango_a'], $lotes, true) && !in_array($ids['frango_b'], $lotes, true), 'frango saiu so do lote A (vence antes)');
    igual($admin->ok('GET', '/api/entradas/' . $ids['frango_a'])['entrada']['saldo'], 500, 'lote A ficou com 500 g');
    $i = $admin->ok('GET', '/api/insumos/' . $ids['frango'])['item'];
    igual($i['saldo'], 3500, 'frango total 3500 g');
    $p = $admin->ok('GET', '/api/pratos/' . $ids['pratoA'])['prato'];
    igual($p['disponivel'], 10, '10 porcoes prontas');
});

caso('producao sem insumo suficiente e recusada e nada e gravado', function () use ($admin, &$ids) {
    $erro = $admin->erro('POST', '/api/producoes', ['prato_id' => $ids['pratoA'], 'quantidade' => 40, 'concluir' => 1], 400);
    verdade(str_contains($erro, 'Estoque insuficiente de "'), 'mensagem: ' . $erro);
    igual($admin->ok('GET', '/api/insumos/' . $ids['frango'])['item']['saldo'], 3500, 'frango nao mudou');
    $erro = $admin->erro('POST', '/api/producoes', ['prato_id' => $ids['pratoB'], 'quantidade' => 5], 400);
    verdade(str_contains($erro, 'feito na hora'), 'prato feito na hora nao tem producao');
});

caso('PDV: venda de 2 porcoes e de um prato feito na hora', function () use ($admin, &$ids) {
    $v = $admin->ok('POST', '/api/vendas', ['itens' => [['prato_id' => $ids['pratoA'], 'quantidade' => 2]], 'forma_pagamento_id' => $ids['dinheiro']]);
    igual($v['total'], 59.8, 'total');
    $venda = $admin->ok('GET', '/api/vendas/' . $v['id'])['venda'];
    igual((float) $venda['custo_total'], 13.8, 'custo = 2 x 6,90 do lote');
    igual($venda['lancamentos'][0]['status'], 'pago', 'a vista no balcao nasce recebida');
    igual($admin->ok('GET', '/api/pratos/' . $ids['pratoA'])['prato']['disponivel'], 8, 'restam 8');
    $v2 = $admin->ok('POST', '/api/vendas', ['itens' => [['prato_id' => $ids['pratoB'], 'quantidade' => 1]], 'forma_pagamento_id' => $ids['pix']]);
    igual($v2['total'], 27.0, 'salada');
    $venda2 = $admin->ok('GET', '/api/vendas/' . $v2['id'])['venda'];
    igual($venda2['lista_itens'][0]['entrada_id'], null, 'feito na hora nao tem lote');
    // custo teorico: 100 g x custo medio do frango com saldo ((500 x 0,032 + 3000 x 0,035) / 3500)
    igual((float) $venda2['custo_total'], 3.46, 'custo pela ficha tecnica');
});

caso('loja online: ajustes, horario, cupom e cardapio publico', function () use ($admin, $cliente, &$ids) {
    $erro = $admin->erro('PUT', '/api/loja-ajustes', ['aberta' => 1, 'aceita_pix' => 1, 'chave_pix' => ''], 400);
    verdade(str_contains($erro, 'chave Pix') || str_contains($erro, 'retirada'), 'abrir sem chave/endereco e recusado: ' . $erro);
    $admin->ok('PUT', '/api/loja-ajustes', ['aberta' => 1, 'chave_pix' => 'pix@greenfit.com.br', 'recebedor_pix' => 'Green Fit',
        'endereco_retirada' => 'Rua das Gaivotas, 100 - Ingleses', 'whatsapp' => '(48) 99209-2237', 'cashback_percentual' => 5,
        'pedido_minimo' => 20, 'frete_gratis_acima' => 0]);
    $admin->ok('PUT', '/api/horarios', ['horarios' => array_map(fn ($d) => ['dia' => $d, 'aberto' => 1, 'abre' => '00:00', 'fecha' => '23:59'], range(0, 6))]);
    $admin->ok('POST', '/api/cupons', ['codigo' => 'bemvindo10', 'tipo' => 'percentual', 'valor' => 10, 'primeira_compra' => 1]);
    $v = $cliente->ok('GET', '/api/loja/vitrine');
    igual($v['loja']['aberta_agora'], true, 'loja aberta agora');
    $pratos = array_column($v['pratos'], null, 'id');
    igual($pratos[$ids['pratoA']]['disponivel'], 8, 'cliente ve 8 porcoes');
    igual($pratos[$ids['pratoB']]['disponivel'], null, 'feito na hora: sem limite');
    verdade(!isset($pratos[$ids['pratoA']]['custo_porcao']), 'cliente nao ve custo');
    igual(count($pratos[$ids['pratoA']]['grupos']), 2, 'grupos de adicionais na vitrine');
});

caso('cliente cria conta com meta e monta o carrinho com adicionais e cupom', function () use ($cliente, &$ids) {
    $cliente->ok('POST', '/api/loja/conta', ['nome' => 'Ana Teste', 'email' => 'ana@teste.com', 'telefone' => '(48) 99999-0000',
        'senha' => 'Salada-Verde-2026', 'objetivo' => 'emagrecer', 'meta_kcal' => 1800]);
    $erro = $cliente->erro('POST', '/api/loja/carrinho', ['itens' => [['prato_id' => $ids['pratoA'], 'quantidade' => 1, 'adicionais' => [$ids['ovo']]]]], 400);
    verdade(str_contains($erro, 'Escolha o molho'), 'molho obrigatorio: ' . $erro);
    $c = $cliente->ok('POST', '/api/loja/carrinho', ['itens' => [['prato_id' => $ids['pratoA'], 'quantidade' => 2,
        'adicionais' => [$ids['ovo'], $ids['mostarda']]]], 'tipo_entrega' => 'entrega', 'bairro_id' => $ids['ingleses'], 'cupom' => 'BEMVINDO10'])['carrinho'];
    igual($c['linhas'][0]['unitario'], 32.9, 'prato + ovo');
    igual($c['produtos'], 65.8, 'produtos');
    igual($c['taxa'], 6.0, 'taxa de Ingleses');
    igual($c['desconto'], 6.58, '10% dos pratos');
    igual($c['total'], 65.22, 'total');
    igual($c['nutricao']['kcal'], 1060, 'kcal: (420 + 70 + 40) x 2');
});

caso('pedido Pix reserva as porcoes; o PDV respeita a reserva', function () use ($admin, $cliente, &$ids) {
    $r = $cliente->ok('POST', '/api/loja/encomendas', ['itens' => [['prato_id' => $ids['pratoA'], 'quantidade' => 2,
        'adicionais' => [$ids['ovo'], $ids['mostarda']], 'observacao' => 'sem cebola']], 'tipo_entrega' => 'entrega',
        'endereco' => ['destinatario' => 'Ana', 'logradouro' => 'Rua das Gaivotas', 'numero' => '10', 'bairro_id' => $ids['ingleses']],
        'pagamento' => 'pix', 'cupom' => 'BEMVINDO10']);
    $ids['enc1'] = $r['id'];
    $e = $cliente->ok('GET', '/api/loja/encomendas/' . $ids['enc1'])['encomenda'];
    igual($e['status'], 'aguardando_pagamento', 'aguarda o Pix');
    igual($e['pix']['chave'], 'pix@greenfit.com.br', 'chave Pix para o cliente');
    igual($e['itens'][0]['observacao'], 'sem cebola', 'observacao do prato');
    $p = $admin->ok('GET', '/api/pratos/' . $ids['pratoA'])['prato'];
    igual([$p['reservado'], $p['vendavel']], [2, 6], 'reservado 2, vendavel 6');
    $erro = $admin->erro('POST', '/api/vendas', ['itens' => [['prato_id' => $ids['pratoA'], 'quantidade' => 7]]], 400);
    verdade(str_contains($erro, 'reservadas'), 'PDV nao vende a reserva: ' . $erro);
});

caso('a loja confirma o Pix, prepara e entrega; o cliente ganha cashback', function () use ($admin, $cliente, &$ids) {
    $r = $admin->ok('POST', '/api/encomendas/' . $ids['enc1'] . '/confirmar', []);
    $venda = $admin->ok('GET', '/api/vendas/' . $r['venda_id'])['venda'];
    igual((float) $venda['valor_bruto'], 71.8, 'bruto = pratos + taxa');
    igual((float) $venda['desconto'], 6.58, 'desconto do cupom');
    igual((float) $venda['valor_total'], 65.22, 'total');
    igual($venda['origem'], 'loja', 'venda da loja');
    igual($venda['lancamentos'][0]['status'], 'pago', 'Pix nasce recebido');
    igual($admin->ok('GET', '/api/pratos/' . $ids['pratoA'])['prato']['disponivel'], 6, 'estoque baixou 2');
    $erro = $admin->erro('POST', '/api/encomendas/' . $ids['enc1'] . '/avancar', ['para' => 'entregue'], 409);
    verdade($erro !== '', 'pular passo e recusado');
    foreach (['em_preparo', 'pronto', 'saiu_entrega', 'entregue'] as $passo) {
        igual($admin->ok('POST', '/api/encomendas/' . $ids['enc1'] . '/avancar', ['para' => $passo])['status'], $passo, 'passo ' . $passo);
    }
    // (65,80 - 6,58) x 5% = 2,961
    igual($cliente->ok('GET', '/api/loja/sessao')['conta']['cashback'], 2.96, 'cashback creditado');
    $cliente->ok('POST', '/api/loja/encomendas/' . $ids['enc1'] . '/avaliar', ['nota' => 5, 'comentario' => 'Delicioso!']);
    $erro = $cliente->erro('POST', '/api/loja/carrinho', ['itens' => [['prato_id' => $ids['pratoB'], 'quantidade' => 1]], 'cupom' => 'BEMVINDO10'], 400);
    verdade(str_contains($erro, 'já usou') || str_contains($erro, 'primeira'), 'cupom de primeira compra nao repete');
});

caso('retirada com cartao na entrega e cashback: a conta baixa ao entregar', function () use ($admin, $cliente, &$ids) {
    $r = $cliente->ok('POST', '/api/loja/encomendas', ['itens' => [['prato_id' => $ids['pratoB'], 'quantidade' => 1],
        ['prato_id' => $ids['pratoA'], 'quantidade' => 1, 'adicionais' => [$ids['iogurte']]]], 'tipo_entrega' => 'retirada',
        'pagamento' => 'cartao_entrega', 'usar_cashback' => 1]);
    $e = $cliente->ok('GET', '/api/loja/encomendas/' . $r['id'])['encomenda'];
    igual($e['status'], 'aguardando_aceite', 'aguarda a loja aceitar');
    igual($e['cashback_usado'], 2.96, 'usou todo o cashback');
    igual($e['valor_total'], 53.94, '27,00 + 29,90 - 2,96');
    $c = $admin->ok('POST', '/api/encomendas/' . $r['id'] . '/confirmar', []);
    $venda = $admin->ok('GET', '/api/vendas/' . $c['venda_id'])['venda'];
    igual($venda['lancamentos'][0]['status'], 'pendente', 'na entrega: a receber');
    igual($venda['forma_pagamento'], 'Cartão na entrega', 'forma');
    foreach (['em_preparo', 'pronto', 'entregue'] as $passo) {
        $admin->ok('POST', '/api/encomendas/' . $r['id'] . '/avancar', ['para' => $passo]);
    }
    $venda = $admin->ok('GET', '/api/vendas/' . $c['venda_id'])['venda'];
    igual($venda['lancamentos'][0]['status'], 'pago', 'entregue: recebido');
});

caso('cliente cancela pedido ainda nao confirmado e a reserva cai', function () use ($admin, $cliente, &$ids) {
    $r = $cliente->ok('POST', '/api/loja/encomendas', ['itens' => [['prato_id' => $ids['pratoA'], 'quantidade' => 3,
        'adicionais' => [$ids['mostarda']]]], 'tipo_entrega' => 'retirada', 'pagamento' => 'pix']);
    igual($admin->ok('GET', '/api/pratos/' . $ids['pratoA'])['prato']['reservado'], 3, 'reservou 3');
    $cliente->ok('POST', '/api/loja/encomendas/' . $r['id'] . '/cancelar', []);
    igual($admin->ok('GET', '/api/pratos/' . $ids['pratoA'])['prato']['reservado'], 0, 'reserva liberada');
    $erro = $admin->erro('POST', '/api/encomendas/' . $r['id'] . '/confirmar', [], 409);
    verdade(str_contains($erro, 'cancelado'), 'cancelado nao confirma');
});

caso('pedido ja vendido cancelado pela loja: estoque volta e o recebido e estornado', function () use ($admin, $cliente, &$ids) {
    $r = $cliente->ok('POST', '/api/loja/encomendas', ['itens' => [['prato_id' => $ids['pratoA'], 'quantidade' => 1,
        'adicionais' => [$ids['mostarda']]]], 'tipo_entrega' => 'retirada', 'pagamento' => 'pix']);
    $admin->ok('POST', '/api/encomendas/' . $r['id'] . '/confirmar', []);
    $antes = $admin->ok('GET', '/api/pratos/' . $ids['pratoA'])['prato']['disponivel'];
    $admin->ok('POST', '/api/encomendas/' . $r['id'] . '/cancelar', ['motivo' => 'Cliente desistiu por telefone']);
    igual($admin->ok('GET', '/api/pratos/' . $ids['pratoA'])['prato']['disponivel'], $antes + 1, 'porcao voltou');
    $e = $cliente->ok('GET', '/api/loja/encomendas/' . $r['id'])['encomenda'];
    igual($e['status'], 'cancelada', 'cliente ve cancelado');
});

caso('perdas e vencidos: baixa por perda, lote vencido nao vende e sai num clique', function () use ($admin, &$ids, $dias) {
    $admin->ok('POST', '/api/movimentacoes', ['entrada_id' => $ids['batata_a'], 'motivo' => 'perda', 'quantidade' => 500]);
    igual($admin->ok('GET', '/api/entradas/' . $ids['batata_a'])['entrada']['saldo'], 2500, 'batata 3000 - 500');
    $brocolis = $admin->ok('POST', '/api/insumos', ['nome' => 'Brócolis', 'categoria' => 'legume_verdura'])['id'];
    $admin->ok('POST', '/api/entradas', ['tipo' => 'insumo', 'insumo_id' => $brocolis, 'quantidade' => 1000, 'custo_total' => 12.00, 'validade' => $dias(-1)]);
    $r = $admin->ok('GET', '/api/resumo');
    igual($r['cards']['lotes_vencidos'], 1, 'um lote vencido no painel');
    igual($admin->ok('GET', '/api/insumos/' . $brocolis)['item']['saldo'], 0, 'vencido nao conta como disponivel');
    igual($admin->ok('POST', '/api/movimentacoes', ['baixar_vencidos' => 1])['baixados'], 1, 'baixou 1 lote');
    igual($admin->ok('GET', '/api/resumo')['cards']['lotes_vencidos'], 0, 'nada vencido');
    $fin = $admin->ok('GET', '/api/financeiro');
    igual($fin['perdas'], 16.0, 'perdas: 500 g batata (4,00) + brocolis vencido (12,00)');
});

caso('cancelar producao concluida devolve os insumos (lote inteiro)', function () use ($admin, &$ids) {
    $antes = $admin->ok('GET', '/api/insumos/' . $ids['frango'])['item']['saldo'];
    $r = $admin->ok('POST', '/api/producoes', ['prato_id' => $ids['pratoA'], 'quantidade' => 4, 'concluir' => 1]);
    igual($admin->ok('GET', '/api/insumos/' . $ids['frango'])['item']['saldo'], $antes - 600, 'baixou 4 x 150 g');
    $admin->ok('POST', '/api/producoes/' . $r['id'] . '/cancelar', ['motivo' => 'Lançada em duplicidade']);
    igual($admin->ok('GET', '/api/insumos/' . $ids['frango'])['item']['saldo'], $antes, 'frango voltou');
});

caso('pedido de entrada: 2,5 KG na nota x fator 1000 = 2500 g no estoque', function () use ($admin, &$ids, $dias) {
    $forn = $admin->ok('POST', '/api/fornecedores', ['nome' => 'Avícola Ilha', 'uf' => 'SC'])['id'];
    $nat = array_column($admin->ok('GET', '/api/naturezas')['itens'], 'id', 'codigo');
    $p = $admin->ok('POST', '/api/pedidos', ['natureza_id' => $nat['COMPRA_INSUMO'], 'fornecedor_id' => $forn, 'itens' => [[
        'tipo_item' => 'insumo', 'insumo_id' => $ids['frango'], 'descricao' => 'FILE DE PEITO CONGELADO', 'codigo_fornecedor' => 'F-77',
        'quantidade' => '2,5', 'unidade' => 'KG', 'fator' => 1000, 'valor_total' => 87.50, 'validade' => $dias(30)]]]);
    $antes = $admin->ok('GET', '/api/insumos/' . $ids['frango'])['item']['saldo'];
    $admin->ok('POST', '/api/pedidos/' . $p['id'] . '/confirmar', []);
    igual($admin->ok('GET', '/api/insumos/' . $ids['frango'])['item']['saldo'], $antes + 2500, '+2500 g');
    $pedido = $admin->ok('GET', '/api/pedidos/' . $p['id'])['pedido'];
    igual((float) $pedido['lancamentos'][0]['valor'], 87.5, 'conta a pagar da nota');
    igual($pedido['lancamentos'][0]['status'], 'pendente', 'sem "Já paguei" a conta fica a pagar');
    // O Estoque mostra de qual entrada veio cada lote (e abre o documento).
    $lote = array_values(array_filter($admin->ok('GET', '/api/entradas?insumo_id=' . $ids['frango'])['itens'],
        fn ($e) => (int) $e['id'] === (int) $pedido['lista_itens'][0]['entrada_id']))[0];
    igual([(int) $lote['pedido_id'], $lote['pedido']], [(int) $p['id'], $pedido['numero']], 'lote aponta para a entrada');
    igual($admin->ok('GET', '/api/entradas/' . $lote['id'])['entrada']['pedido_id'], (int) $p['id'], 'o lote sozinho tambem');
});

caso('entrada digitada com "Já paguei": a conta nasce paga, com a data de hoje', function () use ($admin, &$ids, $dias) {
    $nat = array_column($admin->ok('GET', '/api/naturezas')['itens'], 'id', 'codigo');
    // Compra sempre tem fornecedor (a natureza exige: e o emitente da nota). A feira vira um fornecedor.
    $feira = $admin->ok('POST', '/api/fornecedores', ['nome' => 'Feira do Rio Vermelho', 'uf' => 'SC'])['id'];
    $p = $admin->ok('POST', '/api/pedidos', ['natureza_id' => $nat['COMPRA_INSUMO'], 'fornecedor_id' => $feira, 'itens' => [[
        'tipo_item' => 'insumo', 'insumo_id' => $ids['batata'], 'descricao' => 'Batata-doce (feira)',
        'quantidade' => '3', 'unidade' => 'KG', 'fator' => 1000, 'valor_total' => 21.00]]]);
    $r = $admin->ok('POST', '/api/pedidos/' . $p['id'] . '/confirmar', ['pago' => 1]);
    verdade(str_contains($r['mensagem'], 'já paga'), 'a mensagem diz que a conta ja foi paga: ' . $r['mensagem']);
    $l = $admin->ok('GET', '/api/pedidos/' . $p['id'])['pedido']['lancamentos'];
    igual([count($l), $l[0]['status'], substr((string) $l[0]['data_pagamento'], 0, 10)], [1, 'pago', date('Y-m-d')], 'uma conta, paga hoje');
});

caso('permissoes: a cozinha opera sem ver custo nem financeiro', function () use ($admin, $base, &$ids) {
    $admin->ok('POST', '/api/usuarios', ['usuario' => 'cozinha1', 'nome' => 'Chef', 'perfil' => 'cozinha', 'senha' => 'Panela-Quente-77']);
    $coz = new Cliente($base);
    [$c] = $coz->post('/api/login', ['usuario' => 'cozinha1', 'senha' => 'Panela-Quente-77']);
    verdade($c === 200, 'cozinha entra');
    $coz->post('/api/trocar-senha', ['senha_atual' => 'Panela-Quente-77', 'senha_nova' => 'Forno-Lenha-2026']);
    $coz->erro('GET', '/api/financeiro', null, 403);
    $coz->erro('DELETE', '/api/pratos/' . $ids['pratoA'], null, 403);
    $p = $coz->ok('GET', '/api/pratos/' . $ids['pratoA'])['prato'];
    verdade(!array_key_exists('custo_porcao', $p), 'cozinha nao ve custo do prato');
    $quadro = $coz->ok('GET', '/api/encomendas?quadro=1');
    verdade(is_array($quadro['itens']), 'cozinha ve o quadro de pedidos');
    $erro = $coz->erro('POST', '/api/pratos', ['nome' => 'Novo', 'preco' => 10], 403);
    verdade(str_contains($erro, 'preço'), 'so o admin define preco');
});

caso('relatorios e paineis respondem com a origem balcao x loja', function () use ($admin) {
    $rel = $admin->ok('GET', '/api/relatorios');
    $lojaReceita = array_sum(array_map(fn ($d) => $d['receita_loja'], $rel['diario']));
    $balcao = array_sum(array_map(fn ($d) => $d['receita_balcao'], $rel['diario']));
    igual(round($lojaReceita, 2), round(65.22 + 53.94, 2), 'receita da loja (o pedido cancelado nao conta)');
    igual(round($balcao, 2), round(59.80 + 27.00, 2), 'receita do balcao');
    $admin->ok('GET', '/api/pdv-painel');
    $admin->ok('GET', '/api/config');
});

fim();
