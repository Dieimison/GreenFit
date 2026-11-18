<?php
/**
 * dados/dados-demonstracao.php - monta um banco de DEMONSTRACAO do Green
 * Fit: cardapio completo, equipe, clientes, 60 dias de movimento (compras
 * por nota, producao, balcao, pedidos online com avaliacao e cashback) e
 * um "hoje" vivo (pedidos em cada etapa do quadro, lotes vencendo, insumo
 * em falta, producao planejada).
 *
 * Uso (na pasta do projeto), SEMPRE num banco separado do da loja:
 *   php dados/aplicar-estrutura.php demo\demo.sqlite
 *   php dados/dados-demonstracao.php criar demo\demo.sqlite
 * (ou a variavel GREENFIT_DB). Recusa um banco que ja tem pratos: a
 * demonstracao nao se mistura com cadastro de verdade. Para refazer,
 * apague o arquivo da demonstracao e rode os dois comandos de novo.
 *
 * Tudo passa pelas MESMAS funcoes da API (api/api.php): se uma regra
 * recusar, a demonstracao para com a mensagem da API. O passado e feito
 * dia a dia "agora" e depois as datas daquele dia sao levadas para tras
 * (moverParaODia) - o estoque e o dinheiro continuam batendo, porque o
 * saldo e soma e nao depende da data.
 *
 * Senhas da demonstracao (faixa BANCO DE TESTE ligada):
 *   painel: p / p (acesso rapido, admin)   admin / Fit-Teste-2026x   cozinha / Forno-Verde-2026x   balcao / Caixa-Verde-2026x
 *   loja:   cliente@demo.com / Compra-Demo-2026
 */

declare(strict_types=1);

if (($argv[1] ?? '') !== 'criar') {
    fwrite(STDERR, "Uso:\n  php dados/dados-demonstracao.php criar [caminho\\do\\banco.sqlite]\n");
    exit(1);
}
if (!empty($argv[2])) {
    putenv('GREENFIT_DB=' . $argv[2]);
}

require __DIR__ . '/../api/api.php';

mt_srand(2026);
const DIAS_HISTORICO = 60;

function sorte(int $a, int $b): int
{
    return mt_rand($a, $b);
}

function chance(int $porcento): bool
{
    return mt_rand(1, 100) <= $porcento;
}

function escolher(array $lista)
{
    return $lista[array_rand($lista)];
}

/** Resposta de uma rota da API: [codigo, corpo]. Erro = para tudo com a mensagem. */
function api(array $r): array
{
    return $r[1];
}

function maxId(string $tabela): int
{
    return (int) consultarUm('SELECT COALESCE(MAX(id), 0) AS m FROM "' . $tabela . '"')['m'];
}

/*
 * Leva para o dia "-$n dias" tudo o que foi criado depois das marcas, com
 * a hora espalhada no horario da loja. Colunas de data pura recuam a data;
 * as de data e hora ganham a hora sorteada (a mesma por registro).
 */
function moverParaODia(array $marcas, int $n): void
{
    if ($n <= 0) {
        return;
    }
    $mapa = [
        'entradas' => [['data_entrada', 'hora'], ['validade', 'data']],
        'producoes' => [['data_producao', 'data'], ['validade', 'data'], ['criado_em', 'cedo'], ['atualizado_em', 'cedo'], ['concluida_em', 'cedo']],
        'vendas' => [['data_venda', 'hora'], ['atualizado_em', 'hora']],
        'lancamentos' => [['vencimento', 'data'], ['data_pagamento', 'hora'], ['criado_em', 'hora']],
        'lancamentos_log' => [['criado_em', 'hora']],
        'encomendas' => [['criado_em', 'hora'], ['atualizado_em', 'hora'], ['pagar_ate', 'hora'], ['previsao', 'hora'], ['avaliado_em', 'tarde']],
        'encomenda_eventos' => [['momento', 'hora']],
        'movimentacoes' => [['criado_em', 'cedo']],
        'cashback' => [['criado_em', 'hora']],
        'pedidos' => [['data_entrada', 'cedo'], ['criado_em', 'cedo'], ['atualizado_em', 'cedo'], ['confirmado_em', 'cedo']],
        'pedido_parcelas' => [['vencimento', 'data']],
    ];
    foreach ($mapa as $tabela => $colunas) {
        $desde = $marcas[$tabela] ?? 0;
        foreach (consultar('SELECT id FROM "' . $tabela . '" WHERE id > ?', [$desde]) as $linha) {
            $hora = sprintf('%02d:%02d:%02d', sorte(11, 20), sorte(0, 59), sorte(0, 59));
            $sets = [];
            foreach ($colunas as [$col, $tipo]) {
                if ($tipo === 'data') {
                    $sets[] = "{$col} = CASE WHEN {$col} IS NULL THEN NULL ELSE date({$col}, '-{$n} days') END";
                } else {
                    $h = $tipo === 'cedo' ? sprintf('%02d:%02d:00', sorte(7, 9), sorte(0, 59))
                       : ($tipo === 'tarde' ? sprintf('%02d:%02d:00', sorte(19, 22), sorte(0, 59)) : $hora);
                    $sets[] = "{$col} = CASE WHEN {$col} IS NULL THEN NULL ELSE date({$col}, '-{$n} days') || ' {$h}' END";
                }
            }
            executarSql('UPDATE "' . $tabela . '" SET ' . implode(', ', $sets) . ' WHERE id = ?', [$linha['id']]);
        }
    }
}

function marcas(): array
{
    $m = [];
    foreach (['entradas', 'producoes', 'vendas', 'lancamentos', 'lancamentos_log', 'encomendas', 'encomenda_eventos',
              'movimentacoes', 'cashback', 'pedidos', 'pedido_parcelas'] as $t) {
        $m[$t] = maxId($t);
    }
    return $m;
}

// ------------------------------------------------------------------
// Conferencias
// ------------------------------------------------------------------
if ((int) consultarUm('SELECT COUNT(*) AS q FROM pratos')['q'] > 0) {
    fwrite(STDERR, "Este banco ja tem pratos cadastrados. A demonstracao so roda num banco NOVO e separado:\n"
        . "  php dados\\aplicar-estrutura.php demo\\demo.sqlite\n  php dados\\dados-demonstracao.php criar demo\\demo.sqlite\n");
    exit(1);
}
echo "Banco: " . caminhoBanco() . "\n";
$inicio = microtime(true);

