<?php
/**
 * api/rotas/estoque.php - entradas (os lotes que chegam), a saida por lote
 * (o que vence primeiro sai primeiro), movimentacoes (vencimento, perda,
 * degustacao...) e a ficha do item.
 *
 * O saldo nunca e gravado: e a vw_entradas_saldo, que le as saidas de
 * vw_saidas_estoque (venda concluida e producao concluida).
 *
 * Validade: lote vencido NAO sai por venda nem por producao (a conta
 * lotesDisponiveis o ignora); ele so sai por movimentacao (vencimento).
 */

declare(strict_types=1);

/*
 * Ultima barreira do estoque: depois de gravar, DENTRO da transacao, o
 * saldo de cada lote mexido tem de continuar >= 0.
 */
function conferirSaldos(array $entradaIds, ?string $explicacao = null): void
{
    $ids = array_values(array_unique(array_filter(array_map('intval', $entradaIds))));
    if (!$ids) {
        return;
    }
    $negativa = consultarUm(
        'SELECT id, item, saldo, unidade FROM vw_entradas WHERE id IN (' . vagas($ids) . ') AND saldo < 0 ORDER BY id LIMIT 1', $ids);
    if ($negativa) {
        throw new ErroApi(400, 'Saldo insuficiente de "' . $negativa['item'] . '": a operação deixaria o lote em '
            . quantidadeLegivel((int) $negativa['saldo'], $negativa['unidade']) . '.' . ($explicacao ? ' ' . $explicacao : ''));
    }
}

/** "2,5 kg", "750 g", "3 un", "12 porções": a quantidade como a cozinha fala. */
function quantidadeLegivel(int $q, string $unidade): string
{
    if ($unidade === 'g' && abs($q) >= 1000) {
        return number_format($q / 1000, abs($q) % 1000 === 0 ? 0 : 3, ',', '.') . ' kg';
    }
    if ($unidade === 'ml' && abs($q) >= 1000) {
        return number_format($q / 1000, abs($q) % 1000 === 0 ? 0 : 3, ',', '.') . ' L';
    }
    if ($unidade === 'porcao') {
        return $q . ($q === 1 || $q === -1 ? ' porção' : ' porções');
    }
    return $q . ' ' . $unidade;
}

/** Porcoes de um prato seguradas por pedidos da loja que ainda nao foram confirmados. */
function reservadoDoPrato(int $pratoId, ?int $excetoEncomenda = null): int
{
    return (int) consultarUm(
        'SELECT COALESCE(SUM(ei.quantidade), 0) AS q
           FROM encomenda_itens ei JOIN encomendas en ON en.id = ei.encomenda_id
          WHERE ei.prato_id = ? AND en.status IN (' . vagas(STATUS_ENCOMENDA_RESERVA) . ') AND en.id <> ?',
        array_merge([$pratoId], STATUS_ENCOMENDA_RESERVA, [$excetoEncomenda ?? 0]))['q'];
}

/*
 * Os lotes que podem sair, na ordem em que devem sair: dentro da validade,
 * com saldo, o que vence primeiro antes (sem validade por ultimo), depois o
 * mais antigo. $coluna: insumo_id ou prato_id.
 */
