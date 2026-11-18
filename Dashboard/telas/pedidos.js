// carga: usa Formato, Nucleo; publica Telas.pedidos  (conferido por testes/front/carga.test.js)
/*
 * telas/pedidos.js - ENTRADAS: o pedido de entrada (a nota do fornecedor).
 * Window.Telas.pedidos. Desde a v2 e o UNICO jeito de por mercadoria no
 * estoque (a entrada avulsa do Estoque saiu): o documento leva natureza,
 * CFOP e as contas, e o lote nasce dele. O Estoque so consulta e movimenta.
 *
 *   lista    as entradas, "+ Nova entrada" e "Importar XML da NF-e"
 *   editor   o rascunho: natureza, fornecedor, nota, linhas, parcelas;
 *            Salvar, Confirmar (a pagar ou "Já paguei"), Apagar.
 *            Confirmado/cancelado: so leitura, com os lotes e as contas que
 *            a confirmacao criou, e o Cancelar (admin, com motivo).
 *   novaEntrada({ tipo_item, insumo_id | prato_id })  abre uma entrada nova
 *            com a linha ja escolhida (atalhos do Cadastro e do Cardapio).
 *
 * Cada linha diz O QUE e (insumo ou prato pronto de revenda) e QUAL item
 * do catalogo; sem item escolhido, a confirmacao cria um novo com o nome da
 * nota. A quantidade e a da NOTA (2,5 KG) e o fator converte para a unidade
 * do estoque (1 KG = 1000 g): o lote entra com quantidade x fator, e a tela
 * mostra a conta ao vivo. Quem confere tudo e o servidor (api/rotas/pedidos.php).
 */