// ------------------------------------------------------------------
// Equipe, empresa, regras, loja
// ------------------------------------------------------------------
executarSql("UPDATE usuarios SET senha_hash = ?, trocar_senha = 0, nome = 'Administrador' WHERE usuario = 'admin'", [gerarHash('Fit-Teste-2026x')]);
$admin = consultarUm("SELECT id, usuario, nome, perfil FROM usuarios WHERE usuario = 'admin'");
foreach ([['cozinha', 'Marina (cozinha)', 'cozinha', 'Forno-Verde-2026x'], ['balcao', 'Lucas (balcão)', 'atendimento', 'Caixa-Verde-2026x']] as [$u, $n, $p, $s]) {
    executarSql('INSERT INTO usuarios (usuario, nome, senha_hash, perfil, ativo, trocar_senha) VALUES (?, ?, ?, ?, 1, 0)', [$u, $n, gerarHash($s), $p]);
}
$balcao = consultarUm("SELECT id, usuario, nome, perfil FROM usuarios WHERE usuario = 'balcao'");
$cozinha = consultarUm("SELECT id, usuario, nome, perfil FROM usuarios WHERE usuario = 'cozinha'");
// A demonstracao e um banco de homologacao: faixa "banco de teste", fiscal em
// homologacao e o acesso rapido p / p - o mesmo que dados\homologacao.php faz.
require __DIR__ . '/homologacao.php';
colocarEmHomologacao();
executarSql("UPDATE empresas SET razao_social = 'Green Fit Refeições Saudáveis (demonstração)' WHERE id = (SELECT MIN(id) FROM empresas)");
// Durante a montagem a loja fica aberta 24 h (o passado e feito "agora"); no fim, o horario da demonstracao.
executarSql("UPDATE loja_horarios SET aberto = 1, abre = '00:00', fecha = '23:59'");
api(ajustesDaLoja(null, 'PUT', [
    'aberta' => 1, 'slogan' => 'Comida de verdade, do jeito que o seu corpo pede', 'chave_pix' => 'pix@greenfit.demo',
    'recebedor_pix' => 'Green Fit Refeições', 'endereco_retirada' => 'Rua das Gaivotas, 100 - Ingleses, Florianópolis (endereço de demonstração)',
    'whatsapp' => '48992092237', 'instagram' => 'green_fit_floripa', 'cashback_percentual' => 5, 'pedido_minimo' => 25,
    'frete_gratis_acima' => 120, 'tempo_preparo_min' => 35, 'mensagem_aviso' => 'Cardápio novo da semana: experimente o Bowl Green Fit!',
], $admin));
foreach ([['BEMVINDO10', 'percentual', 10, 0, 1, 'Boas-vindas: 10% na primeira compra'],
          ['FIT5', 'valor', 5, 60, 0, 'R$ 5 de desconto em pedidos a partir de R$ 60'],
          ['FRETEGRATIS', 'frete', 0, 50, 0, 'Entrega grátis a partir de R$ 50']] as [$cod, $tipo, $valor, $min, $primeira, $desc]) {
    api(crudCatalogo('cupons', null, 'POST', ['codigo' => $cod, 'tipo' => $tipo, 'valor' => $valor, 'pedido_minimo' => $min,
        'primeira_compra' => $primeira, 'descricao' => $desc, 'limite_por_cliente' => $primeira ? 1 : 3], []));
}
echo "equipe, loja e cupons ok\n";

// ------------------------------------------------------------------
// Fornecedores e insumos (custo por kg, L ou unidade; validade em dias)
// ------------------------------------------------------------------
$fornecedores = [];
foreach ([['Avícola Ilha (demo)', 'SC', '12345678000190'], ['Hortifruti Norte da Ilha (demo)', 'SC', '23456789000110'],
          ['Empório Grãos & Cia (demo)', 'SC', '34567890000150'], ['Embalagens Floripa (demo)', 'SC', '45678901000120']] as [$n, $uf, $doc]) {
    $fornecedores[$n] = api(crudCatalogo('fornecedores', null, 'POST', ['nome' => $n, 'uf' => $uf, 'documento' => $doc, 'telefone' => '(48) 3333-0000'], []))['id'];
}
[$fAves, $fHorti, $fGraos, $fEmb] = array_values($fornecedores);

// nome => [categoria, unidade, preco por kg/L/un, minimo (unidade base), validade dias, fornecedor]
$tabelaInsumos = [
    'Peito de frango'        => ['proteina', 'g', 28.00, 4000, 5, $fAves],
    'Carne bovina (patinho)' => ['proteina', 'g', 46.00, 3000, 4, $fAves],
    'Filé de tilápia'        => ['proteina', 'g', 44.00, 2000, 4, $fAves],
    'Ovos'                   => ['laticinio', 'un', 0.70, 30, 20, $fAves],
    'Batata-doce'            => ['carboidrato', 'g', 6.50, 4000, 20, $fHorti],
    'Arroz integral'         => ['carboidrato', 'g', 9.00, 3000, 180, $fGraos],
    'Quinoa'                 => ['graos', 'g', 38.00, 1500, 180, $fGraos],
    'Abóbora cabotiá'        => ['legume_verdura', 'g', 5.00, 3000, 15, $fHorti],
    'Brócolis'               => ['legume_verdura', 'g', 14.00, 1500, 5, $fHorti],
    'Mix de folhas'          => ['legume_verdura', 'g', 22.00, 1000, 4, $fHorti],
    'Tomate cereja'          => ['legume_verdura', 'g', 16.00, 1000, 7, $fHorti],
    'Cenoura'                => ['legume_verdura', 'g', 5.00, 1500, 20, $fHorti],
    'Beterraba'              => ['legume_verdura', 'g', 5.50, 1000, 20, $fHorti],
    'Abacate'                => ['fruta', 'g', 12.00, 1500, 6, $fHorti],
    'Grão-de-bico'           => ['graos', 'g', 14.00, 1500, 180, $fGraos],
    'Couve'                  => ['legume_verdura', 'g', 16.00, 600, 5, $fHorti],
    'Maçã verde'             => ['fruta', 'g', 11.00, 2000, 15, $fHorti],
    'Gengibre'               => ['tempero', 'g', 20.00, 200, 20, $fHorti],
    'Limão'                  => ['fruta', 'g', 6.00, 800, 15, $fHorti],
    'Morango'                => ['fruta', 'g', 24.00, 800, 5, $fHorti],
    'Banana'                 => ['fruta', 'g', 6.00, 1500, 6, $fHorti],
    'Aveia em flocos'        => ['graos', 'g', 12.00, 1500, 180, $fGraos],
    'Cacau 70%'              => ['outro', 'g', 80.00, 400, 180, $fGraos],
    'Iogurte natural'        => ['laticinio', 'ml', 12.00, 2000, 15, $fGraos],
    'Azeite extra virgem'    => ['tempero', 'ml', 52.00, 1000, 365, $fGraos],
    'Pote marmita 750 ml'    => ['embalagem', 'un', 0.85, 80, 0, $fEmb],
    'Bowl com tampa'         => ['embalagem', 'un', 1.20, 60, 0, $fEmb],
    'Potinho de molho 50 ml' => ['embalagem', 'un', 0.25, 80, 0, $fEmb],
    'Garrafa 300 ml'         => ['embalagem', 'un', 0.90, 40, 0, $fEmb],
];
$insumo = [];
foreach ($tabelaInsumos as $nome => [$cat, $un, , $min]) {
    $insumo[$nome] = api(crudCatalogo('insumos', null, 'POST', ['nome' => $nome, 'categoria' => $cat, 'unidade' => $un, 'estoque_minimo' => $min], []))['id'];
}
echo count($insumo) . " insumos\n";