function lotesDisponiveis(string $coluna, int $id): array
{
    if (!in_array($coluna, ['insumo_id', 'prato_id'], true)) {
        throw new LogicException('Coluna de lote invalida: ' . $coluna);
    }
    return consultar(
        "SELECT id, item, saldo, custo_unitario, validade, lote, unidade
           FROM vw_entradas
          WHERE {$coluna} = ? AND saldo > 0 AND (dias_validade IS NULL OR dias_validade >= 0)
          ORDER BY CASE WHEN validade IS NULL THEN 1 ELSE 0 END, validade, data_entrada, id", [$id]);
}

/*
 * Reparte uma quantidade pelos lotes (o que vence primeiro sai primeiro).
 * Devolve [[entrada_id, quantidade, custo_unitario], ...]. $reservado e o
 * que outros pedidos seguram do total (so prato) e nao pode ser usado.
 */
function alocarLotes(string $coluna, int $id, int $quantidade, string $nome, string $unidade, int $reservado = 0): array
{
    $lotes = lotesDisponiveis($coluna, $id);
    $total = array_sum(array_map(fn ($l) => (int) $l['saldo'], $lotes));
    $livre = $total - $reservado;
    if ($quantidade > $livre) {
        $vencido = (int) consultarUm(
            "SELECT COALESCE(SUM(saldo), 0) AS q FROM vw_entradas WHERE {$coluna} = ? AND saldo > 0 AND dias_validade < 0", [$id])['q'];
        throw new ErroApi(400, 'Estoque insuficiente de "' . $nome . '": precisa de ' . quantidadeLegivel($quantidade, $unidade)
            . ', disponível ' . quantidadeLegivel(max(0, $livre), $unidade) . '.'
            . ($reservado > 0 ? ' ' . quantidadeLegivel($reservado, $unidade) . ' estão reservadas por pedidos da loja online.' : '')
            . ($vencido > 0 ? ' Há ' . quantidadeLegivel($vencido, $unidade) . ' em lote VENCIDO, que não sai: dê baixa por vencimento.' : ''));
    }
    $partes = [];
    $falta = $quantidade;
    foreach ($lotes as $l) {
        if ($falta <= 0) {
            break;
        }
        $tira = min($falta, (int) $l['saldo']);
        $partes[] = [(int) $l['id'], $tira, (float) $l['custo_unitario']];
        $falta -= $tira;
    }
    return $partes;
}

// ------------------------------------------------------------------
// Entradas (lotes)
// ------------------------------------------------------------------
function entradas(?int $id, string $metodo, array $corpo, array $usuario, array $consulta): array
{
    $admin = $usuario['perfil'] === 'admin';
    $semCusto = function (array $e) use ($admin): array {
        foreach (['quantidade', 'saldo'] as $c) {
            $e[$c] = (int) $e[$c];
        }
        $e['dias_validade'] = $e['dias_validade'] === null ? null : (int) $e['dias_validade'];
        $e['custo_unitario'] = round((float) $e['custo_unitario'], 6);
        if (!$admin) {
            unset($e['custo_total'], $e['custo_unitario']);
        }
        return $e;
    };
    if ($metodo === 'GET') {
        if ($id) {
            $item = consultarUm('SELECT * FROM vw_entradas WHERE id = ?', [$id]);
            if (!$item) {
                throw new ErroApi(404, 'Lote não encontrado.');
            }
            $item = $semCusto($item);
            $item += documentosDosLotes()[$id] ?? ['pedido_id' => null, 'pedido' => null];
            return [200, ['ok' => true, 'entrada' => $item]];
        }
        $onde = [];
        $par  = [];
        $tipo = (string) ($consulta['tipo'] ?? '');
        if ($tipo !== '' && in_array($tipo, valoresDe('tipos_entrada'), true)) {
            $onde[] = 'tipo = ?';
            $par[]  = $tipo;
        }
        foreach (['insumo_id', 'prato_id'] as $col) {
            if (!empty($consulta[$col])) {
                $onde[] = $col . ' = ?';
                $par[] = (int) $consulta[$col];
            }
        }
        if (!empty($consulta['disponivel'])) {
            $onde[] = 'saldo > 0';
        }
        if (!empty($consulta['vencidos'])) {
            $onde[] = 'saldo > 0 AND dias_validade < 0';
        }
        $itens = consultar('SELECT * FROM vw_entradas' . ($onde ? ' WHERE ' . implode(' AND ', $onde) : '')
            . ' ORDER BY CASE WHEN saldo > 0 THEN 0 ELSE 1 END, data_entrada DESC, id DESC', $par);
        $docs = documentosDosLotes();
        return [200, ['ok' => true, 'itens' => array_map(function ($e) use ($semCusto, $docs) {
            return $semCusto($e) + ($docs[(int) $e['id']] ?? ['pedido_id' => null, 'pedido' => null]);
        }, $itens)]];
    }

    if ($metodo === 'POST') {
        return emTransacao(function () use ($corpo, $usuario) {
            $d = dadosEntrada($corpo, null);
            /*
             * A compra vira lancamento no financeiro:
             *   pago -> sai do caixa agora; pagar -> fica pendente; vazio -> nada.
             */
            $comoPagou = txt($corpo, 'gerar_conta_pagar') ?? '';
            if (!in_array($comoPagou, ['', 'pago', 'pagar'], true)) {
                throw new ErroApi(400, 'Escolha como a compra foi paga: "pago", "pagar" ou deixe em branco.');
            }
            [$formaId, $formaNome] = formaDePagamento($corpo);
            $vencimento = dataDoCorpo($corpo, 'vencimento', 'Vencimento da conta');

            executarSql(
                'INSERT INTO entradas (tipo, insumo_id, prato_id, fornecedor_id, descricao, quantidade, custo_total,
                                       lote, validade, nota_fiscal, observacoes, data_entrada)
                 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
                [$d['tipo'], $d['insumo_id'], $d['prato_id'], $d['fornecedor_id'], $d['descricao'], $d['quantidade'],
                 $d['custo_total'], $d['lote'], $d['validade'], $d['nota_fiscal'], $d['observacoes'], $d['data_entrada']]);
            $novoId = (int) banco()->lastInsertId();

            $mensagem = 'Entrada registrada: ' . descreverEntrada($novoId) . '.';
            if ($comoPagou !== '') {
                if ($d['custo_total'] <= 0) {
                    $mensagem .= ' Como o custo é zero, nenhuma conta foi lançada.';
                } else {
                    $pago = $comoPagou === 'pago';
                    criarLancamento([
                        'tipo' => 'pagar', 'descricao' => 'Compra: ' . descreverEntrada($novoId), 'categoria' => 'Fornecedor',
                        'valor' => $d['custo_total'], 'vencimento' => $vencimento ?? substr($d['data_entrada'], 0, 10),
                        'data_pagamento' => $pago ? $d['data_entrada'] : null, 'status' => $pago ? 'pago' : 'pendente',
                        'origem' => 'entrada', 'entrada_id' => $novoId, 'fornecedor_id' => $d['fornecedor_id'],
                        'forma_pagamento' => $formaNome, 'forma_pagamento_id' => $formaId, 'usuario_id' => $usuario['id'],
                    ]);
                }
            }
            return [201, ['ok' => true, 'id' => $novoId, 'mensagem' => $mensagem]];
        });
    }

    if ($metodo === 'PUT') {
        $id = exigirId($id);
        return emTransacao(function () use ($id, $corpo) {
            $atual = consultarUm('SELECT * FROM entradas WHERE id = ?', [$id]);
            if (!$atual) {
                throw new ErroApi(404, 'Lote não encontrado.');
            }
            $d = dadosEntrada($corpo, $atual);
            $travado = pedidoDaEntrada($id) ?? ($atual['producao_id']
                ? 'a produção ' . (consultarUm('SELECT numero FROM producoes WHERE id = ?', [$atual['producao_id']])['numero'] ?? '') : null);
            if ($travado && ((int) $d['quantidade'] !== (int) $atual['quantidade']
                             || emCentavos($d['custo_total']) !== emCentavos($atual['custo_total'])
                             || $d['tipo'] !== $atual['tipo'] || (int) $d['insumo_id'] !== (int) $atual['insumo_id']
                             || (int) $d['prato_id'] !== (int) $atual['prato_id'])) {
                throw new ErroApi(400, 'Este lote veio d' . (str_starts_with($travado, 'a produção') ? '' : 'o pedido ') . $travado
                    . ': item, quantidade e custo seguem o documento. Para corrigir, cancele o documento e lance de novo.');
            }
            executarSql(
                'UPDATE entradas SET tipo = ?, insumo_id = ?, prato_id = ?, fornecedor_id = ?, descricao = ?, quantidade = ?,
                                     custo_total = ?, lote = ?, validade = ?, nota_fiscal = ?, observacoes = ?
                  WHERE id = ?',
                [$d['tipo'], $d['insumo_id'], $d['prato_id'], $d['fornecedor_id'], $d['descricao'], $d['quantidade'],
                 $d['custo_total'], $d['lote'], $d['validade'], $d['nota_fiscal'], $d['observacoes'], $id]);
            conferirSaldos([$id], 'A quantidade não pode ficar menor que o que já saiu (vendas, produção e baixas).');
            return [200, ['ok' => true, 'mensagem' => 'Lote atualizado.']];
        });
    }

    if ($metodo === 'DELETE') {
        $id = exigirId($id);
        return emTransacao(function () use ($id, $usuario) {
            $s = consultarUm('SELECT s.*, e.producao_id FROM vw_entradas_saldo s JOIN entradas e ON e.id = s.entrada_id WHERE s.entrada_id = ?', [$id]);
            if (!$s) {
                throw new ErroApi(404, 'Lote não encontrado.');
            }
            $doPedido = pedidoDaEntrada($id);
            if ($doPedido) {
                throw new ErroApi(400, 'Este lote veio do pedido ' . $doPedido . '. Para tirar do estoque, cancele o pedido '
                    . '(ele desfaz também as contas a pagar).');
            }
            if ($s['producao_id']) {
                throw new ErroApi(400, 'Este lote nasceu de uma ordem de produção. Para desfazer, cancele a produção: '
                    . 'os insumos voltam ao estoque junto.');
            }
            if ((int) $s['vendido'] > 0 || (int) $s['usado_producao'] > 0) {
                throw new ErroApi(400, 'Este lote já teve saída (' . (int) $s['vendido'] . ' vendido(s), ' . (int) $s['usado_producao']
                    . ' usado(s) na produção) e não pode ser excluído - a venda e a produção ficariam sem o custo.');
            }
            if ((int) consultarUm('SELECT COUNT(*) AS q FROM movimentacoes WHERE entrada_id = ?', [$id])['q'] > 0) {
                throw new ErroApi(400, 'Este lote já teve movimentação (vencimento, perda, ajuste...). Excluir apagaria esse histórico. '
                    . 'Para corrigir o estoque, registre uma nova movimentação.');
            }
            cancelarLancamentos('entrada_id', $id, 'entrada excluída', (int) $usuario['id']);
            executarSql('DELETE FROM entradas WHERE id = ?', [$id]);
            return [200, ['ok' => true, 'mensagem' => 'Lote excluído.']];
        });
    }

    throw new ErroApi(405, 'Método não permitido para /api/entradas.');
}

