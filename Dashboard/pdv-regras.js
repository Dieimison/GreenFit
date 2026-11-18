// carga: usa Formato; publica RegrasPdv  (conferido por testes/front/carga.test.js)
/*
 * pdv-regras.js - as contas do PDV, sem tela. Window.RegrasPdv.
 *
 * Roda no navegador e no Node (testes\front\pdv-regras.test.js). Tudo em
 * CENTAVOS inteiros: 3 x R$ 33,33 com 10% de desconto nao pode dar uma
 * soma que o servidor recusa por um centavo.
 *
 *   totais(itens, desconto, modo)        bruto, desconto e total da venda
 *   descontoNoLimite(...)                a MESMA conta do servidor
 *                                        (conferirRegrasDaVenda, vendas.php)
 *   troco(totalCentavos, recebido)       quanto devolver (null = nao informado)
 *   buscar(pratos, texto, categoria)     o que aparece na grade do PDV
 *   acrescimo(adicionais)                quanto os adicionais somam no prato (centavos)
 *   problemaNosGrupos(grupos, escolhidos)  minimo e maximo de cada grupo de adicionais
 *   chaveDaLinha(pratoId, adicionaisIds) o mesmo prato com os mesmos adicionais = a mesma linha
 *   cabe(itens, pratoId, vendavel, mais) a quantidade cabe nas porcoes vendaveis?
 *
 * Quem decide de verdade e o servidor: estas contas so mostram ANTES de
 * enviar o que ele vai dizer.
 */
