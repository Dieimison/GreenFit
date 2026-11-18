<?php
/**
 * api/rotas/producao.php - ordens de producao: a cozinha transforma insumos
 * em porcoes de um prato.
 *
 *   GET    /producoes                 lista (?status=planejada|concluida|cancelada)
 *   GET    /producoes/{id}            com o que consome (concluida: o que saiu de cada lote;
 *                                    planejada: o que a ficha pede x o que tem)
 *   POST   /producoes                 {prato_id, quantidade, data_producao?, observacoes?, concluir?}
 *   PUT    /producoes/{id}            altera a planejada (quantidade, data, observacoes)
 *   DELETE /producoes/{id}            apaga a planejada (admin)
 *   POST   /producoes/{id}/concluir   {quantidade?, validade?, lote?}: baixa os insumos e cria o lote
 *   POST   /producoes/{id}/cancelar   {motivo}: planejada sai da lista; concluida so se o lote
 *                                    estiver inteiro (o lote some e os insumos voltam)
 *
 * Concluir, numa transacao so:
 *   - cada insumo da ficha tecnica x porcoes sai dos lotes (o que vence
 *     primeiro antes; vencido nunca) - producao_itens, com o custo congelado;
 *   - nasce o lote do prato (entradas.producao_id) com custo = soma dos
 *     insumos e validade = data + validade_dias do prato (ou a informada).
 */

declare(strict_types=1);

const SQL_PRODUCAO = "SELECT pr.*, p.nome AS prato, p.validade_dias, p.conservacao, u.nome AS usuario,
                             (SELECT e.id FROM entradas e WHERE e.producao_id = pr.id LIMIT 1) AS entrada_id,
                             (SELECT e.saldo FROM vw_entradas e WHERE e.producao_id = pr.id LIMIT 1) AS saldo_lote
                        FROM producoes pr
                        JOIN pratos p ON p.id = pr.prato_id
                        LEFT JOIN usuarios u ON u.id = pr.usuario_id";

function producaoParaTela(array $p, bool $admin): array
{
    foreach (['id', 'prato_id', 'quantidade', 'validade_dias', 'entrada_id', 'saldo_lote'] as $c) {
        if (isset($p[$c])) {
            $p[$c] = (int) $p[$c];
        }
    }
    $p['custo_total'] = round((float) $p['custo_total'], 2);
    $p['custo_porcao'] = $p['quantidade'] > 0 ? round($p['custo_total'] / $p['quantidade'], 2) : 0;
    if (!$admin) {
        unset($p['custo_total'], $p['custo_porcao']);
    }
    $p['pode_cancelar'] = $p['status'] === 'planejada'
        || ($p['status'] === 'concluida' && $admin && (int) ($p['saldo_lote'] ?? 0) === (int) $p['quantidade']
            && !consultarUm('SELECT 1 FROM movimentacoes m JOIN entradas e ON e.id = m.entrada_id WHERE e.producao_id = ? LIMIT 1', [$p['id']]));
    return $p;
}

/*
 * O que a ficha tecnica pede para N porcoes, insumo a insumo, e o que tem
 * em estoque (dentro da validade). falta > 0 = nao da para concluir.
 */
