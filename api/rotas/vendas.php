<?php
/**
 * api/rotas/vendas.php - a saida de pratos (regra comum ao PDV e a loja
 * online) e as vendas: criar, editar (desconto, forma, cliente, cancelar)
 * e excluir.
 *
 * A tela manda o PRATO e a quantidade; quem escolhe o lote e o servidor:
 * o que vence primeiro sai primeiro, vencido nunca (alocarLotes). Um prato
 * vendido de dois lotes vira duas linhas na venda (uma por lote), cada uma
 * com o custo do seu lote - o lucro do relatorio e o de verdade.
 */

declare(strict_types=1);

// ------------------------------------------------------------------
// Saida de pratos (PDV e loja online usam a mesma regra)
// ------------------------------------------------------------------
/*
 * Le e confere as linhas e devolve as linhas JA repartidas por lote:
 *   {prato_id, quantidade, valor_unitario?, adicionais?, descricao?}  prato do cardapio
 *   {descricao, valor_unitario, custo_unitario?}                      avulso (taxa, item digitado)
 * $excetoEncomenda: a encomenda que esta virando venda (a reserva dela nao conta).
 * Cada linha devolvida: entrada_id, prato_id, descricao, adicionais, quantidade,
 * unitario, tabela (o preco do cardapio), custo, subtotal.
 */
function prepararItensDeSaida(array $itens, ?int $excetoEncomenda = null): array
{
    $pedidos = [];
    foreach (array_values($itens) as $n => $item) {
        if (!is_array($item)) {
            throw new ErroApi(400, 'Cada item precisa de um prato do cardápio ou de uma descrição.');
        }
        $quantidade = inteiro($item, 'quantidade', 'Quantidade', 1, 1000, 1);
        $pratoId = idDoCatalogo($item, 'prato_id', null);
        if (!$pratoId) {
            $descricao = txt($item, 'descricao', 'Descrição') ?? '';
            if ($descricao === '') {
                throw new ErroApi(400, 'Linha ' . ($n + 1) . ': escolha um prato do cardápio ou escreva a descrição do item.');
            }
            $pedidos[] = ['avulso' => true, 'descricao' => $descricao, 'quantidade' => $quantidade,
                          'unitario' => dinheiro($item, 'valor_unitario', 'Preço', 0.0),
                          'custo' => dinheiro($item, 'custo_unitario', 'Custo', 0.0)];
            continue;
        }
        $prato = consultarUm(SQL_PRATOS . ' WHERE p.id = ?', [$pratoId]);
        if (!$prato) {
            throw new ErroApi(400, 'Linha ' . ($n + 1) . ': o prato escolhido não existe.');
        }
        if (!(int) $prato['ativo']) {
            throw new ErroApi(400, '"' . $prato['nome'] . '" está desativado no cardápio.');
        }
        // O que os adicionais somam no preco (o PDV manda); nunca negativo: senao a trava de preco da equipe furava.
        $tabela = round(precoDoPrato($prato) + dinheiro($item, 'acrescimo_adicionais', 'Acréscimo dos adicionais', 0.0), 2);
        $pedidos[] = ['avulso' => false, 'prato' => $prato, 'quantidade' => $quantidade,
                      'descricao' => txt($item, 'descricao', 'Descrição') ?? (string) $prato['nome'],
                      'adicionais' => txt($item, 'adicionais', 'Adicionais'),
                      'unitario' => dinheiro($item, 'valor_unitario', 'Preço', $tabela), 'tabela' => $tabela];
    }

    // Confere o total de cada prato contra o que da para vender (somando as linhas).
    $porPrato = [];
    foreach ($pedidos as $p) {
        if (!$p['avulso'] && !(int) $p['prato']['feito_na_hora']) {
            $porPrato[(int) $p['prato']['id']] = ($porPrato[(int) $p['prato']['id']] ?? 0) + $p['quantidade'];
        }
    }
    $usado = [];   // entrada_id => quanto esta venda ja pegou dela
    $lotes = [];
    foreach ($porPrato as $pid => $total) {
        $nome = '';
        foreach ($pedidos as $p) {
            if (!$p['avulso'] && (int) $p['prato']['id'] === $pid) {
                $nome = $p['prato']['nome'];
                break;
            }
        }
        // alocarLotes confere o total (com a reserva da loja) e da a mensagem certa.
        alocarLotes('prato_id', $pid, $total, $nome, 'porcao', reservadoDoPrato($pid, $excetoEncomenda));
        $lotes[$pid] = lotesDisponiveis('prato_id', $pid);
    }

    $linhas = [];
    foreach ($pedidos as $p) {
        if ($p['avulso']) {
            $linhas[] = ['entrada_id' => null, 'prato_id' => null, 'descricao' => $p['descricao'], 'adicionais' => null,
                         'quantidade' => $p['quantidade'], 'unitario' => $p['unitario'], 'tabela' => null, 'custo' => $p['custo'],
                         'subtotal' => round($p['unitario'] * $p['quantidade'], 2), 'item' => $p['descricao']];
            continue;
        }
        $prato = $p['prato'];
        $base = ['prato_id' => (int) $prato['id'], 'descricao' => $p['descricao'], 'adicionais' => $p['adicionais'],
                 'unitario' => $p['unitario'], 'tabela' => $p['tabela'], 'item' => (string) $prato['nome']];
        if ((int) $prato['feito_na_hora']) {
            $linhas[] = $base + ['entrada_id' => null, 'quantidade' => $p['quantidade'],
                                 'custo' => round((float) $prato['custo_porcao'], 4),
                                 'subtotal' => round($p['unitario'] * $p['quantidade'], 2)];
            continue;
        }
        $falta = $p['quantidade'];
        foreach ($lotes[(int) $prato['id']] as $l) {
            $livre = (int) $l['saldo'] - ($usado[(int) $l['id']] ?? 0);
            if ($falta <= 0 || $livre <= 0) {
                continue;
            }
            $tira = min($falta, $livre);
            $usado[(int) $l['id']] = ($usado[(int) $l['id']] ?? 0) + $tira;
            $linhas[] = $base + ['entrada_id' => (int) $l['id'], 'quantidade' => $tira, 'custo' => round((float) $l['custo_unitario'], 4),
                                 'subtotal' => round($p['unitario'] * $tira, 2)];
            $falta -= $tira;
        }
    }
    return $linhas;
}

