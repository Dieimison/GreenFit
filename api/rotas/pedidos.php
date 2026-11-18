<?php
/**
 * api/rotas/pedidos.php - pedido de entrada (v7): a mercadoria que chega,
 * com ou sem a nota do fornecedor.
 *
 *   GET    /pedidos               lista
 *   GET    /pedidos/{id}          com itens, parcelas e sugestoes de vinculo
 *   POST   /pedidos               cria rascunho digitado; com {xml} importa a NF-e
 *   PUT    /pedidos/{id}          grava o rascunho (cabecalho, itens e parcelas inteiros)
 *   DELETE /pedidos/{id}          apaga rascunho (admin)
 *   POST   /pedidos/{id}/confirmar   vira estoque e contas a pagar (admin, ou chave)
 *   POST   /pedidos/{id}/cancelar    {motivo}: desfaz o que a confirmacao fez (admin)
 *
 * Confirmar, numa transacao so:
 *   - cada linha vira um lote (quantidade da nota x fator: 2,5 KG x 1000 = 2500 g);
 *     linha com tipo mas sem item do catalogo cria o item com o nome da nota;
 *   - o custo de cada unidade leva o desconto da linha e a sua parte do
 *     frete e dos "outros" (seguro, IPI, ST: o que soma no total da nota);
 *   - a natureza diz se mexe no estoque e se gera conta a pagar; as contas
 *     seguem as duplicatas da nota (ou uma so, no total, vencendo na entrada);
 *   - "o codigo X deste fornecedor e o item Y" fica guardado para a proxima nota.
 * Cancelar so passa se nada do que entrou ja saiu e nenhuma conta foi paga.
 *
 * O XML importado e conferido pelo formato, pela chave de acesso (digito
 * verificador e coerencia com emitente, modelo e numero) e pelo destinatario.
 * A autenticidade (assinatura, consulta na SEFAZ) fica para a etapa do
 * documento fiscal.
 */

declare(strict_types=1);

const SQL_PEDIDO = "SELECT p.*, n.descricao AS natureza, n.codigo AS natureza_codigo, n.movimenta_estoque,
                           n.gera_financeiro AS natureza_financeiro, f.nome AS fornecedor, f.uf AS fornecedor_uf,
                           (SELECT COUNT(*) FROM pedido_itens i WHERE i.pedido_id = p.id) AS itens
                      FROM pedidos p
                      JOIN naturezas_operacao n ON n.id = p.natureza_id
                      LEFT JOIN fornecedores f ON f.id = p.fornecedor_id";

const XML_TAMANHO_MAXIMO = 3000000;

// ------------------------------------------------------------------
// Chave de acesso e XML da NF-e
// ------------------------------------------------------------------
/*
 * Chave de 44 posicoes: cUF(2) AAMM(4) CNPJ(14) modelo(2) serie(3)
 * numero(9) tpEmis(1) cNF(8) DV(1). DV pelo modulo 11 (pesos 2 a 9 da
 * direita para a esquerda); resto 0 ou 1 da DV 0. Com o CNPJ alfanumerico
 * cada caractere vale o codigo ASCII - 48, como no proprio CNPJ.
 */
function chaveNfeValida(string $chave): bool
{
    if (!preg_match('/^\d{6}[0-9A-Z]{14}\d{24}$/', $chave)) {
        return false;
    }
    $soma = 0;
    $peso = 2;
    for ($i = 42; $i >= 0; $i--) {
        $soma += (ord($chave[$i]) - 48) * $peso;
        $peso = $peso === 9 ? 2 : $peso + 1;
    }
    $resto = $soma % 11;
    return (int) $chave[43] === ($resto < 2 ? 0 : 11 - $resto);
}

/** Os elementos com este nome local, sem depender do namespace. */
function nosXml(SimpleXMLElement $no, string $caminho): array
{
    $partes = array_map(fn ($p) => "*[local-name()='{$p}']", explode('/', $caminho));
    return $no->xpath('./' . implode('/', $partes)) ?: [];
}

function textoXml(SimpleXMLElement $no, string $caminho): ?string
{
    $achado = nosXml($no, $caminho);
    if (!$achado) {
        return null;
    }
    $t = trim((string) $achado[0]);
    return $t === '' ? null : $t;
}

function numeroXml(SimpleXMLElement $no, string $caminho): float
{
    return round((float) (textoXml($no, $caminho) ?? '0'), 2);
}

