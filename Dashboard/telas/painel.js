// carga: usa Formato, Dre, Graficos, Nucleo; publica Telas.painel  (conferido por testes/front/carga.test.js)
/*
 * telas/painel.js - a secao Resultados: o resultado do periodo (so quem ve
 * o financeiro), a loja online e a cozinha e o estoque HOJE (todos os
 * perfis). Window.Telas.painel.
 *
 * A tela inteira e montada aqui dentro de #painelConteudo (o dashboard.html
 * so tem a div). Os numeros do periodo vem de /api/relatorios (serie
 * DIARIA, ja separada em balcao e loja; a conta do resultado e do dre.js);
 * os de hoje vem prontos de /api/resumo - a tela nao recalcula.
 */
(function (janela) {
    'use strict';

    const { escapar, moeda, porcento, dataCurta, hoje, somarMeses, somarEmCentavos } = janela.Formato;
    const { agregarPeriodo, totalizar, granularidadeDe } = janela.Dre;
    const Graficos = janela.Graficos;
    const N = janela.Nucleo;
    const { api, estado, corDe, etiqueta, vazio, classeSaldo, quantidadeLegivel, textoValidade, avisar, mensagemDe,
            registrarTela, registrarAcoes, mostrarSecao } = N;

    // ==================================================================
    // Esqueleto da tela
    // ==================================================================
    function painelGrafico(id, titulo, nota, idGrafico) {
        return '<div class="painel-grafico">' +
            '<div class="grafico-topo" id="' + id + '"><div>' +
                '<div class="grafico-titulo">' + escapar(titulo) + '</div>' +
                '<div class="grafico-nota">' + escapar(nota) + '</div>' +
            '</div></div>' +
            '<div id="' + idGrafico + '"></div>' +
            '</div>';
    }

    function blocoTabela(id, titulo, cor, idConteudo) {
        return '<div class="table-section">' +
            '<h3 class="table-title" id="' + id + '"><span style="background:var(' + cor + ')"></span>' + escapar(titulo) + '</h3>' +
            '<div id="' + idConteudo + '"></div>' +
            '</div>';
    }

    function esqueletoDoPeriodo() {
        return '<div class="painel-periodo">' +
            '<div class="secao-topo" id="topoKpis"><div>' +
                '<h2 class="secao-titulo" id="tituloPeriodo">Resultado dos últimos 12 meses</h2>' +
                '<p class="secao-descricao">Receita do balcão e da loja online, menos o custo dos pratos e as despesas ' +
                'lançadas no financeiro (inclusive o que venceu ou se perdeu). Cada relatório tem o seu próprio filtro.</p>' +
            '</div></div>' +
            '<div class="kpis" id="kpisRelatorio"></div>' +
            painelGrafico('topoResultado', 'Receita, custo e despesas por mês', 'Passe o mouse em um mês para ver os valores.', 'graficoResultado') +
            '<div class="tables-grid">' +
                painelGrafico('topoLucro', 'Lucro líquido por mês', 'Depois de descontar custo e despesas.', 'graficoLucro') +
                painelGrafico('topoMargem', 'Margem líquida', 'Quanto sobra de cada R$ 100 vendidos.', 'graficoMargem') +
            '</div>' +
            '<div class="tables-grid">' +
                painelGrafico('topoCaixa', 'Caixa: entrou e saiu', 'Só o que foi baixado como pago no financeiro.', 'graficoCaixa') +
                painelGrafico('topoComposicao', 'De onde vem a receita', 'Balcão (PDV) x loja online, no período.', 'graficoComposicao') +
            '</div>' +
            '<div class="tables-grid">' +
                painelGrafico('topoPagamentos', 'Como o cliente pagou', 'Receita das vendas por forma de pagamento.', 'graficoPagamentos') +
                painelGrafico('topoDespesas', 'Para onde vai o dinheiro', 'Despesas lançadas e o custo do que venceu, se perdeu ou foi cortesia. A compra de insumo vira custo quando o prato vende.', 'graficoDespesas') +
            '</div>' +
            '<div class="tables-grid">' +
                painelGrafico('topoEstoquePizza', 'Dinheiro parado no estoque', 'Custo do que está na despensa: insumos x pratos prontos.', 'graficoEstoquePizza') +
                blocoTabela('topoRanking', 'Pratos que mais vendem', '--serie-1', 'rankingItens') +
            '</div>' +
            blocoTabela('topoVencendo', 'Contas a vencer', '--atencao', 'listaVencendo') +
            '<div class="secao-topo" id="topoLoja"><div>' +
                '<h2 class="secao-titulo">Loja online</h2>' +
                '<p class="secao-descricao">Os pedidos do app: quantos chegaram, quanto venderam, entrega x retirada, ' +
                'cancelamentos, descontos (cupom e cashback) e a nota que os clientes deram.</p>' +
            '</div></div>' +
            '<div class="kpis" id="kpisLoja"></div>' +
            '<div class="tables-grid">' +
                painelGrafico('topoPedidosLoja', 'Pedidos por mês', 'Entrega e retirada; os cancelados não entram.', 'graficoPedidosLoja') +
                painelGrafico('topoTipoLoja', 'Entrega x retirada', 'Pedidos que não foram cancelados, no período.', 'graficoTipoLoja') +
            '</div>' +
            blocoTabela('topoDre', 'Resultado do período', '--serie-3', 'tabelaDre') +
            '</div>';
    }

    function esqueletoDeHoje() {
        return '<div class="painel-hoje">' +
            '<div class="secao-topo"><div>' +
                '<h2 class="secao-titulo">Cozinha e estoque hoje</h2>' +
                '<p class="secao-descricao">A situação de agora, não do período: o que está pronto, o que acaba, o que vence, ' +
                'o que falta comprar e o que a cozinha tem para produzir.</p>' +
            '</div></div>' +
            '<div class="stats-container painel-cards-hoje" id="cardsHoje"></div>' +
            '<p class="painel-estoque-valor" id="estoqueValor" hidden></p>' +
            '<div class="tables-grid">' +
                blocoTabela('topoRepor', 'Precisa produzir', '--grave', 'listaRepor') +
                blocoTabela('topoInsumos', 'Insumos abaixo do mínimo', '--serie-2', 'listaInsumos') +
            '</div>' +
            blocoTabela('topoProducoes', 'Produção de hoje e amanhã', '--acento', 'listaProducoes') +
            '<div class="tables-grid">' +
                blocoTabela('topoVencendoLotes', 'Vence em até ' + estado.config.validade_alerta_dias + ' dias', '--atencao', 'listaLotesVencendo') +
                blocoTabela('topoVencidos', 'Vencidos (não saem por venda)', '--critico', 'listaVencidos') +
            '</div>' +
            '</div>';
    }

    // ==================================================================
    // Carga
    // ==================================================================
    async function carregarDashboard() {
        const veFinanceiro = !!estado.config.pode_ver_financeiro;
        const alvo = document.getElementById('painelConteudo');
        if (!alvo.querySelector('.painel-hoje')) {
            alvo.innerHTML = (veFinanceiro ? esqueletoDoPeriodo() : '') + esqueletoDeHoje();
        }
        const [resumo, relatorio] = await Promise.all([
            api.get('/resumo'),
            veFinanceiro ? api.get('/relatorios') : Promise.resolve(null),
        ]);
        estado.resumo = resumo;
        if (relatorio) desenharRelatorios(relatorio);
        desenharHoje(resumo);
    }

    // ==================================================================
    // Cozinha e estoque hoje (/api/resumo)
    // ==================================================================
    function cardHoje(titulo, valor, nota, cor, secao, alerta) {
        return '<button type="button" class="stat-box painel-card' + (alerta ? ' painel-card-alerta' : '') + '"' +
            (secao ? ' data-ir="' + secao + '"' : ' disabled') + '>' +
            '<span class="stat-title"><span style="background:var(' + cor + ')"></span>' + escapar(titulo) + '</span>' +
            '<span class="stat-value">' + escapar(String(valor)) + '</span>' +
            (nota ? '<span class="stat-sub">' + escapar(nota) + '</span>' : '') +
            '</button>';
    }

    function desenharHoje(r) {
        const c = r.cards || {};
        const plural = function (n, um, varios) { return n + ' ' + (n === 1 ? um : varios); };
        document.getElementById('cardsHoje').innerHTML =
            cardHoje('Porções prontas', c.porcoes_prontas || 0, plural(c.pratos_ativos || 0, 'prato ativo', 'pratos ativos'),
                     '--acento', 'cardapio') +
            cardHoje('Precisa produzir', c.pratos_repor || 0,
                     c.pratos_sem_estoque ? plural(c.pratos_sem_estoque, 'prato zerado', 'pratos zerados') : 'nenhum zerado',
                     '--grave', 'producao', (c.pratos_repor || 0) > 0) +
            cardHoje('Produção para hoje', c.producoes_hoje || 0, 'ordens planejadas', '--serie-2', 'producao') +
            cardHoje('Pedidos online abertos', c.pedidos_abertos || 0, pedidosPorStatus(r.pedidos), '--serie-5',
                     estado.config.pode_operar_loja ? 'pedidos-online' : null, (c.pedidos_abertos || 0) > 0) +
            cardHoje('Vence em ' + estado.config.validade_alerta_dias + ' dias', c.lotes_vencendo || 0, 'lotes', '--atencao', 'entradas',
                     (c.lotes_vencendo || 0) > 0) +
            cardHoje('Vencidos', c.lotes_vencidos || 0, c.lotes_vencidos ? 'dê baixa: não saem por venda' : 'nada vencido', '--critico',
                     'entradas', (c.lotes_vencidos || 0) > 0) +
            cardHoje('Insumos em falta', c.insumos_em_falta || 0, 'abaixo do mínimo', '--serie-2', 'pedidos', (c.insumos_em_falta || 0) > 0) +
            cardHoje('Vendas hoje', c.vendas_hoje || 0, moeda(c.faturado_hoje || 0) + ' faturados', '--serie-1', 'vendas');

        const valor = document.getElementById('estoqueValor');
        if (r.estoque_valor) {
            valor.hidden = false;
            valor.innerHTML = 'Parado no estoque (custo): <strong>' + moeda(r.estoque_valor.insumos) + '</strong> em insumos e <strong>' +
                moeda(r.estoque_valor.pratos) + '</strong> em pratos prontos.';
        } else {
            valor.hidden = true;
        }

        desenharRepor(r.repor || []);
        desenharProducoes(r.producoes || []);
        desenharLotes('listaLotesVencendo', r.vencendo || [], 'Nada vencendo nos próximos dias.');
        desenharLotes('listaVencidos', r.vencidos || [], 'Nenhum lote vencido com saldo.', true);
        desenharInsumos(r.insumos || []);
    }

    function pedidosPorStatus(p) {
        const partes = [];
        if (!p) return '';
        if (p.aguardando_aceite) partes.push(p.aguardando_aceite + ' para aceitar');
        if (p.aguardando_pagamento) partes.push(p.aguardando_pagamento + ' aguardando Pix');
        if (p.em_preparo) partes.push(p.em_preparo + ' em preparo');
        return partes.join(' · ') || 'nenhum esperando';
    }

    function tabela(cabeca, linhas, classeColunas) {
        return '<div class="rolagem-x"><table><thead><tr>' + cabeca.map(function (c, i) {
            return '<th' + (classeColunas && classeColunas[i] ? ' class="' + classeColunas[i] + '"' : '') + '>' + escapar(c) + '</th>';
        }).join('') + '</tr></thead><tbody>' + linhas.join('') + '</tbody></table></div>';
    }

    function desenharRepor(lista) {
        const alvo = document.getElementById('listaRepor');
        if (!lista.length) { alvo.innerHTML = vazio('Todos os pratos estão acima do mínimo.'); return; }
        alvo.innerHTML = tabela(['Prato', 'Pronto', 'Reservado', 'Mínimo', 'Vendeu 30 dias'],
            lista.slice(0, 12).map(function (p) {
                return '<tr><td>' + escapar(p.nome) + (p.categoria ? '<br><small class="observacao">' + escapar(p.categoria) + '</small>' : '') + '</td>' +
                    '<td class="numero ' + classeSaldo(p.disponivel, p.minimo) + '">' + p.disponivel + '</td>' +
                    '<td class="numero">' + (p.reservado || 0) + '</td>' +
                    '<td class="numero">' + p.minimo + '</td>' +
                    '<td class="numero">' + (p.vendidos_30d || 0) + '</td></tr>';
            }), [null, 'numero', 'numero', 'numero', 'numero']);
    }

    function desenharProducoes(lista) {
        const alvo = document.getElementById('listaProducoes');
        if (!lista.length) { alvo.innerHTML = vazio('Nenhuma produção planejada para hoje ou amanhã.'); return; }
        alvo.innerHTML = tabela(['Ordem', 'Prato', 'Porções', 'Dia'],
            lista.map(function (p) {
                return '<tr><td>' + escapar(p.numero || '') + '</td>' +
                    '<td>' + escapar(p.prato) + (p.faltando && p.faltando.length
                        ? '<br><small class="saldo-zero">Falta: ' + escapar(p.faltando.join(', ')) + '</small>' : '') + '</td>' +
                    '<td class="numero">' + p.quantidade + '</td>' +
                    '<td>' + dataCurta(p.data_producao) + (p.atrasada ? ' <span class="etiqueta" style="--cor-etiqueta:var(--critico)">atrasada</span>' : '') + '</td></tr>';
            }), [null, null, 'numero', null]);
    }

    function desenharLotes(id, lista, msgVazio, vencidos) {
        const alvo = document.getElementById(id);
        if (!lista.length) { alvo.innerHTML = vazio(msgVazio); return; }
        const comCusto = lista.some(function (l) { return l.custo !== undefined; });
        alvo.innerHTML = (vencidos
            ? '<div class="painel-acao-lista"><button type="button" class="botao botao-pequeno botao-perigo-suave" data-acao="baixar-vencidos">' +
              'Dar baixa nos vencidos</button></div>' : '') +
            tabela(['Item', 'Lote', 'Saldo', 'Validade'].concat(comCusto ? ['Custo'] : []),
                lista.slice(0, 15).map(function (l) {
                    return '<tr><td>' + escapar(l.item) + '<br><small class="observacao">' +
                            escapar(l.tipo === 'prato' ? 'Prato pronto' : 'Insumo') + '</small></td>' +
                        '<td>' + escapar(l.lote || '—') + '</td>' +
                        '<td class="numero">' + escapar(quantidadeLegivel(l.saldo, l.tipo === 'prato' ? 'porcao' : l.unidade)) + '</td>' +
                        '<td class="' + (l.dias_validade < 0 ? 'saldo-zero' : 'saldo-baixo') + '">' + dataCurta(l.validade) +
                            '<br><small class="observacao">' + escapar(textoValidade(l.dias_validade)) + '</small></td>' +
                        (comCusto ? '<td class="numero">' + moeda(l.custo || 0) + '</td>' : '') + '</tr>';
                }), [null, null, 'numero', null, 'numero']);
    }

    function desenharInsumos(lista) {
        const alvo = document.getElementById('listaInsumos');
        if (!lista.length) { alvo.innerHTML = vazio('Nenhum insumo abaixo do mínimo.'); return; }
        alvo.innerHTML = tabela(['Insumo', 'Tem', 'Mínimo', 'Comprar'],
            lista.slice(0, 15).map(function (i) {
                return '<tr><td>' + escapar(i.nome) + '</td>' +
                    '<td class="numero ' + classeSaldo(i.disponivel, i.minimo) + '">' + escapar(quantidadeLegivel(i.disponivel, i.unidade)) + '</td>' +
                    '<td class="numero">' + escapar(quantidadeLegivel(i.minimo, i.unidade)) + '</td>' +
                    '<td class="numero">' + escapar(quantidadeLegivel(Math.max(0, i.minimo - i.disponivel), i.unidade)) + '</td></tr>';
            }), [null, 'numero', 'numero', 'numero']);
    }

    registrarAcoes({
        'baixar-vencidos': async function () {
            if (!window.confirm('Dar baixa em TODOS os lotes vencidos com saldo? Eles saem do estoque como "Vencido / descarte" '
                + 'e o custo entra como perda no resultado.')) return;
            const r = await api.post('/movimentacoes', { baixar_vencidos: 1 });
            avisar(mensagemDe(r, 'Vencidos baixados.'));
            await carregarDashboard();
        },
    });

    // ==================================================================
    // Relatorios do periodo (/api/relatorios)
    // ==================================================================
    /*
     * CADA PAINEL TEM O SEU FILTRO, e eles sao independentes: da para deixar
     * a receita em 12 meses e o ranking em 3 ao mesmo tempo. Os filtros
     * trabalham sobre os dados ja carregados, sem voltar ao servidor: a API
     * manda os 12 meses de uma vez (serie diaria), e cortar no navegador e
     * instantaneo.
     */
    const FILTROS_PADRAO = {
        kpis: '12', kpisOrigem: '',
        resultado: '12', resultadoOrigem: '',
        lucro: '12', lucroOrigem: '',
        margem: '12', margemOrigem: '',
        caixa: '12',
        composicao: '12',
        rankingPeriodo: '12', rankingTipo: 'prato', rankingOrdem: 'receita', rankingOrigem: '',
        vencendoPrazo: '30', vencendoTipo: '',
        dre: '12', dreOrigem: '',
        pagamentos: '12', pagamentosOrigem: '',
        despesas: '12',
        estoquePizza: 'tudo',
        loja: '12',
    };

    /* De onde veio o dinheiro: o PDV ou um pedido da loja online. */
    const ORIGENS = [
        { valor: '', rotulo: 'Balcão e loja' },
        { valor: 'balcao', rotulo: 'Só balcão (PDV)' },
        { valor: 'loja', rotulo: 'Só loja online' },
    ];

    estado.filtros = Object.assign({}, FILTROS_PADRAO);
    estado.datas = {};

    const PERIODOS = [
        { valor: '3', rotulo: 'Últimos 3 meses' },
        { valor: '6', rotulo: 'Últimos 6 meses' },
        { valor: '12', rotulo: 'Últimos 12 meses' },
        { valor: 'datas', rotulo: 'Escolher datas…' },
    ];

    /** O intervalo que um relatório está mostrando, seja preset ou escolhido. */
    function intervaloDe(nome) {
        const valor = estado.filtros[nome];
        const fim = (estado.relatorio && estado.relatorio.ate) || hoje();
        if (valor === 'datas') {
            const d = estado.datas[nome] || {};
            if (d.de && d.ate && d.de <= d.ate) return { de: d.de, ate: d.ate };
            return { de: somarMeses(fim.substring(0, 8) + '01', -11), ate: fim };
        }
        const meses = Number(valor) || 12;
        return { de: somarMeses(fim.substring(0, 8) + '01', -(meses - 1)), ate: fim };
    }

    /** A série que um relatório deve desenhar, já agregada e filtrada. */
    function serieDe(nome) {
        const i = intervaloDe(nome);
        return agregarPeriodo(estado.relatorio && estado.relatorio.diario, i.de, i.ate, estado.filtros[nome + 'Origem'] || '');
    }

    /** Com despesas é líquido; filtrado por origem (sem despesas) é bruto. */
    function rotuloLucro(nome) {
        return estado.filtros[nome + 'Origem'] ? 'Lucro bruto' : 'Lucro líquido';
    }

    const UNIDADE = { dia: 'por dia', semana: 'por semana', mes: 'por mês' };
    const UNIDADE_SINGULAR = { dia: 'um dia', semana: 'uma semana', mes: 'um mês' };

    /* O titulo e a nota acompanham a granularidade ("por dia", "passe o mouse em um dia"). */
    function ajustarTituloDoGrafico(idTopo, nomeFiltro, base, notaDoMouse) {
        const topo = document.getElementById(idTopo);
        if (!topo) return;
        const i = intervaloDe(nomeFiltro);
        const g = granularidadeDe(i.de, i.ate);
        const titulo = topo.querySelector('.grafico-titulo');
        if (titulo && base) titulo.textContent = base + ' ' + UNIDADE[g];
        if (notaDoMouse) {
            const nota = topo.querySelector('.grafico-nota');
            if (nota) nota.textContent = 'Passe o mouse em ' + UNIDADE_SINGULAR[g] + ' para ver os valores.';
        }
    }

    /* Qual bloco redesenhar quando cada filtro muda (sem piscar a tela inteira). */
    const AO_FILTRAR = {
        kpis: function () { desenharKpis(); }, kpisOrigem: function () { desenharKpis(); },
        resultado: function () { desenharGraficoResultado(); }, resultadoOrigem: function () { desenharGraficoResultado(); },
        lucro: function () { desenharGraficoLucro(); }, lucroOrigem: function () { desenharGraficoLucro(); },
        margem: function () { desenharGraficoMargem(); }, margemOrigem: function () { desenharGraficoMargem(); },
        caixa: function () { desenharGraficoCaixa(); },
        composicao: function () { desenharComposicao(); },
        rankingPeriodo: function () { desenharRanking(); }, rankingTipo: function () { desenharRanking(); },
        rankingOrdem: function () { desenharRanking(); }, rankingOrigem: function () { desenharRanking(); },
        vencendoPrazo: function () { desenharVencendo(); }, vencendoTipo: function () { desenharVencendo(); },
        dre: function () { desenharDre(); }, dreOrigem: function () { desenharDre(); },
        pagamentos: function () { desenharPagamentos(); }, pagamentosOrigem: function () { desenharPagamentos(); },
        despesas: function () { desenharDespesas(); },
        estoquePizza: function () { desenharEstoquePizza(); },
        loja: function () { desenharLoja(); },
    };

    document.getElementById('painelConteudo').addEventListener('change', function (evento) {
        if (!estado.relatorio) return;
        const select = evento.target.closest('.filtro-grafico');
        if (select) {
            const nome = select.dataset.filtro;
            estado.filtros[nome] = select.value;
            if (select.value === 'datas' && !estado.datas[nome]) estado.datas[nome] = intervaloDe(nome);
            if (AO_FILTRAR[nome]) AO_FILTRAR[nome]();
            return;
        }
        const campo = evento.target.closest('.filtro-data');
        if (!campo) return;
        const nome = campo.dataset.data;
        const par = estado.datas[nome] || (estado.datas[nome] = intervaloDe(nome));
        par[campo.dataset.ponta] = campo.value;
        // Datas invertidas: arrasta a outra ponta junto (e o que a pessoa quis dizer).
        if (par.de && par.ate && par.de > par.ate) {
            if (campo.dataset.ponta === 'de') par.ate = par.de;
            else par.de = par.ate;
        }
        if (AO_FILTRAR[nome]) AO_FILTRAR[nome]();
    });

    document.getElementById('painelConteudo').addEventListener('click', function (evento) {
        const alvo = evento.target.closest('[data-ir]');
        if (alvo) mostrarSecao(alvo.dataset.ir, true);
    });

    function camposDeDataHtml(nome) {
        if (estado.filtros[nome] !== 'datas') return '';
        const i = intervaloDe(nome);
        const d = estado.datas[nome] || {};
        const limite = (estado.relatorio && estado.relatorio.ate) || '';
        return '<input type="date" class="filtro-data" data-data="' + nome + '" data-ponta="de"' +
               ' value="' + escapar(d.de || i.de) + '" max="' + escapar(limite) + '" title="Data inicial">' +
               '<span class="filtro-ate">até</span>' +
               '<input type="date" class="filtro-data" data-data="' + nome + '" data-ponta="ate"' +
               ' value="' + escapar(d.ate || i.ate) + '" max="' + escapar(limite) + '" title="Data final">';
    }

    /* Filtro fora do padrao fica marcado ("ativo"): ninguem le 3 meses achando que e o ano. */
    function filtroHtml(nome, opcoes, titulo) {
        const valor = estado.filtros[nome];
        const mudou = valor !== FILTROS_PADRAO[nome];
        return '<select class="filtro-grafico' + (mudou ? ' ativo' : '') + '" data-filtro="' + nome + '"' +
               (titulo ? ' title="' + escapar(titulo) + '" aria-label="' + escapar(titulo) + '"' : ' aria-label="Período"') + '>' +
            opcoes.map(function (o) {
                return '<option value="' + escapar(o.valor) + '"' + (String(o.valor) === String(valor) ? ' selected' : '') + '>' +
                       escapar(o.rotulo) + '</option>';
            }).join('') + '</select>';
    }

    function montarFiltros(idPainel, html) {
        const painel = document.getElementById(idPainel);
        if (!painel) return;
        let caixa = painel.querySelector('.filtros-painel');
        if (!caixa) {
            caixa = document.createElement('div');
            caixa.className = 'filtros-painel';
            painel.appendChild(caixa);
        }
        caixa.innerHTML = html;
    }

    function desenharRelatorios(dados) {
        if (dados) estado.relatorio = dados;
        if (!document.getElementById('kpisRelatorio')) return;
        desenharKpis();
        desenharGraficoResultado();
        desenharGraficoLucro();
        desenharGraficoMargem();
        desenharGraficoCaixa();
        desenharComposicao();
        desenharRanking();
        desenharPagamentos();
        desenharDespesas();
        desenharEstoquePizza();
        desenharVencendo();
        desenharLoja();
        desenharDre();
    }

    /** Soma as linhas diárias dentro da janela do filtro, agrupando por chave. */
    function somarNoPeriodo(linhas, janelaDatas, chave, campo, passa) {
        const soma = {};
        (linhas || []).forEach(function (l) {
            if (janelaDatas && (l.dia < janelaDatas.de || l.dia > janelaDatas.ate)) return;
            if (passa && !passa(l)) return;
            soma[l[chave]] = (soma[l[chave]] || 0) + Number(l[campo] || 0);
        });
        return soma;
    }

    function desenharPagamentos() {
        montarFiltros('topoPagamentos', filtroHtml('pagamentosOrigem', ORIGENS, 'De onde veio o dinheiro') +
            filtroHtml('pagamentos', PERIODOS) + camposDeDataHtml('pagamentos'));
        const origem = estado.filtros.pagamentosOrigem;
        const soma = somarNoPeriodo(estado.relatorio.pagamentos, intervaloDe('pagamentos'), 'forma', 'total',
            function (l) { return !origem || l.origem === origem; });
        Graficos.rosca(document.getElementById('graficoPagamentos'), {
            rotuloTotal: 'faturado',
            partes: Object.keys(soma).map(function (k) { return { rotulo: k, valor: soma[k] }; }),
            vazio: 'Nenhuma venda no período.',
        });
    }

    function desenharDespesas() {
        montarFiltros('topoDespesas', filtroHtml('despesas', PERIODOS) + camposDeDataHtml('despesas'));
        const soma = somarNoPeriodo(estado.relatorio.despesas_categoria, intervaloDe('despesas'), 'categoria', 'total');
        Graficos.rosca(document.getElementById('graficoDespesas'), {
            rotuloTotal: 'despesas',
            partes: Object.keys(soma).map(function (k) { return { rotulo: k, valor: soma[k] }; }),
            vazio: 'Nenhuma despesa no período.',
        });
    }

    /*
     * Aqui o periodo recorta pela data da ENTRADA do lote: "desse dinheiro
     * parado, quanto entrou quando". Por isso o padrao e "Qualquer entrada".
     */
    const PERIODOS_ESTOQUE = [{ valor: 'tudo', rotulo: 'Qualquer entrada' }].concat(PERIODOS);
    const NOME_TIPO = { insumo: 'Insumos', prato: 'Pratos prontos' };

    function desenharEstoquePizza() {
        montarFiltros('topoEstoquePizza', filtroHtml('estoquePizza', PERIODOS_ESTOQUE, 'Quando o lote entrou') +
            camposDeDataHtml('estoquePizza'));
        const janelaDatas = estado.filtros.estoquePizza === 'tudo' ? null : intervaloDe('estoquePizza');
        const soma = somarNoPeriodo(estado.relatorio.estoque, janelaDatas, 'tipo', 'investido');
        Graficos.rosca(document.getElementById('graficoEstoquePizza'), {
            rotuloTotal: 'parado',
            partes: Object.keys(soma).map(function (t) {
                return { rotulo: NOME_TIPO[t] || t, valor: soma[t], cor: Graficos.cor(corDe('tipos_entrada', t)) };
            }),
            vazio: 'Nada parado no estoque.',
        });
    }

    // ---- 1. KPIs ----
    function desenharKpis() {
        montarFiltros('topoKpis', filtroHtml('kpisOrigem', ORIGENS, 'De onde veio o dinheiro') +
            filtroHtml('kpis', PERIODOS) + camposDeDataHtml('kpis'));
        const meses = serieDe('kpis');
        const t = totalizar(meses);
        const titulo = document.getElementById('tituloPeriodo');
        if (titulo) {
            const fonte = { balcao: ' — balcão (PDV)', loja: ' — loja online' }[estado.filtros.kpisOrigem] || '';
            titulo.textContent = (estado.filtros.kpis === 'datas' ? 'Resultado do período'
                : 'Resultado dos últimos ' + estado.filtros.kpis + ' meses') + fonte;
        }
        /* Compara os dois ultimos periodos FECHADOS (o corrente esta pela metade). */
        const i = intervaloDe('kpis');
        const unidade = { dia: 'vs. dia anterior', semana: 'vs. semana anterior', mes: 'vs. mês anterior' };
        const fechados = meses.slice(0, -1);
        const ultimo = fechados[fechados.length - 1];
        const penultimo = fechados[fechados.length - 2];
        document.getElementById('kpisRelatorio').innerHTML =
            kpi('Receita no período', moeda(t.receita), '--serie-1',
                variacao(ultimo && ultimo.receita, penultimo && penultimo.receita, unidade[granularidadeDe(i.de, i.ate)])) +
            kpi('Custo dos pratos', moeda(t.custo), '--serie-2',
                t.receita > 0 ? porcento(t.custo / t.receita * 100) + ' da receita (CMV)' : '—') +
            (estado.filtros.kpisOrigem
                ? kpi(estado.filtros.kpisOrigem === 'loja' ? 'Pedidos da loja' : 'Vendas no balcão', t.quantidade, '--serie-4',
                      'ticket médio ' + moeda(t.ticket_medio))
                : kpi('Despesas', moeda(t.despesas), '--serie-4',
                      (t.perdas > 0 ? 'inclui ' + moeda(t.perdas) + ' de perdas · ' : '') +
                      (t.receita > 0 ? porcento(t.despesas / t.receita * 100) + ' da receita' : '—'))) +
            kpi(rotuloLucro('kpis'), moeda(t.lucro_liquido), t.lucro_liquido >= 0 ? '--serie-3' : '--critico',
                'margem de ' + porcento(t.margem) + ' • ticket ' + moeda(t.ticket_medio),
                t.receita > 0 ? Math.max(0, Math.min(100, t.lucro_liquido / t.receita * 100)) : 0);
    }

    // ---- 2. receita x custo x despesas ----
    function desenharGraficoResultado() {
        montarFiltros('topoResultado', filtroHtml('resultadoOrigem', ORIGENS, 'De onde veio o dinheiro') +
            filtroHtml('resultado', PERIODOS) + camposDeDataHtml('resultado'));
        ajustarTituloDoGrafico('topoResultado', 'resultado', 'Receita, custo e despesas', true);
        const comDespesa = !estado.filtros.resultadoOrigem;
        const series = [
            { rotulo: 'Receita', cor: Graficos.cor('--serie-1') },
            { rotulo: 'Custo dos pratos', cor: Graficos.cor('--serie-2') },
        ];
        if (comDespesa) series.push({ rotulo: 'Despesas', cor: Graficos.cor('--serie-4') });
        Graficos.barras(document.getElementById('graficoResultado'), {
            series: series,
            dados: serieDe('resultado').map(function (m) {
                return {
                    rotulo: m.rotulo,
                    valores: comDespesa ? [m.receita, m.custo, m.despesas] : [m.receita, m.custo],
                    extras: [{ rotulo: rotuloLucro('resultado'), valor: moeda(m.lucro_liquido),
                               destaque: m.lucro_liquido >= 0 ? Graficos.cor('--serie-3') : Graficos.cor('--critico') }],
                };
            }),
            vazio: 'Nenhuma venda neste período.',
        });
    }

    // ---- 3. lucro (a cor reforca o sinal; o lado do zero tambem diz) ----
    function desenharGraficoLucro() {
        montarFiltros('topoLucro', filtroHtml('lucroOrigem', ORIGENS, 'De onde veio o dinheiro') +
            filtroHtml('lucro', PERIODOS) + camposDeDataHtml('lucro'));
        ajustarTituloDoGrafico('topoLucro', 'lucro', rotuloLucro('lucro'));
        Graficos.barras(document.getElementById('graficoLucro'), {
            series: [{ rotulo: rotuloLucro('lucro'), cor: Graficos.cor('--serie-3') }],
            corPorSinal: true,
            rotularUltimo: true,
            dados: serieDe('lucro').map(function (m) {
                return { rotulo: m.rotulo, valores: [m.lucro_liquido],
                         extras: [{ rotulo: 'Receita', valor: moeda(m.receita) }, { rotulo: 'Margem', valor: porcento(m.margem) }] };
            }),
            vazio: 'Sem resultado para mostrar neste período.',
        });
    }

    // ---- 4. margem ----
    function desenharGraficoMargem() {
        montarFiltros('topoMargem', filtroHtml('margemOrigem', ORIGENS, 'De onde veio o dinheiro') +
            filtroHtml('margem', PERIODOS) + camposDeDataHtml('margem'));
        Graficos.linha(document.getElementById('graficoMargem'), {
            series: [{ rotulo: estado.filtros.margemOrigem ? 'Margem bruta' : 'Margem líquida', cor: Graficos.cor('--serie-3') }],
            tipo: 'porcento',
            dados: serieDe('margem').map(function (m) {
                return { rotulo: m.rotulo, valores: [m.margem], extras: [{ rotulo: rotuloLucro('margem'), valor: moeda(m.lucro_liquido) }] };
            }),
            vazio: 'Sem margem para calcular neste período.',
        });
    }

    // ---- 5. caixa ----
    function desenharGraficoCaixa() {
        montarFiltros('topoCaixa', filtroHtml('caixa', PERIODOS) + camposDeDataHtml('caixa'));
        Graficos.barras(document.getElementById('graficoCaixa'), {
            series: [{ rotulo: 'Recebido', cor: Graficos.cor('--serie-3') }, { rotulo: 'Pago', cor: Graficos.cor('--serie-2') }],
            dados: serieDe('caixa').map(function (m) {
                return { rotulo: m.rotulo, valores: [m.recebido, m.pago],
                         extras: [{ rotulo: 'Saldo', valor: moeda(m.caixa),
                                    destaque: m.caixa >= 0 ? Graficos.cor('--serie-3') : Graficos.cor('--critico') }] };
            }),
            vazio: 'Nenhuma baixa registrada neste período.',
        });
    }

    // ---- 6. composicao da receita (barra: com duas fatias le melhor que rosca) ----
    function desenharComposicao() {
        montarFiltros('topoComposicao', filtroHtml('composicao', PERIODOS) + camposDeDataHtml('composicao'));
        const meses = serieDe('composicao');
        Graficos.proporcao(document.getElementById('graficoComposicao'), {
            partes: [
                { rotulo: 'Balcão (PDV)', valor: somarEmCentavos(meses, function (m) { return m.receita_balcao; }),
                  cor: Graficos.cor(corDe('origens_venda', 'balcao')) },
                { rotulo: 'Loja online', valor: somarEmCentavos(meses, function (m) { return m.receita_loja; }),
                  cor: Graficos.cor(corDe('origens_venda', 'loja')) },
            ],
            vazio: 'Nenhuma receita neste período.',
        });
    }

    // ---- 7. ranking dos pratos ----
    function desenharRanking() {
        montarFiltros('topoRanking',
            filtroHtml('rankingOrigem', ORIGENS, 'De onde veio o dinheiro') +
            filtroHtml('rankingPeriodo', PERIODOS) + camposDeDataHtml('rankingPeriodo') +
            filtroHtml('rankingTipo', [
                { valor: 'prato', rotulo: 'Só pratos do cardápio' },
                { valor: '', rotulo: 'Tudo (com taxas e avulsos)' },
            ], 'O que entra no ranking') +
            filtroHtml('rankingOrdem', [
                { valor: 'receita', rotulo: 'Por faturamento' },
                { valor: 'lucro', rotulo: 'Por lucro' },
                { valor: 'unidades', rotulo: 'Por porções' },
            ], 'Critério de ordenação'));
        const janelaDatas = intervaloDe('rankingPeriodo');
        const tipo = estado.filtros.rankingTipo;
        const ordem = estado.filtros.rankingOrdem;
        const origem = estado.filtros.rankingOrigem;
        const somado = {};
        (estado.relatorio.itens || []).forEach(function (i) {
            if (i.dia < janelaDatas.de || i.dia > janelaDatas.ate) return;
            if (tipo && i.tipo !== tipo) return;
            if (origem && i.origem !== origem) return;
            const s = somado[i.descricao] || (somado[i.descricao] = { descricao: i.descricao, receita: 0, lucro: 0, unidades: 0 });
            s.receita += Number(i.receita) || 0;
            s.lucro += Number(i.lucro) || 0;
            s.unidades += Number(i.unidades) || 0;
        });
        const lista = Object.keys(somado).map(function (k) { return somado[k]; })
            .sort(function (a, b) { return b[ordem] - a[ordem]; }).slice(0, 8);
        const veCusto = !!estado.config.pode_ver_custo;
        Graficos.ranking(document.getElementById('rankingItens'), {
            itens: lista.map(function (i) {
                return {
                    rotulo: i.descricao,
                    valor: Math.max(0, i[ordem]),
                    texto: ordem === 'unidades'
                        ? i.unidades + ' porç.  ·  ' + moeda(i.receita)
                        : moeda(i[ordem]) + '  ·  ' + i.unidades + ' porç.' + (ordem === 'receita' && veCusto && i.receita > 0
                            ? '  ·  margem ' + porcento(i.lucro / i.receita * 100) : ''),
                };
            }),
            cor: ordem === 'lucro' ? Graficos.cor('--serie-3') : Graficos.cor('--serie-1'),
            vazio: 'Nenhum prato vendido no período.',
        });
    }

    function kpi(rotulo, valor, cor, nota, barra) {
        return '<div class="kpi">' +
            '<i class="kpi-faixa" style="background:var(' + cor + ')"></i>' +
            '<div class="kpi-rotulo">' + escapar(rotulo) + '</div>' +
            '<div class="kpi-valor">' + escapar(valor) + '</div>' +
            '<div class="kpi-nota">' + (nota || '') + '</div>' +
            (barra === undefined ? '' :
                '<div class="barra-mini"><i style="width:' + barra.toFixed(1) + '%;background:var(' + cor + ')"></i></div>') +
            '</div>';
    }

    /* A variacao vem com SETA e SINAL, nunca so com a cor. */
    function variacao(atual, anterior, sufixo) {
        if (!anterior || atual === undefined || atual === null) return escapar(sufixo || '');
        const pct = (atual - anterior) / Math.abs(anterior) * 100;
        const sobe = pct >= 0;
        return '<span class="' + (sobe ? 'delta-sobe' : 'delta-desce') + '">' + (sobe ? '↑' : '↓') + ' ' +
               porcento(Math.abs(pct)) + '</span> ' + escapar(sufixo || '');
    }

    // ---- 8. contas a vencer ----
    function desenharVencendo() {
        montarFiltros('topoVencendo',
            filtroHtml('vencendoPrazo', [
                { valor: '7', rotulo: 'Próximos 7 dias' }, { valor: '15', rotulo: 'Próximos 15 dias' },
                { valor: '30', rotulo: 'Próximos 30 dias' }, { valor: '60', rotulo: 'Próximos 60 dias' },
                { valor: String(estado.config.janela_vencimentos), rotulo: 'Próximos ' + estado.config.janela_vencimentos + ' dias' },
            ], 'Prazo') +
            filtroHtml('vencendoTipo', [
                { valor: '', rotulo: 'Receber e pagar' }, { valor: 'receber', rotulo: 'Só a receber' }, { valor: 'pagar', rotulo: 'Só a pagar' },
            ], 'Tipo de conta'));
        const prazo = Number(estado.filtros.vencendoPrazo);
        const tipo = estado.filtros.vencendoTipo;
        // O vencido (dias negativo) entra em qualquer prazo: e o que nao pode sumir de vista.
        const contas = (estado.relatorio.vencendo || []).filter(function (c) {
            return (!tipo || c.tipo === tipo) && c.dias <= prazo;
        }).slice(0, 10);
        const alvo = document.getElementById('listaVencendo');
        if (!contas.length) {
            alvo.innerHTML = vazio(tipo ? 'Nada a ' + tipo + ' vencendo nos próximos ' + prazo + ' dias.'
                                        : 'Nada vencendo nos próximos ' + prazo + ' dias.');
            return;
        }
        alvo.innerHTML = tabela(['Conta', 'Tipo', 'Vence', 'Valor'], contas.map(function (c) {
            const rotuloDia = c.dias < 0 ? 'vencido há ' + Math.abs(c.dias) + 'd' : c.dias === 0 ? 'hoje' : 'em ' + c.dias + 'd';
            return '<tr><td>' + escapar(c.descricao) + (c.quem ? '<br><small class="observacao">' + escapar(c.quem) + '</small>' : '') + '</td>' +
                '<td>' + etiqueta('tipos_lancamento', c.tipo) + '</td>' +
                '<td' + (c.dias <= 0 ? ' class="saldo-zero"' : '') + '>' + dataCurta(c.vencimento) +
                    '<br><small class="observacao">' + escapar(rotuloDia) + '</small></td>' +
                '<td class="numero">' + moeda(c.valor) + '</td></tr>';
        }), [null, null, null, 'numero']);
    }

    // ---- 9. loja online ----
    /*
     * relatorios.loja tem uma linha por dia e tipo de entrega. Para o grafico
     * por periodo, as contagens passam pelo MESMO agrupador do resultado
     * (dre.js), fantasiadas de colunas de dinheiro (entregas na de balcao,
     * retiradas na de loja): a granularidade e os baldes ficam iguais aos
     * outros graficos, sem uma segunda copia dessa conta.
     */
    function desenharLoja() {
        montarFiltros('topoLoja', filtroHtml('loja', PERIODOS) + camposDeDataHtml('loja'));
        const i = intervaloDe('loja');
        const linhas = (estado.relatorio.loja || []).filter(function (l) { return l.dia >= i.de && l.dia <= i.ate; });
        const soma = function (campo, filtro) {
            return linhas.reduce(function (s, l) { return s + (filtro && !filtro(l) ? 0 : Number(l[campo]) || 0); }, 0);
        };
        const pedidos = soma('pedidos');
        const cancelados = soma('cancelados');
        const validos = pedidos - cancelados;
        const total = soma('total');
        const descontos = soma('descontos');
        const avaliados = soma('avaliados');
        const nota = avaliados ? soma('soma_notas') / avaliados : null;
        document.getElementById('kpisLoja').innerHTML =
            kpi('Pedidos recebidos', String(pedidos), '--serie-5',
                cancelados ? cancelados + ' cancelado(s) · ' + porcento(cancelados / pedidos * 100) : 'nenhum cancelado') +
            kpi('Vendido pela loja', moeda(total), '--acento', 'ticket médio ' + moeda(validos ? total / validos : 0)) +
            kpi('Descontos dados', moeda(descontos), '--laranja',
                'cupons e cashback' + (total > 0 ? ' · ' + porcento(descontos / (total + descontos) * 100) + ' do pedido' : '')) +
            kpi('Avaliação média', nota === null ? '—' : '★ ' + nota.toFixed(1).replace('.', ','), '--dourado',
                avaliados ? avaliados + ' avaliação(ões)' : 'ainda sem avaliações');

        ajustarTituloDoGrafico('topoPedidosLoja', 'loja', 'Pedidos');
        const fantasia = linhas.map(function (l) {
            const valendo = (Number(l.pedidos) || 0) - (Number(l.cancelados) || 0);
            return l.tipo_entrega === 'retirada' ? { dia: l.dia, receita_loja: valendo } : { dia: l.dia, receita_balcao: valendo };
        });
        const baldes = agregarPeriodo(fantasia, i.de, i.ate, '');
        Graficos.barras(document.getElementById('graficoPedidosLoja'), {
            tipo: 'inteiro',
            series: [{ rotulo: 'Entrega', cor: Graficos.cor('--acento') }, { rotulo: 'Retirada', cor: Graficos.cor('--serie-1') }],
            dados: baldes.map(function (b) { return { rotulo: b.rotulo, valores: [b.receita_balcao, b.receita_loja] }; }),
            vazio: 'Nenhum pedido online neste período.',
        });
        const entregas = soma('pedidos', function (l) { return l.tipo_entrega === 'entrega'; }) -
                         soma('cancelados', function (l) { return l.tipo_entrega === 'entrega'; });
        Graficos.proporcao(document.getElementById('graficoTipoLoja'), {
            tipo: 'inteiro',
            partes: [{ rotulo: 'Entrega', valor: entregas, cor: Graficos.cor('--acento') },
                     { rotulo: 'Retirada na loja', valor: validos - entregas, cor: Graficos.cor('--serie-1') }],
            vazio: 'Nenhum pedido online neste período.',
        });
    }

    // ---- 10. quadro do periodo ----
    function desenharDre() {
        montarFiltros('topoDre', filtroHtml('dreOrigem', ORIGENS, 'De onde veio o dinheiro') +
            filtroHtml('dre', PERIODOS) + camposDeDataHtml('dre'));
        const meses = serieDe('dre');
        const comMovimento = meses.filter(function (m) { return m.receita > 0 || m.despesas > 0; });
        const alvo = document.getElementById('tabelaDre');
        if (!comMovimento.length) { alvo.innerHTML = vazio('Nenhum movimento no período escolhido.'); return; }
        const soma = function (campo) { return somarEmCentavos(comMovimento, function (m) { return m[campo]; }); };
        const comOrigem = !!estado.filtros.dreOrigem;
        const cabeca = ['Período', 'Receita', 'Custo', 'Lucro bruto'].concat(comOrigem ? [] : ['Despesas', 'Perdas'])
            .concat([rotuloLucro('dre'), 'Margem']);
        const numeros = cabeca.map(function (c, i) { return i ? 'numero' : null; });
        const linha = function (m, total) {
            const classe = m.lucro_liquido >= 0 ? 'saldo-ok' : 'saldo-zero';
            return '<tr' + (total ? ' class="linha-total"' : '') + '><td>' + escapar(total ? 'Total' : (m.titulo || m.rotulo)) + '</td>' +
                '<td class="numero">' + moeda(m.receita) + '</td><td class="numero">' + moeda(m.custo) + '</td>' +
                '<td class="numero">' + moeda(m.lucro_bruto) + '</td>' +
                (comOrigem ? '' : '<td class="numero">' + moeda(m.despesas) + '</td><td class="numero">' + moeda(m.perdas) + '</td>') +
                '<td class="numero ' + classe + '">' + moeda(m.lucro_liquido) + '</td>' +
                '<td class="numero ' + classe + '">' + porcento(m.margem) + '</td></tr>';
        };
        const total = { receita: soma('receita'), custo: soma('custo'), lucro_bruto: soma('lucro_bruto'), despesas: soma('despesas'),
                        perdas: soma('perdas'), lucro_liquido: soma('lucro_liquido') };
        total.margem = total.receita > 0 ? total.lucro_liquido / total.receita * 100 : 0;
        alvo.innerHTML = tabela(cabeca, comMovimento.map(function (m) { return linha(m, false); }).concat([linha(total, true)]), numeros);
    }

    /*
     * Ao mudar a largura (ou encolher o menu), os graficos sao redesenhados:
     * quantos rotulos cabem no eixo depende da largura real. O espera-um-pouco
     * evita dezenas de redesenhos por segundo enquanto a janela e arrastada.
     */
    let esperaRedesenho = null;
    window.addEventListener('resize', function () {
        if (!estado.relatorio) return;
        clearTimeout(esperaRedesenho);
        esperaRedesenho = setTimeout(function () {
            if (!document.getElementById('secao-dashboard').classList.contains('oculta')) desenharRelatorios(estado.relatorio);
        }, 220);
    });

    registrarTela('dashboard', { titulo: 'Resultados', carregar: carregarDashboard });

    janela.Telas = janela.Telas || {};
    janela.Telas.painel = { desenharRelatorios: desenharRelatorios, carregar: carregarDashboard };
})(window);
