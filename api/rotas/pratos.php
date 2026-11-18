<?php
/**
 * api/rotas/pratos.php - o cardapio: pratos (nutricao, preco, validade,
 * ficha tecnica, fotos, adicionais) e os grupos de adicionais.
 *
 *   GET    /pratos               lista (?venda=1: so ativos, com o que da para vender agora)
 *   GET    /pratos/{id}          o prato com ficha tecnica, grupos e fotos
 *   POST   /pratos               cria   PUT /pratos/{id}  altera   DELETE /pratos/{id} (admin)
 *          corpo: campos do prato + ficha [{insumo_id, quantidade}] + grupos [id, ...]
 *                 + fotos_novas [dataURL] + fotos_remover [id]
 *   GET    /fotos-prato/{id}     a foto (painel)
 *   GET|POST|PUT|DELETE /grupos-adicionais   o grupo com os adicionais [{id?, nome, preco, kcal, proteinas, ativo}]
 *
 * O que da para vender de um prato (disponivelDoPrato): as porcoes em lotes
 * dentro da validade menos o que os pedidos da loja ainda seguram. Prato
 * feito na hora nao tem lote: vende enquanto estiver ativo.
 */

declare(strict_types=1);

const SQL_PRATOS = "SELECT p.*, c.nome AS categoria, ep.disponivel, ep.vencendo, ep.vencido, ep.proxima_validade,
                           cp.custo_porcao, cp.insumos AS insumos_na_ficha,
                           (SELECT GROUP_CONCAT(f.id) FROM (SELECT id FROM prato_fotos WHERE prato_id = p.id ORDER BY ordem, id) f) AS fotos_ids,
                           (SELECT ROUND(AVG(en.avaliacao_nota), 1) FROM encomendas en
                              JOIN encomenda_itens ei ON ei.encomenda_id = en.id
                             WHERE ei.prato_id = p.id AND en.avaliacao_nota IS NOT NULL) AS nota,
                           (SELECT COUNT(DISTINCT en.id) FROM encomendas en
                              JOIN encomenda_itens ei ON ei.encomenda_id = en.id
                             WHERE ei.prato_id = p.id AND en.avaliacao_nota IS NOT NULL) AS avaliacoes,
                           (SELECT COALESCE(SUM(vi.quantidade), 0) FROM venda_itens vi JOIN vendas v ON v.id = vi.venda_id
                             WHERE vi.prato_id = p.id AND v.status = 'concluida'
                               AND v.data_venda >= date('now', 'localtime', '-30 days')) AS vendidos_30d
                      FROM pratos p
                      LEFT JOIN categorias c ON c.id = p.categoria_id
                      JOIN vw_estoque_pratos ep ON ep.prato_id = p.id
                      JOIN vw_custo_pratos cp ON cp.prato_id = p.id";

/** As tags gravadas ("low_carb,vegano") como lista. */
function tagsDe(?string $tags): array
{
    return $tags === null || $tags === '' ? [] : array_values(array_filter(explode(',', $tags)));
}

/** Porcoes vendaveis agora (null = sem limite: feito na hora). */
function disponivelDoPrato(array $p, ?int $excetoEncomenda = null): ?int
{
    if ((int) $p['feito_na_hora'] === 1) {
        return null;
    }
    return max(0, (int) $p['disponivel'] - reservadoDoPrato((int) $p['id'], $excetoEncomenda));
}

/** O preco que vale agora (o promocional, se houver). */
function precoDoPrato(array $p): float
{
    return $p['preco_promocional'] !== null && (float) $p['preco_promocional'] > 0 ? (float) $p['preco_promocional'] : (float) $p['preco'];
}

