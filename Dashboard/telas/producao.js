// carga: usa Formato, Nucleo, Janela; publica Telas.producao  (conferido por testes/front/carga.test.js)
/*
 * telas/producao.js - PRODUCAO: o plano da cozinha. Window.Telas.producao.
 *
 *   Para produzir   as ordens planejadas (atrasadas, hoje, amanha, depois),
 *                   com os insumos que faltam; Concluir e Cancelar
 *   Sugestao        pratos abaixo do minimo (GET /resumo .repor): "Produzir"
 *   Historico       concluidas e canceladas, com lote, validade, custo
 *
 * Concluir baixa os insumos da ficha tecnica x porcoes pelo lote que vence
 * primeiro e cria o lote do prato com validade (api/rotas/producao.php).
 * A tela mostra ANTES o que vai sair de cada insumo e o que falta.
 */
(function (janela) {
    'use strict';

    const { escapar, moeda, dataBr, dataCurta, hoje, somarDias } = janela.Formato;
    const N = janela.Nucleo;
    const { api, estado, mensagemDe, avisar, etiqueta, etiquetaTexto, vazio, tabelaHtml, quantidadeLegivel, carregarPratos } = N;
    const J = janela.Janela;

    const raiz = document.getElementById('producaoConteudo');
    const PAGINA = 30;
    const filtro = { historico: 'concluida', busca: '', limite: PAGINA };
    let producoes = [];
    let repor = [];

    async function carregar() {
        const r = await Promise.all([api.get('/producoes'), api.get('/resumo')]);
        producoes = r[0].itens;
        repor = r[1].repor || [];
        desenhar();
    }

    // ------------------------------------------------------------------
    // Desenho
    // ------------------------------------------------------------------
    function grupoDaData(data) {
        const h = hoje();
        if (data < h) return 'atrasadas';
        if (data === h) return 'hoje';
        if (data === somarDias(h, 1)) return 'amanha';
        return 'depois';
    }

    function cartaoPlanejada(p) {
        const faltando = p.faltando || [];
        return '<article class="cz-cartao-producao' + (grupoDaData(p.data_producao) === 'atrasadas' ? ' cz-atrasada' : '') + '">' +
            '<div class="cz-cartao-topo">' +
                '<span class="cz-porcoes"><strong>' + p.quantidade + '</strong> porç' + (p.quantidade === 1 ? 'ão' : 'ões') + '</span>' +
                '<small class="observacao">' + escapar(p.numero) + '</small>' +
            '</div>' +
            '<h4 class="cz-cartao-titulo">' + escapar(p.prato) + '</h4>' +
            '<p class="observacao">' + escapar(dataBr(p.data_producao)) + (p.observacoes ? ' · ' + escapar(p.observacoes) : '') + '</p>' +
            (faltando.length
                ? '<p class="cz-falta">Falta: ' + escapar(faltando.join(', ')) + '</p>'
                : '<p class="cz-ok">Insumos em estoque</p>') +
            '<div class="cz-cartao-acoes">' +
                '<button type="button" class="botao botao-pequeno" data-acao="concluir-producao" data-id="' + p.id + '">Concluir</button>' +
                '<button type="button" class="botao botao-secundario botao-pequeno" data-acao="editar-producao" data-id="' + p.id + '">Editar</button>' +
                '<button type="button" class="botao-icone perigo" data-acao="cancelar-producao" data-id="' + p.id + '">Cancelar</button>' +
            '</div>' +
        '</article>';
    }

    function planoHtml() {
        const planejadas = producoes.filter(function (p) { return p.status === 'planejada'; });
        if (!planejadas.length) {
            return vazio('Nada planejado. Use "+ Nova produção" ou a sugestão abaixo.');
        }
        const grupos = { atrasadas: [], hoje: [], amanha: [], depois: [] };
        planejadas.forEach(function (p) { grupos[grupoDaData(p.data_producao)].push(p); });
        const titulos = { atrasadas: 'Atrasadas', hoje: 'Hoje', amanha: 'Amanhã', depois: 'Próximos dias' };
        return Object.keys(grupos).filter(function (g) { return grupos[g].length; }).map(function (g) {
            const total = grupos[g].reduce(function (s, p) { return s + p.quantidade; }, 0);
            return '<div class="cz-grupo">' +
                '<h3 class="cz-grupo-titulo' + (g === 'atrasadas' ? ' cz-grupo-atrasado' : '') + '">' + titulos[g] +
                    ' <small>' + grupos[g].length + ' ordem(ns) · ' + total + ' porções</small></h3>' +
                '<div class="cz-grade-producao">' + grupos[g].map(cartaoPlanejada).join('') + '</div>' +
            '</div>';
        }).join('');
    }

    function sugestaoHtml() {
        if (!repor.length) return '';
        return '<div class="table-section cz-sugestao">' +
            '<h3 class="table-title"><span style="background:var(--atencao)"></span>Sugestão: pratos abaixo do mínimo</h3>' +
            '<ul class="cz-lista-sugestao">' + repor.map(function (r) {
                return '<li><div><strong>' + escapar(r.nome) + '</strong><br><small class="observacao">tem ' + r.disponivel +
                    (r.reservado ? ' (' + r.reservado + ' reservadas)' : '') + ' · mínimo ' + r.minimo +
                    (r.vendidos_30d ? ' · ' + r.vendidos_30d + ' vendidas em 30 dias' : '') + '</small></div>' +
                    '<button type="button" class="botao botao-pequeno" data-produzir-prato="' + r.id + '" data-sugestao="' +
                        Math.max(r.minimo * 2 - r.disponivel, 1) + '">Produzir</button></li>';
            }).join('') + '</ul></div>';
    }

    function historicoHtml() {
        const busca = filtro.busca.trim().toLowerCase();
        const lista = producoes.filter(function (p) {
            if (p.status === 'planejada') return false;
            if (filtro.historico && p.status !== filtro.historico) return false;
            return !busca || [p.numero, p.prato, p.observacoes].filter(Boolean).join(' ').toLowerCase().includes(busca);
        });
        const custo = !!estado.config.pode_ver_custo;
        if (!lista.length) return vazio('Nenhuma produção neste filtro.');
        const resto = lista.length - filtro.limite;
        return tabelaHtml({
            colunas: ['Produção', 'Prato', { titulo: 'Porções', classe: 'numero' }, 'Validade']
                .concat(custo ? [{ titulo: 'Custo', classe: 'numero' }] : [])
                .concat(['Situação', { titulo: 'Ações', classe: 'coluna-acoes' }]),
            linhas: lista.slice(0, filtro.limite).map(function (p) {
                return ['<strong class="cz-nowrap">' + escapar(p.numero) + '</strong><br><small class="observacao">' + escapar(dataBr(p.data_producao)) + '</small>',
                        escapar(p.prato) + (p.usuario ? '<br><small class="observacao">' + escapar(p.usuario) + '</small>' : ''),
                        { html: String(p.quantidade) + (p.status === 'concluida' && p.saldo_lote !== null && p.saldo_lote !== undefined
                            ? '<br><small class="observacao">restam ' + p.saldo_lote + '</small>' : ''), classe: 'numero' },
                        p.validade ? escapar(dataBr(p.validade)) : '<small class="observacao">—</small>']
                    .concat(custo ? [{ html: moeda(p.custo_total) + '<br><small class="observacao">' + moeda(p.custo_porcao) + '/porção</small>', classe: 'numero' }] : [])
                    .concat([
                        etiqueta('status_producao', p.status) + (p.motivo_cancelamento ? '<br><small class="observacao">' + escapar(p.motivo_cancelamento) + '</small>' : ''),
                        { classe: 'coluna-acoes', html: '<button type="button" class="botao-icone" data-acao="ver-producao" data-id="' + p.id + '">Detalhe</button>' +
                            (p.status === 'concluida' && p.pode_cancelar
                                ? ' <button type="button" class="botao-icone perigo" data-acao="cancelar-producao" data-id="' + p.id + '">Cancelar</button>' : '') },
                    ]);
            }),
        }) + (resto > 0 ? '<button type="button" class="botao botao-secundario cz-mais" data-mais-producao>Mostrar mais ' +
            Math.min(resto, PAGINA) + ' (de ' + resto + ')</button>' : '');
    }

    function desenhar() {
        const planejadas = producoes.filter(function (p) { return p.status === 'planejada'; });
        const hojeTotal = planejadas.filter(function (p) { return p.data_producao <= hoje(); })
            .reduce(function (s, p) { return s + p.quantidade; }, 0);
        raiz.innerHTML =
            '<div class="secao-topo">' +
                '<div><p class="secao-descricao">O plano da cozinha. Concluir baixa os insumos da ficha técnica (do lote que vence ' +
                    'primeiro) e põe o lote do prato no estoque, com validade.' +
                    (hojeTotal ? ' <strong>Hoje: ' + hojeTotal + ' porções para fazer.</strong>' : '') + '</p></div>' +
                '<div class="grupo-botoes"><button type="button" class="botao" data-acao="nova-producao">+ Nova produção</button></div>' +
            '</div>' +
            '<div class="cz-plano">' + planoHtml() + '</div>' +
            sugestaoHtml() +
            '<div class="table-section">' +
                '<h3 class="table-title"><span style="background:var(--acento)"></span>Histórico</h3>' +
                '<div class="barra-filtros">' +
                    '<input type="search" id="czBuscaProducao" placeholder="Buscar por número ou prato..." value="' + escapar(filtro.busca) + '">' +
                    '<select id="czFiltroProducao" aria-label="Situação">' +
                        [['concluida', 'Concluídas'], ['cancelada', 'Canceladas'], ['', 'Todas']].map(function (o) {
                            return '<option value="' + o[0] + '"' + (filtro.historico === o[0] ? ' selected' : '') + '>' + o[1] + '</option>';
                        }).join('') +
                    '</select>' +
                '</div>' +
                '<div id="czHistoricoProducao">' + historicoHtml() + '</div>' +
            '</div>';
    }

    raiz.addEventListener('input', function (evento) {
        if (evento.target.id !== 'czBuscaProducao') return;
        filtro.busca = evento.target.value;
        filtro.limite = PAGINA;
        document.getElementById('czHistoricoProducao').innerHTML = historicoHtml();
    });
    raiz.addEventListener('change', function (evento) {
        if (evento.target.id !== 'czFiltroProducao') return;
        filtro.historico = evento.target.value;
        filtro.limite = PAGINA;
        document.getElementById('czHistoricoProducao').innerHTML = historicoHtml();
    });
    raiz.addEventListener('click', function (evento) {
        if (evento.target.closest('[data-mais-producao]')) {
            filtro.limite += PAGINA;
            document.getElementById('czHistoricoProducao').innerHTML = historicoHtml();
            return;
        }
        const b = evento.target.closest('[data-produzir-prato]');
        if (b) novaProducao(Number(b.dataset.produzirPrato), Number(b.dataset.sugestao)).catch(function (e) { avisar(e.message, 'erro'); });
    });

    // ------------------------------------------------------------------
    // Necessidade de insumos (ao vivo)
    // ------------------------------------------------------------------
    /*
     * ficha: [{nome, unidade, quantidade|por_porcao, disponivel, custo?}] (por porcao).
     * Devolve a tabela do que sai para N porcoes e do que falta.
     */
    function necessidadeHtml(ficha, porcoes) {
        if (!ficha || !ficha.length) {
            return '<p class="cz-falta">Este prato não tem ficha técnica: nenhum insumo será baixado e o custo fica zero. ' +
                'Cadastre a ficha no Cardápio.</p>';
        }
        const custo = !!estado.config.pode_ver_custo;
        let total = 0;
        let falta = 0;
        const linhas = ficha.map(function (f) {
            const porPorcao = Number(f.por_porcao !== undefined ? f.por_porcao : f.quantidade);
            const precisa = porPorcao * porcoes;
            const tem = Number(f.disponivel) || 0;
            const faltaAqui = Math.max(0, precisa - tem);
            if (faltaAqui) falta++;
            const custoLinha = custo && f.custo !== undefined ? Number(f.custo) * porcoes
                             : (custo && f.custo_previsto !== undefined && f.precisa ? Number(f.custo_previsto) / f.precisa * precisa : null);
            if (custoLinha) total += custoLinha;
            return [escapar(f.nome),
                    { html: escapar(quantidadeLegivel(precisa, f.unidade)) + '<br><small class="observacao">' +
                        escapar(quantidadeLegivel(porPorcao, f.unidade)) + '/porção</small>', classe: 'numero' },
                    { html: '<span class="' + (faltaAqui ? 'saldo-zero' : 'saldo-ok') + '">' + escapar(quantidadeLegivel(tem, f.unidade)) + '</span>' +
                        (faltaAqui ? '<br><small class="saldo-zero">falta ' + escapar(quantidadeLegivel(faltaAqui, f.unidade)) + '</small>' : ''),
                      classe: 'numero' }]
                .concat(custo ? [{ html: custoLinha === null ? '—' : moeda(custoLinha), classe: 'numero' }] : []);
        });
        return tabelaHtml({
            colunas: ['Insumo', { titulo: 'Vai sair', classe: 'numero' }, { titulo: 'Tem no estoque', classe: 'numero' }]
                .concat(custo ? [{ titulo: 'Custo previsto', classe: 'numero' }] : []),
            linhas: linhas,
            total: custo && total ? ['<strong>Total</strong>', '', '', { html: '<strong>' + moeda(total) + '</strong><br><small class="observacao">' +
                moeda(total / Math.max(porcoes, 1)) + '/porção</small>', classe: 'numero' }] : null,
        }) + (falta ? '<p class="cz-falta">Falta insumo para ' + porcoes + ' porções. Dê entrada no estoque ou diminua as porções — ' +
                       'concluir assim é recusado.</p>' : '');
    }

    function porcoesDoCampo(nome) {
        const campo = J.modalCorpo.querySelector('[name="' + nome + '"]');
        return Math.max(0, Math.floor(Number(campo && campo.value) || 0));
    }

    // ------------------------------------------------------------------
    // Nova producao
    // ------------------------------------------------------------------
    async function novaProducao(pratoId, sugestao) {
        const pratos = (await carregarPratos()).filter(function (p) { return p.ativo && p.tipo === 'producao' && !p.feito_na_hora; });
        if (!pratos.length) {
            avisar('Nenhum prato da cozinha com estoque no cardápio. Cadastre o prato (tipo "Produzido na cozinha") no Cardápio.', 'erro');
            return;
        }
        let ficha = null;
        let pratoAtual = null;
        J.abrirModal({
            titulo: 'Nova produção',
            textoSalvar: 'Gravar',
            campos: [
                { nome: 'prato_id', rotulo: 'Prato', tipo: 'select', valor: pratoId ? String(pratoId) : '', largura: 'total',
                  opcoes: [{ valor: '', rotulo: '— escolha o prato —' }].concat(pratos.map(function (p) {
                      return { valor: String(p.id), rotulo: p.nome + ' (tem ' + p.disponivel + ')' };
                  })) },
                { nome: 'quantidade', rotulo: 'Porções', tipo: 'number', valor: sugestao || '', passo: '1', minimo: 1,
                  maximo: estado.config.producao_maxima },
                { nome: 'data_producao', rotulo: 'Data', tipo: 'date', valor: hoje() },
                { nome: 'concluir', rotulo: 'Já está pronto?', tipo: 'checkbox', valor: true, textoSim: 'Sim, concluir agora (baixa os insumos)' },
                { nome: 'validade', rotulo: 'Validade do lote', tipo: 'date', valor: '' },
                { nome: 'lote', rotulo: 'Lote', valor: '', dica: 'Vazio: o número da produção.' },
                { nome: 'observacoes', rotulo: 'Observações', tipo: 'textarea', valor: '', largura: 'total' },
                { nome: '__nec', tipo: 'html', html: '<div class="campo-total cz-necessidade" id="czNecessidade"><p class="observacao">Escolha o prato para ver os insumos.</p></div>' },
            ],
            aoAbrir: function () {
                const sel = J.modalCorpo.querySelector('[name="prato_id"]');
                const qtd = J.modalCorpo.querySelector('[name="quantidade"]');
                const concluir = J.modalCorpo.querySelector('[name="concluir"]');
                const validade = J.modalCorpo.querySelector('[name="validade"]');
                const lote = J.modalCorpo.querySelector('[name="lote"]');
                const alvo = document.getElementById('czNecessidade');
                function redesenharNecessidade() {
                    if (!ficha) return;
                    const n = porcoesDoCampo('quantidade');
                    alvo.innerHTML = n ? '<h4 class="sub-titulo">O que vai sair do estoque</h4>' + necessidadeHtml(ficha, n)
                                       : '<p class="observacao">Informe as porções.</p>';
                }
                async function trocarPrato() {
                    ficha = null;
                    pratoAtual = null;
                    if (!sel.value) { alvo.innerHTML = '<p class="observacao">Escolha o prato para ver os insumos.</p>'; return; }
                    alvo.innerHTML = '<p class="observacao">Carregando a ficha técnica...</p>';
                    try {
                        pratoAtual = (await api.get('/pratos/' + sel.value)).prato;
                        ficha = pratoAtual.ficha || [];
                        if (!validade.dataset.mexeu) validade.value = pratoAtual.validade_dias > 0 ? somarDias(hoje(), pratoAtual.validade_dias) : '';
                        redesenharNecessidade();
                    } catch (erro) {
                        alvo.innerHTML = '<p class="cz-falta">' + escapar(erro.message) + '</p>';
                    }
                }
                function ajustarConcluir() {
                    [validade, lote].forEach(function (c) { c.closest('.campo').classList.toggle('oculta', !concluir.checked); });
                }
                validade.addEventListener('input', function () { validade.dataset.mexeu = '1'; });
                sel.addEventListener('change', trocarPrato);
                qtd.addEventListener('input', redesenharNecessidade);
                concluir.addEventListener('change', ajustarConcluir);
                ajustarConcluir();
                if (sel.value) trocarPrato();
            },
            aoSalvar: async function (v) {
                if (!v.prato_id) throw new Error('Escolha o prato.');
                const corpo = { prato_id: v.prato_id, quantidade: v.quantidade, data_producao: v.data_producao, observacoes: v.observacoes,
                                concluir: v.concluir ? 1 : 0 };
                if (v.concluir) {
                    corpo.validade = v.validade;
                    if (v.lote) corpo.lote = v.lote;
                }
                avisar(mensagemDe(await api.post('/producoes', corpo), 'Produção gravada.'));
                await carregar();
            },
        });
    }

    // ------------------------------------------------------------------
    // Concluir, editar, cancelar, detalhe
    // ------------------------------------------------------------------
    async function concluirProducao(id) {
        const p = (await api.get('/producoes/' + id)).producao;
        const ficha = (p.necessidade || []).map(function (n) {
            return { nome: n.nome, unidade: n.unidade, por_porcao: n.por_porcao, disponivel: n.disponivel,
                     custo: n.custo_previsto !== undefined && n.precisa ? n.custo_previsto / n.precisa * n.por_porcao : undefined };
        });
        J.abrirModal({
            titulo: 'Concluir ' + p.numero + ' — ' + p.prato,
            textoSalvar: 'Concluir produção',
            campos: [
                { nome: 'quantidade', rotulo: 'Porções que saíram da panela', tipo: 'number', valor: p.quantidade, passo: '1', minimo: 1,
                  maximo: estado.config.producao_maxima, dica: 'Planejado: ' + p.quantidade + '. Vale o que rendeu de verdade.' },
                { nome: 'validade', rotulo: 'Validade do lote', tipo: 'date',
                  valor: p.validade_dias > 0 ? somarDias(hoje(), p.validade_dias) : '',
                  dica: p.validade_dias > 0 ? 'Hoje + ' + p.validade_dias + ' dias (' + N.rotuloDe('conservacoes', p.conservacao).toLowerCase() + ').' : 'O prato não tem validade padrão.' },
                { nome: 'lote', rotulo: 'Lote', valor: p.numero },
                { nome: '__nec', tipo: 'html', html: '<div class="campo-total cz-necessidade" id="czNecessidade"></div>' },
            ],
            aoAbrir: function () {
                const alvo = document.getElementById('czNecessidade');
                function redesenhar() {
                    const n = porcoesDoCampo('quantidade');
                    alvo.innerHTML = '<h4 class="sub-titulo">O que vai sair do estoque</h4>' + (n ? necessidadeHtml(ficha, n) : '');
                }
                J.modalCorpo.querySelector('[name="quantidade"]').addEventListener('input', redesenhar);
                redesenhar();
            },
            aoSalvar: async function (v) {
                avisar(mensagemDe(await api.post('/producoes/' + id + '/concluir', v), 'Produção concluída.'));
                await carregar();
            },
        });
    }

    function editarProducao(id) {
        const p = producoes.find(function (x) { return x.id === id; });
        if (!p) return;
        J.abrirModal({
            titulo: 'Editar ' + p.numero + ' — ' + p.prato,
            campos: [
                { nome: 'quantidade', rotulo: 'Porções', tipo: 'number', valor: p.quantidade, passo: '1', minimo: 1, maximo: estado.config.producao_maxima },
                { nome: 'data_producao', rotulo: 'Data', tipo: 'date', valor: p.data_producao },
                { nome: 'observacoes', rotulo: 'Observações', tipo: 'textarea', valor: p.observacoes || '', largura: 'total' },
            ],
            aoSalvar: async function (v) {
                avisar(mensagemDe(await api.put('/producoes/' + id, v), 'Produção atualizada.'));
                await carregar();
            },
        });
    }

    function cancelarProducao(id) {
        const p = producoes.find(function (x) { return x.id === id; });
        if (!p) return;
        J.abrirModal({
            titulo: 'Cancelar ' + p.numero + ' — ' + p.prato,
            textoSalvar: 'Cancelar produção',
            campos: [
                { nome: '__aviso', tipo: 'html', html: '<p class="campo-total observacao">' + (p.status === 'concluida'
                    ? 'A produção já foi concluída: o lote sai do estoque e os insumos voltam. Só passa se nenhuma porção do lote saiu.'
                    : 'A ordem sai do plano. Nada no estoque muda.') + '</p>' },
                { nome: 'motivo', rotulo: 'Motivo', valor: '', obrigatorio: true, largura: 'total' },
            ],
            aoSalvar: async function (v) {
                avisar(mensagemDe(await api.post('/producoes/' + id + '/cancelar', v), 'Produção cancelada.'));
                await carregar();
            },
        });
    }

    async function verProducao(id) {
        const p = (await api.get('/producoes/' + id)).producao;
        const custo = !!estado.config.pode_ver_custo;
        let corpo;
        if (p.status === 'planejada') {
            corpo = necessidadeHtml((p.necessidade || []).map(function (n) {
                return { nome: n.nome, unidade: n.unidade, por_porcao: n.por_porcao, disponivel: n.disponivel };
            }), p.quantidade);
        } else {
            const consumo = p.consumo || [];
            corpo = consumo.length ? tabelaHtml({
                colunas: ['Insumo', 'Lote usado', { titulo: 'Quantidade', classe: 'numero' }].concat(custo ? [{ titulo: 'Custo', classe: 'numero' }] : []),
                linhas: consumo.map(function (c) {
                    return [escapar(c.nome), escapar((c.lote ? 'lote ' + c.lote : 'lote #' + c.entrada_id) + (c.validade ? ' · val. ' + dataCurta(c.validade) : '')),
                            { html: escapar(quantidadeLegivel(c.quantidade, c.unidade)), classe: 'numero' }]
                        .concat(custo ? [{ html: moeda(c.subtotal), classe: 'numero' }] : []);
                }),
                total: custo ? ['<strong>Total</strong>', '', '', { html: '<strong>' + moeda(p.custo_total) + '</strong>', classe: 'numero' }] : null,
            }) : vazio('Nenhum insumo foi baixado (o prato não tinha ficha técnica).');
        }
        J.abrirModal({
            titulo: p.numero + ' — ' + p.prato,
            somenteLeitura: true,
            html: '<div class="campo-total">' +
                '<div class="lista-dados cz-dados">' +
                    '<div><span>Situação</span><strong>' + etiqueta('status_producao', p.status) + '</strong></div>' +
                    '<div><span>Porções</span><strong>' + p.quantidade + '</strong></div>' +
                    '<div><span>Data</span><strong>' + escapar(dataBr(p.data_producao)) + '</strong></div>' +
                    (p.validade ? '<div><span>Validade do lote</span><strong>' + escapar(dataBr(p.validade)) + '</strong></div>' : '') +
                    (p.status === 'concluida' ? '<div><span>Restam no lote</span><strong>' + (p.saldo_lote || 0) + '</strong></div>' : '') +
                    (custo && p.status === 'concluida' ? '<div><span>Custo por porção</span><strong>' + moeda(p.custo_porcao) + '</strong></div>' : '') +
                    (p.usuario ? '<div><span>Quem lançou</span><strong>' + escapar(p.usuario) + '</strong></div>' : '') +
                    (p.motivo_cancelamento ? '<div><span>Motivo do cancelamento</span><strong>' + escapar(p.motivo_cancelamento) + '</strong></div>' : '') +
                '</div>' +
                '<h4 class="sub-titulo">' + (p.status === 'planejada' ? 'O que vai sair do estoque' : 'O que saiu do estoque') + '</h4>' + corpo +
            '</div>',
        });
    }

    N.registrarAcoes({
        'nova-producao': function () { return novaProducao(null, null); },
        'concluir-producao': concluirProducao,
        'editar-producao': editarProducao,
        'cancelar-producao': cancelarProducao,
        'ver-producao': verProducao,
    });

    N.registrarTela('producao', { titulo: 'Produção', carregar: carregar });
    janela.Telas = janela.Telas || {};
    janela.Telas.producao = { carregar: carregar, novaProducao: novaProducao };
})(window);