function necessidadeDaProducao(int $pratoId, int $porcoes, bool $admin): array
{
    return array_map(function ($f) use ($porcoes, $admin) {
        $precisa = (int) $f['quantidade'] * $porcoes;
        $linha = ['insumo_id' => (int) $f['insumo_id'], 'nome' => $f['nome'], 'unidade' => $f['unidade'],
                  'por_porcao' => (int) $f['quantidade'], 'precisa' => $precisa, 'disponivel' => (int) $f['disponivel'],
                  'falta' => max(0, $precisa - (int) $f['disponivel'])];
        if ($admin) {
            $linha['custo_previsto'] = round($precisa * (float) $f['custo_medio'], 2);
        }
        return $linha;
    }, consultar('SELECT ft.insumo_id, ft.quantidade, i.nome, i.unidade, ei.disponivel, ei.custo_medio
                    FROM ficha_tecnica ft JOIN insumos i ON i.id = ft.insumo_id
                    JOIN vw_estoque_insumos ei ON ei.insumo_id = ft.insumo_id
                   WHERE ft.prato_id = ? ORDER BY i.nome', [$pratoId]));
}

function producoes(?int $id, ?string $acao, string $metodo, array $corpo, array $usuario, array $consulta): array
{
    $admin = $usuario['perfil'] === 'admin';
    if ($acao !== null) {
        exigir($metodo === 'POST');
        $id = exigirId($id);
        return $acao === 'concluir' ? concluirProducao($id, $corpo, $usuario) : cancelarProducao($id, $corpo, $usuario);
    }
    if ($metodo === 'GET') {
        if ($id) {
            $p = consultarUm(SQL_PRODUCAO . ' WHERE pr.id = ?', [$id]);
            if (!$p) {
                throw new ErroApi(404, 'Ordem de produção não encontrada.');
            }
            $saida = producaoParaTela($p, $admin);
            if ($p['status'] === 'planejada') {
                $saida['necessidade'] = necessidadeDaProducao((int) $p['prato_id'], (int) $p['quantidade'], $admin);
            } else {
                $saida['consumo'] = array_map(function ($i) use ($admin) {
                    $i['quantidade'] = (int) $i['quantidade'];
                    if (!$admin) {
                        unset($i['custo_unitario'], $i['subtotal']);
                    }
                    return $i;
                }, consultar('SELECT pi.insumo_id, i.nome, i.unidade, pi.entrada_id, e.lote, e.validade, pi.quantidade,
                                     pi.custo_unitario, pi.subtotal
                                FROM producao_itens pi JOIN insumos i ON i.id = pi.insumo_id
                                JOIN entradas e ON e.id = pi.entrada_id
                               WHERE pi.producao_id = ? ORDER BY i.nome, pi.id', [$id]));
            }
            return [200, ['ok' => true, 'producao' => $saida]];
        }
        $onde = [];
        $par = [];
        $status = (string) ($consulta['status'] ?? '');
        if (in_array($status, valoresDe('status_producao'), true)) {
            $onde[] = 'pr.status = ?';
            $par[] = $status;
        }
        $lista = consultar(SQL_PRODUCAO . ($onde ? ' WHERE ' . implode(' AND ', $onde) : '')
            . " ORDER BY CASE pr.status WHEN 'planejada' THEN 0 ELSE 1 END, pr.data_producao DESC, pr.id DESC LIMIT 500", $par);
        return [200, ['ok' => true, 'itens' => array_map(function ($p) use ($admin) {
            $saida = producaoParaTela($p, $admin);
            if ($p['status'] === 'planejada') {
                $falta = array_filter(necessidadeDaProducao((int) $p['prato_id'], (int) $p['quantidade'], false), fn ($n) => $n['falta'] > 0);
                $saida['faltando'] = array_values(array_map(fn ($n) => $n['nome'], $falta));
            }
            return $saida;
        }, $lista)]];
    }

    if ($metodo === 'POST') {
        exigir($id === null);
        $pratoId = idDoCatalogo($corpo, 'prato_id', null);
        if (!$pratoId) {
            throw new ErroApi(400, 'Escolha o prato que vai ser produzido.');
        }
        $prato = pratoProduzivel($pratoId);
        $quantidade = inteiro($corpo, 'quantidade', 'Porções', 1, PRODUCAO_MAXIMA, null);
        if (!$quantidade) {
            throw new ErroApi(400, 'Informe quantas porções vão ser produzidas.');
        }
        $data = dataDoCorpo($corpo, 'data_producao', 'Data da produção') ?? date('Y-m-d');
        $obs = txt($corpo, 'observacoes', 'Observações');
        return emTransacao(function () use ($prato, $quantidade, $data, $obs, $usuario, $corpo) {
            executarSql('INSERT INTO producoes (numero, prato_id, quantidade, status, data_producao, observacoes, usuario_id)
                         VALUES (?, ?, ?, ?, ?, ?, ?)',
                        [proximoNumero('producoes', 'PR'), $prato['id'], $quantidade, 'planejada', $data, $obs, $usuario['id']]);
            $novo = (int) banco()->lastInsertId();
            if (!empty($corpo['concluir'])) {
                [, $r] = concluirProducao($novo, $corpo, $usuario);
                return [201, ['ok' => true, 'id' => $novo] + $r];
            }
            return [201, ['ok' => true, 'id' => $novo, 'mensagem' => 'Produção de ' . $quantidade . ' porção(ões) de "' . $prato['nome']
                . '" planejada para ' . dataBr($data) . '.']];
        });
    }

    $id = exigirId($id);
    $atual = consultarUm('SELECT * FROM producoes WHERE id = ?', [$id]);
    if (!$atual) {
        throw new ErroApi(404, 'Ordem de produção não encontrada.');
    }
    if ($atual['status'] !== 'planejada') {
        throw new ErroApi(400, 'A produção ' . $atual['numero'] . ' está ' . rotuloDe('status_producao', $atual['status'])
            . ' e não muda mais' . ($atual['status'] === 'concluida' ? ' (para desfazer, cancele).' : '.'));
    }
    if ($metodo === 'PUT') {
        $quantidade = inteiro($corpo, 'quantidade', 'Porções', 1, PRODUCAO_MAXIMA, (int) $atual['quantidade']);
        $data = dataDoCorpo($corpo, 'data_producao', 'Data da produção') ?? $atual['data_producao'];
        executarSql('UPDATE producoes SET quantidade = ?, data_producao = ?, observacoes = ?, atualizado_em = ? WHERE id = ?',
                    [$quantidade, $data, txtOu($corpo, 'observacoes', $atual), agora(), $id]);
        return [200, ['ok' => true, 'mensagem' => 'Produção ' . $atual['numero'] . ' atualizada.']];
    }
    if ($metodo === 'DELETE') {
        executarSql('DELETE FROM producoes WHERE id = ?', [$id]);
        return [200, ['ok' => true, 'mensagem' => 'Produção ' . $atual['numero'] . ' apagada.']];
    }
    throw new ErroApi(405, 'Método não permitido para /api/producoes.');
}

/** O prato, se ele pode ser produzido (da cozinha, com lote). */
function pratoProduzivel(int $pratoId): array
{
    $prato = consultarUm('SELECT * FROM pratos WHERE id = ?', [$pratoId]);
    if (!$prato) {
        throw new ErroApi(400, 'Prato informado não existe.');
    }
    if ($prato['tipo'] !== 'producao') {
        throw new ErroApi(400, '"' . $prato['nome'] . '" é de revenda (comprado pronto): ele entra pelo estoque, não pela produção.');
    }
    if ((int) $prato['feito_na_hora'] === 1) {
        throw new ErroApi(400, '"' . $prato['nome'] . '" é feito na hora, quando o pedido chega: não tem produção antecipada nem estoque.');
    }
    return $prato;
}

function concluirProducao(int $id, array $corpo, array $usuario): array
{
    return emTransacao(function () use ($id, $corpo, $usuario) {
        $p = consultarUm('SELECT * FROM producoes WHERE id = ?', [$id]);
        if (!$p) {
            throw new ErroApi(404, 'Ordem de produção não encontrada.');
        }
        if ($p['status'] !== 'planejada') {
            throw new ErroApi(409, 'A produção ' . $p['numero'] . ' já está ' . rotuloDe('status_producao', $p['status']) . '.');
        }
        $prato = pratoProduzivel((int) $p['prato_id']);
        // Rendeu diferente do planejado? Vale o que saiu da panela.
        $quantidade = inteiro($corpo, 'quantidade', 'Porções produzidas', 1, PRODUCAO_MAXIMA, (int) $p['quantidade']);
        $hoje = date('Y-m-d');
        $validade = dataDoCorpo($corpo, 'validade', 'Validade do lote')
                 ?? ((int) $prato['validade_dias'] > 0 ? date('Y-m-d', strtotime($hoje . ' +' . (int) $prato['validade_dias'] . ' days')) : null);
        if ($validade !== null && $validade < $hoje) {
            throw new ErroApi(400, 'A validade do lote não pode ser antes de hoje.');
        }
        $lote = txt($corpo, 'lote', 'Lote') ?? $p['numero'];

        $custo = 0.0;
        $baixados = [];
        foreach (necessidadeDaProducao((int) $prato['id'], $quantidade, true) as $n) {
            foreach (alocarLotes('insumo_id', $n['insumo_id'], $n['precisa'], $n['nome'], $n['unidade']) as [$entradaId, $q, $cu]) {
                $sub = round($q * $cu, 4);
                executarSql('INSERT INTO producao_itens (producao_id, insumo_id, entrada_id, quantidade, custo_unitario, subtotal)
                             VALUES (?, ?, ?, ?, ?, ?)', [$id, $n['insumo_id'], $entradaId, $q, $cu, $sub]);
                $custo += $sub;
                $baixados[] = $entradaId;
            }
        }
        $custo = round($custo, 2);
        conferirSaldos($baixados, 'Algum insumo foi usado por outra produção ao mesmo tempo. Confira o estoque e conclua de novo.');

        $agora = agora();
        executarSql("UPDATE producoes SET status = 'concluida', quantidade = ?, validade = ?, custo_total = ?, concluida_em = ?,
                                         concluida_por = ?, atualizado_em = ? WHERE id = ?",
                    [$quantidade, $validade, $custo, $agora, $usuario['id'], $agora, $id]);
        executarSql("INSERT INTO entradas (tipo, prato_id, producao_id, quantidade, custo_total, lote, validade, observacoes, data_entrada)
                     VALUES ('prato', ?, ?, ?, ?, ?, ?, ?, ?)",
                    [$prato['id'], $id, $quantidade, $custo, $lote, $validade, 'Produção ' . $p['numero'], $agora]);
        $semFicha = !consultarUm('SELECT 1 FROM ficha_tecnica WHERE prato_id = ? LIMIT 1', [$prato['id']]);
        return [200, ['ok' => true, 'mensagem' => 'Produção ' . $p['numero'] . ' concluída: ' . $quantidade . ' porção(ões) de "'
            . $prato['nome'] . '" no estoque' . ($validade ? ', validade ' . dataBr($validade) : '') . '.'
            . ($semFicha ? ' Atenção: o prato não tem ficha técnica, nenhum insumo foi baixado e o custo ficou zero.' : '')]];
    });
}

function cancelarProducao(int $id, array $corpo, array $usuario): array
{
    $motivo = txt($corpo, 'motivo', 'Motivo');
    if ($motivo === null || mb_strlen($motivo) < 3) {
        throw new ErroApi(400, 'Escreva o motivo do cancelamento.');
    }
    return emTransacao(function () use ($id, $motivo, $usuario) {
        $p = consultarUm(SQL_PRODUCAO . ' WHERE pr.id = ?', [$id]);
        if (!$p) {
            throw new ErroApi(404, 'Ordem de produção não encontrada.');
        }
        if ($p['status'] === 'cancelada') {
            throw new ErroApi(400, 'A produção ' . $p['numero'] . ' já está cancelada.');
        }
        $mensagem = 'Produção ' . $p['numero'] . ' cancelada.';
        if ($p['status'] === 'concluida') {
            if ($usuario['perfil'] !== 'admin') {
                throw new ErroApi(403, 'Só o administrador cancela uma produção já concluída (ela devolve insumos ao estoque).');
            }
            $entradaId = (int) $p['entrada_id'];
            $s = consultarUm('SELECT * FROM vw_entradas_saldo WHERE entrada_id = ?', [$entradaId]);
            if ((int) $s['vendido'] > 0 || (int) $s['usado_producao'] > 0 || (int) $s['mov_entrada'] > 0 || (int) $s['mov_saida'] > 0) {
                throw new ErroApi(400, 'Não dá para cancelar: porções deste lote já saíram (venda, baixa ou ajuste). '
                    . 'Para tirar o que sobrou, use Movimentar estoque.');
            }
            executarSql('DELETE FROM entradas WHERE id = ?', [$entradaId]);
            $mensagem .= ' O lote saiu do estoque e os insumos voltaram.';
        }
        executarSql("UPDATE producoes SET status = 'cancelada', cancelada_em = ?, cancelada_por = ?, motivo_cancelamento = ?,
                                         atualizado_em = ? WHERE id = ?", [agora(), $usuario['id'], $motivo, agora(), $id]);
        return [200, ['ok' => true, 'mensagem' => $mensagem]];
    });
}