/** O numero do pedido confirmado que criou este lote, ou null. */
function pedidoDaEntrada(int $entradaId): ?string
{
    $p = consultarUm("SELECT p.numero FROM pedido_itens i JOIN pedidos p ON p.id = i.pedido_id
                       WHERE i.entrada_id = ? AND p.status = 'confirmado'", [$entradaId]);
    return $p['numero'] ?? null;
}

/*
 * O documento de entrada (pedido confirmado) de cada lote, numa consulta so:
 * entrada_id -> [pedido_id, pedido]. O Estoque mostra "Entrada PE-..." e abre
 * o documento; lote sem documento e producao ou lancamento avulso antigo.
 */
function documentosDosLotes(): array
{
    $mapa = [];
    foreach (consultar("SELECT i.entrada_id, p.id, p.numero FROM pedido_itens i JOIN pedidos p ON p.id = i.pedido_id
                         WHERE i.entrada_id IS NOT NULL AND p.status = 'confirmado'") as $r) {
        $mapa[(int) $r['entrada_id']] = ['pedido_id' => (int) $r['id'], 'pedido' => $r['numero']];
    }
    return $mapa;
}

/*
 * Le e confere o corpo de um lote. O tipo decide qual id de catalogo vale.
 * Insumo: quantidade na unidade base (g/ml/un). Prato: porcoes; sem
 * validade informada, ela sai do prato (data + validade_dias).
 */
function dadosEntrada(array $corpo, ?array $atual): array
{
    $tipo = txt($corpo, 'tipo') ?? ($atual['tipo'] ?? 'insumo');
    if (!in_array($tipo, valoresDe('tipos_entrada'), true)) {
        throw new ErroApi(400, 'Tipo de entrada inválido: ' . $tipo . '. Use insumo ou prato.');
    }
    $insumoId = $pratoId = null;
    $prato = null;
    if ($tipo === 'insumo') {
        $insumoId = idDoCatalogo($corpo, 'insumo_id', $atual['insumo_id'] ?? null);
        if (!$insumoId && txt($corpo, 'insumo_nome')) {
            $insumoId = criarInsumo(['nome' => txt($corpo, 'insumo_nome'), 'categoria' => txt($corpo, 'insumo_categoria'),
                                     'unidade' => txt($corpo, 'insumo_unidade')]);
        }
        if (!$insumoId) {
            throw new ErroApi(400, 'Escolha o insumo (ou cadastre um novo).');
        }
        exigirExistente('insumos', $insumoId, 'Insumo informado não existe.');
    } else {
        $pratoId = idDoCatalogo($corpo, 'prato_id', $atual['prato_id'] ?? null);
        if (!$pratoId) {
            throw new ErroApi(400, 'Escolha o prato do cardápio.');
        }
        $prato = consultarUm('SELECT id, nome, validade_dias, feito_na_hora FROM pratos WHERE id = ?', [$pratoId]);
        if (!$prato) {
            throw new ErroApi(400, 'Prato informado não existe.');
        }
        if ((int) $prato['feito_na_hora'] === 1) {
            throw new ErroApi(400, '"' . $prato['nome'] . '" é feito na hora e não tem estoque. Desligue "feito na hora" no cardápio '
                . 'se ele passou a ser produzido antes.');
        }
    }

    $fornecedorId = idDoCatalogo($corpo, 'fornecedor_id', $atual['fornecedor_id'] ?? null);
    if ($fornecedorId) {
        exigirExistente('fornecedores', $fornecedorId, 'Fornecedor informado não existe.');
    }
    $quantidade = inteiro($corpo, 'quantidade', $tipo === 'insumo' ? 'Quantidade' : 'Porções', 1, QUANTIDADE_MAXIMA,
                          $atual ? (int) $atual['quantidade'] : null);
    if (!$quantidade) {
        throw new ErroApi(400, 'Informe a quantidade que chegou.');
    }
    $custoTotal = dinheiro($corpo, 'custo_total', 'Custo total do lote', (float) ($atual['custo_total'] ?? 0));
    conferirTeto($custoTotal, 'O custo do lote');

    $dataEntrada = $atual['data_entrada'] ?? (dataDoCorpo($corpo, 'data_entrada', 'Data de entrada', true) ?? agora());
    $validade = array_key_exists('validade', $corpo) ? dataDoCorpo($corpo, 'validade', 'Validade') : ($atual['validade'] ?? null);
    if ($validade === null && $atual === null && $prato && (int) $prato['validade_dias'] > 0) {
        $validade = date('Y-m-d', strtotime(substr($dataEntrada, 0, 10) . ' +' . (int) $prato['validade_dias'] . ' days'));
    }
    $lote = textoCurtoEstoque($corpo, 'lote', 'Lote', 40, $atual);

    return [
        'tipo' => $tipo, 'insumo_id' => $insumoId, 'prato_id' => $pratoId, 'fornecedor_id' => $fornecedorId,
        'descricao' => txtOu($corpo, 'descricao', $atual), 'quantidade' => $quantidade, 'custo_total' => $custoTotal,
        'lote' => $lote, 'validade' => $validade,
        'nota_fiscal' => txtOu($corpo, 'nota_fiscal', $atual), 'observacoes' => txtOu($corpo, 'observacoes', $atual),
        'data_entrada' => $dataEntrada,
    ];
}

function textoCurtoEstoque(array $corpo, string $campo, string $rotulo, int $maximo, ?array $atual): ?string
{
    $valor = txtOu($corpo, $campo, $atual);
    if ($valor !== null && mb_strlen($valor) > $maximo) {
        throw new ErroApi(400, "O campo \"{$rotulo}\" passou de {$maximo} caracteres.");
    }
    return $valor;
}

/** Nome legivel de um lote, para descricao de lancamento. */
function descreverEntrada(int $entradaId): string
{
    $l = consultarUm('SELECT item, quantidade, unidade, tipo FROM vw_entradas WHERE id = ?', [$entradaId]);
    if (!$l) {
        return 'lote #' . $entradaId;
    }
    return quantidadeLegivel((int) $l['quantidade'], $l['tipo'] === 'prato' ? 'porcao' : $l['unidade']) . ' de ' . $l['item'];
}

// ------------------------------------------------------------------
// Movimentacoes
// ------------------------------------------------------------------
function movimentacoes(?int $id, string $metodo, array $corpo, array $usuario, array $consulta): array
{
    if ($metodo === 'GET') {
        return [200, ['ok' => true] + historicoDoItem($consulta, $usuario)];
    }

    if ($metodo === 'POST') {
        // Um clique para descartar tudo que venceu (cada lote vira uma movimentacao).
        if (!empty($corpo['baixar_vencidos'])) {
            return baixarVencidos($usuario);
        }
        $entradaId = idDoCatalogo($corpo, 'entrada_id', null);
        if (!$entradaId) {
            throw new ErroApi(400, 'Escolha o lote do estoque que está sendo movimentado.');
        }
        $entrada = consultarUm('SELECT * FROM vw_entradas WHERE id = ?', [$entradaId]);
        if (!$entrada) {
            throw new ErroApi(400, 'Lote não encontrado.');
        }
        $motivo = txt($corpo, 'motivo') ?? 'ajuste';
        if (!in_array($motivo, valoresDe('motivos_movimentacao'), true)) {
            throw new ErroApi(400, 'Motivo inválido: ' . $motivo);
        }
        // O motivo escolhe o lado; a tela so manda o lado no ajuste.
        $tipo = $motivo === 'ajuste' ? (txt($corpo, 'tipo') ?? 'entrada') : DOMINIOS['motivos_movimentacao'][$motivo][1];
        if (!in_array($tipo, ['entrada', 'saida'], true)) {
            throw new ErroApi(400, 'Tipo de movimento inválido: ' . $tipo);
        }
        $quantidade = inteiro($corpo, 'quantidade', 'Quantidade', 1, QUANTIDADE_MAXIMA, 1);
        $unidade = $entrada['tipo'] === 'prato' ? 'porcao' : $entrada['unidade'];
        if ($tipo === 'saida' && $quantidade > (int) $entrada['saldo']) {
            throw new ErroApi(400, 'Saldo insuficiente de "' . $entrada['item'] . '": baixa de ' . quantidadeLegivel($quantidade, $unidade)
                . ', o lote tem ' . quantidadeLegivel((int) $entrada['saldo'], $unidade) . '.');
        }
        // Saida que e prejuizo (vencimento, perda, degustacao, consumo): o valor e o custo que se foi.
        $valor = veio($corpo, 'valor') ? dinheiro($corpo, 'valor', 'Valor', 0.0)
               : ($tipo === 'saida' ? round($quantidade * (float) $entrada['custo_unitario'], 2) : 0.0);
        $fornecedorId = idDoCatalogo($corpo, 'fornecedor_id', $entrada['fornecedor_id']);
        if ($fornecedorId) {
            exigirExistente('fornecedores', $fornecedorId, 'Fornecedor informado não existe.');
        }
        return emTransacao(function () use ($entradaId, $tipo, $motivo, $quantidade, $fornecedorId, $valor, $corpo, $usuario, $entrada) {
            executarSql(
                'INSERT INTO movimentacoes (entrada_id, tipo, motivo, quantidade, fornecedor_id, valor, observacoes, usuario_id)
                 VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
                [$entradaId, $tipo, $motivo, $quantidade, $fornecedorId, $valor, txt($corpo, 'observacoes'), $usuario['id']]);
            $novo = (int) banco()->lastInsertId();
            conferirSaldos([$entradaId]);
            return [201, ['ok' => true, 'id' => $novo,
                          'mensagem' => 'Movimentação registrada. Saldo de "' . $entrada['item'] . '" atualizado.']];
        });
    }

    if ($metodo === 'DELETE') {
        $id = exigirId($id);
        return emTransacao(function () use ($id) {
            $mov = consultarUm('SELECT * FROM movimentacoes WHERE id = ?', [$id]);
            if (!$mov) {
                throw new ErroApi(404, 'Movimentação não encontrada.');
            }
            executarSql('DELETE FROM movimentacoes WHERE id = ?', [$id]);
            conferirSaldos([(int) $mov['entrada_id']],
                'O que esta movimentação trouxe já saiu por venda ou produção; ela não pode ser desfeita.');
            return [200, ['ok' => true, 'mensagem' => 'Movimentação desfeita.']];
        });
    }

    throw new ErroApi(405, 'Método não permitido para /api/movimentacoes.');
}

/* Todo lote vencido com saldo vira uma baixa por vencimento, numa transacao. */
function baixarVencidos(array $usuario): array
{
    return emTransacao(function () use ($usuario) {
        $lotes = consultar('SELECT id, item, saldo, custo_unitario FROM vw_entradas WHERE saldo > 0 AND dias_validade < 0');
        foreach ($lotes as $l) {
            executarSql("INSERT INTO movimentacoes (entrada_id, tipo, motivo, quantidade, valor, observacoes, usuario_id)
                         VALUES (?, 'saida', 'vencimento', ?, ?, 'Baixa dos vencidos', ?)",
                        [$l['id'], (int) $l['saldo'], round((int) $l['saldo'] * (float) $l['custo_unitario'], 2), $usuario['id']]);
        }
        return [201, ['ok' => true, 'baixados' => count($lotes),
                      'mensagem' => $lotes ? count($lotes) . ' lote(s) vencido(s) baixado(s) do estoque.' : 'Nenhum lote vencido com saldo.']];
    });
}

/*
 * A ficha de um item: tudo o que entrou e saiu, em ordem, com o saldo.
 * Aceita ?insumo_id=, ?prato_id= ou ?entrada_id= (a ficha de um lote).
 */
function historicoDoItem(array $consulta, array $usuario): array
{
    $onde = '';
    $par = [];
    foreach (['insumo_id', 'prato_id'] as $coluna) {
        if (!empty($consulta[$coluna])) {
            $onde = 'e.' . $coluna . ' = ?';
            $par = [(int) $consulta[$coluna]];
            break;
        }
    }
    if (!$onde && !empty($consulta['entrada_id'])) {
        $onde = 'e.id = ?';
        $par = [(int) $consulta['entrada_id']];
    }
    if (!$onde) {
        throw new ErroApi(400, 'Informe insumo_id, prato_id ou entrada_id para ver a ficha do item.');
    }

    $entradas = consultar(
        'SELECT id, item, tipo, unidade, quantidade, saldo, custo_total, custo_unitario, validade, dias_validade, lote,
                data_entrada, fornecedor, producao_numero
           FROM vw_entradas e WHERE ' . $onde . ' ORDER BY data_entrada', $par);
    if (!$entradas) {
        return ['movimentos' => [], 'saldo' => 0, 'item' => null, 'resumo' => zeroResumo(), 'entradas' => []];
    }
    $ids = array_column($entradas, 'id');
    $v = vagas($ids);

    $linhas = consultar(
        "SELECT data, origem, descricao, referencia, quantidade, valor, entrada_id, mov_id, motivo
           FROM (
                SELECT e.data_entrada AS data, CASE WHEN e.producao_id IS NULL THEN 'compra' ELSE 'producao_lote' END AS origem,
                       CASE WHEN e.producao_id IS NULL THEN 'Entrada no estoque' ELSE 'Produzido (' || COALESCE(pr.numero, '') || ')' END AS descricao,
                       COALESCE(f.nome, '') AS referencia, e.quantidade AS quantidade, e.custo_total AS valor,
                       e.id AS entrada_id, NULL AS mov_id, NULL AS motivo
                  FROM entradas e
                  LEFT JOIN fornecedores f ON f.id = e.fornecedor_id
                  LEFT JOIN producoes pr ON pr.id = e.producao_id
                 WHERE e.id IN ($v)
                UNION ALL
                SELECT s.data, s.origem,
                       CASE WHEN s.origem = 'venda' THEN 'Venda ' || COALESCE(vd.numero, '#' || vd.id)
                            ELSE 'Produção ' || COALESCE(p.numero, '#' || p.id) END,
                       CASE WHEN s.origem = 'venda' THEN COALESCE(c.nome, 'Consumidor') ELSE COALESCE(pt.nome, '') END,
                       -s.quantidade, s.valor_unitario, s.entrada_id, NULL, NULL
                  FROM vw_saidas_estoque s
                  LEFT JOIN vendas vd ON vd.id = s.venda_id
                  LEFT JOIN clientes c ON c.id = vd.cliente_id
                  LEFT JOIN producoes p ON p.id = s.producao_id
                  LEFT JOIN pratos pt ON pt.id = p.prato_id
                 WHERE s.entrada_id IN ($v)
                UNION ALL
                SELECT m.criado_em, m.motivo, '', COALESCE(m.observacoes, ''),
                       CASE WHEN m.tipo = 'entrada' THEN m.quantidade ELSE -m.quantidade END,
                       m.valor, m.entrada_id, m.id, m.motivo
                  FROM movimentacoes m
                 WHERE m.entrada_id IN ($v)
           )
          ORDER BY data, mov_id",
        array_merge($ids, $ids, $ids));

    $saldo = 0;
    $resumo = zeroResumo();
    $movimentos = [];
    foreach ($linhas as $l) {
        $q = (int) $l['quantidade'];
        $saldo += $q;
        if ($q > 0) {
            $resumo['entrou'] += $q;
        } else {
            $resumo['saiu'] += -$q;
        }
        if ($l['motivo'] !== null) {
            $l['descricao'] = rotuloDe('motivos_movimentacao', $l['motivo']);
            if ($q < 0 && in_array($l['motivo'], ['vencimento', 'perda'], true)) {
                $resumo['perdido'] += -$q;
            }
        }
        unset($l['motivo']);
        if ($usuario['perfil'] !== 'admin') {
            unset($l['valor']);
        }
        $movimentos[] = $l + ['saldo' => $saldo];
    }
    $resumo['saldo'] = $saldo;
    if ($usuario['perfil'] !== 'admin') {
        $entradas = array_map(function ($e) { unset($e['custo_total'], $e['custo_unitario']); return $e; }, $entradas);
    }

    return ['item' => $entradas[0]['item'], 'tipo' => $entradas[0]['tipo'], 'unidade' => $entradas[0]['unidade'],
            'entradas' => $entradas, 'movimentos' => array_reverse($movimentos), 'saldo' => $saldo, 'resumo' => $resumo];
}

function zeroResumo(): array
{
    return ['entrou' => 0, 'saiu' => 0, 'perdido' => 0, 'saldo' => 0];
}