// ------------------------------------------------------------------
// Adicionais e cardapio
// ------------------------------------------------------------------
$gMolho = api(gruposAdicionais(null, 'POST', ['nome' => 'Escolha o molho', 'minimo' => 1, 'maximo' => 1, 'descricao' => 'Vai à parte, no potinho', 'adicionais' => [
    ['nome' => 'Mostarda e mel', 'preco' => 0, 'kcal' => 45], ['nome' => 'Iogurte com ervas', 'preco' => 0, 'kcal' => 30, 'proteinas' => 1],
    ['nome' => 'Tahine com limão', 'preco' => 0, 'kcal' => 60, 'proteinas' => 2], ['nome' => 'Sem molho', 'preco' => 0, 'kcal' => 0]]], $admin))['id'];
$gTurbine = api(gruposAdicionais(null, 'POST', ['nome' => 'Turbine seu prato', 'minimo' => 0, 'maximo' => 3, 'adicionais' => [
    ['nome' => 'Ovo cozido', 'preco' => 3.00, 'kcal' => 70, 'proteinas' => 6], ['nome' => 'Porção extra de frango (100 g)', 'preco' => 8.00, 'kcal' => 165, 'proteinas' => 31],
    ['nome' => 'Abacate extra', 'preco' => 4.00, 'kcal' => 80, 'proteinas' => 1], ['nome' => 'Mix de castanhas', 'preco' => 3.50, 'kcal' => 90, 'proteinas' => 3]]], $admin))['id'];
$gSuco = api(gruposAdicionais(null, 'POST', ['nome' => 'Quer gelo?', 'minimo' => 0, 'maximo' => 1, 'adicionais' => [
    ['nome' => 'Com gelo', 'preco' => 0], ['nome' => 'Sem gelo', 'preco' => 0]]], $admin))['id'];
$opcoes = [];
foreach (consultar('SELECT id, nome FROM adicionais') as $a) {
    $opcoes[$a['nome']] = (int) $a['id'];
}
$cat = array_column(consultar('SELECT id, nome FROM categorias'), 'id', 'nome');