/** Um prato como a tela do painel recebe (custo e margem so para o admin). */
function pratoParaTela(array $p, bool $admin): array
{
    $saida = $p;
    foreach (['id', 'categoria_id', 'feito_na_hora', 'porcao_g', 'kcal', 'sodio_mg', 'validade_dias', 'estoque_minimo',
              'publicado', 'destaque', 'ativo', 'ordem', 'disponivel', 'vencendo', 'vencido', 'insumos_na_ficha', 'avaliacoes',
              'vendidos_30d'] as $c) {
        if (array_key_exists($c, $saida) && $saida[$c] !== null) {
            $saida[$c] = (int) $saida[$c];
        }
    }
    foreach (['proteinas', 'carboidratos', 'gorduras', 'fibras', 'preco', 'preco_promocional', 'nota'] as $c) {
        if (array_key_exists($c, $saida) && $saida[$c] !== null) {
            $saida[$c] = (float) $saida[$c];
        }
    }
    $saida['tags'] = tagsDe($p['tags'] ?? null);
    $saida['fotos'] = empty($p['fotos_ids']) ? [] : array_map('intval', explode(',', (string) $p['fotos_ids']));
    unset($saida['fotos_ids']);
    $saida['reservado'] = (int) $saida['feito_na_hora'] === 1 ? 0 : reservadoDoPrato((int) $p['id']);
    $saida['vendavel'] = disponivelDoPrato($p);
    $saida['preco_atual'] = precoDoPrato($p);
    $custo = round((float) ($p['custo_porcao'] ?? 0), 2);
    if ($admin) {
        $saida['custo_porcao'] = $custo;
        $saida['margem'] = $saida['preco_atual'] > 0 && $custo > 0 ? round(($saida['preco_atual'] - $custo) / $saida['preco_atual'] * 100, 1) : null;
    } else {
        unset($saida['custo_porcao']);
    }
    $minimo = (int) $saida['estoque_minimo'] > 0 ? (int) $saida['estoque_minimo'] : ESTOQUE_BAIXO;
    $saida['repor'] = (int) $saida['feito_na_hora'] === 0 && (int) $saida['ativo'] === 1 && (int) $saida['disponivel'] < $minimo;
    return $saida;
}