(function (janela) {
    'use strict';

    const { escapar, moeda, dataCurta, emCentavos, deCentavos, hoje, somarDias } = janela.Formato;
    const N = janela.Nucleo;
    const { api, estado, avisar, mensagemDe, rotuloDe, etiquetaTexto, tabelaHtml, vazio, carregarCatalogos, carregarPratos,
            quantidadeLegivel } = N;

    const raiz = document.getElementById('pedidosConteudo');
    const COR_STATUS = { rascunho: '--atencao', confirmado: '--bom', cancelado: '--tinta-fraca' };
    let lista = [];
    let naturezas = [];
    let cfops = [];
    let atual = null;          // o pedido aberto no editor (objeto em memoria)
    let filtro = 'todos';

    const fmtCfop = function (c) { return c ? String(c).charAt(0) + '.' + String(c).slice(1) : '—'; };
    const num = function (v) { const n = Number(v); return isFinite(n) ? n : 0; };
    function podeConfirmar() {
        return !!estado.config.pode_admin || !!(estado.config.chaves || {})['pedido.confirmar_equipe'];
    }

    // ------------------------------------------------------------------
    // Lista
    // ------------------------------------------------------------------
    function desenharLista() {
        const itens = lista.filter(function (p) {
            return filtro === 'todos' || (filtro === 'abertos' ? p.status === 'rascunho' : p.status === filtro);
        });
        raiz.innerHTML =
            '<div class="secao-topo"><div><p class="secao-descricao">Tudo o que chega na cozinha entra por aqui: insumos e pratos de revenda. ' +
                'Importe o XML da nota do fornecedor ou digite (compra no mercado também), diga o que é cada linha e quanto vira no estoque ' +
                '(2,5 KG = 2500 g) e confirme: vira lote com validade e conta a pagar (ou já paga).</p></div>' +
                '<div class="pedido-acoes-topo">' +
                    '<label class="botao botao-secundario" for="pedidoXml">Importar XML da NF-e</label>' +
                    '<input type="file" id="pedidoXml" accept=".xml,text/xml,application/xml" class="oculto-visual">' +
                    '<button type="button" class="botao" data-pedido="novo">+ Nova entrada</button>' +
                '</div></div>' +
            '<div class="barra-filtros"><select id="filtroPedido" aria-label="Situação">' +
                [['abertos', 'Rascunhos'], ['confirmado', 'Confirmados'], ['cancelado', 'Cancelados'], ['todos', 'Todos']].map(function (f) {
                    return '<option value="' + f[0] + '"' + (f[0] === filtro ? ' selected' : '') + '>' + f[1] + '</option>';
                }).join('') + '</select></div>' +
            '<div class="table-section">' +
            (itens.length
                ? tabelaHtml({
                    colunas: ['Número', 'Fornecedor', 'Nota', 'Natureza', { titulo: 'Total', classe: 'numero' }, 'Data', 'Situação',
                              { titulo: 'Ações', classe: 'coluna-acoes' }],
                    linhas: itens.map(function (p) {
                        return [escapar(p.numero) + '<br><small class="observacao">' + p.itens + ' linha(s)</small>',
                                escapar(p.fornecedor || '—'),
                                p.nota_numero ? 'NF ' + escapar(p.nota_numero) + (p.nota_serie ? '/' + escapar(p.nota_serie) : '') : '<small class="observacao">sem nota</small>',
                                escapar(p.natureza) + '<br><small class="observacao">CFOP ' + fmtCfop(p.cfop) + '</small>',
                                { html: moeda(p.valor_total), classe: 'numero' },
                                dataCurta(p.data_entrada),
                                etiquetaTexto(rotuloDe('status_pedido', p.status), COR_STATUS[p.status]),
                                { classe: 'coluna-acoes', html: '<button type="button" class="botao-icone" data-pedido="abrir" data-id="' + p.id + '">' +
                                    (p.status === 'rascunho' ? 'Abrir' : 'Ver') + '</button>' }];
                    }),
                })
                : vazio(filtro === 'abertos' ? 'Nenhum rascunho. Importe o XML da nota do fornecedor ou use "+ Nova entrada".' : 'Nenhuma entrada aqui.')) +
            '</div>';
    }

    async function carregarLista() {
        lista = (await api.get('/pedidos')).itens;
        atual = null;
        desenharLista();
    }

    // ------------------------------------------------------------------
    // Editor
    // ------------------------------------------------------------------
    function novoPedido() {
        const compra = naturezas.find(function (n) { return n.codigo === 'COMPRA_INSUMO' && n.ativa; }) ||
                       naturezas.find(function (n) { return n.sentido === 'entrada' && n.ativa; });
        return { id: null, status: 'rascunho', numero: 'Nova entrada', natureza_id: compra ? compra.id : '', fornecedor_id: '', cfop: '',
                 nota_numero: '', nota_serie: '', nota_chave: '', nota_emissao: '', valor_frete: 0, valor_outros: 0,
                 gerar_financeiro: 1, forma_pagamento_id: '', observacoes: '', lista_itens: [], parcelas: [], lancamentos: [] };
    }

    function linhaVazia() {
        return { tipo_item: 'insumo', insumo_id: '', prato_id: '', descricao: '', codigo_fornecedor: '', ncm: '', unidade: 'KG',
                 quantidade: 1, fator: 1000, valor_total: 0, valor_desconto: 0, lote: '', validade: '' };
    }

    function totais() {
        const c = { produtos: 0, desconto: 0 };
        atual.lista_itens.forEach(function (i) { c.produtos += emCentavos(i.valor_total); c.desconto += emCentavos(i.valor_desconto); });
        const total = c.produtos - c.desconto + emCentavos(atual.valor_frete) + emCentavos(atual.valor_outros);
        const parcelas = atual.parcelas.reduce(function (s, p) { return s + emCentavos(p.valor); }, 0);
        return { produtos: deCentavos(c.produtos), desconto: deCentavos(c.desconto), total: deCentavos(total), parcelas: deCentavos(parcelas) };
    }

    function opcoes(lista2, valor, rotulo, vazioTexto) {
        return '<option value="">' + escapar(vazioTexto) + '</option>' + lista2.map(function (x) {
            return '<option value="' + escapar(x.id) + '"' + (String(x.id) === String(valor) ? ' selected' : '') + '>' + escapar(rotulo(x)) + '</option>';
        }).join('');
    }

    function catalogoDoTipo(tipo) {
        if (tipo === 'insumo') {
            return { lista: estado.insumos.filter(function (x) { return x.ativo; }), campo: 'insumo_id',
                     rotulo: function (x) { return x.nome + ' (' + x.unidade + ')'; } };
        }
        if (tipo === 'prato') {
            return { lista: estado.pratos.filter(function (x) { return !x.feito_na_hora; }), campo: 'prato_id',
                     rotulo: function (x) { return x.nome + (x.tipo === 'revenda' ? '' : ' (produzido)'); } };
        }
        return null;
    }

    /* A unidade do estoque que combina com a da nota (a mesma regra do servidor: unidadeDoEstoque). */
    function unidadePelaNota(u) {
        u = String(u || '').trim().toUpperCase();
        if (['KG', 'KGS', 'KILO', 'G', 'GR', 'GRS'].indexOf(u) !== -1) return 'g';
        return ['L', 'LT', 'LTS', 'LITRO', 'ML'].indexOf(u) !== -1 ? 'ml' : 'un';
    }

    /* Fator sugerido: 1 KG = 1000 g, 1 L = 1000 ml; o resto, 1 (a caixa a cozinha confere). */
    function fatorSugerido(unidadeNota, unidadeEstoque) {
        const u = String(unidadeNota || '').trim().toUpperCase();
        const mil = ['KG', 'KGS', 'KILO', 'L', 'LT', 'LTS', 'LITRO'].indexOf(u) !== -1;
        return mil && unidadeEstoque !== 'un' ? 1000 : 1;
    }

    /* A unidade em que o lote desta linha vai entrar no estoque. */
    function unidadeDaLinha(i) {
        if (i.tipo_item === 'prato') return 'porcao';
        const insumo = estado.insumos.find(function (x) { return String(x.id) === String(i.insumo_id); });
        return insumo ? insumo.unidade : unidadePelaNota(i.unidade);
    }

    /* "= 2,5 kg no estoque" (ou o aviso de que a conta nao fecha num numero inteiro). */
    function textoEstoque(i) {
        if (!i.tipo_item) return { texto: 'Diga se é insumo ou prato para ligar ao estoque.', erro: true };
        const q = num(String(i.quantidade).replace(',', '.')) * Math.max(1, Math.round(num(i.fator) || 1));
        if (q <= 0) return { texto: 'Informe a quantidade da nota.', erro: true };
        if (Math.abs(q - Math.round(q)) > 0.01) {
            return { texto: 'Quantidade × fator = ' + String(q).replace('.', ',') + ': não fecha um número inteiro. Ajuste o fator (1 KG = 1000 g).', erro: true };
        }
        const unidade = unidadeDaLinha(i);
        const novo = !i[i.tipo_item === 'prato' ? 'prato_id' : 'insumo_id'];
        return { texto: '= ' + quantidadeLegivel(Math.round(q), unidade) + ' no estoque' +
                        (novo ? ' (item novo: ' + (i.tipo_item === 'prato' ? 'prato de revenda fora da loja' : 'insumo em ' + unidade) + ')' : ''),
                 erro: false };
    }

    function linhaHtml(i, n, travado) {
        const cat = catalogoDoTipo(i.tipo_item);
        const dis = travado ? ' disabled' : '';
        const campo = function (nome, rotulo, valor, extra) {
            return '<label class="pedido-campo' + (extra && extra.largo ? ' largo' : '') + '">' + escapar(rotulo) +
                '<input type="' + ((extra && extra.tipo) || 'text') + '" data-linha="' + n + '" data-campo="' + nome + '" value="' +
                escapar(valor === null || valor === undefined ? '' : valor) + '"' + ((extra && extra.attrs) || '') + dis + '></label>';
        };
        const estoque = textoEstoque(i);
        return '<div class="pedido-linha' + (!i.tipo_item ? ' sem-tipo' : '') + '">' +
            '<div class="pedido-linha-topo"><strong>' + (n + 1) + '.</strong>' +
                campo('descricao', 'Descrição (como na nota)', i.descricao, { largo: true, attrs: ' maxlength="200"' }) +
                (travado ? '' : '<button type="button" class="botao-icone perigo-leve" data-pedido="tirar-linha" data-n="' + n + '" aria-label="Tirar a linha ' + (n + 1) + '">×</button>') +
            '</div>' +
            '<div class="pedido-linha-campos">' +
                '<label class="pedido-campo">O que é<select data-linha="' + n + '" data-campo="tipo_item"' + dis + '>' +
                    '<option value="">— escolha —</option>' + [['insumo', 'Insumo (ingrediente, embalagem)'], ['prato', 'Prato pronto (revenda)']].map(function (t) {
                        return '<option value="' + t[0] + '"' + (i.tipo_item === t[0] ? ' selected' : '') + '>' + escapar(t[1]) + '</option>';
                    }).join('') + '</select></label>' +
                (cat
                    ? '<label class="pedido-campo largo">Item do catálogo<select data-linha="' + n + '" data-campo="' + cat.campo + '"' + dis + '>' +
                        opcoes(cat.lista, i[cat.campo], cat.rotulo, '— criar novo com o nome da nota —') + '</select></label>'
                    : '<p class="pedido-dica">Diga se é insumo ou prato pronto para ligar ao catálogo.</p>') +
                campo('quantidade', 'Qtd na nota', String(i.quantidade === null || i.quantidade === undefined ? '' : i.quantidade).replace('.', ','), { attrs: ' inputmode="decimal" maxlength="12" placeholder="2,5"' }) +
                campo('unidade', 'Unidade da nota', i.unidade, { attrs: ' maxlength="6" placeholder="KG, UN, CX"' }) +
                campo('fator', 'Fator (1 KG = 1000 g)', i.fator, { tipo: 'number', attrs: ' min="1" step="1"' }) +
                campo('valor_total', 'Valor da linha', i.valor_total, { tipo: 'number', attrs: ' min="0" step="0.01"' }) +
                campo('valor_desconto', 'Desconto', i.valor_desconto, { tipo: 'number', attrs: ' min="0" step="0.01"' }) +
                campo('lote', 'Lote', i.lote, { attrs: ' maxlength="40"' }) +
                campo('validade', 'Validade', i.validade, { tipo: 'date' }) +
                campo('ncm', 'NCM', i.ncm, { attrs: ' maxlength="10"' }) +
                campo('codigo_fornecedor', 'Código no fornecedor', i.codigo_fornecedor, { attrs: ' maxlength="60"' }) +
                '<p class="pedido-estoque' + (estoque.erro ? ' pedido-estoque-erro' : '') + '" id="pedEstoque' + n + '">' + escapar(estoque.texto) + '</p>' +
                (i.entrada_id ? '<p class="pedido-dica">Lote nº ' + i.entrada_id + ' no estoque.</p>' : '') +
            '</div></div>';
    }

    function desenharEditor() {
        const p = atual;
        const travado = p.status !== 'rascunho';
        const dis = travado ? ' disabled' : '';
        const t = totais();
        const naturezasDeEntrada = naturezas.filter(function (n) { return n.sentido === 'entrada' && (n.ativa || String(n.id) === String(p.natureza_id)); });
        const cfopsEntrada = cfops.filter(function (c) { return c.sentido === 'entrada' && (c.permitido || c.codigo === p.cfop); });
        const cab = function (nome, rotulo, valor, tipo, attrs) {
            return '<div class="campo"><label for="ped-' + nome + '">' + escapar(rotulo) + '</label><input type="' + (tipo || 'text') + '" id="ped-' + nome +
                '" data-cab="' + nome + '" value="' + escapar(valor === null || valor === undefined ? '' : valor) + '"' + (attrs || '') + dis + '></div>';
        };
        raiz.innerHTML =
            '<div class="secao-topo"><div><h2 class="secao-titulo">' + escapar(p.numero) + ' ' +
                etiquetaTexto(rotuloDe('status_pedido', p.status), COR_STATUS[p.status]) + '</h2>' +
                (p.status === 'cancelado' ? '<p class="secao-descricao">Cancelado: ' + escapar(p.motivo_cancelamento || '') + '</p>' : '') +
                (p.tem_xml ? '<p class="secao-descricao">Veio do XML da NF-e. Chave ' + escapar(p.nota_chave) + '</p>' : '') +
            '</div><button type="button" class="botao botao-secundario" data-pedido="voltar">Voltar para a lista</button></div>' +

            '<div class="table-section"><h3 class="table-title"><span style="background:var(--serie-1)"></span>Cabeçalho</h3>' +
            '<div class="formulario">' +
                '<div class="campo"><label for="ped-natureza">Natureza da operação</label><select id="ped-natureza" data-cab="natureza_id"' + dis + '>' +
                    opcoes(naturezasDeEntrada, p.natureza_id, function (n) { return n.descricao; }, '— escolha —') + '</select></div>' +
                '<div class="campo"><label for="ped-fornecedor">Fornecedor</label><select id="ped-fornecedor" data-cab="fornecedor_id"' + dis + '>' +
                    opcoes(estado.fornecedores, p.fornecedor_id, function (f) { return f.nome + (f.uf ? ' (' + f.uf + ')' : ''); }, '— sem fornecedor —') + '</select></div>' +
                '<div class="campo"><label for="ped-cfop">CFOP</label><select id="ped-cfop" data-cab="cfop"' + dis + '>' +
                    '<option value="">Automático pela natureza e UF</option>' + cfopsEntrada.map(function (c) {
                        return '<option value="' + c.codigo + '"' + (c.codigo === p.cfop ? ' selected' : '') + '>' + fmtCfop(c.codigo) + ' - ' + escapar(c.descricao) + '</option>';
                    }).join('') + '</select>' +
                    (p.cfop ? '<small class="dica">Gravado: ' + fmtCfop(p.cfop) + (p.cfop_descricao ? ' - ' + escapar(p.cfop_descricao) : '') + '</small>' : '') + '</div>' +
                cab('nota_numero', 'Número da nota', p.nota_numero, 'text', ' maxlength="9"') +
                cab('nota_serie', 'Série', p.nota_serie, 'text', ' maxlength="3"') +
                cab('nota_chave', 'Chave de acesso (44)', p.nota_chave, 'text', ' maxlength="44"') +
                cab('valor_frete', 'Frete', p.valor_frete, 'number', ' min="0" step="0.01"') +
                cab('valor_outros', 'Outros (seguro, IPI, ST)', p.valor_outros, 'number', ' min="0" step="0.01"') +
                '<div class="campo"><label for="ped-forma">Forma de pagamento ao fornecedor</label><select id="ped-forma" data-cab="forma_pagamento_id"' + dis + '>' +
                    opcoes(estado.formasPagamento.filter(function (f) { return f.ativo || String(f.id) === String(p.forma_pagamento_id); }),
                           p.forma_pagamento_id, function (f) { return f.nome; }, '— não informada —') + '</select></div>' +
                '<div class="campo"><label class="interruptor"><input type="checkbox" data-cab="gerar_financeiro"' + (Number(p.gerar_financeiro) ? ' checked' : '') + dis + '>' +
                    '<span class="interruptor-trilho"><span class="interruptor-bola"></span></span>' +
                    '<span class="interruptor-texto">Gerar contas a pagar (se a natureza gera)</span></label></div>' +
                '<div class="campo campo-total"><label for="ped-obs">Observações</label><input type="text" id="ped-obs" data-cab="observacoes" maxlength="500" value="' +
                    escapar(p.observacoes || '') + '"' + dis + '></div>' +
            '</div></div>' +

            '<div class="table-section"><h3 class="table-title"><span style="background:var(--serie-2)"></span>Itens (' + p.lista_itens.length + ')' +
                (travado ? '' : '<button type="button" class="botao botao-pequeno" data-pedido="nova-linha">+ Linha</button>') + '</h3>' +
            (p.lista_itens.length ? p.lista_itens.map(function (i, n) { return linhaHtml(i, n, travado); }).join('')
                                  : vazio('Nenhuma linha. Use "+ Linha" ou importe o XML da nota.')) +
            '</div>' +

            '<div class="tables-grid">' +
            '<div class="table-section"><h3 class="table-title"><span style="background:var(--serie-4)"></span>Parcelas (duplicatas)' +
                (travado ? '' : '<button type="button" class="botao botao-pequeno" data-pedido="nova-parcela">+ Parcela</button>') + '</h3>' +
                (p.parcelas.length
                    ? '<div class="pedido-parcelas">' + p.parcelas.map(function (x, k) {
                        return '<div class="pedido-parcela">' +
                            '<label class="pedido-campo">Nº<input type="text" data-parcela="' + k + '" data-campo="numero" value="' + escapar(x.numero || '') + '"' + dis + '></label>' +
                            '<label class="pedido-campo">Vencimento<input type="date" data-parcela="' + k + '" data-campo="vencimento" value="' + escapar(x.vencimento || '') + '"' + dis + '></label>' +
                            '<label class="pedido-campo">Valor<input type="number" min="0" step="0.01" data-parcela="' + k + '" data-campo="valor" value="' + escapar(x.valor) + '"' + dis + '></label>' +
                            (travado ? '' : '<button type="button" class="botao-icone perigo-leve" data-pedido="tirar-parcela" data-n="' + k + '" aria-label="Tirar a parcela ' + (k + 1) + '">×</button>') +
                            '</div>';
                    }).join('') + '</div>'
                    : '<p class="pedido-dica">Sem parcelas: a conta a pagar sai numa só, no total, vencendo na data de entrada.</p>') +
                (p.parcelas.length && emCentavos(t.parcelas) !== emCentavos(t.total)
                    ? '<p class="pedido-alerta">As parcelas somam ' + moeda(t.parcelas) + ' e o total é ' + moeda(t.total) + '.</p>' : '') +
            '</div>' +
            '<div class="table-section pedido-totais"><h3 class="table-title"><span style="background:var(--serie-3)"></span>Totais</h3>' +
                '<div class="resumo-linha"><span>Produtos</span><span>' + moeda(t.produtos) + '</span></div>' +
                '<div class="resumo-linha"><span>Descontos</span><span>− ' + moeda(t.desconto) + '</span></div>' +
                '<div class="resumo-linha"><span>Frete + outros</span><span>' + moeda(num(p.valor_frete) + num(p.valor_outros)) + '</span></div>' +
                '<div class="resumo-total"><span>Total</span><strong id="pedTotal">' + moeda(t.total) + '</strong></div>' +
            '</div></div>' +

            (p.lancamentos && p.lancamentos.length
                ? '<div class="table-section"><h3 class="table-title"><span style="background:var(--serie-5)"></span>Contas a pagar criadas</h3>' +
                  tabelaHtml({ colunas: ['Descrição', 'Vencimento', 'Valor', 'Situação'], linhas: p.lancamentos.map(function (l) {
                      return [escapar(l.descricao), dataCurta(l.vencimento), moeda(l.valor), escapar(rotuloDe('status_lancamento', l.status))];
                  }) }) + '</div>'
                : '') +

            '<p class="pdv-erro" id="pedidoErro" role="alert"></p>' +
            '<div class="pedido-botoes">' +
            (p.status === 'rascunho'
                ? (podeConfirmar() && Number(p.gerar_financeiro)
                    ? '<label class="pedido-campo">Pagamento ao confirmar<select id="pedidoPago" data-cab="pago_agora">' +
                        [['0', 'Fica a pagar (vencimento ou parcelas)'], ['1', 'Já paguei (a conta nasce paga)']].map(function (o) {
                            return '<option value="' + o[0] + '"' + (String(pagoAgora(p)) === o[0] ? ' selected' : '') + '>' + o[1] + '</option>';
                        }).join('') + '</select></label>'
                    : '') +
                  '<button type="button" class="botao" data-pedido="salvar">Salvar rascunho</button>' +
                  (podeConfirmar() ? '<button type="button" class="botao botao-confirmar" data-pedido="confirmar">Confirmar entrada</button>' : '') +
                  (p.id && estado.config.pode_admin ? '<button type="button" class="botao botao-secundario" data-pedido="apagar">Apagar rascunho</button>' : '')
                : '') +
            (p.status === 'confirmado' && estado.config.pode_admin
                ? '<label class="pedido-campo largo">Motivo do cancelamento<input type="text" id="pedidoMotivo" maxlength="300"></label>' +
                  '<button type="button" class="botao botao-secundario perigo" data-pedido="cancelar">Cancelar entrada</button>'
                : '') +
            '</div>';
    }

    function erro(texto) {
        const el = document.getElementById('pedidoErro');
        if (el) el.textContent = texto || '';
    }

    /*
     * "Já paguei" ou "fica a pagar", escolhido na hora de confirmar (nao vai
     * para o banco: so muda as contas que a confirmacao cria). Sem escolha,
     * a nota importada ou com parcelas fica a pagar; a digitada (a compra no
     * mercado) ja nasce paga, como fazia a entrada avulsa.
     */
    function pagoAgora(p) {
        if (p.pago_agora !== undefined && p.pago_agora !== '') return Number(p.pago_agora) ? 1 : 0;
        return p.tem_xml || p.parcelas.length ? 0 : 1;
    }

    /* A linha que um atalho pede (Cadastros > Insumos, Cardapio > prato), com o item ja escolhido. */
    function linhaDoAtalho(pedido) {
        const linha = linhaVazia();
        linha.tipo_item = pedido.tipo_item === 'prato' ? 'prato' : 'insumo';
        if (linha.tipo_item === 'prato') {
            const prato = estado.pratos.find(function (x) { return String(x.id) === String(pedido.prato_id); });
            Object.assign(linha, { prato_id: prato ? prato.id : '', descricao: prato ? prato.nome : '', unidade: 'UN', fator: 1 });
            if (prato && prato.validade_dias > 0) linha.validade = somarDias(hoje(), prato.validade_dias);
        } else {
            const insumo = estado.insumos.find(function (x) { return String(x.id) === String(pedido.insumo_id); });
            const base = insumo ? insumo.unidade : 'g';
            Object.assign(linha, { insumo_id: insumo ? insumo.id : '', descricao: insumo ? insumo.nome : '',
                                   unidade: base === 'g' ? 'KG' : base === 'ml' ? 'L' : 'UN', fator: base === 'un' ? 1 : 1000 });
        }
        return linha;
    }

    /*
     * O que outra tela pediu para abrir: { novo: {tipo_item, insumo_id|prato_id} }
     * ou { id }. Fica guardado e o carregar() desta tela abre - abrir direto
     * correria com o carregar() que o mostrarSecao dispara (e a lista venceria).
     */
    let pendente = null;

    /* Abre a tela Entradas numa entrada nova (com a linha do item, se veio). */
    function novaEntrada(pedido) {
        pendente = { novo: pedido || {} };
        atual = null;
        N.mostrarSecao('pedidos', true);
    }

    /* Abre a tela Entradas num documento (o Estoque mostra "Entrada PE-..."). */
    function abrirEntrada(id) {
        pendente = { id: Number(id) };
        atual = null;
        N.mostrarSecao('pedidos', true);
    }

    async function abrir(id) {
        await Promise.all([carregarCatalogos(), carregarApoio(), carregarPratos()]);
        atual = id ? (await api.get('/pedidos/' + id)).pedido : novoPedido();
        atual.lista_itens.forEach(function (i) {
            ['insumo_id', 'prato_id', 'tipo_item', 'ncm', 'codigo_fornecedor', 'unidade', 'lote', 'validade'].forEach(function (c) {
                if (i[c] === null || i[c] === undefined) i[c] = '';
            });
        });
        desenharEditor();
        window.scrollTo({ top: 0 });
    }

    function corpoDoPedido() {
        return {
            natureza_id: atual.natureza_id, fornecedor_id: atual.fornecedor_id || null, cfop: atual.cfop || null,
            nota_numero: atual.nota_numero, nota_serie: atual.nota_serie, nota_chave: atual.nota_chave, nota_emissao: atual.nota_emissao,
            valor_frete: num(atual.valor_frete), valor_outros: num(atual.valor_outros), gerar_financeiro: Number(atual.gerar_financeiro) ? 1 : 0,
            forma_pagamento_id: atual.forma_pagamento_id || null, observacoes: atual.observacoes,
            itens: atual.lista_itens.map(function (i) {
                return { tipo_item: i.tipo_item || null, insumo_id: i.insumo_id || null, prato_id: i.prato_id || null,
                         descricao: i.descricao, codigo_fornecedor: i.codigo_fornecedor || null, gtin: i.gtin || null, ncm: i.ncm || null,
                         cest: i.cest || null, cfop_nota: i.cfop_nota || null, unidade: i.unidade || null,
                         quantidade: String(i.quantidade === null || i.quantidade === undefined ? '' : i.quantidade).replace(',', '.'),
                         fator: Math.max(1, Math.round(num(i.fator) || 1)), valor_total: num(i.valor_total), valor_desconto: num(i.valor_desconto),
                         lote: i.lote || null, validade: i.validade || null };
            }),
            parcelas: atual.parcelas.map(function (x) { return { numero: x.numero || null, vencimento: x.vencimento, valor: num(x.valor) }; }),
        };
    }

    async function salvar() {
        const r = atual.id ? await api.put('/pedidos/' + atual.id, corpoDoPedido()) : await api.post('/pedidos', corpoDoPedido());
        const id = atual.id || r.id;
        avisar(mensagemDe(r, 'Rascunho gravado.'));
        await abrir(id);
        return id;
    }

    async function carregarApoio() {
        const r = await Promise.all([api.get('/naturezas'), api.get('/cfops')]);
        naturezas = r[0].itens;
        cfops = r[1].itens;
    }

    async function importarXml(arquivo) {
        if (!arquivo) return;
        if (arquivo.size > 3000000) { avisar('O arquivo é grande demais para um XML de nota (limite de 3 MB).', 'erro'); return; }
        try {
            const r = await api.post('/pedidos', { xml: await arquivo.text() });
            avisar(mensagemDe(r, 'Nota importada.'));
            await abrir(r.id);
        } catch (falha) {
            avisar(falha.message, 'erro');
        }
    }

    raiz.addEventListener('click', async function (evento) {
        const alvo = evento.target.closest('[data-pedido]');
        if (!alvo) return;
        const n = Number(alvo.dataset.n);
        try {
            switch (alvo.dataset.pedido) {
                // Entrada nova ja com uma linha: a compra digitada (o mercado) quase sempre tem um item so.
                case 'novo': await abrir(null); atual.lista_itens.push(linhaVazia()); desenharEditor(); break;
                case 'abrir': await abrir(Number(alvo.dataset.id)); break;
                case 'voltar': await carregarLista(); break;
                case 'nova-linha': atual.lista_itens.push(linhaVazia()); desenharEditor(); break;
                case 'tirar-linha': atual.lista_itens.splice(n, 1); desenharEditor(); break;
                case 'nova-parcela': atual.parcelas.push({ numero: '', vencimento: '', valor: 0 }); desenharEditor(); break;
                case 'tirar-parcela': atual.parcelas.splice(n, 1); desenharEditor(); break;
                case 'salvar': erro(''); await salvar(); break;
                case 'confirmar': {
                    erro('');
                    // Lido antes de salvar: o salvar recarrega o documento do servidor.
                    const pago = !!Number(atual.gerar_financeiro) && pagoAgora(atual) === 1;
                    const id = await salvar();
                    if (!confirm('Confirmar a entrada? A mercadoria entra no estoque e ' +
                                 (pago ? 'a conta já nasce paga (Já paguei).' : 'as contas a pagar são criadas.'))) return;
                    avisar(mensagemDe(await api.post('/pedidos/' + id + '/confirmar', { pago: pago ? 1 : 0 }), 'Entrada confirmada.'));
                    await abrir(id);
                    break;
                }
                case 'apagar':
                    if (!confirm('Apagar o rascunho ' + atual.numero + '?')) return;
                    avisar(mensagemDe(await api.remover('/pedidos/' + atual.id), 'Rascunho apagado.'));
                    await carregarLista();
                    break;
                case 'cancelar': {
                    const motivo = document.getElementById('pedidoMotivo').value;
                    avisar(mensagemDe(await api.post('/pedidos/' + atual.id + '/cancelar', { motivo: motivo }), 'Entrada cancelada.'));
                    await abrir(atual.id);
                    break;
                }
            }
        } catch (falha) {
            erro(falha.message);
            avisar(falha.message, 'erro');
        }
    });

    function guardar(evento) {
        const el = evento.target;
        const valor = el.type === 'checkbox' ? (el.checked ? 1 : 0) : el.value;
        if (el.dataset.cab) { atual[el.dataset.cab] = valor; }
        else if (el.dataset.linha !== undefined) { atual.lista_itens[Number(el.dataset.linha)][el.dataset.campo] = valor; }
        else if (el.dataset.parcela !== undefined) { atual.parcelas[Number(el.dataset.parcela)][el.dataset.campo] = valor; }
        else return false;
        return true;
    }

    raiz.addEventListener('input', function (evento) {
        if (!atual || !guardar(evento)) return;
        const n = evento.target.dataset.linha;
        if (n !== undefined) {
            const el = document.getElementById('pedEstoque' + n);
            const e = textoEstoque(atual.lista_itens[Number(n)]);
            if (el) { el.textContent = e.texto; el.classList.toggle('pedido-estoque-erro', e.erro); }
        }
        const t = totais();
        const total = document.getElementById('pedTotal');
        if (total) total.textContent = moeda(t.total);
    });

    raiz.addEventListener('change', function (evento) {
        if (evento.target.id === 'filtroPedido') { filtro = evento.target.value; desenharLista(); return; }
        if (evento.target.id === 'pedidoXml') { importarXml(evento.target.files[0]); evento.target.value = ''; return; }
        if (!atual || !guardar(evento)) return;
        const campo = evento.target.dataset.campo;
        const linha = evento.target.dataset.linha !== undefined ? atual.lista_itens[Number(evento.target.dataset.linha)] : null;
        // Unidade da nota ou item escolhido: sugere o fator (1 KG = 1000 g) se ele ainda nao foi mexido.
        if (linha && ['unidade', 'insumo_id', 'tipo_item'].indexOf(campo) !== -1) {
            const sugerido = fatorSugerido(linha.unidade, unidadeDaLinha(linha));
            if ([1, 1000].indexOf(Math.round(num(linha.fator))) !== -1 || !linha.fator) linha.fator = linha.tipo_item === 'prato' ? 1 : sugerido;
            if (campo === 'insumo_id' && !linha.descricao) {
                const ins = estado.insumos.find(function (x) { return String(x.id) === String(linha.insumo_id); });
                if (ins) linha.descricao = ins.nome;
            }
        }
        // Mudou o tipo, o item ou a unidade: o desenho da linha muda (fator, unidade do estoque).
        if (['tipo_item', 'insumo_id', 'prato_id', 'unidade'].indexOf(campo) !== -1 || evento.target.dataset.parcela !== undefined ||
            ['valor_frete', 'valor_outros', 'gerar_financeiro'].indexOf(evento.target.dataset.cab) !== -1) {
            desenharEditor();
        }
    });

    async function carregarPedidos() {
        await Promise.all([carregarApoio(), carregarCatalogos(), carregarPratos()]);
        if (pendente) {
            const pedido = pendente;
            pendente = null;
            if (pedido.id) { await abrir(pedido.id); return; }
            await abrir(null);
            atual.lista_itens.push(pedido.novo.tipo_item ? linhaDoAtalho(pedido.novo) : linhaVazia());
            desenharEditor();
            return;
        }
        if (atual && atual.id) { await abrir(atual.id); return; }
        await carregarLista();
    }

    N.registrarTela('pedidos', { titulo: 'Entradas', carregar: carregarPedidos });
    janela.Telas = janela.Telas || {};
    janela.Telas.pedidos = { carregar: carregarPedidos, abrir: abrir, novaEntrada: novaEntrada, abrirEntrada: abrirEntrada };
})(window);