/* Numero do documento: PREFIXO-AAAA-NNNN, sequencia por ano. */
function proximoNumero(string $tabela, string $prefixo, ?string $data = null): string
{
    if (!in_array($tabela, ['vendas', 'producoes', 'pedidos', 'encomendas'], true)) {
        throw new LogicException('Tabela sem numeracao: ' . $tabela);
    }
    $inicio = $prefixo . '-' . substr($data ?? agora(), 0, 4) . '-';
    $linha  = consultarUm('SELECT COALESCE(MAX(CAST(substr(numero, ?) AS INTEGER)), 0) AS ultimo FROM "' . $tabela . '" WHERE numero LIKE ?',
                          [strlen($inicio) + 1, $inicio . '%']);
    return $inicio . str_pad((string) ((int) $linha['ultimo'] + 1), 4, '0', STR_PAD_LEFT);
}

/*
 * Grava uma venda e as linhas dela: o UNICO INSERT de venda do sistema
 * (PDV e loja online). Quem chama confere o saldo depois (conferirSaldos).
 */
function gravarVenda(array $v, array $linhas): int
{
    executarSql(
        'INSERT INTO vendas (numero, cliente_id, usuario_id, valor_bruto, desconto, valor_total, custo_total,
                             forma_pagamento, forma_pagamento_id, parcelas, status, data_venda, observacoes)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
        [proximoNumero('vendas', 'VD', $v['data']), $v['cliente_id'], $v['usuario_id'], $v['bruto'], $v['desconto'],
         $v['total'], $v['custo'], $v['forma'], $v['forma_id'], $v['parcelas'], 'concluida', $v['data'], $v['observacoes']]);
    $vendaId = (int) banco()->lastInsertId();
    foreach ($linhas as $l) {
        executarSql(
            'INSERT INTO venda_itens (venda_id, entrada_id, prato_id, descricao, adicionais, quantidade, valor_unitario, custo_unitario, subtotal)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
            [$vendaId, $l['entrada_id'], $l['prato_id'] ?? null, $l['descricao'], $l['adicionais'] ?? null, $l['quantidade'],
             $l['unitario'], $l['custo'], $l['subtotal']]);
    }
    return $vendaId;
}