(function (raiz, fabrica) {
    const noNode = typeof module !== 'undefined' && module.exports;
    const objeto = fabrica(noNode ? require('./formato.js') : raiz.Formato);
    if (noNode) module.exports = objeto;
    else raiz.RegrasPdv = objeto;
})(this, function (Formato) {
    'use strict';

    const { emCentavos } = Formato;

    /* Numero digitado ("12,50", "12.5", 12.5) em reais; vazio ou invalido = 0. */
    function lerReais(valor) {
        if (typeof valor === 'number') return isFinite(valor) ? valor : 0;
        const texto = String(valor === null || valor === undefined ? '' : valor).trim().replace(/\s/g, '').replace(/^R\$/i, '');
        if (!texto) return 0;
        // "1.234,56" -> 1234.56 ; "12,5" -> 12.5 ; "12.5" -> 12.5
        const normal = texto.indexOf(',') !== -1 ? texto.replace(/\./g, '').replace(',', '.') : texto;
        const n = Number(normal);
        return isFinite(n) ? n : 0;
    }

    /*
     * itens: [{ preco, quantidade }] (preco = o unitario, ja com os
     * adicionais); desconto: o numero digitado; modo: 'reais' ou
     * 'porcento'. O desconto nunca passa do bruto nem fica negativo. Em %,
     * arredonda para o centavo mais proximo.
     */
    function totais(itens, desconto, modo) {
        const bruto = (itens || []).reduce(function (soma, i) {
            return soma + emCentavos(lerReais(i.preco)) * Math.max(0, Math.floor(Number(i.quantidade) || 0));
        }, 0);
        const digitado = Math.max(0, lerReais(desconto));
        let descontoC = modo === 'porcento' ? Math.round(bruto * Math.min(digitado, 100) / 100) : emCentavos(digitado);
        descontoC = Math.min(Math.max(descontoC, 0), bruto);
        return { bruto: bruto, desconto: descontoC, total: bruto - descontoC,
                 percentual: bruto > 0 ? Math.round(descontoC * 10000 / bruto) / 100 : 0 };
    }

    /*
     * O limite de desconto de quem nao e admin, igual ao servidor:
     * recusa quando desconto > bruto x limite / 100 (em centavos, com o
     * mesmo arredondamento). Limite 100 = sem limite.
     */
    function descontoNoLimite(brutoC, descontoC, limitePercentual, admin) {
        const limite = Number(limitePercentual);
        if (admin || !(limite < 100)) return { ok: true, maximo: brutoC };
        const maximo = emCentavos((brutoC / 100) * limite / 100);
        return { ok: descontoC <= maximo, maximo: maximo };
    }

    /* Troco em centavos; null quando nada foi digitado. Negativo = falta dinheiro. */
    function troco(totalC, recebido) {
        if (recebido === null || recebido === undefined || String(recebido).trim() === '') return null;
        return emCentavos(lerReais(recebido)) - totalC;
    }

    /* Sem acento e em minusculas: "Feijão" acha "feijao". */
    function normalizar(texto) {
        return String(texto === null || texto === undefined ? '' : texto)
            .normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();
    }

    /*
     * A busca do PDV. Cada prato traz "procura" (nome, categoria, selos...)
     * e "categoria" (o id da categoria). Todas as palavras digitadas
     * precisam aparecer. Um codigo de barras digitado INTEIRO ("exatos")
     * vem primeiro (leitor: bipou, Enter, entrou). categoria: 'todos' ou o id.
     */
    function buscar(pratos, texto, categoria) {
        const palavras = normalizar(texto).split(/\s+/).filter(Boolean);
        const inteiro = normalizar(texto).replace(/\s+/g, '');
        return (pratos || []).filter(function (p) {
            if (categoria && categoria !== 'todos' && String(p.categoria) !== String(categoria)) return false;
            const onde = normalizar(p.procura + ' ' + (p.exatos || []).join(' '));
            return palavras.every(function (x) { return onde.indexOf(x) !== -1; });
        }).map(function (p, posicao) {
            const exato = inteiro.length >= 4 && (p.exatos || []).some(function (x) { return normalizar(x) === inteiro; });
            return { item: p, peso: (exato ? 0 : 1), posicao: posicao };
        }).sort(function (a, b) {
            return a.peso - b.peso || a.posicao - b.posicao;
        }).map(function (r) { return r.item; });
    }

    /* Quanto os adicionais escolhidos somam no prato, em centavos: [{ preco, quantidade? }]. */
    function acrescimo(adicionais) {
        return (adicionais || []).reduce(function (s, a) {
            return s + emCentavos(lerReais(a.preco)) * Math.max(1, Math.floor(Number(a.quantidade) || 1));
        }, 0);
    }

    /*
     * Confere os grupos de adicionais do prato como o servidor
     * (calcularPedido): em cada grupo, entre minimo e maximo escolhidos.
     * grupos: [{ id, nome, minimo, maximo }]; escolhidos: { grupoId: quantos }.
     * Devolve a primeira frase de problema, ou '' quando esta tudo certo.
     */
    function problemaNosGrupos(grupos, escolhidos) {
        for (const g of grupos || []) {
            const n = Number((escolhidos || {})[g.id]) || 0;
            if (n < g.minimo) {
                return 'Em "' + g.nome + '", escolha ' + (g.minimo === 1 ? 'uma opção' : g.minimo + ' opções') + '.';
            }
            if (n > g.maximo) {
                return 'Em "' + g.nome + '", dá para escolher no máximo ' + g.maximo + '.';
            }
        }
        return '';
    }

    /* O mesmo prato com os mesmos adicionais e a mesma linha do carrinho (a ordem da escolha nao importa). */
    function chaveDaLinha(pratoId, adicionaisIds) {
        const ids = (adicionaisIds || []).map(Number).filter(function (x) { return x > 0; }).sort(function (a, b) { return a - b; });
        return String(pratoId) + (ids.length ? '|' + ids.join('.') : '');
    }

    /*
     * Ainda cabe "mais" porcoes deste prato? Soma todas as linhas do
     * prato (com adicionais diferentes sao linhas diferentes, mas o mesmo
     * estoque). vendavel null = feito na hora, sem limite.
     */
    function cabe(itens, pratoId, vendavel, mais) {
        if (vendavel === null || vendavel === undefined) return true;
        const ja = (itens || []).reduce(function (s, i) {
            return s + (String(i.prato_id) === String(pratoId) ? Math.max(0, Math.floor(Number(i.quantidade) || 0)) : 0);
        }, 0);
        return ja + (Number(mais) || 0) <= Number(vendavel);
    }

    return { lerReais: lerReais, totais: totais, descontoNoLimite: descontoNoLimite, troco: troco,
             normalizar: normalizar, buscar: buscar, acrescimo: acrescimo, problemaNosGrupos: problemaNosGrupos,
             chaveDaLinha: chaveDaLinha, cabe: cabe };
});