/** Le uma NF-e (procNFe ou NFe) e devolve so o que o pedido usa. Funcao pura. */
function lerNfeXml(string $xml): array
{
    if (strlen($xml) > XML_TAMANHO_MAXIMO) {
        throw new ErroApi(400, 'O arquivo é grande demais para um XML de nota (limite de 3 MB).');
    }
    if (stripos($xml, '<!DOCTYPE') !== false || stripos($xml, '<!ENTITY') !== false) {
        throw new ErroApi(400, 'XML de nota não tem DOCTYPE nem ENTITY: este arquivo não foi aceito.');
    }
    $usoAntes = libxml_use_internal_errors(true);
    $doc = simplexml_load_string($xml, SimpleXMLElement::class, LIBXML_NONET | LIBXML_NOCDATA);
    libxml_clear_errors();
    libxml_use_internal_errors($usoAntes);
    if ($doc === false) {
        throw new ErroApi(400, 'O arquivo não é um XML válido. Use o XML da nota que o fornecedor mandou (o .xml, não o PDF).');
    }
    $inf = $doc->xpath("//*[local-name()='infNFe']")[0] ?? null;
    if (!$inf) {
        throw new ErroApi(400, 'Este XML não é de NF-e (não tem o grupo infNFe).');
    }
    $modelo = textoXml($inf, 'ide/mod');
    if ($modelo !== '55') {
        throw new ErroApi(400, 'Só a NF-e modelo 55 (a nota do fornecedor) entra no pedido. Este XML é modelo ' . ($modelo ?? '?') . '.');
    }
    $chave = substr((string) ($inf['Id'] ?? ''), 3);
    if (!chaveNfeValida($chave)) {
        throw new ErroApi(400, 'A chave de acesso deste XML não confere (o dígito verificador está errado). O arquivo pode estar alterado.');
    }
    $emitDoc = textoXml($inf, 'emit/CNPJ') ?? textoXml($inf, 'emit/CPF');
    $numero = textoXml($inf, 'ide/nNF');
    if (textoXml($inf, 'emit/CNPJ') !== null && substr($chave, 6, 14) !== $emitDoc) {
        throw new ErroApi(400, 'A chave de acesso não é do CNPJ do emitente desta nota. O arquivo pode estar alterado.');
    }
    if (substr($chave, 20, 2) !== '55' || (int) substr($chave, 25, 9) !== (int) $numero) {
        throw new ErroApi(400, 'A chave de acesso não bate com o modelo ou o número da nota. O arquivo pode estar alterado.');
    }
    if (textoXml($inf, 'ide/tpNF') !== '1') {
        throw new ErroApi(400, 'Esta nota é de ENTRADA para quem a emitiu (tpNF 0), não uma venda para a loja. Confira com o fornecedor.');
    }

    $itens = [];
    foreach (nosXml($inf, 'det') as $det) {
        $qtd = round((float) (textoXml($det, 'prod/qCom') ?? '0'), 4);
        if ($qtd <= 0) {
            throw new ErroApi(400, 'O item "' . textoXml($det, 'prod/xProd') . '" vem com quantidade zero.');
        }
        $gtin = textoXml($det, 'prod/cEAN');
        $itens[] = [
            'descricao' => textoXml($det, 'prod/xProd') ?? 'Item sem descrição',
            'codigo_fornecedor' => textoXml($det, 'prod/cProd'),
            'gtin' => $gtin && strtoupper($gtin) !== 'SEM GTIN' ? $gtin : null,
            'ncm' => textoXml($det, 'prod/NCM'),
            'cest' => textoXml($det, 'prod/CEST'),
            'cfop_nota' => textoXml($det, 'prod/CFOP'),
            'unidade' => textoXml($det, 'prod/uCom'),
            'quantidade' => $qtd,
            'valor_total' => numeroXml($det, 'prod/vProd'),
            'valor_desconto' => numeroXml($det, 'prod/vDesc'),
        ];
    }
    if (!$itens) {
        throw new ErroApi(400, 'A nota não tem itens.');
    }
    $tot = nosXml($inf, 'total/ICMSTot')[0] ?? null;
    $vProd = $tot ? numeroXml($tot, 'vProd') : 0.0;
    $vDesc = $tot ? numeroXml($tot, 'vDesc') : 0.0;
    $vFrete = $tot ? numeroXml($tot, 'vFrete') : 0.0;
    $vNF = $tot ? numeroXml($tot, 'vNF') : 0.0;
    $parcelas = [];
    foreach (nosXml($inf, 'cobr/dup') as $dup) {
        $parcelas[] = ['numero' => textoXml($dup, 'nDup'), 'vencimento' => textoXml($dup, 'dVenc'), 'valor' => numeroXml($dup, 'vDup')];
    }
    return [
        'chave' => $chave, 'numero' => $numero, 'serie' => textoXml($inf, 'ide/serie'),
        'emissao' => substr(str_replace('T', ' ', textoXml($inf, 'ide/dhEmi') ?? textoXml($inf, 'ide/dEmi') ?? ''), 0, 19) ?: null,
        'emitente' => ['documento' => $emitDoc, 'nome' => textoXml($inf, 'emit/xNome') ?? 'Fornecedor da nota ' . $numero,
                       'ie' => textoXml($inf, 'emit/IE'), 'uf' => textoXml($inf, 'emit/enderEmit/UF'),
                       'telefone' => textoXml($inf, 'emit/enderEmit/fone')],
        'destinatario' => textoXml($inf, 'dest/CNPJ') ?? textoXml($inf, 'dest/CPF'),
        'itens' => $itens,
        'valor_produtos' => $vProd, 'valor_desconto' => $vDesc, 'valor_frete' => $vFrete,
        // Outros = tudo que soma no total da nota alem de produtos, desconto e frete (seguro, IPI, ST...).
        'valor_outros' => round($vNF - ($vProd - $vDesc + $vFrete), 2),
        'valor_total' => $vNF,
        'parcelas' => $parcelas,
    ];
}

/** CNPJ/CPF so com letras e numeros, em maiuscula (para comparar). */
function documentoLimpo(?string $doc): string
{
    return strtoupper((string) preg_replace('/[^0-9A-Za-z]/', '', (string) $doc));
}

function fornecedorPeloDocumento(string $doc): ?array
{
    if ($doc === '') {
        return null;
    }
    foreach (consultar("SELECT id, nome, documento FROM fornecedores WHERE documento IS NOT NULL AND documento <> ''") as $f) {
        if (documentoLimpo($f['documento']) === $doc) {
            return $f;
        }
    }
    return null;
}

/*
 * Fator sugerido para a unidade da nota: 1 KG = 1000 g, 1 L = 1000 ml.
 * Para "UN", "CX", "PCT" a cozinha confere (uma caixa pode ter 12 un).
 */
function fatorDaUnidade(?string $unidade): int
{
    $u = strtoupper(trim((string) $unidade));
    return in_array($u, ['KG', 'KGS', 'KILO', 'L', 'LT', 'LTS', 'LITRO'], true) ? 1000 : 1;
}

/** A unidade do estoque que combina com a unidade da nota (insumo novo). */
function unidadeDoEstoque(?string $unidade): string
{
    $u = strtoupper(trim((string) $unidade));
    if (in_array($u, ['KG', 'KGS', 'KILO', 'G', 'GR', 'GRS'], true)) {
        return 'g';
    }
    return in_array($u, ['L', 'LT', 'LTS', 'LITRO', 'ML'], true) ? 'ml' : 'un';
}