$foto = 'data:image/jpeg;base64,' . base64_encode((string) file_get_contents(__DIR__ . '/../Img/demo-bowl.jpg'));
// chave => [campos do prato, ficha [insumo => quantidade], grupos]
$cardapio = [
    'frango' => [['nome' => 'Frango grelhado com batata-doce e brócolis', 'categoria_id' => $cat['Marmitas fit'], 'preco' => 29.90,
        'descricao' => 'Peito de frango grelhado na chapa, batata-doce assada com alecrim e brócolis no vapor. O clássico do pós-treino.',
        'porcao_g' => 380, 'kcal' => 430, 'proteinas' => 40, 'carboidratos' => 44, 'gorduras' => 9, 'fibras' => 7, 'sodio_mg' => 380,
        'ingredientes' => 'Peito de frango, batata-doce, brócolis, azeite extra virgem, alecrim, sal rosa.', 'alergenicos' => 'Não contém glúten nem lactose.',
        'tags' => ['high_protein', 'sem_gluten', 'sem_lactose'], 'validade_dias' => 4, 'modo_preparo' => 'Micro-ondas: 3 minutos com a tampa entreaberta.',
        'destaque' => 1, 'estoque_minimo' => 10, 'ncm' => '16023220', 'ordem' => 1],
        ['Peito de frango' => 150, 'Batata-doce' => 180, 'Brócolis' => 80, 'Azeite extra virgem' => 5, 'Pote marmita 750 ml' => 1], [$gTurbine]],
    'carne' => [['nome' => 'Iscas de patinho com arroz integral e legumes', 'categoria_id' => $cat['Marmitas fit'], 'preco' => 32.90,
        'descricao' => 'Iscas de patinho acebolado, arroz integral soltinho, cenoura e brócolis salteados.',
        'porcao_g' => 400, 'kcal' => 520, 'proteinas' => 38, 'carboidratos' => 50, 'gorduras' => 16, 'fibras' => 6, 'sodio_mg' => 420,
        'ingredientes' => 'Patinho, arroz integral, cenoura, brócolis, cebola, azeite.', 'alergenicos' => 'Não contém glúten nem lactose.',
        'tags' => ['high_protein', 'sem_lactose'], 'validade_dias' => 4, 'modo_preparo' => 'Micro-ondas: 3 a 4 minutos.', 'estoque_minimo' => 8, 'ordem' => 2],
        ['Carne bovina (patinho)' => 140, 'Arroz integral' => 150, 'Cenoura' => 50, 'Brócolis' => 50, 'Azeite extra virgem' => 5, 'Pote marmita 750 ml' => 1], [$gTurbine]],
    'tilapia' => [['nome' => 'Tilápia com purê de abóbora', 'categoria_id' => $cat['Low carb'], 'preco' => 34.90, 'preco_promocional' => 31.90,
        'descricao' => 'Filé de tilápia grelhado com limão e purê cremoso de abóbora cabotiá. Leve e saboroso.',
        'porcao_g' => 330, 'kcal' => 310, 'proteinas' => 33, 'carboidratos' => 18, 'gorduras' => 11, 'fibras' => 4, 'sodio_mg' => 350,
        'ingredientes' => 'Tilápia, abóbora cabotiá, limão, azeite, salsinha.', 'alergenicos' => 'Contém peixe.',
        'tags' => ['low_carb', 'sem_gluten', 'sem_lactose'], 'validade_dias' => 3, 'modo_preparo' => 'Micro-ondas: 2 minutos e meio.', 'estoque_minimo' => 6, 'ordem' => 3],
        ['Filé de tilápia' => 150, 'Abóbora cabotiá' => 180, 'Limão' => 10, 'Azeite extra virgem' => 5, 'Pote marmita 750 ml' => 1], [$gTurbine]],
    'escondidinho' => [['nome' => 'Escondidinho de frango com batata-doce', 'categoria_id' => $cat['Marmitas fit'], 'preco' => 29.90,
        'descricao' => 'Frango desfiado temperado coberto com purê de batata-doce e iogurte. Congelado: dura até 60 dias.',
        'porcao_g' => 400, 'kcal' => 450, 'proteinas' => 35, 'carboidratos' => 48, 'gorduras' => 11, 'fibras' => 6, 'sodio_mg' => 410,
        'ingredientes' => 'Frango, batata-doce, iogurte natural, cebola, alho.', 'alergenicos' => 'Contém lactose.',
        'tags' => ['high_protein', 'sem_gluten'], 'conservacao' => 'congelado', 'validade_dias' => 60,
        'modo_preparo' => 'Do freezer direto ao micro-ondas: 6 minutos, mexendo na metade.', 'estoque_minimo' => 12, 'ordem' => 4],
        ['Peito de frango' => 130, 'Batata-doce' => 200, 'Iogurte natural' => 30, 'Pote marmita 750 ml' => 1], []],
    'bowl' => [['nome' => 'Bowl Green Fit', 'categoria_id' => $cat['Bowls e saladas'], 'preco' => 36.90,
        'descricao' => 'Frango grelhado, mix de folhas, tomate cereja, abacate e quinoa. Montado na hora, com o molho à parte.',
        'porcao_g' => 420, 'kcal' => 480, 'proteinas' => 36, 'carboidratos' => 32, 'gorduras' => 22, 'fibras' => 9, 'sodio_mg' => 300,
        'ingredientes' => 'Frango, folhas verdes, tomate cereja, abacate, quinoa, azeite.', 'alergenicos' => 'Não contém glúten nem lactose.',
        'tags' => ['high_protein', 'sem_gluten', 'sem_lactose'], 'feito_na_hora' => 1, 'validade_dias' => 0, 'destaque' => 1, 'ordem' => 1,
        'fotos_novas' => [$foto]],
        ['Peito de frango' => 120, 'Mix de folhas' => 60, 'Tomate cereja' => 60, 'Abacate' => 60, 'Quinoa' => 60, 'Bowl com tampa' => 1, 'Potinho de molho 50 ml' => 1],
        [$gMolho, $gTurbine]],
    'graobico' => [['nome' => 'Salada de grão-de-bico com legumes', 'categoria_id' => $cat['Veggie'], 'preco' => 27.90,
        'descricao' => 'Grão-de-bico, tomate cereja, cenoura e beterraba raladas sobre folhas verdes. 100% vegetal.',
        'porcao_g' => 350, 'kcal' => 360, 'proteinas' => 14, 'carboidratos' => 42, 'gorduras' => 13, 'fibras' => 11, 'sodio_mg' => 220,
        'ingredientes' => 'Grão-de-bico, folhas, tomate cereja, cenoura, beterraba, azeite.', 'alergenicos' => 'Pode conter traços de gergelim.',
        'tags' => ['vegano', 'vegetariano', 'sem_gluten', 'sem_lactose'], 'feito_na_hora' => 1, 'validade_dias' => 0, 'ordem' => 2],
        ['Grão-de-bico' => 120, 'Tomate cereja' => 60, 'Cenoura' => 40, 'Beterraba' => 40, 'Mix de folhas' => 40, 'Bowl com tampa' => 1, 'Potinho de molho 50 ml' => 1],
        [$gMolho, $gTurbine]],
    'sopa' => [['nome' => 'Creme de abóbora com gengibre', 'categoria_id' => $cat['Sopas e caldos'], 'preco' => 19.90,
        'descricao' => 'Creme aveludado de abóbora cabotiá com um toque de gengibre. Congelado.',
        'porcao_g' => 400, 'kcal' => 180, 'proteinas' => 4, 'carboidratos' => 28, 'gorduras' => 6, 'fibras' => 5, 'sodio_mg' => 280,
        'ingredientes' => 'Abóbora cabotiá, gengibre, cebola, azeite.', 'alergenicos' => 'Não contém glúten nem lactose.',
        'tags' => ['vegano', 'sem_gluten', 'sem_lactose', 'low_carb'], 'conservacao' => 'congelado', 'validade_dias' => 30,
        'modo_preparo' => 'Micro-ondas: 5 minutos, mexendo na metade.', 'estoque_minimo' => 6, 'ordem' => 1],
        ['Abóbora cabotiá' => 300, 'Gengibre' => 10, 'Azeite extra virgem' => 5, 'Pote marmita 750 ml' => 1], []],
    'suco' => [['nome' => 'Suco verde detox', 'categoria_id' => $cat['Sucos e detox'], 'preco' => 12.90,
        'descricao' => 'Couve, maçã verde, limão e gengibre batidos na hora da produção. Sem açúcar.',
        'porcao_g' => 300, 'kcal' => 90, 'proteinas' => 1, 'carboidratos' => 21, 'gorduras' => 0, 'fibras' => 3, 'sodio_mg' => 20,
        'ingredientes' => 'Couve, maçã verde, limão, gengibre, água.', 'alergenicos' => 'Não contém alergênicos.',
        'tags' => ['vegano', 'sem_acucar', 'detox', 'sem_gluten', 'sem_lactose'], 'validade_dias' => 2, 'modo_preparo' => 'Agite antes de beber. Mantenha na geladeira.',
        'estoque_minimo' => 6, 'ordem' => 1],
        ['Couve' => 40, 'Maçã verde' => 120, 'Limão' => 30, 'Gengibre' => 5, 'Garrafa 300 ml' => 1], [$gSuco]],
    'brownie' => [['nome' => 'Brownie fit de cacau 70%', 'categoria_id' => $cat['Sobremesas fit'], 'preco' => 11.90,
        'descricao' => 'Brownie de aveia e cacau 70%, adoçado com banana. Molhadinho por dentro.',
        'porcao_g' => 80, 'kcal' => 190, 'proteinas' => 6, 'carboidratos' => 24, 'gorduras' => 8, 'fibras' => 4, 'sodio_mg' => 60,
        'ingredientes' => 'Aveia, cacau 70%, banana, ovos.', 'alergenicos' => 'Contém ovo e glúten (aveia).',
        'tags' => ['sem_acucar', 'sem_lactose'], 'validade_dias' => 5, 'estoque_minimo' => 6, 'ordem' => 1],
        ['Cacau 70%' => 20, 'Aveia em flocos' => 30, 'Ovos' => 1, 'Banana' => 40], []],
    'oats' => [['nome' => 'Overnight oats de morango', 'categoria_id' => $cat['Snacks'], 'preco' => 14.90,
        'descricao' => 'Aveia hidratada no iogurte natural com morango e banana. Pronto para o café da manhã.',
        'porcao_g' => 260, 'kcal' => 320, 'proteinas' => 13, 'carboidratos' => 48, 'gorduras' => 7, 'fibras' => 6, 'sodio_mg' => 90,
        'ingredientes' => 'Aveia, iogurte natural, morango, banana.', 'alergenicos' => 'Contém lactose e glúten (aveia).',
        'tags' => ['vegetariano'], 'validade_dias' => 3, 'estoque_minimo' => 5, 'ordem' => 2],
        ['Aveia em flocos' => 50, 'Iogurte natural' => 120, 'Morango' => 60, 'Banana' => 40, 'Pote marmita 750 ml' => 1], []],
    'kombucha' => [['nome' => 'Kombucha de gengibre 350 ml', 'categoria_id' => $cat['Sucos e detox'], 'preco' => 14.90, 'tipo' => 'revenda',
        'descricao' => 'Kombucha artesanal de gengibre e limão, de produtor local.', 'porcao_g' => 350, 'kcal' => 45, 'carboidratos' => 10,
        'tags' => ['vegano', 'sem_gluten', 'sem_lactose'], 'conservacao' => 'resfriado', 'validade_dias' => 0, 'estoque_minimo' => 6, 'ordem' => 3,
        'ncm' => '22029900'], [], []],
    'barra' => [['nome' => 'Barra de proteína 12 g', 'categoria_id' => $cat['Snacks'], 'preco' => 9.90, 'tipo' => 'revenda',
        'descricao' => 'Barra de proteína sabor cookies, 12 g de proteína.', 'porcao_g' => 45, 'kcal' => 160, 'proteinas' => 12, 'carboidratos' => 15, 'gorduras' => 5,
        'tags' => ['high_protein'], 'conservacao' => 'ambiente', 'validade_dias' => 0, 'estoque_minimo' => 10, 'ordem' => 3], [], []],
];
$prato = [];
foreach ($cardapio as $chave => [$campos, $ficha, $grupos]) {
    $campos['ficha'] = array_map(fn ($n, $q) => ['insumo_id' => $insumo[$n], 'quantidade' => $q], array_keys($ficha), $ficha);
    $campos['grupos'] = $grupos;
    $prato[$chave] = api(pratos(null, 'POST', $campos, $admin, []))['id'];
}
echo count($prato) . " pratos no cardapio\n";

