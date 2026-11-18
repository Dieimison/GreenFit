<?php
/**
 * api/rotas/painel.php - /resumo (a cozinha e o estoque hoje), /pdv-painel,
 * /financeiro e /relatorios.
 *
 * Receita e custo saem SEMPRE da view vw_receitas (e os itens vendidos de
 * vw_itens_faturados). As duas leem vw_faturamentos, o unico lugar que
 * decide o que e faturamento e se veio do balcao ou da loja online.
 * Consulta nova de receita: leia a view; nao escreva o JOIN de novo.
 */

declare(strict_types=1);

/* As saidas que sao prejuizo (custo que se foi sem venda): viram despesa no resultado. */
const MOTIVOS_PERDA = ['vencimento', 'perda', 'degustacao', 'consumo_interno'];

/*
 * A situacao de AGORA, para todos os perfis (sem custo para a equipe):
 * o que esta pronto, o que acaba, o que vence, o que falta comprar e o
 * que a cozinha tem para produzir. A tela le os numeros prontos.
 */
function resumo(array $usuario): array
{
    $admin = $usuario['perfil'] === 'admin';
    $hoje = date('Y-m-d');

    $pratos = array_map(fn ($p) => pratoParaTela($p, $admin), consultar(SQL_PRATOS . ' WHERE p.ativo = 1 ORDER BY c.ordem, p.ordem, p.nome'));
    $comEstoque = array_filter($pratos, fn ($p) => !$p['feito_na_hora']);
    $repor = array_values(array_map(fn ($p) => ['id' => $p['id'], 'nome' => $p['nome'], 'categoria' => $p['categoria'],
        'disponivel' => $p['disponivel'], 'reservado' => $p['reservado'],
        'minimo' => $p['estoque_minimo'] > 0 ? $p['estoque_minimo'] : ESTOQUE_BAIXO, 'vendidos_30d' => $p['vendidos_30d']],
        array_filter($comEstoque, fn ($p) => $p['repor'])));
    usort($repor, fn ($a, $b) => $a['disponivel'] <=> $b['disponivel']);

    $lotes = function (string $condicao) use ($admin): array {
        return array_map(function ($l) use ($admin) {
            $l['saldo'] = (int) $l['saldo'];
            $l['dias_validade'] = (int) $l['dias_validade'];
            $l['custo'] = round((float) $l['custo'], 2);
            if (!$admin) {
                unset($l['custo']);
            }
            return $l;
        }, consultar("SELECT id, tipo, item, unidade, saldo, validade, dias_validade, lote, saldo * custo_unitario AS custo
                        FROM vw_entradas WHERE saldo > 0 AND {$condicao} ORDER BY validade, item"));
    };
    $vencendo = $lotes('dias_validade BETWEEN 0 AND ' . VALIDADE_ALERTA_DIAS);
    $vencidos = $lotes('dias_validade < 0');

    $insumos = array_map(fn ($i) => ['id' => (int) $i['id'], 'nome' => $i['nome'], 'unidade' => $i['unidade'],
                                     'disponivel' => (int) $i['disponivel'], 'minimo' => (int) $i['estoque_minimo']],
        consultar('SELECT i.id, i.nome, i.unidade, i.estoque_minimo, ei.disponivel
                     FROM insumos i JOIN vw_estoque_insumos ei ON ei.insumo_id = i.id
                    WHERE i.ativo = 1 AND i.estoque_minimo > 0 AND ei.disponivel < i.estoque_minimo
                    ORDER BY (ei.disponivel * 1.0 / i.estoque_minimo), i.nome'));

    $producoes = array_map(function ($p) {
        $falta = array_filter(necessidadeDaProducao((int) $p['prato_id'], (int) $p['quantidade'], false), fn ($n) => $n['falta'] > 0);
        return ['id' => (int) $p['id'], 'numero' => $p['numero'], 'prato' => $p['prato'], 'quantidade' => (int) $p['quantidade'],
                'data_producao' => $p['data_producao'], 'atrasada' => $p['data_producao'] < date('Y-m-d'),
                'faltando' => array_values(array_map(fn ($n) => $n['nome'], $falta))];
    }, consultar("SELECT pr.id, pr.numero, pr.prato_id, pr.quantidade, pr.data_producao, p.nome AS prato
                    FROM producoes pr JOIN pratos p ON p.id = pr.prato_id
                   WHERE pr.status = 'planejada' AND pr.data_producao <= ? ORDER BY pr.data_producao, pr.id", [date('Y-m-d', strtotime('+1 day'))]));

    $pedidos = [];
    foreach (consultar('SELECT status, COUNT(*) AS q FROM encomendas WHERE status IN (' . vagas(STATUS_ENCOMENDA_ABERTOS) . ') GROUP BY status',
                       STATUS_ENCOMENDA_ABERTOS) as $l) {
        $pedidos[$l['status']] = (int) $l['q'];
    }
    $vendasHoje = consultarUm("SELECT COUNT(*) AS q, COALESCE(SUM(valor_total), 0) AS t FROM vendas
                                WHERE status = 'concluida' AND substr(data_venda, 1, 10) = ?", [$hoje]);

    $saida = [
        'hoje' => $hoje,
        'cards' => [
            'porcoes_prontas'   => array_sum(array_map(fn ($p) => (int) $p['disponivel'], $comEstoque)),
            'pratos_ativos'     => count($pratos),
            'pratos_sem_estoque' => count(array_filter($comEstoque, fn ($p) => (int) $p['disponivel'] === 0)),
            'pratos_repor'      => count($repor),
            'lotes_vencendo'    => count($vencendo),
            'lotes_vencidos'    => count($vencidos),
            'insumos_em_falta'  => count($insumos),
            'producoes_hoje'    => count($producoes),
            'pedidos_abertos'   => array_sum($pedidos),
            'vendas_hoje'       => (int) $vendasHoje['q'],
            'faturado_hoje'     => round((float) $vendasHoje['t'], 2),
        ],
        'pedidos' => (object) $pedidos,
        'repor' => $repor, 'vencendo' => $vencendo, 'vencidos' => $vencidos, 'insumos' => $insumos, 'producoes' => $producoes,
    ];
    if ($admin) {
        $parado = consultarUm('SELECT COALESCE(SUM(CASE WHEN tipo = \'insumo\' THEN saldo * custo_unitario END), 0) AS insumos,
                                      COALESCE(SUM(CASE WHEN tipo = \'prato\' THEN saldo * custo_unitario END), 0) AS pratos
                                 FROM vw_entradas WHERE saldo > 0');
        $saida['estoque_valor'] = ['insumos' => round((float) $parado['insumos'], 2), 'pratos' => round((float) $parado['pratos'], 2)];
    }
    return $saida;
}

function arredondar(array $linha): array
{
    foreach ($linha as $k => $v) {
        $linha[$k] = is_float($v) ? round($v, 2) : $v;
    }
    return $linha;
}

function financeiro(): array
{
    $est = arredondar(consultarUm(
        "SELECT COALESCE(SUM(saldo * custo_unitario), 0) AS investido_parado,
                COALESCE(SUM(CASE WHEN tipo = 'insumo' THEN saldo * custo_unitario END), 0) AS insumos_parados,
                COALESCE(SUM(CASE WHEN tipo = 'prato' THEN saldo * custo_unitario END), 0) AS pratos_parados,
                COALESCE(SUM(CASE WHEN dias_validade < 0 THEN saldo * custo_unitario END), 0) AS vencido_parado
           FROM vw_entradas WHERE saldo > 0"));
    $prevista = (float) consultarUm(
        "SELECT COALESCE(SUM(e.saldo * CASE WHEN p.preco_promocional > 0 THEN p.preco_promocional ELSE p.preco END), 0) AS v
           FROM vw_entradas e JOIN pratos p ON p.id = e.prato_id
          WHERE e.saldo > 0 AND (e.dias_validade IS NULL OR e.dias_validade >= 0)")['v'];

    $fat = arredondar(consultarUm(
        "SELECT COALESCE(SUM(CASE WHEN origem = 'balcao' THEN receita END), 0) AS receita_balcao,
                COALESCE(SUM(CASE WHEN origem = 'balcao' THEN custo END), 0)   AS custo_balcao,
                COALESCE(SUM(CASE WHEN origem = 'balcao' THEN quantidade END), 0) AS qtd_balcao,
                COALESCE(SUM(CASE WHEN origem = 'loja' THEN receita END), 0)   AS receita_loja,
                COALESCE(SUM(CASE WHEN origem = 'loja' THEN custo END), 0)     AS custo_loja,
                COALESCE(SUM(CASE WHEN origem = 'loja' THEN quantidade END), 0) AS qtd_loja
           FROM vw_receitas"));

    $hoje = date('Y-m-d');
    $lanc = arredondar(consultarUm(
        "SELECT COALESCE(SUM(CASE WHEN tipo='receber' AND status='pendente' THEN valor END), 0) AS a_receber,
                COALESCE(SUM(CASE WHEN tipo='pagar'   AND status='pendente' THEN valor END), 0) AS a_pagar,
                COALESCE(SUM(CASE WHEN tipo='receber' AND status='pago'     THEN valor END), 0) AS recebido,
                COALESCE(SUM(CASE WHEN tipo='pagar'   AND status='pago'     THEN valor END), 0) AS pago,
                COALESCE(SUM(CASE WHEN tipo='receber' AND status='pendente'
                                   AND vencimento IS NOT NULL AND vencimento < ? THEN valor END), 0) AS vencido_receber,
                COALESCE(SUM(CASE WHEN tipo='pagar'   AND status='pendente'
                                   AND vencimento IS NOT NULL AND vencimento < ? THEN valor END), 0) AS vencido_pagar
           FROM lancamentos", [$hoje, $hoje]));

    $mensal = consultar(
        "SELECT substr(dia, 1, 7) AS mes,
                ROUND(COALESCE(SUM(CASE WHEN origem = 'balcao' THEN receita END), 0), 2) AS balcao,
                ROUND(COALESCE(SUM(CASE WHEN origem = 'loja' THEN receita END), 0), 2)   AS loja,
                ROUND(COALESCE(SUM(receita), 0), 2)                                      AS total,
                SUM(quantidade)                                                          AS quantidade
           FROM vw_receitas
          WHERE dia IS NOT NULL
          GROUP BY mes ORDER BY mes DESC LIMIT 12");

    $perdas = round((float) consultarUm('SELECT COALESCE(SUM(valor), 0) AS v FROM movimentacoes WHERE tipo = \'saida\' AND motivo IN ('
        . vagas(MOTIVOS_PERDA) . ')', MOTIVOS_PERDA)['v'], 2);

    return [
        'estoque'        => $est + ['venda_prevista' => round($prevista, 2)],
        'vendas'         => $fat,
        'lancamentos'    => $lanc,
        'mensal'         => $mensal,
        'perdas'         => $perdas,
        'lucro_balcao'   => round($fat['receita_balcao'] - $fat['custo_balcao'], 2),
        'lucro_loja'     => round($fat['receita_loja'] - $fat['custo_loja'], 2),
        'saldo_previsto' => round($lanc['a_receber'] - $lanc['a_pagar'], 2),
    ];
}

/*
 * Series diarias dos graficos. A conta do resultado (receita - custo -
 * despesas) e da tela, sobre a serie diaria. Despesa = lancamento a pagar
 * de origem MANUAL, mais o custo do que se perdeu (vencimento, perda,
 * degustacao, consumo da equipe) - a compra de estoque vira custo quando o
 * prato vende; o que se perde nao vende, entao o custo entra aqui.
 */
const CATEGORIA_PERDA = 'Perdas e cortesias';

function relatorios(): array
{
    $desde = (new DateTimeImmutable(date('Y-m-01')))->modify('-11 months')->format('Y-m-d');

    $porDia = [];
    $noDia = function (string $dia, string $campo, $valor) use (&$porDia): void {
        if ($dia === '') {
            return;
        }
        $porDia[$dia] ??= ['receita_balcao' => 0.0, 'custo_balcao' => 0.0, 'receita_loja' => 0.0,
                           'custo_loja' => 0.0, 'despesas' => 0.0, 'perdas' => 0.0, 'recebido' => 0.0,
                           'pago' => 0.0, 'qtd_balcao' => 0, 'qtd_loja' => 0];
        $porDia[$dia][$campo] += $valor;
    };

    foreach (consultar(
        'SELECT dia, origem, SUM(receita) AS receita, SUM(custo) AS custo, SUM(quantidade) AS quantidade
           FROM vw_receitas WHERE dia >= ? GROUP BY dia, origem', [$desde]) as $l) {
        $o = $l['origem'] === 'loja' ? 'loja' : 'balcao';
        $noDia($l['dia'], 'receita_' . $o, (float) $l['receita']);
        $noDia($l['dia'], 'custo_' . $o, (float) $l['custo']);
        $noDia($l['dia'], 'qtd_' . $o, (int) $l['quantidade']);
    }

    foreach (consultar(
        "SELECT substr(COALESCE(data_pagamento, vencimento), 1, 10) AS dia, COALESCE(SUM(valor), 0) AS total
           FROM lancamentos
          WHERE tipo = 'pagar' AND origem = 'manual' AND status <> 'cancelado'
            AND COALESCE(data_pagamento, vencimento) >= ?
          GROUP BY dia", [$desde]) as $l) {
        $noDia((string) $l['dia'], 'despesas', (float) $l['total']);
    }
    $perdas = consultar(
        'SELECT substr(m.criado_em, 1, 10) AS dia, ROUND(COALESCE(SUM(m.valor), 0), 2) AS total, COUNT(*) AS quantidade
           FROM movimentacoes m
          WHERE m.tipo = \'saida\' AND m.motivo IN (' . vagas(MOTIVOS_PERDA) . ') AND m.criado_em >= ?
          GROUP BY dia', array_merge(MOTIVOS_PERDA, [$desde]));
    foreach ($perdas as $l) {
        $noDia((string) $l['dia'], 'despesas', (float) $l['total']);
        $noDia((string) $l['dia'], 'perdas', (float) $l['total']);
    }

    foreach (consultar(
        "SELECT substr(data_pagamento, 1, 10) AS dia, tipo, COALESCE(SUM(valor), 0) AS total
           FROM lancamentos WHERE status = 'pago' AND data_pagamento >= ? GROUP BY dia, tipo", [$desde]) as $l) {
        $noDia((string) $l['dia'], $l['tipo'] === 'receber' ? 'recebido' : 'pago', (float) $l['total']);
    }

    ksort($porDia);
    $diario = [];
    foreach ($porDia as $dia => $d) {
        $diario[] = ['dia' => $dia] + arredondar($d);
    }

    // O que mais vendeu: linhas por dia/prato/origem; a tela corta e agrupa.
    $itens = consultar(
        'SELECT dia, descricao, tipo, origem, SUM(unidades) AS unidades,
                ROUND(SUM(receita), 2) AS receita, ROUND(SUM(custo), 2) AS custo,
                ROUND(SUM(receita) - SUM(custo), 2) AS lucro
           FROM vw_itens_faturados WHERE dia >= ?
          GROUP BY dia, descricao, tipo, origem', [$desde]);

    $vencendo = consultar(
        "SELECT l.id, l.tipo, l.descricao, l.valor, l.vencimento, l.categoria,
                CAST(julianday(l.vencimento) - julianday(?) AS INTEGER) AS dias,
                COALESCE(c.nome, f.nome) AS quem
           FROM lancamentos l
           LEFT JOIN clientes     c ON c.id = l.cliente_id
           LEFT JOIN fornecedores f ON f.id = l.fornecedor_id
          WHERE l.status = 'pendente' AND l.vencimento IS NOT NULL AND l.vencimento <= ?
          ORDER BY l.vencimento",
        [date('Y-m-d'), date('Y-m-d', strtotime('+' . JANELA_VENCIMENTOS . ' days'))]);

    $pagamentos = consultar(
        'SELECT dia, forma, origem, ROUND(SUM(receita), 2) AS total, SUM(quantidade) AS quantidade
           FROM vw_receitas WHERE dia >= ? GROUP BY dia, forma, origem', [$desde]);

    $despesasPorCategoria = consultar(
        "SELECT substr(COALESCE(data_pagamento, vencimento), 1, 10) AS dia,
                COALESCE(NULLIF(TRIM(categoria), ''), 'Sem categoria') AS categoria,
                ROUND(COALESCE(SUM(valor), 0), 2) AS total, COUNT(*) AS quantidade
           FROM lancamentos
          WHERE tipo = 'pagar' AND origem = 'manual' AND status <> 'cancelado'
            AND COALESCE(data_pagamento, vencimento) >= ?
          GROUP BY dia, categoria", [$desde]);
    foreach ($perdas as $l) {
        $despesasPorCategoria[] = ['dia' => $l['dia'], 'categoria' => CATEGORIA_PERDA, 'total' => $l['total'], 'quantidade' => $l['quantidade']];
    }

    // Dinheiro parado no estoque, por dia de ENTRADA e tipo (insumo x prato pronto).
    $estoque = consultar(
        'SELECT substr(data_entrada, 1, 10) AS dia, tipo, SUM(saldo) AS unidades,
                ROUND(SUM(custo_unitario * saldo), 2) AS investido
           FROM vw_entradas WHERE saldo > 0
          GROUP BY dia, tipo');

    // Pedidos online por dia: quantos, ticket, entrega x retirada, avaliacao.
    $loja = consultar(
        "SELECT substr(criado_em, 1, 10) AS dia, tipo_entrega, COUNT(*) AS pedidos,
                ROUND(COALESCE(SUM(CASE WHEN status <> 'cancelada' THEN valor_total END), 0), 2) AS total,
                ROUND(COALESCE(SUM(CASE WHEN status <> 'cancelada' THEN desconto + cashback_usado END), 0), 2) AS descontos,
                SUM(CASE WHEN status = 'cancelada' THEN 1 ELSE 0 END) AS cancelados,
                ROUND(AVG(avaliacao_nota), 2) AS nota,
                COUNT(avaliacao_nota) AS avaliados, COALESCE(SUM(avaliacao_nota), 0) AS soma_notas
           FROM encomendas WHERE criado_em >= ?
          GROUP BY dia, tipo_entrega", [$desde]);

    return [
        'diario'     => $diario,
        'desde'      => $desde,
        'ate'        => date('Y-m-d'),
        'itens'      => $itens,
        'vencendo'   => $vencendo,
        'estoque'    => $estoque,
        'pagamentos' => $pagamentos,
        'despesas_categoria' => $despesasPorCategoria,
        'loja'       => $loja,
    ];
}

/*
 * A tela de entrada do PDV: o dia de hoje, os pedidos online que pedem
 * atencao e os pratos que estao acabando. Todos os perfis: sem custo.
 */
function painelDoPdv(array $usuario): array
{
    expirarEncomendas();
    $hoje = date('Y-m-d');
    $vendas = consultarUm("SELECT COUNT(*) AS q, COALESCE(SUM(valor_total), 0) AS t FROM vendas
                            WHERE status = 'concluida' AND substr(data_venda, 1, 10) = ?", [$hoje]);
    $pedidos = [];
    foreach (consultar('SELECT status, COUNT(*) AS q FROM encomendas WHERE status IN (' . vagas(STATUS_ENCOMENDA_ABERTOS) . ') GROUP BY status',
                       STATUS_ENCOMENDA_ABERTOS) as $l) {
        $pedidos[$l['status']] = (int) $l['q'];
    }
    $ultimos = array_map(fn ($e) => resumoEncomenda($e) + ['cliente' => $e['cliente']],
        consultar('SELECT e.*, c.nome AS cliente FROM encomendas e JOIN loja_contas c ON c.id = e.conta_id
                    WHERE e.status IN (' . vagas(STATUS_ENCOMENDA_ABERTOS) . ')
                    ORDER BY e.criado_em LIMIT 8', STATUS_ENCOMENDA_ABERTOS));
    $acabando = array_values(array_map(fn ($p) => ['id' => $p['id'], 'nome' => $p['nome'], 'vendavel' => $p['vendavel']],
        array_filter(array_map(fn ($p) => pratoParaTela($p, false), consultar(SQL_PRATOS . ' WHERE p.ativo = 1 AND p.feito_na_hora = 0')),
                     fn ($p) => $p['repor'])));
    return ['hoje' => $hoje, 'vendas_hoje' => ['quantidade' => (int) $vendas['q'], 'total' => round((float) $vendas['t'], 2)],
            'pedidos' => (object) $pedidos, 'ultimos_pedidos' => $ultimos, 'acabando' => array_slice($acabando, 0, 8)];
}
