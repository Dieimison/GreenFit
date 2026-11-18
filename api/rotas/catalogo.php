<?php
/**
 * api/rotas/catalogo.php - os cadastros simples (clientes, fornecedores,
 * insumos, categorias do cardapio, formas de pagamento, bairros de entrega
 * e cupons).
 *
 * Todos tem as mesmas quatro operacoes, entao sao UMA funcao,
 * crudCatalogo(), guiada por uma tabela de configuracao (catalogos()).
 * Cada cadastro diz: seus campos e tipos, como e a lista, o que impede
 * excluir, e o que tem de proprio. O prato tem rota propria (pratos.php):
 * ficha tecnica, fotos e adicionais nao cabem num CRUD de campos.
 */

declare(strict_types=1);

/*
 * Campos: [tipo, rotulo, opcoes]. Tipos: texto, dinheiro, decimal, inteiro
 * (min, max, padrao), ativo (0/1), enum (dominio, padrao), id (tabela,
 * frase), digitos, data. No PUT, campo que nao veio continua como esta.
 */
function catalogos(): array
{
    static $c = null;
    if ($c !== null) {
        return $c;
    }
    $texto = fn (string $rotulo, bool $obrigatorio = false) => ['texto', $rotulo, ['obrigatorio' => $obrigatorio]];
    $contato = ['nome' => $texto('Nome', true), 'telefone' => $texto('Telefone'), 'documento' => $texto('CPF/CNPJ'),
                'email' => $texto('E-mail'), 'endereco' => $texto('Endereço'), 'observacoes' => $texto('Observações')];
    // O que a nota fiscal pede do item (NCM 8 numeros, CEST 7, origem 0-8).
    $fiscal = ['ncm' => ['digitos', 'NCM', ['tamanho' => 8]], 'cest' => ['digitos', 'CEST', ['tamanho' => 7]],
               'origem' => ['enum', 'Origem da mercadoria', ['dominio' => 'origens_mercadoria', 'opcional' => true]],
               'gtin' => ['digitos', 'GTIN (código de barras)', ['tamanhos' => [8, 12, 13, 14]]]];

    $c = [
        'clientes' => [
            'tabela' => 'clientes', 'artigo' => 'o', 'nome' => 'Cliente',
            'lista'  => 'SELECT c.*, (SELECT COUNT(*) FROM vendas v WHERE v.cliente_id = c.id AND v.status = \'concluida\') AS compras,
                               (SELECT ROUND(COALESCE(SUM(v.valor_total), 0), 2) FROM vendas v
                                 WHERE v.cliente_id = c.id AND v.status = \'concluida\') AS total_comprado,
                               (SELECT MAX(v.data_venda) FROM vendas v WHERE v.cliente_id = c.id AND v.status = \'concluida\') AS ultima_compra
                          FROM clientes c',
            'alias'  => 'c', 'ordem' => 'c.nome',
            'campos' => $contato + ['bairro' => $texto('Bairro'),
                                    'objetivo' => ['enum', 'Objetivo', ['dominio' => 'objetivos', 'opcional' => true]],
                                    'restricoes' => $texto('Restrições alimentares')],
            'conferir' => 'conferirClienteRepetido',
            'usos' => [['SELECT COUNT(*) FROM vendas WHERE cliente_id = :id', '%d venda(s)']],
            'em_uso' => 'Este cliente tem %s e não pode ser excluído - o histórico ficaria sem dono.',
        ],
        'fornecedores' => [
            'tabela' => 'fornecedores', 'artigo' => 'o', 'nome' => 'Fornecedor',
            'lista'  => 'SELECT f.* FROM fornecedores f', 'alias' => 'f', 'ordem' => 'f.nome',
            'campos' => $contato + ['ie' => $texto('Inscrição estadual'),
                                    'uf' => ['enum', 'UF', ['dominio' => 'ufs', 'opcional' => true]]],
            'usos' => [['SELECT COUNT(*) FROM entradas WHERE fornecedor_id = :id', '%d entrada(s)'],
                       ['SELECT COUNT(*) FROM lancamentos WHERE fornecedor_id = :id', '%d conta(s) no financeiro']],
            'em_uso' => 'Este fornecedor tem %s e não pode ser excluído - o histórico ficaria sem dono.',
        ],
        'insumos' => [
            'tabela' => 'insumos', 'artigo' => 'o', 'nome' => 'Insumo',
            'lista'  => 'SELECT i.*, ei.disponivel AS saldo, ei.vencido, ROUND(ei.custo_medio, 6) AS custo_medio,
                               ROUND(ei.valor_parado, 2) AS valor_parado,
                               (SELECT COUNT(*) FROM ficha_tecnica ft WHERE ft.insumo_id = i.id) AS em_fichas
                          FROM insumos i JOIN vw_estoque_insumos ei ON ei.insumo_id = i.id',
            'alias'  => 'i', 'ordem' => 'i.ativo DESC, i.categoria, i.nome', 'filtro_ativos' => 'ativos', 'nome_unico' => 'o insumo',
            'campos' => ['nome' => $texto('Nome', true),
                         'categoria' => ['enum', 'Categoria', ['dominio' => 'categorias_insumo', 'padrao' => 'outro']],
                         'unidade' => ['enum', 'Unidade do estoque', ['dominio' => 'unidades_insumo', 'padrao' => 'g']],
                         'estoque_minimo' => ['inteiro', 'Estoque mínimo', ['min' => 0, 'max' => QUANTIDADE_MAXIMA, 'padrao' => 0]],
                         'codigo' => $texto('Código'), 'observacoes' => $texto('Observações'),
                         'ativo' => ['ativo', 'Ativo', []]] + $fiscal,
            'conferir' => 'conferirUnidadeDoInsumo',
            'saida' => 'semCustoParaEquipe',
            'usos' => [['SELECT COUNT(*) FROM entradas WHERE insumo_id = :id', '%d lote(s) no estoque'],
                       ['SELECT COUNT(*) FROM ficha_tecnica WHERE insumo_id = :id', '%d ficha(s) técnica(s)']],
            'em_uso' => 'Este insumo tem %s e não pode ser excluído. Desative-o: ele some das listas e o histórico continua.',
        ],
        'categorias' => [
            'tabela' => 'categorias', 'artigo' => 'a', 'nome' => 'Categoria',
            'lista'  => 'SELECT c.*, (SELECT COUNT(*) FROM pratos p WHERE p.categoria_id = c.id) AS pratos FROM categorias c',
            'alias'  => 'c', 'ordem' => 'c.ordem, c.nome', 'filtro_ativos' => 'ativas', 'nome_unico' => 'uma categoria chamada',
            'campos' => ['nome' => $texto('Nome', true), 'descricao' => $texto('Descrição'),
                         'ordem' => ['inteiro', 'Ordem no cardápio', ['min' => 0, 'max' => 100000, 'padrao' => 0]],
                         'ativo' => ['ativo', 'Ativa', []]],
            'usos' => [['SELECT COUNT(*) FROM pratos WHERE categoria_id = :id', '%d']],
            'em_uso' => 'Esta categoria tem %s prato(s). Mude os pratos de categoria, ou desative-a.',
        ],
        'formas-pagamento' => [
            'tabela' => 'formas_pagamento', 'artigo' => 'a', 'nome' => 'Forma de pagamento',
            'lista'  => 'SELECT f.*, ' . implode(' + ', array_map(
                            fn ($t) => "(SELECT COUNT(*) FROM \"{$t}\" x WHERE x.forma_pagamento_id = f.id)", USOS_DA_FORMA))
                      . ' AS usos FROM formas_pagamento f',
            'alias'  => 'f', 'ordem' => 'f.ordem, f.nome', 'filtro_ativos' => 'ativas', 'nome_unico' => 'uma forma de pagamento chamada',
            'campos' => ['nome' => $texto('Nome', true), 'tipo' => ['enum', 'Tipo', ['dominio' => 'tipos_pagamento', 'padrao' => 'vista']],
                         'parcelas_padrao' => ['inteiro', 'Parcelas sugeridas', ['min' => 1, 'max' => PARCELAS_MAX, 'padrao' => 1]],
                         'ativo' => ['ativo', 'Ativa', []],
                         'ordem' => ['inteiro', 'Ordem', ['min' => 0, 'max' => 100000]],
                         'observacoes' => $texto('Observações')],
            'conferir' => 'conferirFormaDePagamento',
            'depois'   => 'depoisDeGravarForma',
            'saida'    => fn (array $f) => ['padrao' => (int) ($f['padrao'] ?? 0) === 1] + $f,
            'usos'     => [['SELECT ' . implode(' + ', array_map(fn ($t) => "(SELECT COUNT(*) FROM \"{$t}\" WHERE forma_pagamento_id = :id)", USOS_DA_FORMA)), '%d']],
            'em_uso'   => 'Esta forma de pagamento está em %s registro(s) e não pode ser excluída. '
                        . 'Desative-a: ela some das listas e o histórico continua correto.',
        ],
        'bairros' => [
            'tabela' => 'loja_bairros', 'artigo' => 'o', 'nome' => 'Bairro',
            'lista'  => 'SELECT b.*, (SELECT COUNT(*) FROM encomendas e WHERE e.bairro_id = b.id) AS pedidos FROM loja_bairros b',
            'alias'  => 'b', 'ordem' => 'b.ativo DESC, b.nome', 'filtro_ativos' => 'ativos',
            'campos' => ['nome' => $texto('Bairro', true), 'cidade' => $texto('Cidade', true),
                         'taxa' => ['dinheiro', 'Taxa de entrega', []],
                         'tempo_min' => ['inteiro', 'Tempo de viagem (minutos)', ['min' => 0, 'max' => 300, 'padrao' => 15]],
                         'ativo' => ['ativo', 'Atendido', []]],
            'conferir' => 'conferirBairroRepetido',
            'usos' => [['SELECT COUNT(*) FROM encomendas WHERE bairro_id = :id', '%d']],
            'em_uso' => 'Este bairro já tem %s pedido(s). Desligue "Atendido" em vez de excluir.',
        ],
        'cupons' => [
            'tabela' => 'cupons', 'artigo' => 'o', 'nome' => 'Cupom',
            'lista'  => "SELECT c.*, (SELECT COUNT(*) FROM encomendas e WHERE e.cupom_id = c.id AND e.status <> 'cancelada') AS usos,
                                (SELECT ROUND(COALESCE(SUM(e.desconto), 0), 2) FROM encomendas e
                                  WHERE e.cupom_id = c.id AND e.status <> 'cancelada') AS desconto_dado
                           FROM cupons c",
            'alias'  => 'c', 'ordem' => 'c.ativo DESC, c.codigo', 'filtro_ativos' => 'ativos',
            'campos' => ['codigo' => $texto('Código', true), 'descricao' => $texto('Descrição'),
                         'tipo' => ['enum', 'Tipo', ['dominio' => 'tipos_cupom', 'padrao' => 'percentual']],
                         'valor' => ['dinheiro', 'Valor', []],
                         'pedido_minimo' => ['dinheiro', 'Pedido mínimo', []],
                         'inicio' => ['data', 'Válido a partir de', []], 'fim' => ['data', 'Válido até', []],
                         'limite_usos' => ['inteiro', 'Limite de usos (total)', ['min' => 1, 'max' => 1000000]],
                         'limite_por_cliente' => ['inteiro', 'Usos por cliente', ['min' => 1, 'max' => 1000, 'padrao' => 1]],
                         'primeira_compra' => ['liga', 'Só na primeira compra', []],
                         'ativo' => ['ativo', 'Ativo', []]],
            'conferir' => 'conferirCupom',
            'usos' => [['SELECT COUNT(*) FROM encomendas WHERE cupom_id = :id', '%d']],
            'em_uso' => 'Este cupom já foi usado em %s pedido(s). Desative-o em vez de excluir.',
        ],
    ];
    return $c;
}

/* Onde uma forma pode estar em uso. */
const USOS_DA_FORMA = ['vendas', 'lancamentos', 'pedidos'];

/** O CRUD de qualquer cadastro, guiado pela configuracao. */
function crudCatalogo(string $nomeRota, ?int $id, string $metodo, array $corpo, array $consulta): array
{
    $cat   = catalogos()[$nomeRota];
    $artigo = $cat['artigo'];
    $naoAchou = $cat['nome'] . ' não encontrad' . $artigo . '.';
    $saida = $cat['saida'] ?? fn (array $l) => $l;
    if (is_string($saida)) {
        $nomeSaida = $saida;
        $saida = fn (array $l) => $nomeSaida($l);
    }

    if ($metodo === 'GET') {
        $sql = $cat['lista'];
        if ($id) {
            $item = consultarUm($sql . ' WHERE ' . $cat['alias'] . '.id = ?', [$id]);
            if (!$item) {
                throw new ErroApi(404, $naoAchou);
            }
            return [200, ['ok' => true, 'item' => $saida($item)]];
        }
        if (isset($cat['filtro_ativos']) && !empty($consulta[$cat['filtro_ativos']])) {
            $sql .= ' WHERE ' . $cat['alias'] . '.ativo = 1';
        }
        return [200, ['ok' => true, 'itens' => array_map($saida, consultar($sql . ' ORDER BY ' . $cat['ordem']))]];
    }

    if ($metodo === 'POST' || $metodo === 'PUT') {
        return emTransacao(function () use ($cat, $id, $metodo, $corpo, $artigo, $naoAchou) {
            $atual = null;
            if ($metodo === 'PUT') {
                $id = exigirId($id);
                $atual = consultarUm('SELECT * FROM "' . $cat['tabela'] . '" WHERE id = ?', [$id]);
                if (!$atual) {
                    throw new ErroApi(404, $naoAchou);
                }
            }
            $dados = lerCamposDoCatalogo($cat['campos'], $corpo, $atual);
            if (isset($cat['nome_unico'])) {
                $igual = consultarUm('SELECT id, nome FROM "' . $cat['tabela'] . '" WHERE minusculas(nome) = minusculas(?) AND id <> ?',
                                     [$dados['nome'], $id ?? 0]);
                if ($igual) {
                    throw new ErroApi(400, 'Já existe ' . $cat['nome_unico'] . ' "' . $igual['nome'] . '".');
                }
            }
            if (isset($cat['conferir'])) {
                $dados = ($cat['conferir'])($dados, $id, $atual, $corpo);
            }

            $colunas = array_keys($dados);
            if ($metodo === 'POST') {
                executarSql('INSERT INTO "' . $cat['tabela'] . '" (' . implode(', ', $colunas) . ') VALUES (' . vagas($colunas) . ')',
                            array_values($dados));
                $id = (int) banco()->lastInsertId();
            } else {
                executarSql('UPDATE "' . $cat['tabela'] . '" SET ' . implode(' = ?, ', $colunas) . ' = ? WHERE id = ?',
                            array_merge(array_values($dados), [$id]));
            }
            if (isset($cat['depois'])) {
                ($cat['depois'])($id, $dados, $atual, $corpo);
            }
            $verbo = $metodo === 'POST' ? 'cadastrad' : 'atualizad';
            return $metodo === 'POST'
                ? [201, ['ok' => true, 'id' => $id, 'mensagem' => $cat['nome'] . ' ' . $verbo . $artigo . '.']]
                : [200, ['ok' => true, 'mensagem' => $cat['nome'] . ' ' . $verbo . $artigo . '.']];
        });
    }

    if ($metodo === 'DELETE') {
        $id = exigirId($id);
        if (!consultarUm('SELECT id FROM "' . $cat['tabela'] . '" WHERE id = ?', [$id])) {
            throw new ErroApi(404, $naoAchou);
        }
        $usos = [];
        foreach ($cat['usos'] as [$sql, $frase]) {
            $st = banco()->prepare($sql);
            $st->execute([':id' => $id]);
            $n = (int) $st->fetchColumn();
            if ($n > 0) {
                $usos[] = sprintf($frase, $n);
            }
        }
        if ($usos) {
            throw new ErroApi(400, sprintf($cat['em_uso'], implode(' e ', $usos)));
        }
        if ($nomeRota === 'formas-pagamento') {
            conferirFormaNaoPadrao($id, 'excluir');
        }
        executarSql('DELETE FROM "' . $cat['tabela'] . '" WHERE id = ?', [$id]);
        return [200, ['ok' => true, 'mensagem' => $cat['nome'] . ' excluíd' . $artigo . '.']];
    }

    throw new ErroApi(405, 'Método não permitido para /api/' . $nomeRota . '.');
}

/** Le os campos de um cadastro do corpo (PUT preserva o que nao veio). */
function lerCamposDoCatalogo(array $campos, array $corpo, ?array $atual): array
{
    $dados = [];
    foreach ($campos as $campo => [$tipo, $rotulo, $op]) {
        $veioNoCorpo = array_key_exists($campo, $corpo);
        if (!$veioNoCorpo && $atual !== null) {
            $dados[$campo] = $atual[$campo];
            continue;
        }
        switch ($tipo) {
            case 'texto':
                $valor = !empty($op['obrigatorio']) ? obrigatorio($corpo, $campo, $rotulo) : txt($corpo, $campo, $rotulo);
                if ($valor !== null && mb_strlen($valor) > 500) {
                    throw new ErroApi(400, "O campo \"{$rotulo}\" passou de 500 caracteres.");
                }
                if (isset($op['lista'])) {
                    $valor = valorDaLista($op['lista'], $valor);
                }
                $dados[$campo] = $valor ?? ($op['vazio'] ?? null);
                break;
            case 'dinheiro':
                $dados[$campo] = dinheiro($corpo, $campo, $rotulo, 0.0);
                break;
            case 'inteiro':
                $dados[$campo] = inteiro($corpo, $campo, $rotulo, $op['min'], $op['max'], $op['padrao'] ?? null);
                break;
            case 'ativo':
                $dados[$campo] = $veioNoCorpo ? (int) (bool) $corpo[$campo] : 1;
                break;
            case 'liga':
                $dados[$campo] = $veioNoCorpo ? (int) (bool) $corpo[$campo] : 0;
                break;
            case 'data':
                $dados[$campo] = dataDoCorpo($corpo, $campo, $rotulo);
                break;
            case 'digitos':
                $valor = txt($corpo, $campo, $rotulo);
                if ($valor !== null) {
                    $valor = (string) preg_replace('/\D/', '', $valor);
                    $tamanhos = $op['tamanhos'] ?? [$op['tamanho']];
                    if (!in_array(strlen($valor), $tamanhos, true)) {
                        throw new ErroApi(400, $rotulo . ' tem ' . implode(', ', array_slice($tamanhos, 0, -1))
                            . (count($tamanhos) > 1 ? ' ou ' : '') . end($tamanhos) . ' números.');
                    }
                }
                $dados[$campo] = $valor;
                break;
            case 'unidade':
                $dados[$campo] = strtoupper(txt($corpo, $campo, $rotulo) ?? 'UN');
                if (!preg_match('/^[A-Z0-9]{1,6}$/', $dados[$campo])) {
                    throw new ErroApi(400, 'Unidade: até 6 letras, como UN, KG, CX.');
                }
                break;
            case 'enum':
                if (!empty($op['opcional']) && txt($corpo, $campo, $rotulo) === null) {
                    $dados[$campo] = null;
                    break;
                }
                $valor = txt($corpo, $campo, $rotulo) ?? $op['padrao'];
                if (!in_array($valor, valoresDe($op['dominio']), true)) {
                    throw new ErroApi(400, $rotulo . ' inválid' . (in_array($rotulo, ['Tipo', 'Objetivo'], true) ? 'o' : 'a') . ': ' . $valor . '.');
                }
                $dados[$campo] = $valor;
                break;
            case 'id':
                $valor = idDoCatalogo($corpo, $campo, null);
                if ($valor) {
                    exigirExistente($op['tabela'], $valor, $op['frase']);
                }
                $dados[$campo] = $valor;
                break;
        }
    }
    return $dados;
}

/*
 * Nome igual nao basta para dizer que e a mesma pessoa (dois "Joao Silva"
 * existem). Nome igual E o mesmo telefone preenchido, sim: duplicado.
 */
function conferirClienteRepetido(array $d, ?int $id, ?array $atual, array $corpo): array
{
    $digitos = (string) preg_replace('/\D/', '', (string) $d['telefone']);
    if ($digitos === '') {
        return $d;
    }
    foreach (consultar('SELECT id, nome, telefone FROM clientes WHERE minusculas(nome) = minusculas(?) AND id <> ?',
                       [$d['nome'], $id ?? 0]) as $outro) {
        if ((string) preg_replace('/\D/', '', (string) $outro['telefone']) === $digitos) {
            throw new ErroApi(400, 'Já existe o cliente "' . $outro['nome'] . '" com este telefone. Use o cadastro que já existe.');
        }
    }
    return $d;
}

/*
 * A unidade do insumo e a base do estoque: trocar g por un depois de ter
 * lote mudaria o sentido de todos os numeros guardados.
 */
function conferirUnidadeDoInsumo(array $d, ?int $id, ?array $atual, array $corpo): array
{
    if ($atual !== null && $d['unidade'] !== $atual['unidade']
        && (consultarUm('SELECT 1 FROM entradas WHERE insumo_id = ? LIMIT 1', [$id])
            || consultarUm('SELECT 1 FROM ficha_tecnica WHERE insumo_id = ? LIMIT 1', [$id]))) {
        throw new ErroApi(400, 'Este insumo já tem lotes ou fichas técnicas em ' . $atual['unidade']
            . '. Trocar a unidade mudaria todas as quantidades guardadas. Cadastre um insumo novo.');
    }
    return $d;
}

/* Custo do insumo e do dono: a equipe ve saldo e minimo, nao quanto custou. */
function semCustoParaEquipe(array $linha): array
{
    static $perfil = null;
    $perfil ??= (usuarioDaSessao()['perfil'] ?? '');
    if ($perfil !== 'admin') {
        unset($linha['custo_medio'], $linha['valor_parado']);
    }
    foreach (['saldo', 'vencido', 'estoque_minimo', 'em_fichas'] as $c) {
        if (isset($linha[$c])) {
            $linha[$c] = (int) $linha[$c];
        }
    }
    return $linha;
}

function conferirBairroRepetido(array $d, ?int $id, ?array $atual, array $corpo): array
{
    $igual = consultarUm('SELECT id FROM loja_bairros WHERE minusculas(nome) = minusculas(?) AND minusculas(cidade) = minusculas(?) AND id <> ?',
                         [$d['nome'], $d['cidade'], $id ?? 0]);
    if ($igual) {
        throw new ErroApi(400, 'O bairro "' . $d['nome'] . '" (' . $d['cidade'] . ') já está cadastrado.');
    }
    return $d;
}

/* Cupom: codigo em maiusculas sem espaco; percentual ate 100; fim depois do inicio. */
function conferirCupom(array $d, ?int $id, ?array $atual, array $corpo): array
{
    $d['codigo'] = strtoupper((string) preg_replace('/\s+/', '', (string) $d['codigo']));
    if (!preg_match('/^[A-Z0-9_-]{3,20}$/', $d['codigo'])) {
        throw new ErroApi(400, 'O código do cupom tem de 3 a 20 letras ou números, sem espaço (ex.: BEMVINDO10).');
    }
    if (consultarUm('SELECT id FROM cupons WHERE codigo = ? AND id <> ?', [$d['codigo'], $id ?? 0])) {
        throw new ErroApi(400, 'Já existe o cupom ' . $d['codigo'] . '.');
    }
    if ($d['tipo'] === 'percentual' && ($d['valor'] <= 0 || $d['valor'] > 100)) {
        throw new ErroApi(400, 'Cupom de porcentagem: o valor fica entre 1 e 100 (%).');
    }
    if ($d['tipo'] === 'valor' && $d['valor'] <= 0) {
        throw new ErroApi(400, 'Cupom de valor: informe quantos reais ele desconta.');
    }
    if ($d['tipo'] === 'frete') {
        $d['valor'] = 0.0;
    }
    if ($d['inicio'] && $d['fim'] && $d['fim'] < $d['inicio']) {
        throw new ErroApi(400, 'A data final do cupom é antes da inicial.');
    }
    return $d;
}

/*
 * Forma de pagamento:
 *   - forma nova sem ordem nasce DEPOIS da ultima;
 *   - a forma padrao nao pode ser desativada sem escolher outra.
 */
function conferirFormaDePagamento(array $d, ?int $id, ?array $atual, array $corpo): array
{
    if ($atual === null && empty($d['ordem'])) {
        $d['ordem'] = (int) consultarUm('SELECT COALESCE(MAX(ordem), 0) AS m FROM formas_pagamento')['m'] + 10;
    }
    $d['ordem'] = (int) ($d['ordem'] ?? 0);
    if ($atual !== null && (int) $d['ativo'] === 0 && (int) $atual['padrao'] === 1 && empty($corpo['padrao'])) {
        conferirFormaNaoPadrao((int) $atual['id'], 'desativar');
    }
    return $d;
}

/* A forma padrao vale para a loja inteira: so o admin escolhe. */
function conferirQuemEscolhePadrao(?int $id, string $metodo, array $corpo, array $usuario): void
{
    if ($usuario['perfil'] === 'admin' || !in_array($metodo, ['POST', 'PUT'], true) || empty($corpo['padrao'])) {
        return;
    }
    $jaEPadrao = $metodo === 'PUT' && $id
        && (int) (consultarUm('SELECT padrao FROM formas_pagamento WHERE id = ?', [$id])['padrao'] ?? 0) === 1;
    if (!$jaEPadrao) {
        throw new ErroApi(403, 'Só o administrador escolhe a forma de pagamento padrão da loja.');
    }
}

function conferirFormaNaoPadrao(int $id, string $acao): void
{
    if ((int) (consultarUm('SELECT padrao FROM formas_pagamento WHERE id = ?', [$id])['padrao'] ?? 0) === 1) {
        throw new ErroApi(400, "Esta é a forma de pagamento padrão. Marque outra como padrão antes de {$acao} esta.");
    }
}

/*
 * Depois de gravar uma forma: {padrao: true} faz dela a padrao (e so
 * ela); renomear atualiza o texto guardado nos documentos.
 */
function depoisDeGravarForma(int $id, array $d, ?array $atual, array $corpo): void
{
    if (!empty($corpo['padrao'])) {
        if ((int) $d['ativo'] === 0) {
            throw new ErroApi(400, 'A forma padrão precisa estar ativa.');
        }
        executarSql('UPDATE formas_pagamento SET padrao = 0 WHERE padrao = 1 AND id <> ?', [$id]);
        executarSql('UPDATE formas_pagamento SET padrao = 1 WHERE id = ?', [$id]);
    }
    if ($atual !== null && $d['nome'] !== $atual['nome']) {
        executarSql('UPDATE vendas SET forma_pagamento = ? WHERE forma_pagamento_id = ?', [$d['nome'], $id]);
        renomearFormaNosLancamentos($id, $d['nome']);
    }
}

/** Le a forma de pagamento de um corpo e devolve [id, nome]. */
function formaDePagamento(array $corpo, ?array $atual = null): array
{
    if (!array_key_exists('forma_pagamento_id', $corpo)) {
        return [isset($atual['forma_pagamento_id']) ? (int) $atual['forma_pagamento_id'] : null,
                $atual['forma_pagamento'] ?? null];
    }
    $id = idDoCatalogo($corpo, 'forma_pagamento_id', null);
    if (!$id) {
        return [null, null];
    }
    $forma = consultarUm('SELECT nome FROM formas_pagamento WHERE id = ?', [$id]);
    if (!$forma) {
        throw new ErroApi(400, 'Forma de pagamento informada não existe.');
    }
    return [$id, $forma['nome']];
}

/** A forma do cadastro com este nome (sem acento nem caixa): [id, nome]. */
function formaPeloNome(string $nome): array
{
    $f = consultarUm('SELECT id, nome FROM formas_pagamento WHERE minusculas(nome) = minusculas(?) ORDER BY ativo DESC, id LIMIT 1', [$nome]);
    return $f ? [(int) $f['id'], (string) $f['nome']] : [null, $nome];
}

/*
 * Cliente cadastrado na hora (PDV, loja online). Com telefone, procura pelo
 * telefone (so os digitos); sem telefone, pelo nome exato.
 */
function acharOuCriarCliente(?string $nome, ?string $telefone = null): ?int
{
    $nome = $nome === null ? '' : trim($nome);
    if ($nome === '') {
        return null;
    }
    $telefone = $telefone === null ? '' : trim($telefone);
    $digitos  = preg_replace('/\D/', '', $telefone);
    if ($digitos !== '') {
        $achado = consultarUm(
            "SELECT id FROM clientes
              WHERE replace(replace(replace(replace(replace(
                    COALESCE(telefone, ''), ' ', ''), '(', ''), ')', ''), '-', ''), '.', '') = ?", [$digitos]);
    } else {
        $achado = consultarUm('SELECT id FROM clientes WHERE minusculas(nome) = minusculas(?)', [$nome]);
    }
    if ($achado) {
        return (int) $achado['id'];
    }
    executarSql('INSERT INTO clientes (nome, telefone) VALUES (?, ?)', [$nome, $telefone !== '' ? $telefone : null]);
    return (int) banco()->lastInsertId();
}

/* Insumo criado na hora (entrada, pedido de entrada). */
function criarInsumo(array $dados): int
{
    $categoria = in_array($dados['categoria'] ?? 'outro', valoresDe('categorias_insumo'), true) ? $dados['categoria'] : 'outro';
    $unidade = in_array($dados['unidade'] ?? 'g', valoresDe('unidades_insumo'), true) ? $dados['unidade'] : 'g';
    $igual = consultarUm('SELECT id FROM insumos WHERE minusculas(nome) = minusculas(?)', [$dados['nome']]);
    if ($igual) {
        return (int) $igual['id'];
    }
    executarSql('INSERT INTO insumos (nome, categoria, unidade) VALUES (?, ?, ?)', [$dados['nome'], $categoria, $unidade]);
    return (int) banco()->lastInsertId();
}

/* Prato de revenda criado na hora pelo pedido de entrada (fica fora da loja ate o admin revisar). */
function criarPratoRevenda(string $nome): int
{
    executarSql("INSERT INTO pratos (nome, tipo, publicado, validade_dias, conservacao) VALUES (?, 'revenda', 0, 0, 'ambiente')", [$nome]);
    return (int) banco()->lastInsertId();
}

/** Le um id de catalogo do corpo, aceitando "" e 0 como "nao informado". */
function idDoCatalogo(array $corpo, string $campo, $padrao): ?int
{
    if (!array_key_exists($campo, $corpo)) {
        return $padrao === null ? null : (int) $padrao;
    }
    $valor = $corpo[$campo];
    if ($valor === '' || $valor === null) {
        return null;
    }
    if (!is_scalar($valor)) {
        throw new ErroApi(400, 'O campo "' . $campo . '" precisa ser o número de um registro.');
    }
    return (int) $valor === 0 ? null : (int) $valor;
}

/** 400 com a mensagem dada se o id nao existe na tabela (lista fechada). */
function exigirExistente(string $tabela, int $id, string $mensagem): void
{
    if (!in_array($tabela, ['clientes', 'fornecedores', 'insumos', 'pratos', 'categorias', 'formas_pagamento',
                            'entradas', 'producoes', 'grupos_adicionais', 'loja_bairros'], true)) {
        throw new LogicException('Tabela fora da lista: ' . $tabela);
    }
    if (!consultarUm('SELECT id FROM "' . $tabela . '" WHERE id = ?', [$id])) {
        throw new ErroApi(400, $mensagem);
    }
}