// ------------------------------------------------------------------
// Clientes do app
// ------------------------------------------------------------------
$bairros = array_column(consultar('SELECT id, nome FROM loja_bairros'), 'id', 'nome');
$nomes = [['Cliente Demo', 'cliente@demo.com'], ['Ana Souza', 'ana.souza@demo.com'], ['Bruno Lima', 'bruno.lima@demo.com'],
          ['Carla Mendes', 'carla.mendes@demo.com'], ['Diego Rocha', 'diego.rocha@demo.com'], ['Elisa Prado', 'elisa.prado@demo.com'],
          ['Fábio Nunes', 'fabio.nunes@demo.com'], ['Gabriela Torres', 'gabriela.torres@demo.com'], ['Heitor Alves', 'heitor.alves@demo.com'],
          ['Isabela Costa', 'isabela.costa@demo.com'], ['João Pedro Silva', 'joao.silva@demo.com'], ['Larissa Melo', 'larissa.melo@demo.com']];
$contas = [];
$hash = gerarHash('Compra-Demo-2026');
foreach ($nomes as $i => [$nome, $email]) {
    executarSql('INSERT INTO loja_contas (email, nome, telefone, senha_hash, objetivo, meta_kcal, aceita_novidades) VALUES (?, ?, ?, ?, ?, ?, ?)',
                [$email, $nome, '4899' . sprintf('%07d', 1000000 + $i * 7919), $hash, escolher(['emagrecer', 'ganhar_massa', 'manter', 'saude']),
                 escolher([1600, 1800, 2000, 2200, 2500, null]), chance(60) ? 1 : 0]);
    $contaId = (int) banco()->lastInsertId();
    $bairro = escolher(array_keys($bairros));
    salvarEndereco($contaId, ['apelido' => 'Casa', 'destinatario' => $nome, 'cep' => null, 'logradouro' => escolher(['Rua das Gaivotas', 'Rua Dom João Becker', 'Servidão dos Pescadores', 'Rua do Siri', 'Av. Luiz Boiteux Piazza']),
                              'numero' => (string) sorte(10, 1900), 'complemento' => chance(40) ? 'Apto ' . sorte(101, 504) : null,
                              'referencia' => chance(30) ? 'Perto da praça' : null, 'bairro_id' => $bairros[$bairro], 'bairro' => $bairro,
                              'cidade' => 'Florianópolis', 'uf' => 'SC']);
    $contas[] = consultarUm('SELECT * FROM loja_contas WHERE id = ?', [$contaId]);
}
executarSql('INSERT INTO favoritos (conta_id, prato_id) VALUES (?, ?), (?, ?)', [$contas[0]['id'], $prato['bowl'], $contas[0]['id'], $prato['frango']]);
foreach ([['Marcos Vinícius', '(48) 99111-2233', 'ganhar_massa', null], ['Patrícia Ramos', '(48) 99222-3344', 'emagrecer', 'Sem lactose'],
          ['Academia Corpo em Forma (demo)', '(48) 3222-1100', null, null]] as [$n, $t, $o, $r]) {
    api(crudCatalogo('clientes', null, 'POST', ['nome' => $n, 'telefone' => $t, 'objetivo' => $o, 'restricoes' => $r, 'bairro' => 'Ingleses'], []));
}
$clientesBalcao = array_map('intval', array_column(consultar('SELECT id FROM clientes'), 'id'));
echo count($contas) . " contas no app\n";

// ------------------------------------------------------------------
// O dia de loja (usado no passado e no hoje)
// ------------------------------------------------------------------
$formas = array_column(consultar('SELECT id, nome FROM formas_pagamento'), 'id', 'nome');
$naturezas = array_column(consultar('SELECT id, codigo FROM naturezas_operacao'), 'id', 'codigo');
$comEstoque = ['frango', 'carne', 'tilapia', 'escondidinho', 'sopa', 'suco', 'brownie', 'oats'];
$popularidade = ['frango' => 10, 'carne' => 7, 'tilapia' => 5, 'escondidinho' => 4, 'sopa' => 3, 'suco' => 5, 'brownie' => 4, 'oats' => 3,
                 'bowl' => 8, 'graobico' => 4, 'kombucha' => 3, 'barra' => 3];

