// dre.test.js - a formula do resultado que o painel mostra (Dashboard/dre.js).
'use strict';
const D = require('../../Dashboard/dre.js');
const { caso, igual, perto, fim } = require('./caso');

function dia(data, campos) {
    return Object.assign({ dia: data }, campos);
}

/*
 * Um mes de cozinha, escrito a mao, no formato da serie diaria da API:
 *   05/03  vendas no balcao 1000 (custo 600), 2 vendas
 *   10/03  pedido da loja online 300 (custo 100), 1 venda
 *   12/03  outro pedido da loja 200 (custo 50), 1 venda
 *   15/03  aluguel 400 + 30 de comida vencida (despesas 430, perdas 30); 1300 pagos no caixa
 *   20/03  recebido 1300
 */
const MARCO = [
    dia('2026-03-05', { receita_balcao: 1000, custo_balcao: 600, qtd_balcao: 2 }),
    dia('2026-03-10', { receita_loja: 300, custo_loja: 100, qtd_loja: 1 }),
    dia('2026-03-12', { receita_loja: 200, custo_loja: 50, qtd_loja: 1 }),
    dia('2026-03-15', { despesas: 430, perdas: 30, pago: 1300 }),
    dia('2026-03-20', { recebido: 1300 }),
];
const tot = function (linhas, de, ate, origem) { return D.totalizar(D.agregarPeriodo(linhas, de, ate, origem)); };

console.log('dre');

caso('mes inteiro: receita, custo, despesas (com perdas), lucro bruto e liquido, margem, ticket', function () {
    const t = tot(MARCO, '2026-03-01', '2026-03-31', '');
    igual([t.receita, t.custo, t.lucro_bruto, t.despesas, t.perdas, t.lucro_liquido, t.quantidade],
          [1500, 750, 750, 430, 30, 320, 4]);
    perto(t.margem, 21.333, 'margem = 320 / 1500');
    perto(t.ticket_medio, 375, 'ticket = 1500 / 4');
});

caso('venda da loja: soma uma vez, fica em "loja" e nao em "balcao"', function () {
    igual([tot([MARCO[1]], '2026-03-01', '2026-03-31', '').receita,
           tot([MARCO[1]], '2026-03-01', '2026-03-31', 'balcao').receita,
           tot([MARCO[1]], '2026-03-01', '2026-03-31', 'loja').receita], [300, 0, 300]);
});

caso('despesas: so a coluna "despesas"; o que foi pago no caixa nao vira despesa', function () {
    const t = tot([MARCO[3]], '2026-03-01', '2026-03-31', '');
    igual([t.despesas, t.lucro_liquido], [430, -430]);
    const caixa = D.agregarPeriodo(MARCO, '2026-03-01', '2026-03-31', '').reduce(function (s, b) { return s + b.caixa; }, 0);
    igual(caixa, 0, 'caixa = recebido 1300 - pago 1300');
});

caso('filtrado por origem: sem despesas nem perdas, lucro bruto daquela origem', function () {
    const b = tot(MARCO, '2026-03-01', '2026-03-31', 'balcao');
    const l = tot(MARCO, '2026-03-01', '2026-03-31', 'loja');
    igual([b.receita, b.custo, b.despesas, b.perdas, b.lucro_liquido, b.quantidade], [1000, 600, 0, 0, 400, 2]);
    igual([l.receita, l.custo, l.despesas, l.perdas, l.lucro_liquido, l.quantidade], [500, 150, 0, 0, 350, 2]);
});

caso('baldes guardam a receita de cada origem, para a barra balcao x loja', function () {
    const t = D.agregarPeriodo(MARCO, '2026-03-01', '2026-03-31', '').reduce(function (s, b) {
        return [s[0] + b.receita_balcao, s[1] + b.receita_loja];
    }, [0, 0]);
    igual(t, [1000, 500]);
});

caso('dia fora do intervalo fica de fora', function () {
    const t = tot(MARCO, '2026-03-11', '2026-03-31', '');
    igual([t.receita, t.despesas], [200, 430]);
});

caso('sem receita: margem e ticket zero (nao NaN)', function () {
    const t = tot([], '2026-03-01', '2026-03-31', '');
    igual([t.margem, t.ticket_medio, t.receita], [0, 0, 0]);
});

caso('centavos: 0,10 + 0,20 da 0,30', function () {
    igual(tot([dia('2026-03-01', { receita_balcao: 0.1 }), dia('2026-03-02', { receita_loja: 0.2 })],
              '2026-03-01', '2026-03-31', '').receita, 0.3);
});

caso('granularidade: ate 45 dias por dia, ate 180 por semana, depois por mes', function () {
    igual([D.granularidadeDe('2026-03-01', '2026-04-15'), D.granularidadeDe('2026-03-01', '2026-04-16'),
           D.granularidadeDe('2026-01-01', '2026-06-30'), D.granularidadeDe('2026-01-01', '2026-07-01')],
          ['dia', 'semana', 'semana', 'mes']);
    igual(D.agregarPeriodo([], '2026-03-01', '2026-03-31', '').length, 31);
    igual(D.agregarPeriodo([], '2025-11-01', '2026-10-27', '').length, 12);
});

caso('serie mensal nao pula fevereiro', function () {
    igual(D.agregarPeriodo([], '2025-08-31', '2026-03-31', '').map(function (b) { return b.mes; }).join(','),
          '2025-08,2025-09,2025-10,2025-11,2025-12,2026-01,2026-02,2026-03');
});

caso('semana: o dia cai no balde da semana certa', function () {
    const com = D.agregarPeriodo([dia('2026-03-09', { receita_balcao: 50 })], '2026-01-01', '2026-04-30', '')
        .filter(function (b) { return b.receita > 0; });
    igual([com.length, com[0].mes], [1, '2026-03-05']);
});

fim();
