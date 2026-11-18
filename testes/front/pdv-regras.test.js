/*
 * pdv-regras.test.js - as contas do PDV (Dashboard/pdv-regras.js).
 *
 * O limite de desconto tem de dar o MESMO que o servidor
 * (conferirRegrasDaVenda, api/rotas/vendas.php): 10% de R$ 100,00 ->
 * 10,00 passa, 10,01 nao. Os grupos de adicionais seguem o calcularPedido
 * (api/rotas/loja.php). Os valores esperados sao escritos a mao.
 */
'use strict';
const R = require('../../Dashboard/pdv-regras.js');
const { caso, igual, fim } = require('./caso');

console.log('pdv-regras: contas do caixa');

caso('lerReais aceita virgula, ponto, milhar e "R$"; vazio e lixo = 0', function () {
    igual([R.lerReais('12,50'), R.lerReais('12.5'), R.lerReais('1.234,56'), R.lerReais(''), R.lerReais('abc'), R.lerReais(7),
           R.lerReais('R$ 29,90')], [12.5, 12.5, 1234.56, 0, 0, 7, 29.9]);
});

caso('totais em centavos: 3 x 33,33 = 99,99', function () {
    igual(R.totais([{ preco: 33.33, quantidade: 3 }], 0, 'reais'), { bruto: 9999, desconto: 0, total: 9999, percentual: 0 });
});

caso('marmita com adicional: 2 x (29,90 + 3,00) + salada 27,00 = 92,80', function () {
    igual(R.totais([{ preco: 32.9, quantidade: 2 }, { preco: '27', quantidade: 1 }], 0, 'reais').total, 9280);
});

caso('desconto em reais', function () {
    igual(R.totais([{ preco: '35', quantidade: 2 }, { preco: 60, quantidade: 1 }], '13', 'reais'),
          { bruto: 13000, desconto: 1300, total: 11700, percentual: 10 });
});

caso('desconto em % arredonda no centavo (10% de 99,99 = 10,00)', function () {
    igual(R.totais([{ preco: 33.33, quantidade: 3 }], '10', 'porcento').desconto, 1000);
});

caso('desconto nunca passa do bruto nem fica negativo', function () {
    igual([R.totais([{ preco: 50, quantidade: 1 }], 80, 'reais').total, R.totais([{ preco: 50, quantidade: 1 }], -5, 'reais').desconto,
           R.totais([{ preco: 50, quantidade: 1 }], 150, 'porcento').total], [0, 0, 0]);
});

caso('limite de desconto = o do servidor: 10% de R$ 100 -> 10,00 passa, 10,01 nao', function () {
    igual([R.descontoNoLimite(10000, 1000, 10, false).ok, R.descontoNoLimite(10000, 1001, 10, false).ok,
           R.descontoNoLimite(10000, 1000, 10, false).maximo], [true, false, 1000]);
});

caso('limite 100 = sem limite; admin nunca tem limite', function () {
    igual([R.descontoNoLimite(10000, 10000, 100, false).ok, R.descontoNoLimite(10000, 9000, 5, true).ok], [true, true]);
});

caso('troco: recebido - total; vazio = null; falta = negativo', function () {
    igual([R.troco(11700, '200'), R.troco(11700, ''), R.troco(11700, '100,00')], [8300, null, -1700]);
});

const pratos = [
    { categoria: 1, procura: 'Frango grelhado com batata-doce Marmitas fit Rico em proteína', exatos: [] },
    { categoria: 2, procura: 'Salada Caesar fit Bowls e saladas', exatos: [] },
    { categoria: 6, procura: 'Kombucha de gengibre Sucos e detox', exatos: ['7898000111222'] },
    { categoria: 1, procura: 'Iscas de carne com arroz integral Marmitas fit', exatos: [] },
];

caso('busca sem acento e sem caixa: "PROTEINA" acha "Rico em proteína"', function () {
    igual(R.buscar(pratos, 'PROTEINA', 'todos').map(function (p) { return p.procura.split(' ')[0]; }), ['Frango']);
});

caso('busca exige todas as palavras', function () {
    igual(R.buscar(pratos, 'marmitas carne', 'todos').length, 1);
});

caso('codigo de barras digitado inteiro vem primeiro (leitor)', function () {
    igual(R.buscar(pratos, '7898000111222', 'todos')[0].categoria, 6);
});

caso('filtro por categoria (id em texto ou numero)', function () {
    igual([R.buscar(pratos, '', 1).length, R.buscar(pratos, '', '1').length, R.buscar(pratos, '', 'todos').length], [2, 2, 4]);
});

caso('acrescimo dos adicionais em centavos (ovo 3,00 + 2 x castanha 3,50 = 10,00)', function () {
    igual(R.acrescimo([{ preco: 3 }, { preco: '3,50', quantidade: 2 }, { preco: 0 }]), 1000);
});

const grupos = [{ id: 7, nome: 'Escolha o molho', minimo: 1, maximo: 1 }, { id: 8, nome: 'Turbine seu prato', minimo: 0, maximo: 2 }];

caso('grupos: molho obrigatorio falta -> frase do servidor', function () {
    igual(R.problemaNosGrupos(grupos, { 8: 1 }), 'Em "Escolha o molho", escolha uma opção.');
});

caso('grupos: passou do maximo', function () {
    igual(R.problemaNosGrupos(grupos, { 7: 1, 8: 3 }), 'Em "Turbine seu prato", dá para escolher no máximo 2.');
});

caso('grupos: dentro do minimo e do maximo = sem problema', function () {
    igual([R.problemaNosGrupos(grupos, { 7: 1 }), R.problemaNosGrupos([], {})], ['', '']);
});

caso('chave da linha: a ordem dos adicionais nao importa; sem adicional e so o prato', function () {
    igual([R.chaveDaLinha(5, [9, 3]), R.chaveDaLinha(5, ['3', 9]), R.chaveDaLinha(5, [])], ['5|3.9', '5|3.9', '5']);
});

caso('cabe: soma as linhas do mesmo prato; feito na hora (null) sem limite', function () {
    const itens = [{ prato_id: 1, quantidade: 2 }, { prato_id: 1, quantidade: 3 }, { prato_id: 2, quantidade: 9 }];
    igual([R.cabe(itens, 1, 6, 1), R.cabe(itens, 1, 6, 2), R.cabe(itens, 2, null, 50), R.cabe([], 3, 0, 1)], [true, false, true, false]);
});

fim();