/** Um prato sorteado pela popularidade. */
function pratoSorteado(array $pop): string
{
    $total = array_sum($pop);
    $r = mt_rand(1, $total);
    foreach ($pop as $k => $p) {
        $r -= $p;
        if ($r <= 0) {
            return $k;
        }
    }
    return array_key_first($pop);
}

/** Compra da semana por nota (pedido de entrada confirmado): insumos para ~$dias dias. */
function compraDaSemana(array $tabela, array $insumo, array $naturezas, array $porFornecedor, float $fatorDias, array $usuario, bool $comValidade): void
{
    foreach ($porFornecedor as $fornecedorId => $nomes) {
        $itens = [];
        foreach ($nomes as $nome) {
            [, $un, $preco, $min, $validade] = $tabela[$nome];
            $base = $un === 'un' ? max(20, (int) ($min * 3 * $fatorDias / 7)) : max(1000, (int) (round($min * 3 * $fatorDias / 7 / 500) * 500));
            $qtdNota = $un === 'un' ? $base : $base / 1000;   // na nota: KG, L ou UN
            $total = round($qtdNota * $preco * (mt_rand(95, 105) / 100), 2);
            $itens[] = ['tipo_item' => 'insumo', 'insumo_id' => $insumo[$nome], 'descricao' => mb_strtoupper($nome), 'codigo_fornecedor' => 'D' . $insumo[$nome],
                        'quantidade' => $qtdNota, 'unidade' => $un === 'g' ? 'KG' : ($un === 'ml' ? 'L' : 'UN'), 'fator' => $un === 'un' ? 1 : 1000,
                        'valor_total' => $total, 'validade' => $comValidade && $validade > 0 ? date('Y-m-d', strtotime('+' . $validade . ' days')) : null];
        }
        $total = array_sum(array_column($itens, 'valor_total'));
        $r = api(pedidos(null, 'POST', ['natureza_id' => $naturezas['COMPRA_INSUMO'], 'fornecedor_id' => $fornecedorId, 'itens' => $itens,
            'nota_numero' => (string) mt_rand(10000, 99999), 'nota_serie' => '1',
            'parcelas' => [['vencimento' => date('Y-m-d', strtotime('+14 days')), 'valor' => round($total, 2)]]], $usuario, null));
        api(pedidos((int) $r['id'], 'POST', [], $usuario, 'confirmar'));
    }
}

$porFornecedor = [];
foreach ($tabelaInsumos as $nome => $d) {
    $porFornecedor[$d[5]][] = $nome;
}

/*
 * Compra digitada (a feira, o mercado, a revenda): uma Entrada de uma linha
 * confirmada com "Já paguei" - o caminho unico da tela desde que o Estoque
 * deixou de lancar entrada avulsa. Confirma o admin (a regra
 * pedido.confirmar_equipe nasce desligada).
 */
function compraDigitada(array $linha, int $fornecedorId, string $natureza, ?int $formaId): void
{
    global $naturezas, $admin;
    if (empty($linha['descricao'])) {
        $linha['descricao'] = !empty($linha['prato_id'])
            ? consultarUm('SELECT nome FROM pratos WHERE id = ?', [$linha['prato_id']])['nome']
            : consultarUm('SELECT nome FROM insumos WHERE id = ?', [$linha['insumo_id']])['nome'];
    }
    $r = api(pedidos(null, 'POST', ['natureza_id' => $naturezas[$natureza], 'fornecedor_id' => $fornecedorId,
        'forma_pagamento_id' => $formaId, 'observacoes' => 'Compra digitada', 'itens' => [$linha]], $admin, null));
    api(pedidos((int) $r['id'], 'POST', ['pago' => 1], $admin, 'confirmar'));
}

/*
 * Produz $porcoes de um prato (planejada + concluida). Faltou insumo? A
 * cozinha passa no mercado antes (compra avulsa paga no Pix, com folga).
 */
function produzir(int $pratoId, int $porcoes, array $usuario): void
{
    global $tabelaInsumos, $formas;
    foreach (necessidadeDaProducao($pratoId, $porcoes, false) as $n) {
        if ($n['falta'] <= 0) {
            continue;
        }
        [, $un, $preco, , , $fornecedor] = $tabelaInsumos[$n['nome']];
        $q = $un === 'un' ? max(20, $n['falta'] * 2) : (int) (ceil($n['falta'] * 2 / 500) * 500);
        $naNota = $un === 'un' ? $q : $q / 1000;   // KG, L ou UN, como na tela
        compraDigitada(['tipo_item' => 'insumo', 'insumo_id' => $n['insumo_id'], 'descricao' => $n['nome'], 'quantidade' => $naNota,
            'unidade' => $un === 'g' ? 'KG' : ($un === 'ml' ? 'L' : 'UN'), 'fator' => $un === 'un' ? 1 : 1000,
            'valor_total' => round($naNota * $preco * (mt_rand(97, 110) / 100), 2)], $fornecedor, 'COMPRA_INSUMO', $formas['Pix']);
    }
    api(producoes(null, null, 'POST', ['prato_id' => $pratoId, 'quantidade' => $porcoes, 'concluir' => 1], $usuario, []));
}

/** Uma venda de balcao com 1 a 3 pratos que tenham estoque agora. */
function vendaBalcao(array $prato, array $pop, array $formas, array $clientes, array $usuario): void
{
    $itens = [];
    for ($i = 0, $n = sorte(1, 3); $i < $n; $i++) {
        $k = pratoSorteado($pop);
        $p = consultarUm(SQL_PRATOS . ' WHERE p.id = ?', [$prato[$k]]);
        $livre = disponivelDoPrato($p);
        if ($livre !== null && $livre < 1) {
            continue;
        }
        $itens[] = ['prato_id' => $prato[$k], 'quantidade' => 1];
    }
    if (!$itens) {
        return;
    }
    $forma = escolher(['Dinheiro', 'Pix', 'Pix', 'Cartão de débito', 'Cartão de crédito', 'Vale-refeição']);
    try {
        api(criarVenda(['itens' => $itens, 'forma_pagamento_id' => $formas[$forma], 'cliente_id' => chance(30) ? escolher($clientes) : null,
                        'observacoes' => 'Balcão'], $usuario));
    } catch (ErroApi $e) {
        // duas linhas do mesmo prato podem passar do saldo: a demonstracao segue
    }
}

