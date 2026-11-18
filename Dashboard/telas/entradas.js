// carga: usa Formato, Nucleo, Janela; publica Telas.entradas  (conferido por testes/front/carga.test.js)
/*
 * telas/entradas.js - ESTOQUE: os lotes que estao na cozinha (insumos e
 * pratos prontos), com validade, saldo e custo. Window.Telas.entradas.
 *
 *   abas      Pratos prontos | Insumos | Todos os lotes
 *   no topo   vencendo, vencidos (com "Baixar vencidos"), insumos abaixo
 *             do minimo, porcoes prontas
 *   acoes     + Nova entrada (abre a tela Entradas: e o UNICO caminho de
 *             mercadoria para o estoque, desde a v2), Movimentar, e por
 *             lote: Movimentar, Historico, Editar, Excluir (admin, so lote
 *             avulso antigo sem saida). A origem mostra o documento:
 *             "Entrada PE-..." abre a entrada; "Producao OP-..." a producao.
 *
 * O saldo e a validade vem do servidor (vw_entradas): a tela so mostra.
 * Insumo e guardado na unidade base (g, ml, un); a tela mostra "2,5 kg"
 * e o formulario deixa digitar em kg ou L (Telas.movimentacao.campoQuantidade).
 */
(function (janela) {
    'use strict';

    const { escapar, moeda, dataCurta, dataBr } = janela.Formato;
    const N = janela.Nucleo;
    const { api, estado, mensagemDe, avisar, rotuloDe, etiqueta, vazio, opcoesDe,
            tabelaHtml, quantidadeLegivel, situacaoDoLote, textoValidade, carregarCatalogos } = N;
    const J = janela.Janela;
    const M = function () { return janela.Telas.movimentacao; };

    const raiz = document.getElementById('entradasConteudo');
    const PAGINA = 60;
    const filtro = { aba: 'pratos', busca: '', situacao: '', comSaldo: true, limite: PAGINA };
    let lotes = [];
    let resumo = null;

    function unidade(e) { return e.tipo === 'prato' ? 'porcao' : (e.unidade || 'un'); }

    /* Custo por unidade de compra: R$/kg, R$/L, R$/un, R$/porção. */
    function custoPorUnidade(custoUnitario, base) {
        const c = Number(custoUnitario) || 0;
        if (base === 'g') return moeda(c * 1000) + '/kg';
        if (base === 'ml') return moeda(c * 1000) + '/L';
        if (base === 'porcao') return moeda(c) + '/porção';
        return moeda(c) + '/un';
    }

    // ------------------------------------------------------------------
    // Carregar e desenhar
    // ------------------------------------------------------------------
    async function carregar() {
        const r = await Promise.all([api.get('/entradas'), api.get('/resumo')]);
        lotes = r[0].itens;
        resumo = r[1];
        desenhar();
    }

    function filtrados() {
        const busca = filtro.busca.trim().toLowerCase();
        return lotes.filter(function (e) {
            if (filtro.aba === 'pratos' && e.tipo !== 'prato') return false;
            if (filtro.aba === 'insumos' && e.tipo !== 'insumo') return false;
            if (filtro.comSaldo && Number(e.saldo) <= 0) return false;
            if (filtro.situacao && situacaoDoLote(e) !== filtro.situacao) return false;
            if (busca) {
                const texto = [e.item, e.lote, e.fornecedor, e.producao_numero, e.nota_fiscal, e.observacoes, e.categoria]
                    .filter(Boolean).join(' ').toLowerCase();
                if (!texto.includes(busca)) return false;
            }
            return true;
        });
    }

    function topoHtml() {
        const c = (resumo && resumo.cards) || {};
        const falta = (resumo && resumo.insumos) || [];
        const cards = [
            '<button type="button" class="cz-alerta' + (c.lotes_vencidos ? ' cz-alerta-grave' : '') + '" data-ver-situacao="vencido">' +
                '<strong>' + (c.lotes_vencidos || 0) + '</strong><span>' + (c.lotes_vencidos === 1 ? 'lote vencido' : 'lotes vencidos') + '</span>' +
                (c.lotes_vencidos ? '<em>não vendem nem vão para a panela</em>' : '<em>nada vencido</em>') + '</button>',
            '<button type="button" class="cz-alerta' + (c.lotes_vencendo ? ' cz-alerta-atencao' : '') + '" data-ver-situacao="vencendo">' +
                '<strong>' + (c.lotes_vencendo || 0) + '</strong><span>vencendo em até ' + estado.config.validade_alerta_dias + ' dias</span>' +
                '<em>use ou venda primeiro</em></button>',
            '<div class="cz-alerta' + (falta.length ? ' cz-alerta-atencao' : '') + '">' +
                '<strong>' + falta.length + '</strong><span>' + (falta.length === 1 ? 'insumo abaixo do mínimo' : 'insumos abaixo do mínimo') + '</span>' +
                '<em>' + escapar(falta.slice(0, 3).map(function (i) { return i.nome; }).join(', ') || 'tudo em dia') +
                    (falta.length > 3 ? '…' : '') + '</em></div>',
            '<div class="cz-alerta cz-alerta-bom"><strong>' + (c.porcoes_prontas || 0) + '</strong><span>porções prontas para vender</span>' +
                '<em>' + (c.pratos_sem_estoque || 0) + ' prato(s) sem estoque</em></div>',
        ];
        let valor = '';
        if (estado.config.pode_ver_custo && resumo && resumo.estoque_valor) {
            valor = '<p class="observacao cz-valor-parado">Dinheiro parado no estoque: <strong>' +
                moeda(resumo.estoque_valor.insumos + resumo.estoque_valor.pratos) + '</strong> (insumos ' + moeda(resumo.estoque_valor.insumos) +
                ' · pratos prontos ' + moeda(resumo.estoque_valor.pratos) + ')</p>';
        }
        return '<div class="cz-alertas">' + cards.join('') + '</div>' +
            (c.lotes_vencidos ? '<div class="cz-faixa-vencidos"><span>Há lote vencido com saldo. Dê baixa para o estoque ficar certo e a perda entrar no resultado.</span>' +
                '<button type="button" class="botao botao-pequeno botao-perigo-suave" data-acao="baixar-vencidos">Baixar vencidos</button></div>' : '') +
            valor;
    }

    function linhaLote(e) {
        const s = situacaoDoLote(e);
        const u = unidade(e);
        const origem = e.producao_numero ? 'Produção <span class="cz-nowrap">' + escapar(e.producao_numero) + '</span>'
            : e.pedido_id ? '<button type="button" class="botao-link" data-acao="ver-documento-entrada" data-id="' + e.pedido_id + '" title="Abrir a entrada">' +
                'Entrada <span class="cz-nowrap">' + escapar(e.pedido) + '</span></button>' +
                (e.fornecedor ? '<br><small class="observacao">' + escapar(e.fornecedor) + '</small>' : '')
            : escapar(e.fornecedor || 'Lançamento avulso');
        // Lote de documento (entrada ou producao) se desfaz cancelando o documento: o servidor recusa o Excluir.
        const excluivel = estado.config.pode_excluir && !e.pedido_id && !e.producao_numero;
        const custo = estado.config.pode_ver_custo && e.custo_unitario !== undefined;
        return [
            '<strong>' + escapar(e.item) + '</strong>' +
                (filtro.aba === 'todos' ? ' ' + etiqueta('tipos_entrada', e.tipo) : '') +
                '<br><small class="observacao">' + escapar([e.lote ? 'lote ' + e.lote : null, e.tipo === 'insumo' ? rotuloDe('categorias_insumo', e.categoria) : e.categoria]
                    .filter(Boolean).join(' · ') || '—') + '</small>',
            etiqueta('situacoes_lote', s) + '<br><small class="observacao">' + escapar(e.validade ? dataBr(e.validade) + ' · ' + textoValidade(e.dias_validade) : 'sem validade') + '</small>',
            { html: '<strong class="cz-nowrap ' + (Number(e.saldo) <= 0 ? 'saldo-zero' : (s === 'vencido' ? 'saldo-zero' : 'saldo-ok')) + '">' +
                escapar(quantidadeLegivel(e.saldo, u)) + '</strong><br><small class="observacao cz-nowrap">de ' +
                escapar(u === 'porcao' ? String(e.quantidade) : quantidadeLegivel(e.quantidade, u)) + '</small>',
              classe: 'numero' },
        ].concat(custo ? [{ html: escapar(custoPorUnidade(e.custo_unitario, u)) + '<br><small class="observacao">lote ' + moeda(e.custo_total) + '</small>',
                            classe: 'numero' }] : []).concat([
            origem + '<br><small class="observacao">entrou ' + escapar(dataCurta(e.data_entrada)) + '</small>',
            { classe: 'coluna-acoes', html:
                '<button type="button" class="botao-icone" data-acao="movimentar-lote" data-id="' + e.id + '">Movimentar</button> ' +
                '<button type="button" class="botao-icone" data-acao="historico-lote" data-id="' + e.id + '">Histórico</button> ' +
                '<button type="button" class="botao-icone" data-acao="editar-lote" data-id="' + e.id + '">Editar</button>' +
                (excluivel ? ' <button type="button" class="botao-icone perigo" data-acao="excluir-lote" data-id="' + e.id + '">Excluir</button>' : '') },
        ]);
    }

    function desenhar() {
        const lista = filtrados();
        const custo = !!estado.config.pode_ver_custo;
        const contagem = { pratos: 0, insumos: 0, todos: 0 };
        lotes.forEach(function (e) {
            if (Number(e.saldo) <= 0) return;
            contagem.todos++;
            contagem[e.tipo === 'prato' ? 'pratos' : 'insumos']++;
        });
        raiz.innerHTML =
            '<div class="secao-topo">' +
                '<div><p class="secao-descricao">Os lotes na cozinha. Venda e produção usam sempre o lote que vence primeiro; ' +
                'lote vencido não sai — dê baixa.</p></div>' +
                '<div class="grupo-botoes">' +
                    '<button type="button" class="botao" data-acao="estoque-nova-entrada" title="Abre a tela Entradas: nota do fornecedor ou compra digitada">+ Nova entrada</button>' +
                    '<button type="button" class="botao botao-secundario" data-acao="nova-movimentacao" title="Vencimento, perda, degustação, ajuste">Movimentar</button>' +
                '</div>' +
            '</div>' +
            topoHtml() +
            '<div class="sub-abas cz-abas">' +
                [['pratos', 'Pratos prontos'], ['insumos', 'Insumos'], ['todos', 'Todos os lotes']].map(function (a) {
                    return '<button type="button" class="sub-aba' + (filtro.aba === a[0] ? ' ativa' : '') + '" data-aba-estoque="' + a[0] + '">' +
                        escapar(a[1]) + ' <span class="cz-contagem">' + contagem[a[0]] + '</span></button>';
                }).join('') +
            '</div>' +
            '<div class="barra-filtros">' +
                '<input type="search" id="czBuscaEstoque" placeholder="Buscar por item, lote, fornecedor, produção..." value="' + escapar(filtro.busca) + '">' +
                '<select id="czSituacaoEstoque" aria-label="Situação">' +
                    [['', 'Qualquer situação'], ['ok', 'No prazo'], ['vencendo', 'Vencendo'], ['vencido', 'Vencido'], ['esgotado', 'Esgotado']].map(function (o) {
                        return '<option value="' + o[0] + '"' + (filtro.situacao === o[0] ? ' selected' : '') + '>' + escapar(o[1]) + '</option>';
                    }).join('') +
                '</select>' +
                '<label class="cz-check"><input type="checkbox" id="czComSaldo"' + (filtro.comSaldo ? ' checked' : '') + '> Só com saldo</label>' +
            '</div>' +
            '<div class="table-section" id="czListaEstoque">' + listaHtml(lista) + '</div>';
    }

    function listaHtml(lista) {
        const custo = !!estado.config.pode_ver_custo;
        return (lista.length ? tabelaHtml({
                    colunas: ['Item', 'Validade', { titulo: 'Saldo', classe: 'numero' }]
                        .concat(custo ? [{ titulo: 'Custo', classe: 'numero' }] : [])
                        .concat(['Origem', { titulo: 'Ações', classe: 'coluna-acoes' }]),
                    linhas: lista.slice(0, filtro.limite).map(function (e) {
                        const s = situacaoDoLote(e);
                        return { celulas: linhaLote(e), classe: s === 'vencido' ? 'cz-linha-vencida' : (s === 'vencendo' ? 'cz-linha-vencendo' : '') };
                    }),
                }) + (lista.length > filtro.limite ? '<button type="button" class="botao botao-secundario cz-mais" data-mais-lotes>Mostrar mais ' +
                    Math.min(lista.length - filtro.limite, PAGINA) + ' (de ' + (lista.length - filtro.limite) + ')</button>' : '')
                : vazio(lotes.length ? 'Nenhum lote com estes filtros.' : 'O estoque está vazio. Comece por "+ Nova entrada".'));
    }

    function desenharLista() {
        const alvo = document.getElementById('czListaEstoque');
        if (alvo) alvo.innerHTML = listaHtml(filtrados());
        else desenhar();
    }

    raiz.addEventListener('click', function (evento) {
        if (evento.target.closest('[data-mais-lotes]')) {
            filtro.limite += PAGINA;
            desenharLista();
            return;
        }
        const aba = evento.target.closest('[data-aba-estoque]');
        if (aba) {
            filtro.limite = PAGINA;
            filtro.aba = aba.dataset.abaEstoque;
            desenhar();
            return;
        }
        const sit = evento.target.closest('[data-ver-situacao]');
        if (sit) {
            filtro.situacao = sit.dataset.verSituacao;
            filtro.aba = 'todos';
            filtro.comSaldo = true;
            desenhar();
        }
    });
    raiz.addEventListener('input', function (evento) {
        if (evento.target.id !== 'czBuscaEstoque') return;
        filtro.busca = evento.target.value;
        filtro.limite = PAGINA;
        desenharLista();
    });
    raiz.addEventListener('change', function (evento) {
        if (evento.target.id === 'czSituacaoEstoque') { filtro.situacao = evento.target.value; desenharLista(); }
        if (evento.target.id === 'czComSaldo') { filtro.comSaldo = evento.target.checked; desenharLista(); }
    });

    // ------------------------------------------------------------------
    // Formularios
    // ------------------------------------------------------------------
    /*
     * Entrada NAO se lanca aqui (v2): toda mercadoria entra pela tela Entradas
     * (o documento com natureza, CFOP e contas). Aqui o lote so e consultado,
     * movimentado (perda, vencimento, ajuste) e corrigido no que nao e conta.
     */
    async function editarLote(id) {
        const r = await Promise.all([api.get('/entradas/' + id), carregarCatalogos()]);
        const e = r[0].entrada;
        const u = unidade(e);
        const origem = e.producao_numero ? 'a produção ' + e.producao_numero : (e.pedido ? 'a entrada ' + e.pedido : null);
        const custo = !!estado.config.pode_ver_custo;
        J.abrirModal({
            titulo: 'Lote: ' + e.item,
            campos: [
                { nome: '__origem', tipo: 'html', html: origem
                    ? '<p class="observacao campo-total">Este lote veio d' + escapar(origem) + ': quantidade e custo seguem o documento. ' +
                      'Para corrigir, cancele o documento e lance de novo.</p>' : '' },
                { tipo: 'html', nome: '__qtd', html: origem ? '<div class="campo"><label>Quantidade</label><input value="' +
                    escapar(quantidadeLegivel(e.quantidade, u)) + '" readonly></div>'
                    : M().campoQuantidade('quantidade', e.tipo === 'prato' ? 'Porções do lote' : 'Quantidade do lote', u, e.quantidade,
                        'Não pode ficar menor que o que já saiu.') },
            ].concat(custo ? [{ nome: 'custo_total', rotulo: 'Custo total do lote (R$)', tipo: 'number', valor: e.custo_total, minimo: 0,
                                desabilitado: !!origem }] : []).concat([
                { nome: 'validade', rotulo: 'Validade', tipo: 'date', valor: e.validade || '' },
                { nome: 'lote', rotulo: 'Lote', valor: e.lote || '' },
                { nome: 'fornecedor_id', rotulo: 'Fornecedor', tipo: 'select', valor: e.fornecedor_id ? String(e.fornecedor_id) : '',
                  opcoes: opcoesDe(estado.fornecedores, function (f) { return f.nome; }, '— não informado —') },
                { nome: 'nota_fiscal', rotulo: 'Nota fiscal', valor: e.nota_fiscal || '' },
                { nome: 'observacoes', rotulo: 'Observações', tipo: 'textarea', valor: e.observacoes || '', largura: 'total' },
            ]),
            aoSalvar: async function (v) {
                const corpo = { validade: v.validade, lote: v.lote, fornecedor_id: v.fornecedor_id, nota_fiscal: v.nota_fiscal,
                                observacoes: v.observacoes };
                if (!origem) {
                    const q = M().lerQuantidade('quantidade');
                    if (!q || q < 1) throw new Error('Informe a quantidade do lote.');
                    corpo.quantidade = q;
                    if (custo) corpo.custo_total = v.custo_total || 0;
                }
                avisar(mensagemDe(await api.put('/entradas/' + id, corpo), 'Lote atualizado.'));
                await carregar();
            },
        });
    }

    async function baixarVencidos() {
        const vencidos = lotes.filter(function (e) { return situacaoDoLote(e) === 'vencido'; });
        const lista = vencidos.slice(0, 8).map(function (e) { return '• ' + e.item + ': ' + quantidadeLegivel(e.saldo, unidade(e)); }).join('\n');
        if (!confirm('Dar baixa por vencimento em ' + vencidos.length + ' lote(s)?\n\n' + lista +
                     (vencidos.length > 8 ? '\n…' : '') + '\n\nO saldo vai a zero e o custo entra como perda.')) return;
        avisar(mensagemDe(await api.post('/movimentacoes', { baixar_vencidos: 1 }), 'Vencidos baixados.'));
        await carregar();
    }

    function loteDe(id) { return lotes.find(function (e) { return e.id === id; }); }

    N.registrarAcoes({
        'estoque-nova-entrada': function () { return janela.Telas.pedidos.novaEntrada(); },
        'ver-documento-entrada': function (id) { return janela.Telas.pedidos.abrirEntrada(id); },
        'movimentar-lote': function (id) { return M().abrir({ entrada_id: id, depois: carregar }); },
        'historico-lote': function (id) {
            const e = loteDe(id);
            return M().ficha({ entrada_id: id }, e ? e.item : '');
        },
        'editar-lote': editarLote,
        'excluir-lote': async function (id) {
            const e = loteDe(id);
            if (!confirm('Excluir o lote de "' + (e ? e.item : '') + '"? Só dá para excluir lote que ainda não teve saída.')) return;
            avisar(mensagemDe(await api.remover('/entradas/' + id), 'Lote excluído.'));
            await carregar();
        },
        'baixar-vencidos': baixarVencidos,
    });

    N.registrarTela('entradas', { titulo: 'Estoque', carregar: carregar });
    janela.Telas = janela.Telas || {};
    janela.Telas.entradas = { carregar: carregar };
})(window);