// ------------------------------------------------------------------
// Vendas
// ------------------------------------------------------------------
const SQL_VENDA = "SELECT v.*,
                          (SELECT COUNT(*) FROM lancamentos l
                            WHERE l.venda_id = v.id AND l.tipo = 'receber' AND l.status = 'pago') AS parcelas_pagas
                     FROM vw_vendas v";

/* O que a tela pode oferecer para esta venda. Cancelar venda ja recebida e estorno: so admin. */
function permissoesVenda(array $v, array $usuario): array
{
    $admin = $usuario['perfil'] === 'admin';
    $daLoja = !empty($v['encomenda_numero']);
    $concluida = $v['status'] === 'concluida';
    $paga = (int) ($v['parcelas_pagas'] ?? 0) > 0;
    return $v + [
        'origem'            => $daLoja ? 'loja' : 'balcao',
        'pode_editar_valor' => $concluida && !$daLoja,
        'pode_cancelar'     => $concluida && !$daLoja && (!$paga || $admin),
        'pode_excluir'      => $admin && !$daLoja,
    ];
}

/* Custo e lucro sao do dono: cozinha e atendimento nao recebem. */
function semCusto(array $linha, array $usuario, array $campos = ['custo_total', 'lucro', 'custo_unitario']): array
{
    if ($usuario['perfil'] !== 'admin') {
        foreach ($campos as $c) {
            unset($linha[$c]);
        }
    }
    return $linha;
}

