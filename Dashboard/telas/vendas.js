// carga: usa Formato, Nucleo, Janela; publica Telas.vendas  (conferido por testes/front/carga.test.js)
/*
 * telas/vendas.js - consulta, edicao e cancelamento das vendas: as do
 * balcao (PDV) e as que nasceram de um pedido da loja online. Window.Telas.vendas.
 * Venda NOVA so pelo PDV (telas/pdv.js).
 *
 * O que cada venda permite (editar valor, cancelar, excluir) vem pronto do
 * servidor em cada registro: pode_editar_valor, pode_cancelar, pode_excluir,
 * e a origem (balcao | loja, com o numero do pedido). A tela so mostra ou
 * esconde; a regra mora la. Venda da loja muda pelo pedido (Pedidos online).
 */
(function (janela) {
    'use strict';

    const { escapar, moeda, porcento, dataCurta, horaCurta, somarEmCentavos } = janela.Formato;
    const N = janela.Nucleo;
    const { api, estado, mensagemDe, avisar, etiqueta, vazio, opcoesDe, tabelaHtml, moedaOuTraco,
            campoFormaPagamento, carregarCatalogos, textoValidade } = N;
    const { abrirModal } = janela.Janela;

    const filtros = { busca: '', status: 'concluida', origem: '', de: '', ate: '' };

    async function carregarVendas() {
        const r = await Promise.all([api.get('/vendas'), carregarCatalogos()]);
        estado.vendas = r[0].itens;
        desenharTela();
    }

    function daLoja(v) {
        return v.origem === 'loja' || !!v.encomenda_numero;
    }

    function desenharTela() {
        const alvo = document.getElementById('vendasConteudo');
        alvo.innerHTML =
            '<div class="gestao-topo">' +
                '<p class="secao-descricao">Consulte, edite e cancele as vendas do balcão e da loja online. Venda nova é no PDV: ' +
                'ele baixa os pratos do lote que vence primeiro e abre a conta a receber.</p>' +
                '<div class="grupo-botoes"><button type="button" class="botao" data-acao="abrir-pdv">Abrir o PDV <kbd>F2</kbd></button></div>' +
            '</div>' +
            '<div class="barra-filtros gestao-filtros" id="filtrosVendas">' +
                '<input type="search" data-filtro-venda="busca" placeholder="Buscar por número, cliente, prato ou pedido online..." ' +
                    'aria-label="Buscar vendas" value="' + escapar(filtros.busca) + '">' +
                select('status', [['concluida', 'Só concluídas'], ['', 'Todas as situações'], ['cancelada', 'Canceladas']], 'Situação') +
                select('origem', [['', 'Balcão e loja'], ['balcao', 'Só balcão (PDV)'], ['loja', 'Só loja online']], 'Origem') +
                '<input type="date" data-filtro-venda="de" value="' + escapar(filtros.de) + '" title="Vendas a partir de" aria-label="De">' +
                '<input type="date" data-filtro-venda="ate" value="' + escapar(filtros.ate) + '" title="Vendas até" aria-label="Até">' +
            '</div>' +
            '<div class="gestao-resumo" id="resumoVendas"></div>' +
            '<div class="table-section"><div id="listaVendas"></div></div>';
        desenharLista();
    }

    function select(nome, opcoes, rotulo) {
        return '<select data-filtro-venda="' + nome + '" aria-label="' + escapar(rotulo) + '">' + opcoes.map(function (o) {
            return '<option value="' + o[0] + '"' + (filtros[nome] === o[0] ? ' selected' : '') + '>' + escapar(o[1]) + '</option>';
        }).join('') + '</select>';
    }

    function filtradas() {
        const busca = filtros.busca.trim().toLowerCase();
        return estado.vendas.filter(function (v) {
            if (filtros.status && v.status !== filtros.status) return false;
            if (filtros.origem && (daLoja(v) ? 'loja' : 'balcao') !== filtros.origem) return false;
            const dia = String(v.data_venda || '').substring(0, 10);
            if (filtros.de && dia < filtros.de) return false;
            if (filtros.ate && dia > filtros.ate) return false;
            if (!busca) return true;
            return [v.numero, v.cliente, v.vendedor, v.forma_pagamento, v.itens_texto, v.encomenda_numero]
                .join(' ').toLowerCase().includes(busca);
        });
    }

    function desenharLista() {
        const itens = filtradas();
        const concluidas = itens.filter(function (v) { return v.status === 'concluida'; });
        const total = somarEmCentavos(concluidas, function (v) { return v.valor_total; });
        const veLucro = itens.some(function (v) { return v.lucro !== undefined && v.lucro !== null; });
        const lucro = veLucro ? somarEmCentavos(concluidas, function (v) { return v.lucro; }) : null;
        const loja = somarEmCentavos(concluidas.filter(daLoja), function (v) { return v.valor_total; });

        document.getElementById('resumoVendas').innerHTML = concluidas.length
            ? '<span><strong>' + concluidas.length + '</strong> venda(s) concluída(s)</span>' +
              '<span>Total <strong>' + moeda(total) + '</strong></span>' +
              '<span>Ticket médio <strong>' + moeda(total / concluidas.length) + '</strong></span>' +
              '<span>Balcão <strong>' + moeda(total - loja) + '</strong> · Loja <strong>' + moeda(loja) + '</strong></span>' +
              (veLucro ? '<span>Lucro <strong>' + moeda(lucro) + '</strong>' + (total > 0 ? ' (' + porcento(lucro / total * 100) + ')' : '') + '</span>' : '')
            : '';

        const alvo = document.getElementById('listaVendas');
        if (!itens.length) {
            alvo.innerHTML = vazio(estado.vendas.length ? 'Nenhuma venda com estes filtros.'
                                                       : 'Nenhuma venda registrada. As vendas do balcão são feitas no PDV (tecla F2).');
            return;
        }
        alvo.innerHTML = tabelaHtml({
            colunas: ['Número', 'Cliente', 'Pratos', 'Pagamento', { titulo: 'Total', classe: 'numero' }]
                .concat(veLucro ? [{ titulo: 'Lucro', classe: 'numero' }] : [])
                .concat(['Data', 'Situação', { titulo: 'Ações', classe: 'coluna-acoes' }]),
            linhas: itens.slice(0, 500).map(function (v) {
                return [
                    '<span class="doc-numero">' + escapar(v.numero || ('#' + v.id)) + '</span>' +
                        '<span class="doc-sub">' + (daLoja(v) ? 'Loja online · ' + escapar(v.encomenda_numero || '') : 'Balcão') + '</span>',
                    escapar(v.cliente) + (v.vendedor ? '<span class="doc-sub">por ' + escapar(v.vendedor) + '</span>' : ''),
                    escapar(resumirItens(v.itens_texto)) + '<span class="doc-sub">' + (v.unidades || 0) + ' un.</span>',
                    escapar(v.forma_pagamento || '—') + (v.parcelas > 1 ? '<span class="doc-sub">' + v.parcelas + 'x</span>' : ''),
                    { classe: 'numero', html: moeda(v.valor_total) + (v.desconto > 0 ? '<span class="doc-sub">desc. ' + moeda(v.desconto) + '</span>' : '') },
                ].concat(veLucro ? [{ classe: 'numero', html: moedaOuTraco(v.lucro) }] : []).concat([
                    dataCurta(v.data_venda) + '<span class="doc-sub">' + escapar(horaCurta(v.data_venda)) + '</span>',
                    etiqueta('status_venda', v.status),
                    { classe: 'coluna-acoes', html: '<div class="acoes-linha">' +
                        '<button type="button" class="botao-icone" data-acao="ver-venda" data-id="' + v.id + '">Ver</button>' +
                        '<button type="button" class="botao-icone" data-acao="editar-venda" data-id="' + v.id + '">Editar</button>' +
                        (v.pode_excluir ? '<button type="button" class="botao-icone perigo botao-excluir" data-acao="excluir-venda" data-id="' + v.id + '">Excluir</button>' : '') +
                        '</div>' },
                ]);
            }),
        });
    }

    /* "Frango grelhado | Salada | Taxa de entrega" -> os dois primeiros e "+1". */
    function resumirItens(texto) {
        const partes = String(texto || '').split(' | ').filter(Boolean);
        const unicos = partes.filter(function (p, i) { return partes.indexOf(p) === i; });
        return unicos.slice(0, 2).join(', ') + (unicos.length > 2 ? ' +' + (unicos.length - 2) : '') || '—';
    }

    /*
     * Formulario do Editar venda, pelo que o servidor permite NESTA venda:
     *   pode_editar_valor  cliente, desconto e forma de pagamento
     *   pode_cancelar      o campo Situacao, com "Cancelada"
     */
    function formularioEditarVenda(venda) {
        const campos = [];
        if (daLoja(venda)) {
            campos.push({ nome: '__aviso', tipo: 'html', html:
                '<div class="aviso-formulario campo-total">Esta venda veio do pedido <strong>' + escapar(venda.encomenda_numero || '') +
                '</strong> da loja online. Valor, cliente e situação mudam pelo pedido, em <strong>Pedidos online</strong> ' +
                '(o cliente acompanha no app). Aqui só a observação.</div>' });
        } else if (venda.status === 'cancelada') {
            campos.push({ nome: '__aviso', tipo: 'html', html:
                '<div class="aviso-formulario campo-total">Venda <strong>cancelada</strong>: as porções já voltaram ao estoque e ' +
                'podem ter sido vendidas de novo, então ela não volta a ser concluída. Registre uma venda nova no PDV.</div>' });
        }
        if (venda.pode_editar_valor) {
            campos.push({
                nome: 'cliente_id', rotulo: 'Cliente', tipo: 'select', valor: venda.cliente_id || '',
                opcoes: opcoesDe(estado.clientes, function (c) { return c.nome + (c.telefone ? ' · ' + c.telefone : ''); },
                                 '— consumidor não identificado —'),
                largura: 'total',
            });
            campos.push({ nome: 'desconto', rotulo: 'Desconto (R$)', tipo: 'number', valor: venda.desconto,
                          maximo: venda.valor_bruto > 0 ? venda.valor_bruto : undefined,
                          dica: 'Se a venda já foi recebida, o servidor diz o que acontece com a diferença.' });
            campos.push(campoFormaPagamento(venda.forma_pagamento_id));
        }
        if (venda.pode_cancelar) {
            campos.push({
                nome: 'status', rotulo: 'Situação', tipo: 'select', valor: venda.status,
                opcoes: [{ valor: 'concluida', rotulo: 'Concluída' }, { valor: 'cancelada', rotulo: 'Cancelada' }],
                dica: 'Cancelar devolve as porções ao lote de onde saíram.',
            });
        }
        campos.push({ nome: 'observacoes', rotulo: 'Observações', tipo: 'textarea', valor: venda.observacoes, largura: 'total' });
        return campos;
    }

    async function verVenda(id) {
        const v = (await api.get('/vendas/' + id)).venda;
        const veCusto = v.custo_total !== undefined && v.custo_total !== null;
        const itens = tabelaHtml({
            colunas: ['Item', { titulo: 'Qtd', classe: 'numero' }, { titulo: 'Unitário', classe: 'numero' }, { titulo: 'Subtotal', classe: 'numero' }]
                .concat(veCusto ? [{ titulo: 'Custo', classe: 'numero' }] : []),
            linhas: v.lista_itens.map(function (i) {
                const lote = i.entrada_id
                    ? 'lote ' + (i.lote || '#' + i.entrada_id) + (i.validade ? ' · validade ' + dataCurta(i.validade) : '')
                    : (i.prato_id ? 'feito na hora' : '');
                return [
                    escapar(i.descricao) +
                        (i.adicionais ? '<span class="detalhe-adicionais">+ ' + escapar(i.adicionais) + '</span>' : '') +
                        (lote ? '<span class="detalhe-adicionais">' + escapar(lote) + '</span>' : ''),
                    { classe: 'numero', html: String(i.quantidade) },
                    { classe: 'numero', html: moeda(i.valor_unitario) },
                    { classe: 'numero', html: moeda(i.subtotal) },
                ].concat(veCusto ? [{ classe: 'numero', html: moeda(i.custo_unitario * i.quantidade) }] : []);
            }),
            total: [{ colspan: 3, html: '<strong>Total' + (v.desconto > 0 ? ' (desconto ' + moeda(v.desconto) + ')' : '') + '</strong>' },
                    { classe: 'numero', html: '<strong>' + moeda(v.valor_total) + '</strong>' }]
                .concat(veCusto ? [{ classe: 'numero', html: '<strong>' + moeda(v.custo_total) + '</strong>' }] : []),
        });
        const lancamentos = (v.lancamentos || []).length
            ? tabelaHtml({
                colunas: ['Descrição', 'Vencimento', { titulo: 'Valor', classe: 'numero' }, 'Situação'],
                linhas: v.lancamentos.map(function (l) {
                    return [escapar(l.descricao) + (l.forma_pagamento ? '<span class="doc-sub">' + escapar(l.forma_pagamento) + '</span>' : ''),
                            dataCurta(l.vencimento), { classe: 'numero', html: moeda(l.valor) }, etiqueta('status_lancamento', l.status)];
                }),
            })
            : vazio('Esta venda não gerou lançamentos.');

        abrirModal({
            titulo: 'Venda ' + (v.numero || '#' + v.id),
            somenteLeitura: true,
            html: '<div class="campo-total">' +
                  '<div class="lista-dados">' +
                  '  <div><span>Origem</span><strong>' + (daLoja(v) ? 'Loja online · pedido ' + escapar(v.encomenda_numero || '') : 'Balcão (PDV)') + '</strong></div>' +
                  '  <div><span>Cliente</span><strong>' + escapar(v.cliente) + '</strong></div>' +
                  '  <div><span>Vendedor</span><strong>' + escapar(v.vendedor || '—') + '</strong></div>' +
                  '  <div><span>Data</span><strong>' + dataCurta(v.data_venda) + ' ' + escapar(horaCurta(v.data_venda)) + '</strong></div>' +
                  '  <div><span>Pagamento</span><strong>' + escapar(v.forma_pagamento || '—') + (v.parcelas > 1 ? ' em ' + v.parcelas + 'x' : '') + '</strong></div>' +
                  '  <div><span>Situação</span><strong>' + etiqueta('status_venda', v.status) + '</strong></div>' +
                  (veCusto ? '  <div><span>Custo dos pratos</span><strong>' + moeda(v.custo_total) + '</strong></div>' +
                             '  <div><span>Lucro</span><strong>' + moedaOuTraco(v.lucro) +
                             (v.valor_total > 0 ? ' (' + porcento(v.lucro / v.valor_total * 100) + ')' : '') + '</strong></div>' : '') +
                  '</div>' +
                  '<h4 class="sub-titulo">Itens</h4>' + itens +
                  '<h4 class="sub-titulo">Contas a receber</h4>' + lancamentos +
                  (v.observacoes ? '<h4 class="sub-titulo">Observações</h4><p>' + escapar(v.observacoes) + '</p>' : '') +
                  '</div>',
        });
    }

    const conteudo = document.getElementById('vendasConteudo');
    conteudo.addEventListener('input', function (evento) {
        const campo = evento.target.closest('[data-filtro-venda]');
        if (!campo || campo.tagName !== 'INPUT' || campo.type !== 'search') return;
        filtros.busca = campo.value;
        desenharLista();
    });
    conteudo.addEventListener('change', function (evento) {
        const campo = evento.target.closest('[data-filtro-venda]');
        if (!campo || (campo.tagName === 'INPUT' && campo.type === 'search')) return;
        filtros[campo.dataset.filtroVenda] = campo.value;
        desenharLista();
    });

    N.registrarAcoes({
        'abrir-pdv': function () { N.mostrarSecao('pdv', true); },
        'ver-venda': verVenda,
        'editar-venda': function (id) {
            const venda = estado.vendas.find(function (v) { return v.id === id; });
            return abrirModal({
                titulo: 'Editar venda ' + (venda.numero || '#' + venda.id),
                campos: formularioEditarVenda(venda),
                aoSalvar: async function (valores) {
                    if (valores.status === 'cancelada' && venda.status !== 'cancelada' &&
                        !confirm('Cancelar a venda ' + (venda.numero || '#' + venda.id) + '? As porções voltam ao estoque.')) {
                        throw new Error('Nada foi gravado.');
                    }
                    avisar(mensagemDe(await api.put('/vendas/' + id, valores), 'Venda atualizada.'));
                    await carregarVendas();
                },
            });
        },
        'excluir-venda': async function (id) {
            const venda = estado.vendas.find(function (v) { return v.id === id; });
            if (!confirm('Excluir a venda ' + (venda.numero || '#' + venda.id) + '? As porções voltam para o estoque e a conta é cancelada.')) return;
            avisar(mensagemDe(await api.remover('/vendas/' + id), 'Venda excluída.'));
            await carregarVendas();
        },
    });

    N.registrarTela('vendas', { titulo: 'Vendas', carregar: carregarVendas });
    janela.Telas = janela.Telas || {};
    janela.Telas.vendas = { verVenda: verVenda, daLoja: daLoja, carregar: carregarVendas };
})(window);