function pratos(?int $id, string $metodo, array $corpo, array $usuario, array $consulta): array
{
    $admin = $usuario['perfil'] === 'admin';
    if ($metodo === 'GET') {
        if ($id) {
            $p = consultarUm(SQL_PRATOS . ' WHERE p.id = ?', [$id]);
            if (!$p) {
                throw new ErroApi(404, 'Prato não encontrado.');
            }
            $saida = pratoParaTela($p, $admin);
            $saida['ficha'] = array_map(function ($f) use ($admin) {
                $linha = ['insumo_id' => (int) $f['insumo_id'], 'nome' => $f['nome'], 'unidade' => $f['unidade'],
                          'quantidade' => (int) $f['quantidade'], 'disponivel' => (int) $f['disponivel']];
                if ($admin) {
                    $linha['custo'] = round((int) $f['quantidade'] * (float) $f['custo_medio'], 4);
                }
                return $linha;
            }, consultar('SELECT ft.insumo_id, ft.quantidade, i.nome, i.unidade, ei.disponivel, ei.custo_medio
                            FROM ficha_tecnica ft JOIN insumos i ON i.id = ft.insumo_id
                            JOIN vw_estoque_insumos ei ON ei.insumo_id = ft.insumo_id
                           WHERE ft.prato_id = ? ORDER BY i.nome', [$id]));
            $saida['grupos'] = array_map(fn ($g) => ['id' => (int) $g['id'], 'nome' => $g['nome'], 'minimo' => (int) $g['minimo'],
                                                       'maximo' => (int) $g['maximo'], 'ordem' => (int) $g['ordem']],
                consultar('SELECT g.id, g.nome, g.minimo, g.maximo, pg.ordem FROM prato_grupos pg
                             JOIN grupos_adicionais g ON g.id = pg.grupo_id WHERE pg.prato_id = ? ORDER BY pg.ordem, g.nome', [$id]));
            $saida['lotes'] = array_map(function ($l) use ($admin) {
                $l['saldo'] = (int) $l['saldo'];
                $l['dias_validade'] = $l['dias_validade'] === null ? null : (int) $l['dias_validade'];
                if (!$admin) {
                    unset($l['custo_unitario']);
                }
                return $l;
            }, consultar('SELECT id, lote, validade, dias_validade, saldo, producao_numero, custo_unitario, data_entrada
                            FROM vw_entradas WHERE prato_id = ? AND saldo > 0 ORDER BY validade, id', [$id]));
            return [200, ['ok' => true, 'prato' => $saida]];
        }
        $sql = SQL_PRATOS;
        if (!empty($consulta['venda'])) {
            $sql .= ' WHERE p.ativo = 1';
        }
        $lista = array_map(fn ($p) => pratoParaTela($p, $admin), consultar($sql . ' ORDER BY c.ordem, p.ordem, p.nome'));
        return [200, ['ok' => true, 'itens' => $lista]];
    }

    if ($metodo === 'DELETE') {
        $id = exigirId($id);
        if (!consultarUm('SELECT id FROM pratos WHERE id = ?', [$id])) {
            throw new ErroApi(404, 'Prato não encontrado.');
        }
        $usos = [];
        foreach ([['SELECT COUNT(*) AS q FROM entradas WHERE prato_id = ?', '%d lote(s)'],
                  ['SELECT COUNT(*) AS q FROM producoes WHERE prato_id = ?', '%d produção(ões)'],
                  ['SELECT COUNT(*) AS q FROM venda_itens WHERE prato_id = ?', '%d venda(s)'],
                  ['SELECT COUNT(*) AS q FROM encomenda_itens WHERE prato_id = ?', '%d pedido(s) online']] as [$sql, $frase]) {
            $n = (int) consultarUm($sql, [$id])['q'];
            if ($n > 0) {
                $usos[] = sprintf($frase, $n);
            }
        }
        if ($usos) {
            throw new ErroApi(400, 'Este prato tem ' . implode(', ', $usos) . ' e não pode ser excluído. '
                . 'Desative-o (ou tire da loja online): ele some do cardápio e o histórico continua.');
        }
        executarSql('DELETE FROM pratos WHERE id = ?', [$id]);
        return [200, ['ok' => true, 'mensagem' => 'Prato excluído do cardápio.']];
    }

    exigir($metodo === 'POST' || $metodo === 'PUT');
    $atual = null;
    if ($metodo === 'PUT') {
        $id = exigirId($id);
        $atual = consultarUm('SELECT * FROM pratos WHERE id = ?', [$id]);
        if (!$atual) {
            throw new ErroApi(404, 'Prato não encontrado.');
        }
    }
    if (!$admin && (veio($corpo, 'preco') || veio($corpo, 'preco_promocional'))
        && ($atual === null || emCentavos(lerDinheiro($corpo['preco'] ?? $atual['preco']) ?? 0) !== emCentavos($atual['preco'])
            || emCentavos(lerDinheiro($corpo['preco_promocional'] ?? $atual['preco_promocional']) ?? 0) !== emCentavos($atual['preco_promocional'] ?? 0))) {
        throw new ErroApi(403, 'Só o administrador define o preço dos pratos.');
    }
    $d = dadosPrato($corpo, $atual);
    $ficha = array_key_exists('ficha', $corpo) ? fichaDoCorpo($corpo['ficha']) : null;
    $grupos = array_key_exists('grupos', $corpo) ? gruposDoCorpo($corpo['grupos']) : null;
    $novas = $corpo['fotos_novas'] ?? [];
    $remover = $corpo['fotos_remover'] ?? [];
    if (!is_array($novas) || !is_array($remover)) {
        throw new ErroApi(400, 'Fotos inválidas.');
    }
    $fotos = array_map('fotoDoCorpo', array_values($novas));

    return emTransacao(function () use ($id, $atual, $d, $ficha, $grupos, $fotos, $remover) {
        $colunas = array_keys($d);
        if ($atual) {
            executarSql('UPDATE pratos SET ' . implode(' = ?, ', $colunas) . ' = ?, atualizado_em = ? WHERE id = ?',
                        array_merge(array_values($d), [agora(), $id]));
            foreach ($remover as $fotoId) {
                if (is_scalar($fotoId)) {
                    executarSql('DELETE FROM prato_fotos WHERE id = ? AND prato_id = ?', [(int) $fotoId, $id]);
                }
            }
        } else {
            executarSql('INSERT INTO pratos (' . implode(', ', $colunas) . ') VALUES (' . vagas($colunas) . ')', array_values($d));
            $id = (int) banco()->lastInsertId();
        }
        if ($ficha !== null) {
            executarSql('DELETE FROM ficha_tecnica WHERE prato_id = ?', [$id]);
            foreach ($ficha as $insumoId => $quantidade) {
                executarSql('INSERT INTO ficha_tecnica (prato_id, insumo_id, quantidade) VALUES (?, ?, ?)', [$id, $insumoId, $quantidade]);
            }
        }
        if ($grupos !== null) {
            executarSql('DELETE FROM prato_grupos WHERE prato_id = ?', [$id]);
            foreach ($grupos as $ordem => $grupoId) {
                executarSql('INSERT INTO prato_grupos (prato_id, grupo_id, ordem) VALUES (?, ?, ?)', [$id, $grupoId, $ordem]);
            }
        }
        $ja = (int) consultarUm('SELECT COUNT(*) AS q FROM prato_fotos WHERE prato_id = ?', [$id])['q'];
        if ($ja + count($fotos) > LOJA_FOTOS_MAX) {
            throw new ErroApi(400, 'Cada prato leva no máximo ' . LOJA_FOTOS_MAX . ' fotos (este ficaria com ' . ($ja + count($fotos)) . ').');
        }
        $ordem = (int) consultarUm('SELECT COALESCE(MAX(ordem), 0) AS o FROM prato_fotos WHERE prato_id = ?', [$id])['o'];
        $st = banco()->prepare('INSERT INTO prato_fotos (prato_id, ordem, tipo, dados) VALUES (?, ?, ?, ?)');
        foreach ($fotos as [$tipo, $bytes]) {
            $ordem++;
            $st->bindValue(1, $id, PDO::PARAM_INT);
            $st->bindValue(2, $ordem, PDO::PARAM_INT);
            $st->bindValue(3, $tipo);
            $st->bindValue(4, $bytes, PDO::PARAM_LOB);
            $st->execute();
        }
        if ($d['tipo'] === 'producao' && (int) $d['feito_na_hora'] === 0 && $ficha === []) {
            $aviso = ' Sem ficha técnica, a produção não sabe quais insumos baixar.';
        }
        return [$atual ? 200 : 201, ['ok' => true, 'id' => $id,
            'mensagem' => ($atual ? 'Prato atualizado.' : 'Prato cadastrado no cardápio.') . ($aviso ?? '')]];
    });
}

/** Os campos do prato, conferidos (PUT: o que nao veio fica como esta). */
function dadosPrato(array $corpo, ?array $atual): array
{
    $ler = fn (string $c) => array_key_exists($c, $corpo);
    $num = function (string $campo, string $rotulo, bool $inteiro, float $max) use ($corpo, $atual, $ler) {
        if (!$ler($campo)) {
            return $atual[$campo] ?? null;
        }
        if ($corpo[$campo] === null || $corpo[$campo] === '') {
            return null;
        }
        $v = lerDinheiro($corpo[$campo]);
        if ($v === null || $v < 0 || $v > $max) {
            throw new ErroApi(400, "O campo \"{$rotulo}\" precisa ser um número entre 0 e " . (int) $max . '.');
        }
        return $inteiro ? (int) round($v) : round($v, 1);
    };
    $liga = function (string $campo, int $padrao) use ($corpo, $atual, $ler): int {
        if (!$ler($campo)) {
            return $atual !== null ? (int) $atual[$campo] : $padrao;
        }
        return !empty($corpo[$campo]) && $corpo[$campo] !== '0' ? 1 : 0;
    };

    $nome = $ler('nome') ? obrigatorio($corpo, 'nome', 'Nome do prato') : ($atual['nome'] ?? null);
    if ($nome === null) {
        throw new ErroApi(400, 'O campo "Nome do prato" é obrigatório.');
    }
    if (mb_strlen($nome) > 120) {
        throw new ErroApi(400, 'O nome do prato passou de 120 caracteres.');
    }
    $categoriaId = $ler('categoria_id') ? idDoCatalogo($corpo, 'categoria_id', null) : ($atual['categoria_id'] ?? null);
    if ($categoriaId) {
        exigirExistente('categorias', (int) $categoriaId, 'Categoria informada não existe.');
    }
    $tipo = $ler('tipo') ? (txt($corpo, 'tipo') ?? 'producao') : ($atual['tipo'] ?? 'producao');
    if (!in_array($tipo, valoresDe('tipos_prato'), true)) {
        throw new ErroApi(400, 'Tipo de prato inválido: ' . $tipo . '.');
    }
    $feitoNaHora = $liga('feito_na_hora', 0);
    if ($feitoNaHora && $tipo === 'revenda') {
        throw new ErroApi(400, 'Prato de revenda (comprado pronto) tem estoque: ele não pode ser "feito na hora".');
    }
    if ($atual && $feitoNaHora && !(int) $atual['feito_na_hora']
        && (int) consultarUm('SELECT COALESCE(SUM(saldo), 0) AS q FROM vw_entradas WHERE prato_id = ? AND saldo > 0', [$atual['id']])['q'] > 0) {
        throw new ErroApi(400, 'Este prato ainda tem porções em estoque. Venda ou dê baixa nelas antes de marcá-lo como feito na hora.');
    }
    $conservacao = $ler('conservacao') ? (txt($corpo, 'conservacao') ?? 'resfriado') : ($atual['conservacao'] ?? 'resfriado');
    if (!in_array($conservacao, valoresDe('conservacoes'), true)) {
        throw new ErroApi(400, 'Conservação inválida: ' . $conservacao . '.');
    }
    $tags = $ler('tags') ? tagsDoCorpo($corpo['tags']) : ($atual['tags'] ?? null);

    $preco = $ler('preco') ? dinheiro($corpo, 'preco', 'Preço', 0.0) : (float) ($atual['preco'] ?? 0);
    $promo = $ler('preco_promocional') ? (veio($corpo, 'preco_promocional') ? dinheiro($corpo, 'preco_promocional', 'Preço promocional') : null)
           : ($atual['preco_promocional'] ?? null);
    if ($promo !== null && ($promo <= 0 || emCentavos($promo) >= emCentavos($preco))) {
        throw new ErroApi(400, 'O preço promocional precisa ser menor que o preço normal (' . moedaBr($preco) . '). Para tirar a promoção, deixe o campo vazio.');
    }
    $publicado = $liga('publicado', 1);
    $ativo = $liga('ativo', 1);
    if ($publicado && $ativo && $preco <= 0) {
        throw new ErroApi(400, 'Para aparecer na loja online, o prato precisa de preço. Informe o preço ou desligue "Na loja online".');
    }
    $textoLongo = function (string $campo, string $rotulo, int $max) use ($corpo, $atual, $ler) {
        $v = $ler($campo) ? txt($corpo, $campo, $rotulo) : ($atual[$campo] ?? null);
        if ($v !== null && mb_strlen($v) > $max) {
            throw new ErroApi(400, "O campo \"{$rotulo}\" passou de {$max} caracteres.");
        }
        return $v;
    };
    $digitos = function (string $campo, string $rotulo, array $tamanhos) use ($corpo, $atual, $ler) {
        if (!$ler($campo)) {
            return $atual[$campo] ?? null;
        }
        $v = txt($corpo, $campo, $rotulo);
        if ($v === null) {
            return null;
        }
        $v = (string) preg_replace('/\D/', '', $v);
        if (!in_array(strlen($v), $tamanhos, true)) {
            throw new ErroApi(400, $rotulo . ' tem ' . implode(' ou ', $tamanhos) . ' números.');
        }
        return $v;
    };
    $origem = $ler('origem') ? txt($corpo, 'origem') : ($atual['origem'] ?? null);
    if ($origem !== null && !in_array($origem, valoresDe('origens_mercadoria'), true)) {
        throw new ErroApi(400, 'Origem da mercadoria inválida.');
    }
    $unidade = $ler('unidade') ? strtoupper(txt($corpo, 'unidade') ?? 'UN') : ($atual['unidade'] ?? 'UN');
    if (!preg_match('/^[A-Z0-9]{1,6}$/', $unidade)) {
        throw new ErroApi(400, 'Unidade fiscal: até 6 letras, como UN, KG, PCT.');
    }

    return [
        'nome' => $nome, 'categoria_id' => $categoriaId, 'descricao' => $textoLongo('descricao', 'Descrição', 1000),
        'tipo' => $tipo, 'feito_na_hora' => $feitoNaHora,
        'porcao_g' => $num('porcao_g', 'Porção (g)', true, 5000) ?: null,
        'kcal' => $num('kcal', 'Calorias (kcal)', true, 5000), 'proteinas' => $num('proteinas', 'Proteínas (g)', false, 1000),
        'carboidratos' => $num('carboidratos', 'Carboidratos (g)', false, 1000), 'gorduras' => $num('gorduras', 'Gorduras (g)', false, 1000),
        'fibras' => $num('fibras', 'Fibras (g)', false, 1000), 'sodio_mg' => $num('sodio_mg', 'Sódio (mg)', true, 20000),
        'ingredientes' => $textoLongo('ingredientes', 'Ingredientes', 1000), 'alergenicos' => $textoLongo('alergenicos', 'Alergênicos', 300),
        'tags' => $tags, 'conservacao' => $conservacao,
        'validade_dias' => $ler('validade_dias') ? inteiro($corpo, 'validade_dias', 'Validade (dias)', 0, 3650, 3) : (int) ($atual['validade_dias'] ?? 3),
        'modo_preparo' => $textoLongo('modo_preparo', 'Como aquecer / consumir', 500),
        'preco' => $preco, 'preco_promocional' => $promo,
        'estoque_minimo' => $ler('estoque_minimo') ? inteiro($corpo, 'estoque_minimo', 'Estoque mínimo', 0, 100000, 0) : (int) ($atual['estoque_minimo'] ?? 0),
        'publicado' => $publicado, 'destaque' => $liga('destaque', 0), 'ativo' => $ativo,
        'ordem' => $ler('ordem') ? inteiro($corpo, 'ordem', 'Ordem', 0, 100000, 0) : (int) ($atual['ordem'] ?? 0),
        'ncm' => $digitos('ncm', 'NCM', [8]), 'cest' => $digitos('cest', 'CEST', [7]), 'origem' => $origem,
        'unidade' => $unidade, 'gtin' => $digitos('gtin', 'GTIN', [8, 12, 13, 14]),
    ];
}

/** Tags: lista (ou texto com virgulas) de valores do dominio, sem repetir. */
function tagsDoCorpo($valor): ?string
{
    $lista = is_array($valor) ? $valor : preg_split('/\s*,\s*/', (string) $valor, -1, PREG_SPLIT_NO_EMPTY);
    $validas = valoresDe('tags_prato');
    $saida = [];
    foreach ($lista as $t) {
        $t = trim((string) $t);
        if ($t === '') {
            continue;
        }
        if (!in_array($t, $validas, true)) {
            throw new ErroApi(400, 'Selo desconhecido: ' . $t . '.');
        }
        $saida[$t] = true;
    }
    return $saida ? implode(',', array_keys($saida)) : null;
}

/** Ficha tecnica: [{insumo_id, quantidade}] -> [insumo_id => quantidade] (o mesmo insumo duas vezes soma). */
function fichaDoCorpo($ficha): array
{
    if (!is_array($ficha)) {
        throw new ErroApi(400, 'Ficha técnica inválida.');
    }
    $saida = [];
    foreach (array_values($ficha) as $n => $linha) {
        if (!is_array($linha)) {
            throw new ErroApi(400, 'Linha ' . ($n + 1) . ' da ficha técnica inválida.');
        }
        $insumoId = idDoCatalogo($linha, 'insumo_id', null);
        if (!$insumoId) {
            continue;   // linha vazia da tela
        }
        exigirExistente('insumos', $insumoId, 'Linha ' . ($n + 1) . ' da ficha técnica: o insumo não existe.');
        $q = inteiro($linha, 'quantidade', 'Quantidade da ficha técnica', 1, 100000, null);
        if (!$q) {
            throw new ErroApi(400, 'Linha ' . ($n + 1) . ' da ficha técnica: informe a quantidade por porção.');
        }
        $saida[$insumoId] = ($saida[$insumoId] ?? 0) + $q;
    }
    return $saida;
}

/** Grupos de adicionais do prato: lista de ids, na ordem em que aparecem. */
function gruposDoCorpo($grupos): array
{
    if (!is_array($grupos)) {
        throw new ErroApi(400, 'Grupos de adicionais inválidos.');
    }
    $saida = [];
    foreach ($grupos as $g) {
        $gid = is_array($g) ? idDoCatalogo($g, 'id', null) : (is_scalar($g) ? (int) $g : 0);
        if (!$gid) {
            continue;
        }
        exigirExistente('grupos_adicionais', $gid, 'Grupo de adicionais não existe.');
        if (!in_array($gid, $saida, true)) {
            $saida[] = $gid;
        }
    }
    return $saida;
}

/** Foto que veio como data URL: tipo e tamanho conferidos pelo CONTEUDO, nao pelo nome. */
function fotoDoCorpo($valor): array
{
    if (!is_string($valor) || !preg_match('#^data:(image/(?:jpeg|png|webp));base64,([A-Za-z0-9+/=\s]+)$#', $valor, $m)) {
        throw new ErroApi(400, 'A foto precisa ser JPG, PNG ou WEBP.');
    }
    $bytes = base64_decode($m[2], true);
    if ($bytes === false || $bytes === '') {
        throw new ErroApi(400, 'Não consegui ler a foto. Escolha o arquivo de novo.');
    }
    if (strlen($bytes) > LOJA_FOTO_BYTES_MAX) {
        throw new ErroApi(400, 'A foto passou de 1 MB. Use uma foto menor.');
    }
    $info = @getimagesizefromstring($bytes);
    if (!$info || !in_array($info['mime'] ?? '', ['image/jpeg', 'image/png', 'image/webp'], true) || $info[0] > 8000 || $info[1] > 8000) {
        throw new ErroApi(400, 'O arquivo não é uma foto JPG, PNG ou WEBP válida.');
    }
    return [$info['mime'], $bytes];
}

function enviarFoto(?array $foto): void
{
    if (!$foto) {
        responder(404, ['ok' => false, 'erro' => 'Foto não encontrada.']);
        return;
    }
    http_response_code(200);
    header('Content-Type: ' . $foto['tipo']);
    header('Content-Length: ' . strlen((string) $foto['dados']));
    header('X-Content-Type-Options: nosniff');
    header("Content-Security-Policy: default-src 'none'");
    header('Cache-Control: private, max-age=86400');
    echo $foto['dados'];
}

/** A foto de um prato. $soPublicado: a loja online so mostra foto de prato publicado e ativo. */
function fotoDoPrato(?int $id, bool $soPublicado): void
{
    $sql = 'SELECT f.tipo, f.dados FROM prato_fotos f JOIN pratos p ON p.id = f.prato_id WHERE f.id = ?'
         . ($soPublicado ? ' AND p.publicado = 1 AND p.ativo = 1' : '');
    enviarFoto(consultarUm($sql, [exigirId($id)]));
}

// ------------------------------------------------------------------
// Grupos de adicionais
// ------------------------------------------------------------------
function gruposAdicionais(?int $id, string $metodo, array $corpo, array $usuario): array
{
    $montar = function (array $g): array {
        $g['id'] = (int) $g['id'];
        $g['minimo'] = (int) $g['minimo'];
        $g['maximo'] = (int) $g['maximo'];
        $g['ativo'] = (int) $g['ativo'];
        $g['pratos'] = (int) consultarUm('SELECT COUNT(*) AS q FROM prato_grupos WHERE grupo_id = ?', [$g['id']])['q'];
        $g['adicionais'] = array_map(fn ($a) => ['id' => (int) $a['id'], 'nome' => $a['nome'], 'preco' => (float) $a['preco'],
                                                 'kcal' => (int) $a['kcal'], 'proteinas' => (float) $a['proteinas'],
                                                 'ativo' => (int) $a['ativo'], 'ordem' => (int) $a['ordem']],
            consultar('SELECT * FROM adicionais WHERE grupo_id = ? ORDER BY ordem, id', [$g['id']]));
        return $g;
    };
    if ($metodo === 'GET') {
        if ($id) {
            $g = consultarUm('SELECT * FROM grupos_adicionais WHERE id = ?', [$id]);
            if (!$g) {
                throw new ErroApi(404, 'Grupo de adicionais não encontrado.');
            }
            return [200, ['ok' => true, 'grupo' => $montar($g)]];
        }
        return [200, ['ok' => true, 'itens' => array_map($montar, consultar('SELECT * FROM grupos_adicionais ORDER BY ativo DESC, nome'))]];
    }
    if ($metodo === 'DELETE') {
        $id = exigirId($id);
        if (!consultarUm('SELECT id FROM grupos_adicionais WHERE id = ?', [$id])) {
            throw new ErroApi(404, 'Grupo de adicionais não encontrado.');
        }
        executarSql('DELETE FROM grupos_adicionais WHERE id = ?', [$id]);
        return [200, ['ok' => true, 'mensagem' => 'Grupo excluído (os pedidos antigos guardam o nome do adicional).']];
    }
    exigir($metodo === 'POST' || $metodo === 'PUT');
    $atual = null;
    if ($metodo === 'PUT') {
        $id = exigirId($id);
        $atual = consultarUm('SELECT * FROM grupos_adicionais WHERE id = ?', [$id]);
        if (!$atual) {
            throw new ErroApi(404, 'Grupo de adicionais não encontrado.');
        }
    }
    $nome = array_key_exists('nome', $corpo) ? obrigatorio($corpo, 'nome', 'Nome do grupo') : ($atual['nome'] ?? null);
    if ($nome === null) {
        throw new ErroApi(400, 'O campo "Nome do grupo" é obrigatório.');
    }
    $minimo = inteiro($corpo, 'minimo', 'Mínimo a escolher', 0, 20, $atual ? (int) $atual['minimo'] : 0);
    $maximo = inteiro($corpo, 'maximo', 'Máximo a escolher', 1, 20, $atual ? (int) $atual['maximo'] : 1);
    if ($maximo < $minimo) {
        throw new ErroApi(400, 'O máximo a escolher não pode ser menor que o mínimo.');
    }
    $ativo = array_key_exists('ativo', $corpo) ? (int) (bool) $corpo['ativo'] : ($atual ? (int) $atual['ativo'] : 1);
    $descricao = array_key_exists('descricao', $corpo) ? txt($corpo, 'descricao') : ($atual['descricao'] ?? null);
    $adicionais = null;
    if (array_key_exists('adicionais', $corpo)) {
        if (!is_array($corpo['adicionais'])) {
            throw new ErroApi(400, 'Adicionais inválidos.');
        }
        $adicionais = [];
        foreach (array_values($corpo['adicionais']) as $n => $a) {
            if (!is_array($a) || txt($a, 'nome') === null) {
                continue;
            }
            $adicionais[] = ['id' => idDoCatalogo($a, 'id', null), 'nome' => txt($a, 'nome'),
                             'preco' => dinheiro($a, 'preco', 'Preço do adicional ' . ($n + 1), 0.0),
                             'kcal' => inteiro($a, 'kcal', 'Kcal do adicional ' . ($n + 1), 0, 5000, 0),
                             'proteinas' => round((float) (lerDinheiro($a['proteinas'] ?? 0) ?? 0), 1),
                             'ativo' => array_key_exists('ativo', $a) ? (int) (bool) $a['ativo'] : 1, 'ordem' => $n];
        }
        if (!$adicionais) {
            throw new ErroApi(400, 'O grupo precisa de pelo menos uma opção (ex.: "Ovo cozido", "Molho de mostarda e mel").');
        }
        if ($minimo > count(array_filter($adicionais, fn ($a) => $a['ativo']))) {
            throw new ErroApi(400, 'O cliente precisa escolher ' . $minimo . ' e o grupo só tem ' . count($adicionais) . ' opção(ões) ativa(s).');
        }
    }
    return emTransacao(function () use ($id, $atual, $nome, $descricao, $minimo, $maximo, $ativo, $adicionais) {
        if ($atual) {
            executarSql('UPDATE grupos_adicionais SET nome = ?, descricao = ?, minimo = ?, maximo = ?, ativo = ? WHERE id = ?',
                        [$nome, $descricao, $minimo, $maximo, $ativo, $id]);
        } else {
            executarSql('INSERT INTO grupos_adicionais (nome, descricao, minimo, maximo, ativo) VALUES (?, ?, ?, ?, ?)',
                        [$nome, $descricao, $minimo, $maximo, $ativo]);
            $id = (int) banco()->lastInsertId();
        }
        if ($adicionais !== null) {
            $manter = [];
            foreach ($adicionais as $a) {
                if ($a['id'] && consultarUm('SELECT id FROM adicionais WHERE id = ? AND grupo_id = ?', [$a['id'], $id])) {
                    executarSql('UPDATE adicionais SET nome = ?, preco = ?, kcal = ?, proteinas = ?, ativo = ?, ordem = ? WHERE id = ?',
                                [$a['nome'], $a['preco'], $a['kcal'], $a['proteinas'], $a['ativo'], $a['ordem'], $a['id']]);
                    $manter[] = $a['id'];
                } else {
                    executarSql('INSERT INTO adicionais (grupo_id, nome, preco, kcal, proteinas, ativo, ordem) VALUES (?, ?, ?, ?, ?, ?, ?)',
                                [$id, $a['nome'], $a['preco'], $a['kcal'], $a['proteinas'], $a['ativo'], $a['ordem']]);
                    $manter[] = (int) banco()->lastInsertId();
                }
            }
            executarSql('DELETE FROM adicionais WHERE grupo_id = ? AND id NOT IN (' . vagas($manter) . ')', array_merge([$id], $manter));
        }
        return [$atual ? 200 : 201, ['ok' => true, 'id' => $id, 'mensagem' => $atual ? 'Grupo de adicionais atualizado.' : 'Grupo de adicionais criado.']];
    });
}