function vendas(?int $id, string $metodo, array $corpo, array $usuario): array
{
    if ($metodo === 'GET') {
        $preparar = fn (array $v) => semCusto(permissoesVenda($v, $usuario), $usuario);
        if ($id) {
            $venda = consultarUm(SQL_VENDA . ' WHERE v.id = ?', [$id]);
            if (!$venda) {
                throw new ErroApi(404, 'Venda não encontrada.');
            }
            $venda = $preparar($venda);
            $venda['lista_itens'] = array_map(fn ($l) => semCusto($l, $usuario),
                consultar('SELECT vi.*, e.lote, e.validade FROM venda_itens vi LEFT JOIN entradas e ON e.id = vi.entrada_id
                            WHERE vi.venda_id = ? ORDER BY vi.id', [$id]));
            $venda['lancamentos'] = array_map(fn ($l) => permissoesLancamento($l, $usuario),
                consultar('SELECT * FROM lancamentos WHERE venda_id = ? ORDER BY parcela, id', [$id]));
            return [200, ['ok' => true, 'venda' => $venda]];
        }
        return [200, ['ok' => true, 'itens' => array_map($preparar, consultar(SQL_VENDA . ' ORDER BY v.data_venda DESC, v.id DESC LIMIT 2000'))]];
    }

    if ($metodo === 'POST') {
        return criarVenda($corpo, $usuario);
    }
    if ($metodo === 'PUT') {
        return atualizarVenda($id, $corpo, $usuario);
    }

    if ($metodo === 'DELETE') {
        $id = exigirId($id);
        return emTransacao(function () use ($id, $usuario) {
            if (!consultarUm('SELECT id FROM vendas WHERE id = ?', [$id])) {
                throw new ErroApi(404, 'Venda não encontrada.');
            }
            $encomenda = consultarUm('SELECT numero FROM encomendas WHERE venda_id = ?', [$id]);
            if ($encomenda) {
                throw new ErroApi(400, 'Esta venda veio do pedido ' . $encomenda['numero'] . ' da loja online e não pode ser '
                    . 'excluída. Para desfazer, cancele o pedido em Pedidos online: a venda é cancelada junto e o cliente vê no app.');
            }
            cancelarLancamentos('venda_id', $id, 'venda excluída', (int) $usuario['id']);
            executarSql('DELETE FROM vendas WHERE id = ?', [$id]);
            return [200, ['ok' => true, 'mensagem' => 'Venda excluída e porções devolvidas ao estoque.']];
        });
    }

    throw new ErroApi(405, 'Método não permitido para /api/vendas.');
}

/* Parcelas inteiras de 1 a PARCELAS_MAX, nenhuma abaixo de R$ 0,01, e "a vista" so com 1. */
function conferirParcelamento(float $total, int $parcelas, bool $pago): void
{
    if ($pago && $parcelas > 1) {
        throw new ErroApi(400, '"Já recebi" vale só para pagamento em 1 parcela. Parcelado, cada '
            . 'parcela fica a receber e recebe baixa no Financeiro quando for paga.');
    }
    if (intdiv(emCentavos($total), $parcelas) < 1) {
        throw new ErroApi(400, sprintf('%s em %d parcelas daria parcela menor que R$ 0,01. Diminua o número de parcelas.',
            moedaBr($total), $parcelas));
    }
}

/*
 * As regras por chave que valem para a venda (Admin > Regras). "Cliente
 * obrigatorio" vale para todos; as outras limitam a equipe - o admin nao
 * tem limite. Conferidas AQUI, no servidor. $linhas null = edicao.
 */
function conferirRegrasDaVenda(array $usuario, float $bruto, float $desconto, ?int $clienteId, ?int $formaId, ?array $linhas): void
{
    if (!$clienteId && chaveLigada('venda.exigir_cliente')) {
        throw new ErroApi(400, 'Escolha o cliente: nesta loja toda venda é feita com o cliente identificado.');
    }
    if ($usuario['perfil'] === 'admin') {
        return;
    }
    $maximo = chaveNumero('venda.desconto_maximo_equipe');
    if ($maximo < 100 && emCentavos($desconto) > emCentavos($bruto * $maximo / 100)) {
        throw new ErroApi(403, sprintf('Desconto acima do permitido para o seu perfil: até %d%%, ou seja, %s nesta venda. '
            . 'Para mais, peça a um administrador.', $maximo, moedaBr(round($bruto * $maximo / 100, 2))));
    }
    if ($formaId && !chaveLigada('venda.prazo_equipe')
        && (consultarUm('SELECT tipo FROM formas_pagamento WHERE id = ?', [$formaId])['tipo'] ?? null) === 'prazo') {
        throw new ErroApi(403, 'Venda a prazo (fiado) só com o administrador nesta loja.');
    }
    if ($linhas !== null && !chaveLigada('venda.alterar_preco_equipe')) {
        foreach ($linhas as $l) {
            if (!$l['prato_id']) {
                throw new ErroApi(403, 'Item fora do cardápio (avulso) só o administrador lança nesta loja.');
            }
            if (emCentavos($l['unitario']) !== emCentavos($l['tabela'])) {
                throw new ErroApi(403, sprintf('O preço de "%s" é %s. Nesta loja só o administrador muda o preço: '
                    . 'para vender mais barato, use o desconto.', $l['item'], moedaBr($l['tabela'])));
            }
        }
    }
}

function criarVenda(array $corpo, array $usuario): array
{
    $itens = $corpo['itens'] ?? [];
    if (!is_array($itens) || count($itens) === 0) {
        throw new ErroApi(400, 'A venda precisa de pelo menos um item.');
    }
    $clienteId = idDoCatalogo($corpo, 'cliente_id', null);
    if ($clienteId) {
        exigirExistente('clientes', $clienteId, 'Cliente informado não existe.');
    } elseif (txt($corpo, 'cliente_nome')) {
        $clienteId = null;   // cadastrado dentro da transacao, abaixo
    }

    $desconto = dinheiro($corpo, 'desconto', 'Desconto', 0.0);
    $parcelas = inteiro($corpo, 'parcelas', 'Parcelas', 1, PARCELAS_MAX, 1);
    // No balcao a venda a vista nasce recebida; parcelada fica a receber.
    $pago     = array_key_exists('pago', $corpo) ? !empty($corpo['pago']) : $parcelas === 1;
    [$formaId, $forma] = formaDePagamento($corpo);
    $data       = dataDoCorpo($corpo, 'data_venda', 'Data da venda', true) ?? agora();
    $vencimento = dataDoCorpo($corpo, 'vencimento', 'Vencimento') ?? substr($data, 0, 10);

    $vendaId = emTransacao(function () use ($corpo, $usuario, $itens, $clienteId, $desconto, $parcelas, $pago,
                                            $forma, $formaId, $data, $vencimento) {
        if (!$clienteId && txt($corpo, 'cliente_nome')) {
            $clienteId = acharOuCriarCliente(txt($corpo, 'cliente_nome'), txt($corpo, 'cliente_telefone'));
        }
        $linhas = prepararItensDeSaida($itens);
        $bruto = round(array_sum(array_column($linhas, 'subtotal')), 2);
        $custo = round(array_sum(array_map(fn ($l) => $l['custo'] * $l['quantidade'], $linhas)), 2);
        conferirTeto($bruto, 'O total da venda');
        if ($desconto > $bruto) {
            throw new ErroApi(400, 'O desconto precisa estar entre zero e o valor da venda (' . moedaBr($bruto) . ').');
        }
        $total = round($bruto - $desconto, 2);
        if ($total <= 0) {
            throw new ErroApi(400, 'O total da venda ficou em R$ 0,00. Para dar uma porção de cortesia ou degustação, '
                . 'use Movimentar estoque > Degustação / cortesia.');
        }
        conferirParcelamento($total, $parcelas, $pago);
        conferirRegrasDaVenda($usuario, $bruto, $desconto, $clienteId, $formaId, $linhas);

        $vendaId = gravarVenda(['cliente_id' => $clienteId, 'usuario_id' => $usuario['id'], 'bruto' => $bruto,
            'desconto' => $desconto, 'total' => $total, 'custo' => $custo, 'forma' => $forma, 'forma_id' => $formaId,
            'parcelas' => $parcelas, 'data' => $data, 'observacoes' => txt($corpo, 'observacoes')], $linhas);
        conferirSaldos(array_column($linhas, 'entrada_id'));
        gerarLancamentosDaVenda($vendaId, $total, $parcelas, $forma, $formaId, $clienteId, $vencimento, (int) $usuario['id'], $pago);
        return $vendaId;
    });
    $v = consultarUm('SELECT numero, valor_total FROM vendas WHERE id = ?', [$vendaId]);
    return [201, ['ok' => true, 'id' => $vendaId, 'numero' => $v['numero'], 'total' => (float) $v['valor_total'],
                  'mensagem' => 'Venda ' . $v['numero'] . ' registrada: ' . moedaBr((float) $v['valor_total']) . '.']];
}

/*
 * A venda vira dinheiro: uma conta a receber por parcela, de mes em mes,
 * dividida em CENTAVOS (a ultima leva a sobra). A vista com "pago" ja
 * nasce paga. Valor zero nao gera conta.
 */
function gerarLancamentosDaVenda(int $vendaId, float $total, int $parcelas, ?string $forma, ?int $formaId,
                                 ?int $clienteId, string $vencimento, int $usuarioId, bool $pago): void
{
    $centavos = emCentavos($total);
    if ($centavos <= 0) {
        return;
    }
    $numero = consultarUm('SELECT numero FROM vendas WHERE id = ?', [$vendaId])['numero'] ?? ('#' . $vendaId);
    $base   = intdiv($centavos, $parcelas);
    $sobra  = $centavos - $base * $parcelas;
    $quitar = $pago && $parcelas === 1;
    for ($i = 1; $i <= $parcelas; $i++) {
        criarLancamento([
            'tipo' => 'receber', 'descricao' => 'Venda ' . $numero . ($parcelas > 1 ? " ({$i}/{$parcelas})" : ''),
            'categoria' => 'Venda', 'valor' => ($base + ($i === $parcelas ? $sobra : 0)) / 100,
            'vencimento' => somarMeses($vencimento, $i - 1),
            'status' => $quitar ? 'pago' : 'pendente', 'data_pagamento' => $quitar ? agora() : null,
            'origem' => 'venda', 'venda_id' => $vendaId, 'cliente_id' => $clienteId,
            'forma_pagamento' => $forma, 'forma_pagamento_id' => $formaId,
            'parcela' => $i, 'total_parcelas' => $parcelas, 'usuario_id' => $usuarioId,
        ]);
    }
}

/*
 * Editar venda: cabecalho (cliente, desconto, forma, observacoes) e status.
 * Os itens nao mudam depois de gravados. Regras:
 *   - cancelada e estado FINAL (as porcoes voltam ao lote);
 *   - venda da loja online so muda pelo pedido (Pedidos online);
 *   - cancelar venda ja recebida e estorno: so admin;
 *   - mudou valor ou forma: nada pago -> parcelas refeitas; ja tem pago ->
 *     o pago fica, e a diferenca vira receber ou devolucao (so admin).
 * $pelaEncomenda: quem chama e o cancelamento do pedido da loja online.
 */
function atualizarVenda(?int $id, array $corpo, array $usuario, bool $pelaEncomenda = false): array
{
    $id = exigirId($id);
    $admin = $usuario['perfil'] === 'admin';
    return emTransacao(function () use ($id, $corpo, $usuario, $admin, $pelaEncomenda) {
        $atual = consultarUm('SELECT * FROM vendas WHERE id = ?', [$id]);
        if (!$atual) {
            throw new ErroApi(404, 'Venda não encontrada.');
        }
        $status = txt($corpo, 'status') ?? $atual['status'];
        if (!in_array($status, valoresDe('status_venda'), true)) {
            throw new ErroApi(400, 'Status de venda inválido: ' . $status . '. Use concluida ou cancelada.');
        }
        $bruto    = (float) $atual['valor_bruto'];
        $desconto = dinheiro($corpo, 'desconto', 'Desconto', (float) $atual['desconto']);
        if ($desconto > $bruto) {
            throw new ErroApi(400, 'O desconto precisa estar entre zero e o valor dos itens (' . moedaBr($bruto) . ').');
        }
        $total = round($bruto - $desconto, 2);
        $clienteId = array_key_exists('cliente_id', $corpo) ? idDoCatalogo($corpo, 'cliente_id', null)
                   : ($atual['cliente_id'] === null ? null : (int) $atual['cliente_id']);
        if ($clienteId) {
            exigirExistente('clientes', $clienteId, 'Cliente informado não existe.');
        }
        [$formaId, $formaNome] = formaDePagamento($corpo, $atual);

        $mudouValor   = emCentavos($total) !== emCentavos($atual['valor_total']);
        $mudouForma   = (int) $formaId !== (int) $atual['forma_pagamento_id'];
        $mudouCliente = (int) $clienteId !== (int) $atual['cliente_id'];
        $cancelando   = $status === 'cancelada' && $atual['status'] !== 'cancelada';

        if ($atual['status'] === 'cancelada') {
            if ($status !== 'cancelada') {
                throw new ErroApi(400, 'Venda cancelada não pode ser reativada. Registre uma nova venda.');
            }
            if ($mudouValor || $mudouForma || $mudouCliente) {
                throw new ErroApi(400, 'Venda cancelada não pode ser alterada; só as observações mudam.');
            }
        }
        $encomenda = consultarUm('SELECT numero FROM encomendas WHERE venda_id = ?', [$id]);
        if ($encomenda && !$pelaEncomenda && ($cancelando || $mudouValor || $mudouCliente)) {
            throw new ErroApi(400, 'Esta venda veio do pedido ' . $encomenda['numero'] . ' da loja online. Para cancelar ou mudar '
                . 'o valor, use Pedidos online.');
        }

        $recebido = (float) consultarUm(
            "SELECT COALESCE(SUM(CASE WHEN tipo = 'receber' THEN valor ELSE -valor END), 0) AS v
               FROM lancamentos WHERE venda_id = ? AND status = 'pago'", [$id])['v'];
        if ($cancelando && $recebido > 0 && !$admin && !$pelaEncomenda) {
            throw new ErroApi(403, 'Só o administrador pode cancelar uma venda que já foi recebida: o dinheiro '
                . 'recebido precisa ser estornado. Peça a um administrador.');
        }
        if (!$cancelando && $atual['status'] === 'concluida' && ($mudouValor || $mudouForma || $mudouCliente)) {
            conferirRegrasDaVenda($usuario, $bruto, $desconto, $clienteId, $mudouForma ? $formaId : null, null);
        }
        $refazer = !$cancelando && $atual['status'] === 'concluida' && ($mudouValor || $mudouForma);
        if ($refazer && $total <= 0) {
            throw new ErroApi(400, 'O desconto não pode zerar a venda. Para desfazer a venda, cancele-a.');
        }
        if ($refazer && emCentavos($recebido) > emCentavos($total) && !$admin) {
            throw new ErroApi(403, 'Esta venda já recebeu ' . moedaBr($recebido) . ' e o valor novo é menor: a diferença '
                . 'teria de ser devolvida ao cliente. Só o administrador pode lançar essa devolução.');
        }
        if ($refazer && $recebido <= 0) {
            conferirParcelamento($total, (int) $atual['parcelas'], false);
        }

        executarSql(
            'UPDATE vendas SET cliente_id = ?, desconto = ?, valor_total = ?, forma_pagamento = ?,
                               forma_pagamento_id = ?, status = ?, observacoes = ?, atualizado_em = ? WHERE id = ?',
            [$clienteId, $desconto, $total, $formaNome, $formaId, $status, txtOu($corpo, 'observacoes', $atual), agora(), $id]);

        $mensagem = 'Venda atualizada.';
        if ($cancelando) {
            cancelarLancamentos('venda_id', $id, 'venda cancelada', (int) $usuario['id']);
            $mensagem = 'Venda cancelada e porções devolvidas ao estoque.';
        } elseif ($refazer) {
            $motivo = $mudouValor ? 'valor da venda alterado' : 'forma de pagamento alterada';
            $primeiro = consultarUm("SELECT MIN(vencimento) AS v FROM lancamentos WHERE venda_id = ? AND status = 'pendente'",
                                    [$id])['v'] ?? null;
            $vencimento = $primeiro ?: substr((string) $atual['data_venda'], 0, 10);
            if ($recebido <= 0) {
                cancelarLancamentos('venda_id', $id, $motivo, (int) $usuario['id']);
                gerarLancamentosDaVenda($id, $total, (int) $atual['parcelas'], $formaNome, $formaId, $clienteId,
                    $vencimento, (int) $usuario['id'], false);
                $mensagem = 'Venda atualizada; as parcelas a receber foram refeitas com o valor novo.';
            } elseif (!$mudouValor) {
                trocarFormaDosPendentes($id, $formaId, $formaNome, (int) $usuario['id']);
                $mensagem = 'Venda atualizada; as parcelas a receber passaram para a forma nova (as já pagas ficam como estão).';
            } else {
                $mensagem = acertarVendaJaRecebida($id, $total, $recebido, $formaNome, $formaId, $clienteId,
                    max($vencimento, date('Y-m-d')), (int) $usuario['id'], $motivo);
            }
        } elseif ($mudouCliente) {
            trocarClienteDosLancamentos($id, $clienteId, (int) $usuario['id']);
        }
        return [200, ['ok' => true, 'mensagem' => $mensagem]];
    });
}

/* Venda que ja recebeu e mudou de valor: o pago fica; nasce UMA conta da diferenca. */
function acertarVendaJaRecebida(int $vendaId, float $total, float $recebido, ?string $forma, ?int $formaId,
                                ?int $clienteId, string $vencimento, int $usuarioId, string $motivo): string
{
    cancelarLancamentos('venda_id', $vendaId, $motivo, $usuarioId, true);
    $numero = consultarUm('SELECT numero FROM vendas WHERE id = ?', [$vendaId])['numero'];
    $diferenca = round($total - $recebido, 2);
    $comum = ['categoria' => 'Venda', 'vencimento' => $vencimento, 'status' => 'pendente', 'origem' => 'venda',
              'venda_id' => $vendaId, 'cliente_id' => $clienteId, 'forma_pagamento' => $forma,
              'forma_pagamento_id' => $formaId, 'usuario_id' => $usuarioId];
    if (emCentavos($diferenca) > 0) {
        criarLancamento(['tipo' => 'receber', 'descricao' => 'Venda ' . $numero . ' (diferença)', 'valor' => $diferenca] + $comum);
        return 'Venda atualizada. O que já foi recebido (' . moedaBr($recebido) . ') continua recebido; '
             . 'a diferença de ' . moedaBr($diferenca) . ' ficou como conta a receber.';
    }
    if (emCentavos($diferenca) < 0) {
        criarLancamento(['tipo' => 'pagar', 'descricao' => 'Devolução ao cliente — ' . $numero, 'valor' => -$diferenca] + $comum);
        return 'Venda atualizada. Já foram recebidos ' . moedaBr($recebido) . ' e a venda agora vale ' . moedaBr($total)
             . ': foi lançada uma devolução de ' . moedaBr(-$diferenca) . ' ao cliente, a pagar.';
    }
    return 'Venda atualizada. O valor já recebido cobre a venda inteira; não há mais nada a receber.';
}