/** Vinculo guardado (codigo do fornecedor) ou, sem ele, o item com o mesmo GTIN. */
function vinculoSugerido(?int $fornecedorId, ?string $codigo, ?string $gtin): ?array
{
    if ($fornecedorId && $codigo !== null) {
        $v = consultarUm('SELECT tipo_item, insumo_id, prato_id, fator FROM vinculos_fornecedor
                           WHERE fornecedor_id = ? AND codigo_fornecedor = ?', [$fornecedorId, $codigo]);
        if ($v) {
            return $v + ['por' => 'código do fornecedor'];
        }
    }
    if ($gtin !== null) {
        foreach (['insumo' => 'insumos', 'prato' => 'pratos'] as $tipo => $tabela) {
            $achado = consultarUm('SELECT id FROM "' . $tabela . '" WHERE gtin = ?', [$gtin]);
            if ($achado) {
                return ['tipo_item' => $tipo, 'insumo_id' => $tipo === 'insumo' ? (int) $achado['id'] : null,
                        'prato_id' => $tipo === 'prato' ? (int) $achado['id'] : null, 'fator' => null, 'por' => 'GTIN'];
            }
        }
    }
    return null;
}

/** POST /pedidos com {xml}: cria o rascunho com tudo que a nota traz. */
function importarNfe(string $xml, array $usuario): array
{
    $nota = lerNfeXml($xml);
    $empresa = empresaAtual();
    if (!$empresa) {
        throw new ErroApi(400, 'Cadastre a empresa em Administrativo > Empresa e regras > Empresa antes de importar notas.');
    }
    if ($empresa['cnpj'] && $nota['destinatario'] && documentoLimpo($nota['destinatario']) !== $empresa['cnpj']) {
        throw new ErroApi(400, 'Esta nota não é para esta loja: o destinatário é ' . $nota['destinatario'] . ' e o CNPJ da loja é '
            . $empresa['cnpj'] . '.');
    }
    $repetido = consultarUm("SELECT numero FROM pedidos WHERE nota_chave = ? AND status <> 'cancelado'", [$nota['chave']]);
    if ($repetido) {
        throw new ErroApi(400, 'Esta nota já foi lançada no pedido ' . $repetido['numero'] . '.');
    }
    $natureza = consultarUm("SELECT id FROM naturezas_operacao WHERE codigo = 'COMPRA_INSUMO' AND ativa = 1")
             ?? consultarUm("SELECT id FROM naturezas_operacao WHERE sentido = 'entrada' AND ativa = 1 ORDER BY id LIMIT 1");
    if (!$natureza) {
        throw new ErroApi(400, 'Não há natureza de operação de entrada ativa. Ative uma em Fiscal > Naturezas.');
    }

    return emTransacao(function () use ($nota, $xml, $usuario, $natureza) {
        $e = $nota['emitente'];
        $doc = documentoLimpo($e['documento']);
        $fornecedor = fornecedorPeloDocumento($doc);
        $novoFornecedor = false;
        if (!$fornecedor) {
            $uf = in_array($e['uf'], valoresDe('ufs'), true) ? $e['uf'] : null;
            executarSql('INSERT INTO fornecedores (nome, documento, ie, uf, telefone, observacoes) VALUES (?, ?, ?, ?, ?, ?)',
                        [$e['nome'], $doc, $e['ie'], $uf, $e['telefone'], 'Cadastrado pela importação da NF-e ' . $nota['numero']]);
            $fornecedor = ['id' => (int) banco()->lastInsertId(), 'nome' => $e['nome']];
            $novoFornecedor = true;
        }
        $itens = [];
        foreach ($nota['itens'] as $i) {
            $v = vinculoSugerido((int) $fornecedor['id'], $i['codigo_fornecedor'], $i['gtin']);
            $itens[] = $i + ['tipo_item' => $v['tipo_item'] ?? null, 'insumo_id' => $v['insumo_id'] ?? null,
                             'prato_id' => $v['prato_id'] ?? null, 'fator' => $v['fator'] ?? fatorDaUnidade($i['unidade'])];
        }
        $id = gravarPedido(null, [
            'natureza_id' => (int) $natureza['id'], 'fornecedor_id' => (int) $fornecedor['id'],
            'nota_numero' => $nota['numero'], 'nota_serie' => $nota['serie'], 'nota_chave' => $nota['chave'],
            'nota_emissao' => $nota['emissao'], 'valor_frete' => $nota['valor_frete'], 'valor_outros' => $nota['valor_outros'],
            'itens' => $itens, 'parcelas' => $nota['parcelas'],
        ], $usuario, $xml);
        $pedido = consultarUm('SELECT numero, valor_total FROM pedidos WHERE id = ?', [$id]);
        $aviso = emCentavos($pedido['valor_total']) !== emCentavos($nota['valor_total'])
            ? ' Atenção: o total calculado (' . moedaBr((float) $pedido['valor_total']) . ') não bate com o total da nota ('
              . moedaBr($nota['valor_total']) . '). Confira os itens.' : '';
        return [201, ['ok' => true, 'id' => $id, 'numero' => $pedido['numero'],
                      'mensagem' => 'Nota ' . $nota['numero'] . ' importada no rascunho ' . $pedido['numero'] . '.'
                          . ($novoFornecedor ? ' O fornecedor ' . $fornecedor['nome'] . ' foi cadastrado.' : '')
                          . ' Confira em cada linha o que é (insumo ou prato) e o fator (1 KG = 1000 g).' . $aviso]];
    });
}

// ------------------------------------------------------------------
// Rascunho: ler, conferir e gravar
// ------------------------------------------------------------------
/* As linhas como vao para o banco (conferidas). */
function linhasDoPedido(array $itens): array
{
    $saida = [];
    foreach (array_values($itens) as $n => $item) {
        if (!is_array($item)) {
            throw new ErroApi(400, 'Linha ' . ($n + 1) . ' do pedido inválida.');
        }
        $tipo = txt($item, 'tipo_item');
        if ($tipo !== null && !in_array($tipo, valoresDe('tipos_entrada'), true)) {
            throw new ErroApi(400, 'Linha ' . ($n + 1) . ': tipo inválido (' . $tipo . '). Use insumo ou prato.');
        }
        $qtd = lerDinheiro($item['quantidade'] ?? 1);
        $qtd = $qtd === null ? null : round((float) str_replace(',', '.', (string) $item['quantidade']), 4);
        if ($qtd === null || $qtd <= 0 || $qtd > QUANTIDADE_MAXIMA) {
            throw new ErroApi(400, 'Linha ' . ($n + 1) . ': a quantidade precisa ser maior que zero.');
        }
        $fator = inteiro($item, 'fator', 'Fator da linha ' . ($n + 1), 1, 100000, 1);
        $total = array_key_exists('valor_total', $item) && $item['valor_total'] !== '' && $item['valor_total'] !== null
            ? dinheiro($item, 'valor_total', 'Valor da linha', 0.0)
            : round(dinheiro($item, 'valor_unitario', 'Custo unitário', 0.0) * $qtd, 2);
        $desconto = dinheiro($item, 'valor_desconto', 'Desconto da linha', 0.0);
        if ($desconto > $total) {
            throw new ErroApi(400, 'Linha ' . ($n + 1) . ': o desconto passa do valor da linha.');
        }
        $linha = [
            'tipo_item' => $tipo,
            'insumo_id' => $tipo === 'insumo' ? idDoCatalogo($item, 'insumo_id', null) : null,
            'prato_id' => $tipo === 'prato' ? idDoCatalogo($item, 'prato_id', null) : null,
            'descricao' => txt($item, 'descricao', 'Descrição') ?? '',
            'codigo_fornecedor' => txt($item, 'codigo_fornecedor'), 'gtin' => txt($item, 'gtin'),
            'ncm' => digitosOuNada(txt($item, 'ncm'), 8, 'NCM', $n), 'cest' => digitosOuNada(txt($item, 'cest'), 7, 'CEST', $n),
            'cfop_nota' => txt($item, 'cfop_nota'), 'unidade' => txt($item, 'unidade'),
            'quantidade' => $qtd, 'fator' => $fator, 'valor_total' => $total, 'valor_desconto' => $desconto,
            'lote' => txt($item, 'lote', 'Lote'), 'validade' => dataDoCorpo($item, 'validade', 'Validade da linha ' . ($n + 1)),
        ];
        if ($linha['descricao'] === '') {
            throw new ErroApi(400, 'Linha ' . ($n + 1) . ': falta a descrição do item.');
        }
        foreach (['insumo_id' => 'insumos', 'prato_id' => 'pratos'] as $col => $tabela) {
            if ($linha[$col]) {
                exigirExistente($tabela, $linha[$col], 'Linha ' . ($n + 1) . ': o item do catálogo escolhido não existe.');
            }
        }
        $saida[] = $linha;
    }
    return $saida;
}

function digitosOuNada(?string $valor, int $tamanho, string $nome, int $linha): ?string
{
    if ($valor === null) {
        return null;
    }
    $d = preg_replace('/\D/', '', $valor);
    if (strlen($d) !== $tamanho) {
        throw new ErroApi(400, 'Linha ' . ($linha + 1) . ': ' . $nome . ' tem ' . $tamanho . ' números.');
    }
    return $d;
}

/** O CFOP do pedido: o escolhido, ou o da natureza pela UF do fornecedor x a da empresa. */
function cfopDoPedido(array $natureza, ?int $fornecedorId, ?string $escolhido): ?string
{
    if ($escolhido !== null && $escolhido !== '') {
        $c = cfopDaEmpresa(preg_replace('/\D/', '', $escolhido));
        if (!$c) {
            throw new ErroApi(400, 'CFOP ' . $escolhido . ' não cadastrado.');
        }
        if ($c['sentido'] !== 'entrada') {
            throw new ErroApi(400, 'O CFOP ' . formatarCfop($c['codigo']) . ' é de saída; pedido de entrada usa CFOP que começa com 1, 2 ou 3.');
        }
        return $c['codigo'];
    }
    $ufEmpresa = consultarUm('SELECT uf FROM empresa_fiscal WHERE empresa_id = ?', [(int) (empresaAtual()['id'] ?? 0)])['uf'] ?? null;
    $ufFornecedor = $fornecedorId ? (consultarUm('SELECT uf FROM fornecedores WHERE id = ?', [$fornecedorId])['uf'] ?? null) : null;
    $deFora = $ufEmpresa && $ufFornecedor && $ufEmpresa !== $ufFornecedor;
    return $deFora ? ($natureza['cfop_interestadual'] ?? $natureza['cfop_interno']) : $natureza['cfop_interno'];
}

/** Grava o rascunho (novo ou por cima). Devolve o id. */
function gravarPedido(?int $id, array $corpo, array $usuario, ?string $xml = null): int
{
    $natureza = consultarUm('SELECT * FROM naturezas_operacao WHERE id = ?', [idDoCatalogo($corpo, 'natureza_id', null) ?? 0]);
    if (!$natureza) {
        throw new ErroApi(400, 'Escolha a natureza da operação (compra para revenda, bonificação...).');
    }
    if ($natureza['sentido'] !== 'entrada' || !(int) $natureza['ativa']) {
        throw new ErroApi(400, 'A natureza "' . $natureza['descricao'] . '" não serve para pedido de entrada (é de saída ou está desligada).');
    }
    $fornecedorId = idDoCatalogo($corpo, 'fornecedor_id', null);
    if ($fornecedorId) {
        exigirExistente('fornecedores', $fornecedorId, 'Fornecedor informado não existe.');
    }
    $chave = txt($corpo, 'nota_chave');
    if ($chave !== null) {
        $chave = strtoupper(preg_replace('/\s/', '', $chave));
        if (!chaveNfeValida($chave)) {
            throw new ErroApi(400, 'Chave de acesso inválida: são 44 caracteres e o último é o dígito de conferência.');
        }
        $repetido = consultarUm("SELECT numero FROM pedidos WHERE nota_chave = ? AND status <> 'cancelado' AND id <> ?", [$chave, $id ?? 0]);
        if ($repetido) {
            throw new ErroApi(400, 'Esta nota já foi lançada no pedido ' . $repetido['numero'] . '.');
        }
    }
    $linhas = linhasDoPedido(is_array($corpo['itens'] ?? null) ? $corpo['itens'] : []);
    $frete = dinheiro($corpo, 'valor_frete', 'Frete', 0.0);
    $outros = dinheiro($corpo, 'valor_outros', 'Outros', 0.0);
    $produtos = round(array_sum(array_column($linhas, 'valor_total')), 2);
    $desconto = round(array_sum(array_column($linhas, 'valor_desconto')), 2);
    $total = round($produtos - $desconto + $frete + $outros, 2);
    conferirTeto($total, 'O total do pedido');
    [$formaId] = formaDePagamento($corpo);
    $parcelas = [];
    foreach (is_array($corpo['parcelas'] ?? null) ? $corpo['parcelas'] : [] as $k => $p) {
        $venc = dataDoCorpo(is_array($p) ? $p : [], 'vencimento', 'Vencimento da parcela ' . ($k + 1));
        $valor = dinheiro(is_array($p) ? $p : [], 'valor', 'Valor da parcela ' . ($k + 1), 0.0);
        if (!$venc || $valor <= 0) {
            throw new ErroApi(400, 'Parcela ' . ($k + 1) . ': informe vencimento e valor maior que zero.');
        }
        $parcelas[] = ['numero' => txt($p, 'numero'), 'vencimento' => $venc, 'valor' => $valor];
    }
    $cabecalho = [
        'natureza_id' => (int) $natureza['id'], 'cfop' => cfopDoPedido($natureza, $fornecedorId, txt($corpo, 'cfop')),
        'fornecedor_id' => $fornecedorId, 'nota_numero' => txt($corpo, 'nota_numero'), 'nota_serie' => txt($corpo, 'nota_serie'),
        'nota_chave' => $chave, 'nota_emissao' => txt($corpo, 'nota_emissao'),
        'data_entrada' => dataDoCorpo($corpo, 'data_entrada', 'Data de entrada', true) ?? agora(),
        'valor_produtos' => $produtos, 'valor_desconto' => $desconto, 'valor_frete' => $frete, 'valor_outros' => $outros,
        'valor_total' => $total, 'gerar_financeiro' => array_key_exists('gerar_financeiro', $corpo) ? (int) (bool) $corpo['gerar_financeiro'] : 1,
        'forma_pagamento_id' => $formaId, 'observacoes' => txt($corpo, 'observacoes'), 'atualizado_em' => agora(),
    ];

    return emTransacao(function () use ($id, $cabecalho, $linhas, $parcelas, $usuario, $xml) {
        if ($id === null) {
            $cabecalho += ['numero' => proximoNumero('pedidos', 'PE'), 'empresa_id' => (int) empresaAtual()['id'],
                           'criado_por' => $usuario['id'], 'xml_nota' => $xml];
            $colunas = array_keys($cabecalho);
            executarSql('INSERT INTO pedidos (' . implode(', ', $colunas) . ') VALUES (' . vagas($colunas) . ')', array_values($cabecalho));
            $id = (int) banco()->lastInsertId();
        } else {
            $colunas = array_keys($cabecalho);
            executarSql('UPDATE pedidos SET ' . implode(' = ?, ', $colunas) . ' = ? WHERE id = ?', array_merge(array_values($cabecalho), [$id]));
            executarSql('DELETE FROM pedido_itens WHERE pedido_id = ?', [$id]);
            executarSql('DELETE FROM pedido_parcelas WHERE pedido_id = ?', [$id]);
        }
        foreach ($linhas as $ordem => $l) {
            $l = ['pedido_id' => $id, 'ordem' => $ordem + 1] + $l;
            $colunas = array_keys($l);
            executarSql('INSERT INTO pedido_itens (' . implode(', ', $colunas) . ') VALUES (' . vagas($colunas) . ')', array_values($l));
        }
        foreach ($parcelas as $p) {
            executarSql('INSERT INTO pedido_parcelas (pedido_id, numero, vencimento, valor) VALUES (?, ?, ?, ?)',
                        [$id, $p['numero'], $p['vencimento'], $p['valor']]);
        }
        return $id;
    });
}

// ------------------------------------------------------------------
// Confirmar e cancelar
// ------------------------------------------------------------------
/** Custo TOTAL de cada linha: liquido + parte do frete e dos outros (em centavos, a sobra na ultima). */
function custosDoPedido(array $pedido, array $itens): array
{
    $liquidos = array_map(fn ($i) => emCentavos($i['valor_total']) - emCentavos($i['valor_desconto']), $itens);
    $somaLiquidos = array_sum($liquidos);
    $extras = emCentavos($pedido['valor_frete']) + emCentavos($pedido['valor_outros']);
    $custos = [];
    $distribuido = 0;
    foreach (array_values($itens) as $k => $i) {
        $ultimo = $k === count($itens) - 1;
        $parte = $somaLiquidos > 0 ? ($ultimo ? $extras - $distribuido : intdiv($extras * $liquidos[$k], $somaLiquidos)) : 0;
        $distribuido += $parte;
        $custos[$i['id']] = ($liquidos[$k] + $parte) / 100;
    }
    return $custos;
}

/** Quantidade do lote no estoque: quantidade da nota x fator (tem de dar inteiro). */
function quantidadeNoEstoque(array $i): int
{
    $q = (float) $i['quantidade'] * (int) $i['fator'];
    if (abs($q - round($q)) > 0.01 || round($q) < 1) {
        throw new ErroApi(400, 'Linha ' . $i['ordem'] . ' ("' . $i['descricao'] . '"): ' . str_replace('.', ',', (string) (float) $i['quantidade'])
            . ' ' . ($i['unidade'] ?: 'un') . ' x fator ' . $i['fator'] . ' não dá um número inteiro. Ajuste o fator '
            . '(1 KG = 1000 g, 1 L = 1000 ml).');
    }
    return (int) round($q);
}

/*
 * Confirmar = a mercadoria entra (um lote por linha) e nascem as contas a
 * pagar. Com "pago": 1 (o "Já paguei" da tela, a compra no mercado paga na
 * hora) as contas ja nascem pagas, com a data de agora: sem isso cada
 * compra a vista pedia uma baixa a mais no Financeiro. Era o que a entrada
 * avulsa do Estoque fazia; ela saiu da tela (v2) e a Entrada e o caminho unico.
 */
function confirmarPedido(int $id, array $usuario, array $corpo = []): array
{
    if ($usuario['perfil'] !== 'admin' && !chaveLigada('pedido.confirmar_equipe')) {
        throw new ErroApi(403, 'Só o administrador confirma pedido de entrada (ele gera estoque e contas a pagar).');
    }
    $pagoAgora = !empty($corpo['pago']);
    return emTransacao(function () use ($id, $usuario, $pagoAgora) {
        $p = consultarUm(SQL_PEDIDO . ' WHERE p.id = ?', [$id]);
        if (!$p) {
            throw new ErroApi(404, 'Pedido não encontrado.');
        }
        if ($p['status'] !== 'rascunho') {
            throw new ErroApi(400, 'O pedido ' . $p['numero'] . ' já está ' . rotuloDe('status_pedido', $p['status']) . '.');
        }
        $natureza = consultarUm('SELECT * FROM naturezas_operacao WHERE id = ?', [$p['natureza_id']]);
        if (!(int) $natureza['ativa']) {
            throw new ErroApi(400, 'A natureza "' . $natureza['descricao'] . '" foi desligada. Escolha outra no pedido.');
        }
        if ((int) $natureza['exige_fornecedor'] && !$p['fornecedor_id']) {
            throw new ErroApi(400, 'Escolha o fornecedor: a natureza "' . $natureza['descricao'] . '" exige.');
        }
        if ($p['cfop']) {
            $c = cfopDaEmpresa($p['cfop']);
            if (!$c || !$c['permitido']) {
                throw new ErroApi(400, 'O CFOP ' . formatarCfop($p['cfop']) . ' não está permitido para esta loja (Fiscal > CFOP).');
            }
        }
        $itens = consultar('SELECT * FROM pedido_itens WHERE pedido_id = ? ORDER BY ordem', [$id]);
        if (!$itens) {
            throw new ErroApi(400, 'O pedido não tem itens.');
        }
        $estoque = $natureza['movimenta_estoque'] === 'entra';
        foreach ($itens as $i) {
            if ($estoque && $i['tipo_item'] === null) {
                throw new ErroApi(400, 'A linha ' . $i['ordem'] . ' ("' . $i['descricao'] . '") ainda não diz o que é: insumo ou prato.');
            }
        }
        $custos = custosDoPedido($p, $itens);
        $nota = $p['nota_numero'] ? 'NF ' . $p['nota_numero'] . ($p['nota_serie'] ? '/' . $p['nota_serie'] : '') : null;
        $entradas = 0;
        foreach ($itens as $i) {
            if ($i['tipo_item'] === null) {
                continue;
            }
            [$insumoId, $pratoId] = itemDoCatalogoParaPedido($i);
            if ($estoque) {
                $validade = $i['validade'];
                if ($validade === null && $pratoId) {
                    $dias = (int) (consultarUm('SELECT validade_dias FROM pratos WHERE id = ?', [$pratoId])['validade_dias'] ?? 0);
                    $validade = $dias > 0 ? date('Y-m-d', strtotime(substr($p['data_entrada'], 0, 10) . " +{$dias} days")) : null;
                }
                executarSql(
                    'INSERT INTO entradas (tipo, insumo_id, prato_id, fornecedor_id, quantidade, custo_total, lote, validade,
                                           nota_fiscal, observacoes, data_entrada)
                     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
                    [$i['tipo_item'], $insumoId, $pratoId, $p['fornecedor_id'], quantidadeNoEstoque($i), round($custos[$i['id']], 2),
                     $i['lote'], $validade, $nota, 'Pedido ' . $p['numero'], $p['data_entrada']]);
                $entradaId = (int) banco()->lastInsertId();
                executarSql('UPDATE pedido_itens SET entrada_id = ? WHERE id = ?', [$entradaId, $i['id']]);
                $entradas++;
            }
            if ($p['fornecedor_id'] && $i['codigo_fornecedor'] !== null) {
                executarSql('INSERT INTO vinculos_fornecedor (fornecedor_id, codigo_fornecedor, tipo_item, insumo_id, prato_id, fator, atualizado_em)
                             VALUES (?, ?, ?, ?, ?, ?, ?)
                             ON CONFLICT (fornecedor_id, codigo_fornecedor) DO UPDATE SET tipo_item = excluded.tipo_item,
                                insumo_id = excluded.insumo_id, prato_id = excluded.prato_id, fator = excluded.fator,
                                atualizado_em = excluded.atualizado_em',
                            [$p['fornecedor_id'], $i['codigo_fornecedor'], $i['tipo_item'], $insumoId, $pratoId, (int) $i['fator'], agora()]);
            }
        }

        $contas = 0;
        $total = (float) $p['valor_total'];
        if ($natureza['gera_financeiro'] === 'pagar' && (int) $p['gerar_financeiro'] && $total > 0) {
            $parcelas = consultar('SELECT * FROM pedido_parcelas WHERE pedido_id = ? ORDER BY vencimento, id', [$id]);
            if (!$parcelas) {
                $parcelas = [['numero' => null, 'vencimento' => substr($p['data_entrada'], 0, 10), 'valor' => $total]];
            }
            $soma = array_sum(array_map(fn ($x) => emCentavos($x['valor']), $parcelas));
            if (abs($soma - emCentavos($total)) > 1) {
                throw new ErroApi(400, 'As parcelas somam ' . moedaBr($soma / 100) . ' e o pedido é de ' . moedaBr($total)
                    . '. Acerte as parcelas antes de confirmar.');
            }
            [$formaId, $forma] = formaDePagamento(['forma_pagamento_id' => $p['forma_pagamento_id']]);
            foreach ($parcelas as $k => $x) {
                $lancId = criarLancamento([
                    'tipo' => 'pagar', 'categoria' => 'Fornecedor', 'valor' => (float) $x['valor'], 'vencimento' => $x['vencimento'],
                    'descricao' => 'Compra ' . $p['numero'] . ($nota ? ' (' . $nota . ')' : '') . (count($parcelas) > 1 ? ' ' . ($k + 1) . '/' . count($parcelas) : ''),
                    'origem' => 'entrada', 'fornecedor_id' => $p['fornecedor_id'], 'forma_pagamento' => $forma, 'forma_pagamento_id' => $formaId,
                    'parcela' => $k + 1, 'total_parcelas' => count($parcelas), 'usuario_id' => $usuario['id'],
                    'observacoes' => $x['numero'] ? 'Duplicata ' . $x['numero'] : null,
                    'status' => $pagoAgora ? 'pago' : 'pendente', 'data_pagamento' => $pagoAgora ? agora() : null,
                ]);
                executarSql('UPDATE lancamentos SET pedido_id = ? WHERE id = ?', [$id, $lancId]);
                $contas++;
            }
        }
        executarSql("UPDATE pedidos SET status = 'confirmado', confirmado_por = ?, confirmado_em = ?, atualizado_em = ? WHERE id = ?",
                    [$usuario['id'], agora(), agora(), $id]);
        return [200, ['ok' => true, 'mensagem' => 'Pedido ' . $p['numero'] . ' confirmado: '
            . ($estoque ? $entradas . ' lote(s) no estoque' : 'sem estoque (a natureza não mexe no estoque)') . ', '
            . ($contas ? $contas . ($pagoAgora ? ' conta(s) já paga(s).' : ' conta(s) a pagar.') : 'nenhuma conta a pagar.')]];
    });
}

