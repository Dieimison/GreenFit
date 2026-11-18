<?php
/*
 * testes/integridade.php - confere as invariantes de negocio direto no
 * banco (somente leitura). Roda no banco que a suite de fluxos sujou e
 * serve para qualquer banco (o da demonstracao, o da loja).
 * Uso: php testes/integridade.php caminho\do\banco.sqlite
 * Imprime so contagens e ids - nenhum dado pessoal.
 */
$db = $argv[1] ?? '';
if (!is_file($db)) { fwrite(STDERR, "banco nao encontrado: $db\n"); exit(2); }
$p = new PDO('sqlite:' . $db, null, null, [PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION, PDO::ATTR_DEFAULT_FETCH_MODE => PDO::FETCH_ASSOC]);
$p->exec('PRAGMA query_only = 1');

$checks = [
  'I1 saldo negativo em algum lote' =>
    "SELECT entrada_id AS id, saldo FROM vw_entradas_saldo WHERE saldo < 0",
  'I2 venda concluida cujo total != a receber - devolucoes, nao cancelados (tolerancia 0,005)' =>
    "SELECT v.id, v.valor_total AS venda,
            ROUND(COALESCE(SUM(CASE WHEN l.tipo = 'receber' THEN l.valor ELSE -l.valor END),0),2) AS lancamentos
       FROM vendas v LEFT JOIN lancamentos l ON l.venda_id = v.id AND l.status <> 'cancelado'
      WHERE v.status = 'concluida' AND v.valor_total > 0 GROUP BY v.id
     HAVING ABS(v.valor_total - COALESCE(SUM(CASE WHEN l.tipo = 'receber' THEN l.valor ELSE -l.valor END),0)) > 0.005",
  'I3 venda com valor_bruto - desconto != valor_total' =>
    "SELECT id, valor_bruto, desconto, valor_total FROM vendas WHERE ABS(valor_bruto - desconto - valor_total) > 0.005",
  'I4 venda com valor_bruto != soma dos itens' =>
    "SELECT v.id, v.valor_bruto, ROUND(SUM(vi.subtotal),2) AS itens FROM vendas v JOIN venda_itens vi ON vi.venda_id = v.id
      GROUP BY v.id HAVING ABS(v.valor_bruto - SUM(vi.subtotal)) > 0.005",
  'I5 venda com custo_total != soma do custo dos itens (tolerancia 0,02)' =>
    "SELECT v.id, v.custo_total, ROUND(SUM(vi.custo_unitario * vi.quantidade),2) AS itens FROM vendas v JOIN venda_itens vi ON vi.venda_id = v.id
      GROUP BY v.id HAVING ABS(v.custo_total - SUM(vi.custo_unitario * vi.quantidade)) > 0.02",
  'I6 venda cancelada com conta que nao foi cancelada' =>
    "SELECT v.id, l.id AS lancamento FROM vendas v JOIN lancamentos l ON l.venda_id = v.id WHERE v.status = 'cancelada' AND l.status <> 'cancelado'",
  'I7 pedido online confirmado em diante sem venda (ou com venda cancelada)' =>
    "SELECT e.id, e.status FROM encomendas e LEFT JOIN vendas v ON v.id = e.venda_id
      WHERE e.status IN ('confirmado','em_preparo','pronto','saiu_entrega','entregue') AND (v.id IS NULL OR v.status <> 'concluida')",
  'I8 pedido online cancelado ou ainda reservado com venda concluida' =>
    "SELECT e.id, e.status FROM encomendas e JOIN vendas v ON v.id = e.venda_id
      WHERE e.status IN ('cancelada','aguardando_pagamento','aguardando_aceite') AND v.status = 'concluida'",
  'I9 pedido online cujo total != pratos + taxa - desconto - cashback' =>
    "SELECT id, valor_produtos, taxa_entrega, desconto, cashback_usado, valor_total FROM encomendas
      WHERE ABS(valor_produtos + taxa_entrega - desconto - cashback_usado - valor_total) > 0.005",
  'I10 pedido online cujos pratos != soma das linhas' =>
    "SELECT e.id, e.valor_produtos, ROUND(SUM(i.subtotal),2) AS linhas FROM encomendas e JOIN encomenda_itens i ON i.encomenda_id = e.id
      GROUP BY e.id HAVING ABS(e.valor_produtos - SUM(i.subtotal)) > 0.005",
  'I11 venda da loja cujo total != total do pedido' =>
    "SELECT e.id, e.valor_total, v.valor_total AS venda FROM encomendas e JOIN vendas v ON v.id = e.venda_id
      WHERE v.status = 'concluida' AND ABS(e.valor_total - v.valor_total) > 0.005",
  'I12 reserva maior que o estoque dentro da validade (prato com lote)' =>
    "SELECT ei.prato_id, SUM(ei.quantidade) AS reservado, ep.disponivel FROM encomenda_itens ei
       JOIN encomendas en ON en.id = ei.encomenda_id AND en.status IN ('aguardando_pagamento','aguardando_aceite')
       JOIN pratos p ON p.id = ei.prato_id AND p.feito_na_hora = 0
       JOIN vw_estoque_pratos ep ON ep.prato_id = ei.prato_id
      GROUP BY ei.prato_id HAVING SUM(ei.quantidade) > ep.disponivel",
  'I13 producao concluida sem exatamente um lote (ou cancelada/planejada com lote)' =>
    "SELECT pr.id, pr.status, COUNT(e.id) AS lotes FROM producoes pr LEFT JOIN entradas e ON e.producao_id = pr.id
      GROUP BY pr.id HAVING (pr.status = 'concluida' AND COUNT(e.id) <> 1) OR (pr.status <> 'concluida' AND COUNT(e.id) > 0)",
  'I14 lote de producao com quantidade ou custo diferente da producao' =>
    "SELECT pr.id, pr.quantidade, e.quantidade AS lote, pr.custo_total, e.custo_total AS custo_lote FROM producoes pr
       JOIN entradas e ON e.producao_id = pr.id WHERE e.quantidade <> pr.quantidade OR ABS(e.custo_total - pr.custo_total) > 0.005",
  'I15 producao concluida cujo custo != soma do que consumiu (tolerancia 0,02)' =>
    "SELECT pr.id, pr.custo_total, ROUND(COALESCE(SUM(pi.subtotal),0),2) AS consumo FROM producoes pr
       LEFT JOIN producao_itens pi ON pi.producao_id = pr.id WHERE pr.status = 'concluida'
      GROUP BY pr.id HAVING ABS(pr.custo_total - COALESCE(SUM(pi.subtotal),0)) > 0.02",
  'I16 prato feito na hora com lote no estoque' =>
    "SELECT e.id, e.prato_id FROM entradas e JOIN pratos p ON p.id = e.prato_id JOIN vw_entradas_saldo s ON s.entrada_id = e.id
      WHERE p.feito_na_hora = 1 AND s.saldo > 0",
  'I17 venda que saiu de lote ja vencido no dia da venda' =>
    "SELECT vi.id, e.validade, v.data_venda FROM venda_itens vi JOIN vendas v ON v.id = vi.venda_id AND v.status = 'concluida'
       JOIN entradas e ON e.id = vi.entrada_id WHERE e.validade IS NOT NULL AND e.validade < substr(v.data_venda, 1, 10)",
  'I18 cashback negativo em alguma conta' =>
    "SELECT conta_id, ROUND(SUM(CASE WHEN tipo = 'uso' THEN -valor ELSE valor END),2) AS saldo FROM cashback
      GROUP BY conta_id HAVING SUM(CASE WHEN tipo = 'uso' THEN -valor ELSE valor END) < -0.005",
  'I19 cupom usado alem do limite total' =>
    "SELECT c.codigo, c.limite_usos, COUNT(e.id) AS usos FROM cupons c JOIN encomendas e ON e.cupom_id = c.id AND e.status <> 'cancelada'
      WHERE c.limite_usos IS NOT NULL GROUP BY c.id HAVING COUNT(e.id) > c.limite_usos",
  'I20 lancamento com valor <= 0' =>
    "SELECT id, valor, origem FROM lancamentos WHERE valor <= 0",
  'I21 valores negativos em lotes e itens' =>
    "SELECT 'entrada' AS t, id FROM entradas WHERE custo_total < 0
     UNION ALL SELECT 'venda_item', id FROM venda_itens WHERE valor_unitario < 0 OR custo_unitario < 0
     UNION ALL SELECT 'producao_item', id FROM producao_itens WHERE custo_unitario < 0",
  'I22 mais de uma forma de pagamento padrao' =>
    "SELECT COUNT(*) AS padroes FROM formas_pagamento WHERE padrao = 1 HAVING COUNT(*) > 1",
  'I23 vw_receitas diferente das vendas concluidas' =>
    "SELECT (SELECT ROUND(COALESCE(SUM(receita),0),2) FROM vw_receitas) AS view,
            (SELECT ROUND(COALESCE(SUM(valor_total),0),2) FROM vendas WHERE status='concluida') AS real
      WHERE ABS(view - real) > 0.005",
  'I24 PRAGMA foreign_key_check' => "PRAGMA foreign_key_check",
];

$falhas = 0;
foreach ($checks as $nome => $sql) {
    $linhas = $p->query($sql)->fetchAll();
    $n = count($linhas);
    if ($n) { $falhas++; }
    printf("%-4s %s: %d%s\n", $n ? 'XX' : 'ok', $nome, $n,
        $n ? '  ex.: ' . json_encode(array_slice($linhas, 0, 6), JSON_UNESCAPED_UNICODE) : '');
}
echo "\ninvariantes violadas: $falhas de " . count($checks) . "\n";
exit($falhas ? 1 : 0);