/** Um pedido do app, levado ate $ate (null = so criado). Devolve o id ou null. */
function pedidoOnline(array $conta, array $prato, array $pop, array $opcoes, array $bairros, ?string $ate, array $usuario, bool $avaliar, ?string $pagar = null, ?bool $retirar = null): ?int
{
    $itens = [];
    for ($i = 0, $n = sorte(1, 3); $i < $n; $i++) {
        $k = pratoSorteado($pop);
        $p = consultarUm(SQL_PRATOS . ' WHERE p.id = ?', [$prato[$k]]);
        $livre = disponivelDoPrato($p);
        $q = sorte(1, 2);
        if ($livre !== null && $livre < $q + 1) {
            continue;
        }
        $ad = [];
        if (in_array($k, ['bowl', 'graobico'], true)) {
            $ad[] = $opcoes[escolher(['Mostarda e mel', 'Iogurte com ervas', 'Tahine com limão', 'Sem molho'])];
        }
        if (in_array($k, ['frango', 'carne', 'tilapia', 'bowl', 'graobico'], true) && chance(35)) {
            $ad[] = $opcoes[escolher(['Ovo cozido', 'Porção extra de frango (100 g)', 'Abacate extra', 'Mix de castanhas'])];
        }
        $itens[] = ['prato_id' => $prato[$k], 'quantidade' => $q, 'adicionais' => $ad,
                    'observacao' => chance(12) ? escolher(['Sem cebola, por favor', 'Molho bem separado', 'Talher descartável']) : null];
    }
    if (!$itens) {
        return null;
    }
    $retirada = $retirar ?? chance(25);
    $end = consultarUm('SELECT id FROM loja_enderecos WHERE conta_id = ? LIMIT 1', [$conta['id']]);
    $pagamento = $pagar ?? escolher(['pix', 'pix', 'pix', 'cartao_entrega', 'dinheiro_entrega', 'vr_entrega']);
    $corpo = ['itens' => $itens, 'tipo_entrega' => $retirada ? 'retirada' : 'entrega', 'endereco_id' => $end['id'] ?? null,
              'pagamento' => $pagamento, 'usar_cashback' => chance(30) ? 1 : 0,
              'cupom' => chance(8) ? 'FIT5' : null, 'troco_para' => $pagamento === 'dinheiro_entrega' ? 200 : null];
    try {
        $r = api(criarEncomenda($conta, $corpo));
    } catch (ErroApi $e) {
        return null;   // cupom sem minimo, prato que esgotou: o cliente desistiria
    }
    $id = (int) $r['id'];
    if ($ate === null) {
        return $id;
    }
    if ($ate === 'cancelada') {
        api(cancelarEncomenda($id, ['motivo' => 'Cliente pediu para cancelar pelo WhatsApp.'], $usuario));
        return $id;
    }
    api(confirmarEncomenda($id, [], $usuario));
    $e = consultarUm('SELECT * FROM encomendas WHERE id = ?', [$id]);
    foreach (trilhaDe($e) as $passo) {
        if ($passo === 'confirmado') {
            continue;
        }
        api(avancarEncomenda($id, ['para' => $passo], $usuario));
        if ($passo === $ate) {
            break;
        }
    }
    if ($avaliar && $ate === 'entregue' && chance(65)) {
        executarSql('UPDATE encomendas SET avaliacao_nota = ?, avaliacao_comentario = ?, avaliado_em = ? WHERE id = ?',
                    [escolher([5, 5, 5, 4, 4, 5, 3]), chance(50) ? escolher(['Muito saboroso!', 'Chegou quentinho e bem embalado.',
                     'O bowl é o melhor da ilha!', 'Porção caprichada.', 'Poderia vir mais molho.', 'Entrega rápida, recomendo!']) : null, agora(), $id]);
    }
    return $id;
}