/*
 * O item do catalogo da linha: o escolhido, ou um NOVO com o nome da nota
 * (insumo na unidade que combina com a da nota; prato de revenda fora da
 * loja online ate o admin revisar). NCM, CEST e GTIN que o catalogo ainda
 * nao tem sao aprendidos da nota.
 */
function itemDoCatalogoParaPedido(array $i): array
{
    $insumo = $i['tipo_item'] === 'insumo';
    $coluna = $insumo ? 'insumo_id' : 'prato_id';
    $refId = $i[$coluna] ? (int) $i[$coluna] : null;
    if (!$refId) {
        $refId = $insumo ? criarInsumo(['nome' => $i['descricao'], 'categoria' => 'outro', 'unidade' => unidadeDoEstoque($i['unidade'])])
                         : criarPratoRevenda($i['descricao']);
        executarSql('UPDATE pedido_itens SET ' . $coluna . ' = ? WHERE id = ?', [$refId, $i['id']]);
    }
    executarSql('UPDATE "' . ($insumo ? 'insumos' : 'pratos') . '" SET ncm = COALESCE(ncm, ?), cest = COALESCE(cest, ?), gtin = COALESCE(gtin, ?) WHERE id = ?',
                [$i['ncm'], $i['cest'], $i['gtin'], $refId]);
    return [$insumo ? $refId : null, $insumo ? null : $refId];
}

