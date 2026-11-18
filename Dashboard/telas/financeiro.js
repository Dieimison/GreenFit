// carga: usa Formato, Nucleo, Janela; publica Telas.financeiro  (conferido por testes/front/carga.test.js)
/*
 * telas/financeiro.js - Financeiro (so quem ve o financeiro): resumo,
 * lancamentos (contas a pagar e a receber) e historico de vendas por mes.
 * Window.Telas.financeiro. A tela inteira e montada em #financeiroConteudo.
 *
 * O que cada lancamento permite (editar o valor, excluir, cancelar) vem
 * pronto do servidor em cada registro (pode_editar_valor, pode_excluir,
 * pode_cancelar). Lancamento gerado por venda ou compra e o espelho do
 * documento: o valor muda pelo documento.
 */
(function (janela) {
    'use strict';

    const { escapar, moeda, porcento, dataCurta, horaCurta, mesAno, hoje, emCentavos, deCentavos, somarEmCentavos } = janela.Formato;
    const N = janela.Nucleo;
    const { api, estado, mensagemDe, avisar, rotuloDe, opcoesDoDominio, etiqueta, vazio, opcoesDe, cardSimples,
            tabelaHtml, campoFormaPagamento, carregarCatalogos } = N;
    const { abrirModal } = janela.Janela;

    estado.painelFinanceiro = 'resumo';
    const filtroLanc = { tipo: '', status: 'pendente', busca: '', de: '', ate: '' };
    const filtroHist = { busca: '', de: '', ate: '', pagamento: '', origem: '' };
    const SEM_FORMA_ID = 'nenhuma';

    const daLoja = function (v) { return v.origem === 'loja' || !!v.encomenda_numero; };

    function alvo() { return document.getElementById('conteudoFinanceiro'); }

    function desenharCasca() {
        const raiz = document.getElementById('financeiroConteudo');
        if (raiz.querySelector('#conteudoFinanceiro')) return;
        raiz.innerHTML =
            '<div class="gestao-topo">' +
                '<p class="secao-descricao">Contas a pagar e a receber: as geradas pelas vendas (balcão e loja online) e pelas ' +
                'compras, e as lançadas na mão (aluguel, gás, entregador...).</p>' +
                '<div class="grupo-botoes">' +
                    '<button type="button" class="botao" data-acao="novo-lancamento" data-tipo="receber">+ A receber</button>' +
                    '<button type="button" class="botao botao-secundario" data-acao="novo-lancamento" data-tipo="pagar">+ A pagar</button>' +
                '</div>' +
            '</div>' +
            '<div class="sub-abas" id="subAbasFinanceiro">' +
                '<button type="button" class="sub-aba" data-painel="resumo">Resumo</button>' +
                '<button type="button" class="sub-aba" data-painel="lancamentos">Lançamentos</button>' +
                '<button type="button" class="sub-aba" data-painel="vendas">Vendas por mês</button>' +
            '</div>' +
            '<div id="conteudoFinanceiro"><p class="texto-vazio">Carregando...</p></div>';
    }

    async function carregarFinanceiro() {
        desenharCasca();
        document.querySelectorAll('#subAbasFinanceiro .sub-aba').forEach(function (aba) {
            aba.classList.toggle('ativa', aba.dataset.painel === estado.painelFinanceiro);
        });
        if (estado.painelFinanceiro === 'resumo') {
            return desenharResumo(await api.get('/financeiro'));
        }
        if (estado.painelFinanceiro === 'lancamentos') {
            await carregarCatalogos();
            return carregarLancamentos();
        }
        const [dados, formas] = await Promise.all([api.get('/vendas'), api.get('/formas-pagamento')]);
        estado.vendas = dados.itens;
        estado.formasPagamento = formas.itens;
        return desenharHistorico();
    }

    // ------------------------------------------------------------------
    // Resumo
    // ------------------------------------------------------------------
    function desenharResumo(d) {
        const est = d.estoque || {};
        const v = d.vendas || {};
        const l = d.lancamentos || {};
        const receita = deCentavos(emCentavos(v.receita_balcao) + emCentavos(v.receita_loja));
        const mensal = (d.mensal || []).length
            ? tabelaHtml({
                colunas: ['Mês', { titulo: 'Balcão', classe: 'numero' }, { titulo: 'Loja online', classe: 'numero' },
                          { titulo: 'Total', classe: 'numero' }, { titulo: 'Vendas', classe: 'numero' }],
                linhas: d.mensal.map(function (m) {
                    return [mesAno(m.mes), { classe: 'numero', html: moeda(m.balcao) }, { classe: 'numero', html: moeda(m.loja) },
                            { classe: 'numero', html: '<strong>' + moeda(m.total) + '</strong>' }, { classe: 'numero', html: String(m.quantidade) }];
                }),
            })
            : vazio('Nenhuma venda ainda.');
        // Vencido aparece separado porque e o unico numero que exige acao hoje.
        const alertas = (l.vencido_receber > 0 || l.vencido_pagar > 0)
            ? '<div class="stats-container">' +
              (l.vencido_receber > 0 ? cardSimples('Vencido a receber', moeda(l.vencido_receber), '--critico') : '') +
              (l.vencido_pagar > 0 ? cardSimples('Vencido a pagar', moeda(l.vencido_pagar), '--critico') : '') +
              '</div>'
            : '';
        alvo().innerHTML =
            '<div class="stats-container">' +
                cardSimples('A receber (em aberto)', moeda(l.a_receber), '--serie-3') +
                cardSimples('A pagar (em aberto)', moeda(l.a_pagar), '--critico') +
                cardSimples('Saldo previsto', moeda(d.saldo_previsto), d.saldo_previsto >= 0 ? '--serie-3' : '--critico') +
                cardSimples('Já recebido', moeda(l.recebido), '--serie-1') +
            '</div>' + alertas +
            '<div class="stats-container">' +
                cardSimples('Receita do balcão', moeda(v.receita_balcao), '--serie-1') +
                cardSimples('Lucro do balcão', moeda(d.lucro_balcao), '--serie-3') +
                cardSimples('Receita da loja online', moeda(v.receita_loja), '--acento') +
                cardSimples('Lucro da loja online', moeda(d.lucro_loja), '--serie-3') +
            '</div>' +
            '<div class="stats-container">' +
                cardSimples('Parado em insumos', moeda(est.insumos_parados), '--serie-1') +
                cardSimples('Parado em pratos prontos', moeda(est.pratos_parados), '--acento') +
                cardSimples('Venda prevista dos pratos prontos', moeda(est.venda_prevista), '--serie-5') +
                cardSimples('Perdas (vencido, perda, cortesia)', moeda(d.perdas), '--critico') +
            '</div>' +
            '<div class="tables-grid">' +
                '<div class="table-section"><h3 class="table-title"><span style="background:var(--serie-1)"></span>Faturamento por mês</h3>' + mensal + '</div>' +
                '<div class="table-section"><h3 class="table-title"><span style="background:var(--serie-5)"></span>Resumo</h3>' +
                    '<div class="lista-dados">' +
                        '<div><span>Vendas no balcão</span><strong>' + (v.qtd_balcao || 0) + '</strong></div>' +
                        '<div><span>Vendas da loja online</span><strong>' + (v.qtd_loja || 0) + '</strong></div>' +
                        '<div><span>Custo dos pratos vendidos</span><strong>' + moeda(deCentavos(emCentavos(v.custo_balcao) + emCentavos(v.custo_loja))) +
                            (receita > 0 ? ' (' + porcento((v.custo_balcao + v.custo_loja) / receita * 100) + ')' : '') + '</strong></div>' +
                        '<div><span>Estoque parado (custo)</span><strong>' + moeda(est.investido_parado) + '</strong></div>' +
                        (est.vencido_parado > 0 ? '<div><span>Vencido ainda no estoque</span><strong class="saldo-zero">' + moeda(est.vencido_parado) + '</strong></div>' : '') +
                        '<div><span>Já pago (todas as contas)</span><strong>' + moeda(l.pago) + '</strong></div>' +
                    '</div>' +
                '</div>' +
            '</div>';
    }

    // ------------------------------------------------------------------
    // Lancamentos
    // ------------------------------------------------------------------
    async function carregarLancamentos() {
        const q = [];
        ['tipo', 'status', 'de', 'ate'].forEach(function (k) { if (filtroLanc[k]) q.push(k + '=' + encodeURIComponent(filtroLanc[k])); });
        estado.lancamentos = (await api.get('/lancamentos' + (q.length ? '?' + q.join('&') : ''))).itens;
        desenharLancamentos();
    }

    function selectFiltro(chave, valor, opcoes, rotulo, dataNome) {
        return '<select ' + dataNome + '="' + chave + '" aria-label="' + escapar(rotulo) + '">' + opcoes.map(function (o) {
            return '<option value="' + escapar(o[0]) + '"' + (valor === o[0] ? ' selected' : '') + '>' + escapar(o[1]) + '</option>';
        }).join('') + '</select>';
    }

    function desenharLancamentos() {
        const busca = filtroLanc.busca.trim().toLowerCase();
        const itens = estado.lancamentos.filter(function (l) {
            if (!busca) return true;
            return [l.descricao, l.categoria, l.cliente, l.fornecedor, l.venda_numero, l.encomenda_numero, l.forma_pagamento]
                .join(' ').toLowerCase().includes(busca);
        });
        const filtros =
            '<div class="barra-filtros gestao-filtros">' +
                '<input type="search" data-filtro-lanc="busca" placeholder="Buscar por descrição, categoria, cliente ou fornecedor..." ' +
                    'aria-label="Buscar lançamentos" value="' + escapar(filtroLanc.busca) + '">' +
                selectFiltro('tipo', filtroLanc.tipo, [['', 'Receber e pagar'], ['receber', 'Só a receber'], ['pagar', 'Só a pagar']], 'Tipo', 'data-filtro-lanc') +
                selectFiltro('status', filtroLanc.status, [['pendente', 'Em aberto'], ['', 'Todas as situações'], ['pago', 'Pagos'], ['cancelado', 'Cancelados']], 'Situação', 'data-filtro-lanc') +
                '<input type="date" data-filtro-lanc="de" value="' + escapar(filtroLanc.de) + '" title="Vencimento a partir de" aria-label="De">' +
                '<input type="date" data-filtro-lanc="ate" value="' + escapar(filtroLanc.ate) + '" title="Vencimento até" aria-label="Até">' +
            '</div>';
        if (!itens.length) {
            alvo().innerHTML = filtros + vazio('Nenhum lançamento neste filtro. Use "+ A receber" e "+ A pagar" para incluir na mão.');
            return;
        }
        const pendentes = function (tipo) { return itens.filter(function (l) { return l.tipo === tipo && l.status === 'pendente'; }); };
        const receber = somarEmCentavos(pendentes('receber'), function (l) { return l.valor; });
        const pagar = somarEmCentavos(pendentes('pagar'), function (l) { return l.valor; });
        const saldo = deCentavos(emCentavos(receber) - emCentavos(pagar));
        const marcoHoje = hoje();
        alvo().innerHTML = filtros +
            '<div class="gestao-resumo"><span>A receber <strong>' + moeda(receber) + '</strong></span>' +
            '<span>A pagar <strong>' + moeda(pagar) + '</strong></span>' +
            '<span>Saldo <strong class="' + (saldo >= 0 ? 'saldo-ok' : 'saldo-zero') + '">' + moeda(saldo) + '</strong></span>' +
            '<span>' + itens.length + ' lançamento(s)</span></div>' +
            '<div class="table-section">' + tabelaHtml({
                colunas: ['Descrição', 'Tipo', 'Vencimento', { titulo: 'Valor', classe: 'numero' }, 'Situação', 'Origem',
                          { titulo: 'Ações', classe: 'coluna-acoes' }],
                linhas: itens.map(function (l) {
                    const vencido = l.status === 'pendente' && l.vencimento && l.vencimento < marcoHoje;
                    const quem = l.cliente || l.fornecedor || '';
                    const ref = l.encomenda_numero ? (l.venda_numero || '') + ' · pedido ' + l.encomenda_numero : (l.venda_numero || '');
                    return [
                        escapar(l.descricao) + (quem ? '<span class="doc-sub">' + escapar(quem) + '</span>' : '') +
                            (l.categoria ? '<span class="doc-sub">' + escapar(l.categoria) + '</span>' : ''),
                        etiqueta('tipos_lancamento', l.tipo),
                        { classe: vencido ? 'saldo-zero' : '', html: dataCurta(l.vencimento) + (vencido ? '<span class="doc-sub">vencido</span>' : '') },
                        { classe: 'numero', html: moeda(l.valor) + (l.total_parcelas > 1 ? '<span class="doc-sub">' + l.parcela + '/' + l.total_parcelas + '</span>' : '') },
                        etiqueta('status_lancamento', l.status) + (l.forma_pagamento ? '<span class="doc-sub">' + escapar(l.forma_pagamento) + '</span>' : ''),
                        escapar(rotuloDe('origens_lancamento', l.origem || 'manual')) + (ref ? '<span class="doc-sub">' + escapar(ref) + '</span>' : ''),
                        { classe: 'coluna-acoes', html: '<div class="acoes-linha">' +
                            (l.status === 'pendente' ? '<button type="button" class="botao-icone" data-acao="baixar-lancamento" data-id="' + l.id + '">Dar baixa</button>' : '') +
                            '<button type="button" class="botao-icone" data-acao="editar-lancamento" data-id="' + l.id + '">Editar</button>' +
                            '<button type="button" class="botao-icone" data-acao="log-lancamento" data-id="' + l.id + '" title="Ver alterações">Histórico</button>' +
                            (l.pode_excluir ? '<button type="button" class="botao-icone perigo botao-excluir" data-acao="excluir-lancamento" data-id="' + l.id + '">Excluir</button>' : '') +
                            '</div>' },
                    ];
                }),
            }) + '</div>';
    }

    // ------------------------------------------------------------------
    // Vendas por mes (historico)
    // ------------------------------------------------------------------
    function desenharHistorico() {
        const f = filtroHist;
        if (!estado.vendas.length) { alvo().innerHTML = vazio('Nenhuma venda registrada ainda.'); return; }
        // O filtro de forma usa o ID do cadastro (como o relatorio); so entram as formas usadas.
        const usadas = {};
        estado.vendas.forEach(function (v) { usadas[String(v.forma_pagamento_id || '')] = true; });
        const formas = estado.formasPagamento.filter(function (fp) { return usadas[String(fp.id)]; })
            .map(function (fp) { return [String(fp.id), fp.nome]; });
        if (usadas['']) formas.push([SEM_FORMA_ID, '— não informada —']);
        const busca = f.busca.trim().toLowerCase();
        const itens = estado.vendas.filter(function (v) {
            const dia = String(v.data_venda).substring(0, 10);
            if (f.de && dia < f.de) return false;
            if (f.ate && dia > f.ate) return false;
            if (f.pagamento === SEM_FORMA_ID ? v.forma_pagamento_id : (f.pagamento && String(v.forma_pagamento_id) !== f.pagamento)) return false;
            if (f.origem && (daLoja(v) ? 'loja' : 'balcao') !== f.origem) return false;
            if (!busca) return true;
            return [v.numero, v.cliente, v.vendedor, v.forma_pagamento, v.itens_texto, v.encomenda_numero].filter(Boolean).join(' ').toLowerCase().includes(busca);
        });
        const barra = '<div class="barra-filtros gestao-filtros">' +
            '<input type="search" data-filtro-hist="busca" placeholder="Buscar por número, cliente, prato ou vendedor..." aria-label="Buscar" value="' + escapar(f.busca) + '">' +
            '<input type="date" data-filtro-hist="de" value="' + escapar(f.de) + '" title="A partir de" aria-label="De">' +
            '<input type="date" data-filtro-hist="ate" value="' + escapar(f.ate) + '" title="Até" aria-label="Até">' +
            selectFiltro('pagamento', f.pagamento, [['', 'Todas as formas']].concat(formas), 'Forma de pagamento', 'data-filtro-hist') +
            selectFiltro('origem', f.origem, [['', 'Balcão e loja'], ['balcao', 'Só balcão (PDV)'], ['loja', 'Só loja online']], 'Origem', 'data-filtro-hist') +
            '</div>';
        if (!itens.length) { alvo().innerHTML = barra + vazio('Nenhuma venda encontrada com esses filtros.'); return; }
        const concluidas = itens.filter(function (v) { return v.status === 'concluida'; });
        const soma = function (lista, campo) { return somarEmCentavos(lista, function (v) { return v[campo]; }); };
        const total = soma(concluidas, 'valor_total');
        const custo = soma(concluidas, 'custo_total');
        const meses = {};
        concluidas.forEach(function (v) { (meses[String(v.data_venda).substring(0, 7)] = meses[String(v.data_venda).substring(0, 7)] || []).push(v); });
        alvo().innerHTML = barra +
            '<div class="stats-container">' +
                cardSimples('Vendas concluídas', concluidas.length, '--serie-1') +
                cardSimples('Balcão', moeda(soma(concluidas.filter(function (v) { return !daLoja(v); }), 'valor_total')), '--serie-1') +
                cardSimples('Loja online', moeda(soma(concluidas.filter(daLoja), 'valor_total')), '--acento') +
                cardSimples('Lucro', moeda(deCentavos(emCentavos(total) - emCentavos(custo))) + (total > 0 ? ' · ' + porcento((total - custo) / total * 100) : ''), '--serie-3') +
            '</div>' +
            '<div class="tables-grid">' +
            '<div class="table-section"><h3 class="table-title"><span style="background:var(--serie-1)"></span>Por mês</h3>' +
            tabelaHtml({
                colunas: ['Mês', { titulo: 'Vendas', classe: 'numero' }, { titulo: 'Balcão', classe: 'numero' },
                          { titulo: 'Loja', classe: 'numero' }, { titulo: 'Custo', classe: 'numero' }, { titulo: 'Lucro', classe: 'numero' }],
                linhas: Object.keys(meses).sort().reverse().map(function (mes) {
                    const lista = meses[mes];
                    return [mesAno(mes), { html: String(lista.length), classe: 'numero' },
                            { html: moeda(soma(lista.filter(function (v) { return !daLoja(v); }), 'valor_total')), classe: 'numero' },
                            { html: moeda(soma(lista.filter(daLoja), 'valor_total')), classe: 'numero' },
                            { html: moeda(soma(lista, 'custo_total')), classe: 'numero' },
                            { html: moeda(soma(lista, 'lucro')), classe: 'numero' }];
                }),
            }) + '</div>' +
            '<div class="table-section"><h3 class="table-title"><span style="background:var(--serie-5)"></span>Vendas ' +
                '<small class="observacao" style="margin-left:auto;font-weight:400">' + itens.length + ' encontrada(s)</small></h3>' +
            tabelaHtml({
                colunas: ['Número', 'Data', 'Cliente', { titulo: 'Total', classe: 'numero' }, { titulo: 'Ações', classe: 'coluna-acoes' }],
                linhas: itens.slice(0, 40).map(function (v) {
                    return ['<span class="doc-numero">' + escapar(v.numero || '#' + v.id) + '</span><span class="doc-sub">' +
                                (daLoja(v) ? 'Loja · ' + escapar(v.encomenda_numero || '') : 'Balcão') + '</span>',
                            dataCurta(v.data_venda),
                            escapar(v.cliente) + (v.forma_pagamento ? '<span class="doc-sub">' + escapar(v.forma_pagamento) + '</span>' : ''),
                            { classe: 'numero', html: moeda(v.valor_total) + (v.status === 'cancelada' ? '<span class="doc-sub">cancelada</span>' : '') },
                            { classe: 'coluna-acoes', html: '<button type="button" class="botao-icone" data-acao="ver-venda" data-id="' + v.id + '">Ver</button>' }];
                }),
            }) +
            (itens.length > 40 ? '<p class="observacao" style="margin-top:10px">Mostrando as 40 mais recentes de ' + itens.length +
                '. Use os filtros para chegar no que procura.</p>' : '') +
            '</div></div>';
    }

    // ------------------------------------------------------------------
    // Formulario e ficha do lancamento
    // ------------------------------------------------------------------
    function formularioLancamento(lanc, tipo) {
        lanc = lanc || {};
        const travarValor = !!lanc.id && !lanc.pode_editar_valor;
        return [
            { nome: 'tipo', rotulo: 'Tipo', tipo: 'select', valor: lanc.tipo || tipo || 'receber', opcoes: opcoesDoDominio('tipos_lancamento'),
              desabilitado: !!lanc.id && lanc.origem !== 'manual' },
            { nome: 'valor', rotulo: 'Valor (R$)', tipo: 'number', valor: lanc.valor, obrigatorio: true, minimo: 0.01, somenteLeitura: travarValor,
              dica: travarValor ? 'Gerado por ' + rotuloDe('origens_lancamento', lanc.origem) + ': o valor muda pelo próprio documento.' : '' },
            { nome: 'descricao', rotulo: 'Descrição', valor: lanc.descricao, obrigatorio: true, largura: 'total' },
            { nome: 'categoria', rotulo: 'Categoria', tipo: 'lista', lista: 'categorias_lancamento', valor: lanc.categoria },
            { nome: 'vencimento', rotulo: 'Vencimento', tipo: 'date', valor: (lanc.vencimento || hoje()).substring(0, 10) },
            { nome: 'status', rotulo: 'Situação', tipo: 'select', valor: lanc.status || 'pendente', opcoes: opcoesDoDominio('status_lancamento'),
              dica: 'Marcar como pago carimba a data de hoje sozinho.' },
            campoFormaPagamento(lanc.forma_pagamento_id),
            { nome: 'cliente_id', rotulo: 'Cliente', tipo: 'select', valor: lanc.cliente_id || '',
              opcoes: opcoesDe(estado.clientes, function (c) { return c.nome; }, '— nenhum —') },
            { nome: 'fornecedor_id', rotulo: 'Fornecedor', tipo: 'select', valor: lanc.fornecedor_id || '',
              opcoes: opcoesDe(estado.fornecedores, function (f) { return f.nome; }, '— nenhum —') },
            { nome: 'parcela', rotulo: 'Parcela nº', tipo: 'number', valor: lanc.parcela || 1, passo: '1', minimo: 1, maximo: estado.config.parcelas_max },
            { nome: 'total_parcelas', rotulo: 'Total de parcelas', tipo: 'number', valor: lanc.total_parcelas || 1, passo: '1', minimo: 1,
              maximo: estado.config.parcelas_max },
            { nome: 'observacoes', rotulo: 'Observações', tipo: 'textarea', valor: lanc.observacoes, largura: 'total' },
        ];
    }

    /* Ficha do lancamento: o que ele e hoje e tudo o que ja mudou nele. */
    async function verLogLancamento(id) {
        const dados = await api.get('/lancamentos/' + id);
        const l = dados.lancamento;
        const linhas = (dados.log || []).map(function (g) {
            return [dataCurta(g.criado_em) + '<span class="doc-sub">' + escapar(horaCurta(g.criado_em)) + '</span>',
                    escapar(g.campo), escapar(g.valor_antes), '<strong>' + escapar(g.valor_depois) + '</strong>', escapar(g.usuario || '—')];
        });
        abrirModal({
            titulo: 'Lançamento — ' + l.descricao,
            somenteLeitura: true,
            html: '<div class="campo-total">' +
                '<div class="lista-dados" style="margin-bottom:18px">' +
                '  <div><span>Valor</span><strong>' + moeda(l.valor) + '</strong></div>' +
                '  <div><span>Tipo</span><strong>' + etiqueta('tipos_lancamento', l.tipo) + '</strong></div>' +
                '  <div><span>Situação</span><strong>' + etiqueta('status_lancamento', l.status) + '</strong></div>' +
                '  <div><span>Vencimento</span><strong>' + dataCurta(l.vencimento) + '</strong></div>' +
                (l.data_pagamento ? '  <div><span>Baixa em</span><strong>' + dataCurta(l.data_pagamento) + '</strong></div>' : '') +
                '  <div><span>Parcela</span><strong>' + l.parcela + ' de ' + l.total_parcelas + '</strong></div>' +
                '  <div><span>Origem</span><strong>' + escapar(rotuloDe('origens_lancamento', l.origem)) + '</strong></div>' +
                (l.forma_pagamento ? '  <div><span>Forma</span><strong>' + escapar(l.forma_pagamento) + '</strong></div>' : '') +
                '</div>' +
                '<h4 class="sub-titulo">Alterações</h4>' +
                (linhas.length ? tabelaHtml({ colunas: ['Quando', 'Campo', 'De', 'Para', 'Quem'], linhas: linhas })
                               : vazio('Este lançamento nunca foi alterado.')) +
                '</div>',
        });
    }

    // ------------------------------------------------------------------
    // Eventos (delegados: o conteudo e redesenhado a cada filtro)
    // ------------------------------------------------------------------
    function trocarPainel(nome) {
        estado.painelFinanceiro = nome;
        carregarFinanceiro().catch(function (erro) { avisar(erro.message, 'erro'); });
    }

    const raiz = document.getElementById('financeiroConteudo');
    raiz.addEventListener('click', function (evento) {
        const aba = evento.target.closest('.sub-aba[data-painel]');
        if (aba) trocarPainel(aba.dataset.painel);
    });

    function lerBusca(campo, obj, desenhar) {
        const pos = campo.selectionStart;
        obj.busca = campo.value;
        desenhar();
        const novo = raiz.querySelector('[' + (obj === filtroLanc ? 'data-filtro-lanc' : 'data-filtro-hist') + '="busca"]');
        if (novo) { novo.focus(); novo.setSelectionRange(pos, pos); }
    }

    raiz.addEventListener('input', function (evento) {
        const lanc = evento.target.closest('[data-filtro-lanc="busca"]');
        if (lanc) return lerBusca(lanc, filtroLanc, desenharLancamentos);
        const hist = evento.target.closest('[data-filtro-hist="busca"]');
        if (hist) return lerBusca(hist, filtroHist, desenharHistorico);
    });

    raiz.addEventListener('change', function (evento) {
        const lanc = evento.target.closest('[data-filtro-lanc]');
        if (lanc && lanc.dataset.filtroLanc !== 'busca') {
            filtroLanc[lanc.dataset.filtroLanc] = lanc.value;
            carregarLancamentos().catch(function (erro) { avisar(erro.message, 'erro'); });
            return;
        }
        const hist = evento.target.closest('[data-filtro-hist]');
        if (hist && hist.dataset.filtroHist !== 'busca') {
            filtroHist[hist.dataset.filtroHist] = hist.value;
            desenharHistorico();
        }
    });

    N.registrarAcoes({
        'novo-lancamento': async function (id, tipo) {
            await carregarCatalogos();
            return abrirModal({
                titulo: tipo === 'pagar' ? 'Nova conta a pagar' : 'Nova conta a receber',
                campos: formularioLancamento(null, tipo),
                aoSalvar: async function (valores) {
                    avisar(mensagemDe(await api.post('/lancamentos', valores), 'Lançamento registrado.'));
                    trocarPainel('lancamentos');
                },
            });
        },
        'editar-lancamento': function (id) {
            const lanc = estado.lancamentos.find(function (l) { return l.id === id; });
            return abrirModal({
                titulo: 'Editar lançamento',
                campos: formularioLancamento(lanc),
                aoSalvar: async function (valores) {
                    if (!lanc.pode_editar_valor) delete valores.valor;   // o valor muda pelo documento
                    if (lanc.origem !== 'manual') delete valores.tipo;
                    avisar(mensagemDe(await api.put('/lancamentos/' + id, valores), 'Lançamento atualizado.'));
                    await carregarLancamentos();
                },
            });
        },
        'log-lancamento': verLogLancamento,
        'baixar-lancamento': async function (id) {
            const lanc = estado.lancamentos.find(function (l) { return l.id === id; });
            if (!confirm('Dar baixa em "' + lanc.descricao + '" (' + moeda(lanc.valor) + ')?')) return;
            avisar(mensagemDe(await api.put('/lancamentos/' + id, { status: 'pago' }), 'Baixa registrada.'));
            await carregarLancamentos();
        },
        'excluir-lancamento': async function (id) {
            const lanc = estado.lancamentos.find(function (l) { return l.id === id; });
            if (!confirm('Excluir o lançamento "' + lanc.descricao + '"?')) return;
            avisar(mensagemDe(await api.remover('/lancamentos/' + id), 'Lançamento excluído.'));
            await carregarLancamentos();
        },
    });

    N.registrarTela('financeiro', { titulo: 'Financeiro', carregar: carregarFinanceiro, soFinanceiro: true });
    janela.Telas = janela.Telas || {};
    janela.Telas.financeiro = { carregar: carregarFinanceiro };
})(window);