// ------------------------------------------------------------------
// O passado: um dia de cada vez, levado para tras
// ------------------------------------------------------------------
for ($n = DIAS_HISTORICO; $n >= 1; $n--) {
    $marcas = marcas();
    if ($n === DIAS_HISTORICO || $n % 7 === 0) {
        compraDaSemana($tabelaInsumos, $insumo, $naturezas, $porFornecedor, 7.5, $admin, false);
    }
    // Mais movimento na sexta e no sabado; a loja cresce ao longo dos 60 dias.
    $diaSemana = (int) date('w', strtotime("-{$n} days"));
    $ritmo = (in_array($diaSemana, [5, 6], true) ? 1.3 : 1.0) * (0.7 + 0.5 * (DIAS_HISTORICO - $n) / DIAS_HISTORICO);
    if ($diaSemana === 0) {
        moverParaODia($marcas, $n);   // domingo fechado (so a compra da semana, se cair aqui)
        continue;
    }
    // O que venceu ate este dia vai para o descarte (no dia certo).
    foreach (consultar("SELECT id, saldo FROM vw_entradas WHERE tipo = 'prato' AND saldo > 0 AND validade < date('now', 'localtime', ?)", ["-{$n} days"]) as $l) {
        api(movimentacoes(null, 'POST', ['entrada_id' => $l['id'], 'motivo' => 'vencimento', 'quantidade' => (int) $l['saldo'], 'observacoes' => 'Passou da validade'], $cozinha, []));
    }
    foreach ($comEstoque as $k) {
        $porcoes = max(2, (int) round($popularidade[$k] * 1.05 * $ritmo + sorte(-1, 1)));
        if (in_array($k, ['escondidinho', 'sopa'], true) && $n % 6 !== 0) {
            continue;   // congelados: produz de 6 em 6 dias, para a semana
        }
        if (in_array($k, ['escondidinho', 'sopa'], true)) {
            $porcoes *= 2;
        }
        produzir($prato[$k], $porcoes, $cozinha);
    }
    if ($n === DIAS_HISTORICO || $n % 10 === 0) {
        foreach ([['kombucha', 12, 6.50], ['barra', 15, 4.20]] as [$k, $q, $custo]) {
            compraDigitada(['tipo_item' => 'prato', 'prato_id' => $prato[$k], 'quantidade' => $q, 'unidade' => 'UN', 'fator' => 1,
                'valor_total' => round($q * $custo, 2), 'validade' => date('Y-m-d', strtotime('+90 days'))], $fGraos, 'COMPRA_REVENDA', $formas['Pix']);
        }
    }
    for ($i = 0, $v = (int) round(sorte(6, 12) * $ritmo); $i < $v; $i++) {
        vendaBalcao($prato, $popularidade, $formas, $clientesBalcao, $balcao);
    }
    for ($i = 0, $p = (int) round(sorte(4, 9) * $ritmo); $i < $p; $i++) {
        pedidoOnline(escolher($contas), $prato, $popularidade, $opcoes, $bairros, chance(5) ? 'cancelada' : 'entregue', $balcao, true);
    }
    // Fim do dia: o que sobrou e venceria vai para a degustacao/descarte de vez em quando.
    foreach (consultar("SELECT id, saldo FROM vw_entradas WHERE tipo = 'prato' AND saldo > 0 AND validade IS NOT NULL AND validade <= date('now', 'localtime', '+1 day')") as $l) {
        if (chance(30)) {
            api(movimentacoes(null, 'POST', ['entrada_id' => $l['id'], 'motivo' => chance(60) ? 'degustacao' : 'vencimento',
                'quantidade' => min((int) $l['saldo'], sorte(1, 2)), 'observacoes' => 'Fim do dia'], $cozinha, []));
        }
    }
    if ($n % 15 === 0) {
        foreach ([['Aluguel', 3200.00], ['Energia', sorte(480, 620)], ['Gás', sorte(180, 260)], ['Internet', 129.90],
                  ['Entregador', sorte(900, 1300)], ['Marketing', 350.00]] as [$categoria, $valor]) {
            api(lancamentos(null, 'POST', ['tipo' => 'pagar', 'descricao' => $categoria . ' (demo)', 'categoria' => $categoria, 'valor' => $valor,
                'vencimento' => date('Y-m-d'), 'status' => 'pago', 'forma_pagamento_id' => $formas['Pix']], $admin, []));
        }
    }
    moverParaODia($marcas, $n);
    if ($n % 10 === 0) {
        echo "  dia -{$n} ok\n";
    }
}
// As contas das compras do passado foram pagas no vencimento (a loja esta em dia).
executarSql("UPDATE lancamentos SET status = 'pago', data_pagamento = vencimento || ' 10:00:00'
              WHERE tipo = 'pagar' AND status = 'pendente' AND vencimento < date('now', 'localtime')");
// Lotes de prato do passado que ficaram vencidos: descarte (o da tilapia fica, para o painel mostrar um vencido).
$marcas = marcas();
foreach (consultar("SELECT id, saldo, prato_id FROM vw_entradas WHERE tipo = 'prato' AND saldo > 0 AND dias_validade < 0") as $l) {
    api(movimentacoes(null, 'POST', ['entrada_id' => $l['id'], 'motivo' => 'vencimento', 'quantidade' => (int) $l['saldo'],
        'observacoes' => 'Descarte do fim de semana'], $cozinha, []));
}
moverParaODia($marcas, 1);

// ------------------------------------------------------------------
// Hoje
// ------------------------------------------------------------------
compraDaSemana($tabelaInsumos, $insumo, $naturezas, $porFornecedor, 3, $admin, true);
// Uma alface vencida (para o "Baixar vencidos") e a quinoa abaixo do minimo.
compraDigitada(['tipo_item' => 'insumo', 'insumo_id' => $insumo['Mix de folhas'], 'quantidade' => 0.8, 'unidade' => 'KG', 'fator' => 1000,
    'valor_total' => 17.60, 'validade' => date('Y-m-d', strtotime('-1 day')), 'lote' => 'FOLHAS-ONTEM'], $fHorti, 'COMPRA_INSUMO', $formas['Pix']);
// A quinoa fica abaixo do minimo (o painel avisa para comprar).
executarSql('UPDATE insumos SET estoque_minimo = (SELECT disponivel FROM vw_estoque_insumos WHERE insumo_id = ?) + 1500 WHERE id = ?', [$insumo['Quinoa'], $insumo['Quinoa']]);
foreach (['frango' => 16, 'tilapia' => 4, 'suco' => 8, 'brownie' => 8] as $k => $q) {
    produzir($prato[$k], $q, $cozinha);
}
// Um lote de tilapia de ontem, que vence amanha (aparece em "vencendo").
api(producoes(null, null, 'POST', ['prato_id' => $prato['escondidinho'], 'quantidade' => 6, 'data_producao' => date('Y-m-d', strtotime('+1 day'))], $cozinha, []));
api(producoes(null, null, 'POST', ['prato_id' => $prato['sopa'], 'quantidade' => 12], $cozinha, []));
for ($i = 0; $i < 9; $i++) {
    vendaBalcao($prato, $popularidade, $formas, $clientesBalcao, $balcao);
}
foreach ([['entregue', null, null], ['entregue', null, null], ['entregue', null, true], ['saiu_entrega', 'dinheiro_entrega', false],
          ['pronto', 'pix', true], ['em_preparo', 'cartao_entrega', false], ['em_preparo', 'pix', false],
          [null, 'pix', false], [null, 'cartao_entrega', false], [null, 'vr_entrega', true]] as $i => [$ate, $pagar, $retirar]) {
    $conta = $i === 7 ? $contas[0] : $contas[1 + $i];
    pedidoOnline($conta, $prato, $popularidade, $opcoes, $bairros, $ate, $balcao, true, $pagar, $retirar);
}
// O Cliente Demo tem cashback e um pedido Pix esperando pagamento.
executarSql("INSERT INTO cashback (conta_id, tipo, valor, descricao) VALUES (?, 'credito', 7.50, 'Bônus de boas-vindas (demo)')", [$contas[0]['id']]);

// Horario da demonstracao: todos os dias, 7h as 23h (para abrir a qualquer hora do dia).
executarSql("UPDATE loja_horarios SET aberto = 1, abre = '07:00', fecha = '23:00'");

$resumo = consultarUm("SELECT (SELECT COUNT(*) FROM vendas) AS vendas, (SELECT COUNT(*) FROM encomendas) AS pedidos,
                              (SELECT COUNT(*) FROM producoes) AS producoes, (SELECT COUNT(*) FROM entradas) AS lotes,
                              (SELECT ROUND(SUM(valor_total), 2) FROM vendas WHERE status = 'concluida') AS faturado");
printf("\nPronto em %.1f s: %d vendas, %d pedidos online, %d produções, %d lotes, faturado R$ %s.\n",
       microtime(true) - $inicio, $resumo['vendas'], $resumo['pedidos'], $resumo['producoes'], $resumo['lotes'],
       number_format((float) $resumo['faturado'], 2, ',', '.'));
echo "\nPainel:  p / p (acesso rapido)   admin / Fit-Teste-2026x   cozinha / Forno-Verde-2026x   balcao / Caixa-Verde-2026x\n";
echo "Loja:    cliente@demo.com / Compra-Demo-2026\n";