function cancelarPedido(int $id, array $corpo, array $usuario): array
{
    if ($usuario['perfil'] !== 'admin') {
        throw new ErroApi(403, 'Só o administrador cancela pedido de entrada.');
    }
    $motivo = txt($corpo, 'motivo', 'Motivo');
    if ($motivo === null || mb_strlen($motivo) < 5) {
        throw new ErroApi(400, 'Escreva o motivo do cancelamento (pelo menos 5 letras).');
    }
    return emTransacao(function () use ($id, $usuario, $motivo) {
        $p = consultarUm('SELECT * FROM pedidos WHERE id = ?', [$id]);
        if (!$p) {
            throw new ErroApi(404, 'Pedido não encontrado.');
        }
        if ($p['status'] === 'cancelado') {
            throw new ErroApi(400, 'O pedido ' . $p['numero'] . ' já está cancelado.');
        }
        $saiu = [];
        if ($p['status'] === 'confirmado') {
            foreach (consultar('SELECT i.entrada_id, i.descricao, s.vendido, s.usado_producao,
                                       (SELECT COUNT(*) FROM movimentacoes m WHERE m.entrada_id = i.entrada_id) AS movimentos,
                                       (SELECT COUNT(*) FROM producao_itens pi WHERE pi.entrada_id = i.entrada_id) AS producoes
                                  FROM pedido_itens i JOIN vw_entradas_saldo s ON s.entrada_id = i.entrada_id
                                 WHERE i.pedido_id = ?', [$id]) as $e) {
                if ((int) $e['vendido'] || (int) $e['usado_producao'] || (int) $e['movimentos'] || (int) $e['producoes']) {
                    $saiu[] = $e['descricao'];
                }
            }
            if ($saiu) {
                throw new ErroApi(400, 'Não dá para cancelar: já saiu estoque deste pedido (' . implode('; ', array_slice($saiu, 0, 3))
                    . (count($saiu) > 3 ? '...' : '') . '). Devolva ao fornecedor por Movimentar estoque.');
            }
            $pagas = (int) consultarUm("SELECT COUNT(*) AS n FROM lancamentos WHERE pedido_id = ? AND status = 'pago'", [$id])['n'];
            if ($pagas) {
                throw new ErroApi(400, 'Não dá para cancelar: ' . $pagas . ' conta(s) deste pedido já foram pagas. '
                    . 'Estorne no Financeiro e cancele de novo.');
            }
            cancelarLancamentos('pedido_id', $id, 'pedido ' . $p['numero'] . ' cancelado', (int) $usuario['id']);
            $ids = array_column(consultar('SELECT entrada_id FROM pedido_itens WHERE pedido_id = ? AND entrada_id IS NOT NULL', [$id]), 'entrada_id');
            executarSql('UPDATE pedido_itens SET entrada_id = NULL WHERE pedido_id = ?', [$id]);
            if ($ids) {
                executarSql('DELETE FROM entradas WHERE id IN (' . vagas($ids) . ')', $ids);
            }
        }
        executarSql("UPDATE pedidos SET status = 'cancelado', cancelado_por = ?, cancelado_em = ?, motivo_cancelamento = ?, atualizado_em = ?
                     WHERE id = ?", [$usuario['id'], agora(), $motivo, agora(), $id]);
        return [200, ['ok' => true, 'mensagem' => 'Pedido ' . $p['numero'] . ' cancelado.'
            . ($p['status'] === 'confirmado' ? ' Os lotes saíram do estoque e as contas a pagar foram canceladas.' : '')]];
    });
}

// ------------------------------------------------------------------
// A rota
// ------------------------------------------------------------------
function pedidos(?int $id, string $metodo, array $corpo, array $usuario, ?string $acao): array
{
    if ($acao !== null) {
        exigir($metodo === 'POST');
        $id = exigirId($id);
        if ($acao === 'confirmar') {
            return confirmarPedido($id, $usuario, $corpo);
        }
        if ($acao === 'cancelar') {
            return cancelarPedido($id, $corpo, $usuario);
        }
        throw new ErroApi(404, 'Rota não encontrada.');
    }
    if ($metodo === 'GET') {
        if (!$id) {
            return [200, ['ok' => true, 'itens' => consultar(str_replace('p.*,', 'p.id, p.numero, p.status, p.natureza_id, p.cfop,
                p.fornecedor_id, p.nota_numero, p.nota_serie, p.nota_chave, p.nota_emissao, p.data_entrada, p.valor_produtos,
                p.valor_desconto, p.valor_frete, p.valor_outros, p.valor_total, p.gerar_financeiro, p.criado_em, p.confirmado_em,
                p.cancelado_em, p.motivo_cancelamento,', SQL_PEDIDO) . ' ORDER BY p.id DESC')]];
        }
        $p = consultarUm(SQL_PEDIDO . ' WHERE p.id = ?', [$id]);
        if (!$p) {
            throw new ErroApi(404, 'Pedido não encontrado.');
        }
        $p['tem_xml'] = $p['xml_nota'] !== null;
        unset($p['xml_nota']);
        $p['lista_itens'] = consultar('SELECT * FROM pedido_itens WHERE pedido_id = ? ORDER BY ordem', [$id]);
        $p['parcelas'] = consultar('SELECT numero, vencimento, valor FROM pedido_parcelas WHERE pedido_id = ? ORDER BY vencimento, id', [$id]);
        $p['lancamentos'] = consultar('SELECT id, descricao, valor, vencimento, status, data_pagamento FROM lancamentos WHERE pedido_id = ? ORDER BY parcela', [$id]);
        $p['cfop_descricao'] = $p['cfop'] ? (consultarUm('SELECT descricao FROM cfops WHERE codigo = ?', [$p['cfop']])['descricao'] ?? null) : null;
        return [200, ['ok' => true, 'pedido' => $p]];
    }
    if ($metodo === 'POST') {
        exigir($id === null);
        if (array_key_exists('xml', $corpo)) {
            return importarNfe((string) $corpo['xml'], $usuario);
        }
        $novo = gravarPedido(null, $corpo, $usuario);
        return [201, ['ok' => true, 'id' => $novo, 'numero' => consultarUm('SELECT numero FROM pedidos WHERE id = ?', [$novo])['numero'],
                      'mensagem' => 'Rascunho do pedido gravado.']];
    }
    $id = exigirId($id);
    $atual = consultarUm('SELECT id, numero, status FROM pedidos WHERE id = ?', [$id]);
    if (!$atual) {
        throw new ErroApi(404, 'Pedido não encontrado.');
    }
    if ($atual['status'] !== 'rascunho') {
        throw new ErroApi(400, 'O pedido ' . $atual['numero'] . ' está ' . rotuloDe('status_pedido', $atual['status'])
            . ' e não muda mais' . ($atual['status'] === 'confirmado' ? ' (para desfazer, cancele).' : '.'));
    }
    if ($metodo === 'PUT') {
        gravarPedido($id, $corpo, $usuario);
        return [200, ['ok' => true, 'mensagem' => 'Rascunho do pedido gravado.']];
    }
    if ($metodo === 'DELETE') {
        executarSql('DELETE FROM pedidos WHERE id = ?', [$id]);
        return [200, ['ok' => true, 'mensagem' => 'Rascunho ' . $atual['numero'] . ' apagado.']];
    }
    throw new ErroApi(405, 'Método não permitido para /api/pedidos.');
}
