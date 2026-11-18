// carga: usa Formato, Nucleo, Telas.inicio; publica Telas.pdvInicio  (conferido por testes/front/carga.test.js)
/*
 * telas/pdv-inicio.js - a tela de ENTRADA do PDV. Window.Telas.pdvInicio.
 *
 * O menu "PDV" abre aqui. De cima para baixo:
 *   - o balcao: saudacao e a acao do dia, "Nova venda" (F2);
 *   - o dia em numeros (vendas de hoje e os pedidos online por etapa) -
 *     cada numero leva a tela dele;
 *   - os atalhos do balcao (cada perfil ve os seus) e, ao lado, os pedidos
 *     online que pedem atencao e os pratos que estao acabando.
 * A venda continua no PDV em tela cheia (secao "pdv"); "Sair do PDV" volta
 * para ca. Os numeros vem prontos de GET /api/pdv-painel (sem custo).
 */
(function (janela) {
    'use strict';

    const { escapar, moeda, dataCurta, horaCurta } = janela.Formato;
    const N = janela.Nucleo;
    const { api, estado, mostrarSecao, etiqueta, vazio, avisar, quantidadeLegivel } = N;
    const icone = janela.Telas.inicio.icone;

    const raiz = document.getElementById('pdvInicioConteudo');

    /* Os atalhos, na ordem do balcao. quem: todos | loja | financeiro | admin. */
    const ATALHOS = [
        { ir: 'pedidos-online', titulo: 'Pedidos online', texto: 'Aceitar, preparar e entregar', icone: 'pedidos-online', quem: 'loja', aviso: 'novos' },
        { ir: 'producao', titulo: 'Produção', texto: 'O que a cozinha produz hoje', icone: 'producao', quem: 'todos' },
        { ir: 'entradas', titulo: 'Estoque', texto: 'Lotes, validade e baixas', icone: 'entradas', quem: 'todos' },
        { ir: 'cardapio', titulo: 'Cardápio', texto: 'Pratos, preços e adicionais', icone: 'cardapio', quem: 'todos' },
        { ir: 'vendas', titulo: 'Histórico de vendas', texto: 'Consultar e cancelar', icone: 'vendas', quem: 'todos' },
        { ir: 'cadastros', titulo: 'Clientes', texto: 'Cadastro e restrições', icone: 'cadastros', quem: 'todos' },
        { ir: 'financeiro', titulo: 'Recebimentos', texto: 'Contas a receber e a pagar', icone: 'financeiro', quem: 'financeiro' },
        { ir: 'dashboard', titulo: 'Resultados', texto: 'O que mais vende', icone: 'dashboard', quem: 'todos' },
    ];

    function pode(a) {
        const c = estado.config;
        return a.quem === 'todos' || (a.quem === 'loja' && c.pode_operar_loja) ||
               (a.quem === 'financeiro' && c.pode_ver_financeiro) || (a.quem === 'admin' && c.pode_admin);
    }

    function novos(d) {
        return d ? (Number(d.pedidos.aguardando_aceite) || 0) + (Number(d.pedidos.aguardando_pagamento) || 0) : 0;
    }

    function avisoDo(a, d) {
        if (a.aviso === 'novos' && novos(d)) return '<span class="pdvi-selo">' + novos(d) + (novos(d) === 1 ? ' novo' : ' novos') + '</span>';
        return '';
    }

    function saudacao() {
        const h = new Date().getHours();
        return h < 12 ? 'Bom dia' : (h < 18 ? 'Boa tarde' : 'Boa noite');
    }

    function numero(valor, rotulo, ir, destaque) {
        return '<button type="button" class="pdvi-numero' + (destaque ? ' pdvi-numero-alerta' : '') + '" data-ir="' + ir + '">' +
            '<strong>' + escapar(valor) + '</strong><span>' + escapar(rotulo) + '</span></button>';
    }

    function desenhar(d) {
        const primeiroNome = String((estado.usuario && estado.usuario.nome) || '').trim().split(/\s+/)[0];
        const p = d ? d.pedidos : {};
        const n = function (s) { return Number(p[s]) || 0; };
        const loja = !!estado.config.pode_operar_loja;
        raiz.innerHTML =
            '<div class="pdvi">' +
                '<section class="pdvi-balcao">' +
                    '<div class="pdvi-balcao-texto">' +
                        '<span class="pdvi-balcao-sub">Balcão · ' + escapar(estado.config.empresa || 'Green Fit') + '</span>' +
                        '<h2 class="pdvi-balcao-titulo">' + escapar(saudacao() + (primeiroNome ? ', ' + primeiroNome : '')) + '</h2>' +
                    '</div>' +
                    '<div class="pdvi-acoes">' +
                        '<button type="button" class="pdvi-nova-venda" data-ir="pdv">' +
                            '<span class="pdvi-acao-icone">' + icone('vendas') + '</span>' +
                            '<span class="pdvi-acao-textos"><span class="pdvi-acao-nome">Nova venda</span>' +
                            '<span class="pdvi-acao-dica"><kbd>F2</kbd> de qualquer tela</span></span></button>' +
                        (loja ? '<button type="button" class="pdvi-nova-os" data-ir="pedidos-online">' +
                            '<span class="pdvi-acao-icone">' + icone('pedidos-online') + '</span>' +
                            '<span class="pdvi-acao-textos"><span class="pdvi-acao-nome">Pedidos online</span>' +
                            '<span class="pdvi-acao-dica">' + (d ? (novos(d) ? novos(d) + ' esperando a loja' : 'nenhum esperando') : 'o quadro da cozinha') +
                            '</span></span></button>' : '') +
                    '</div>' +
                '</section>' +

                '<section class="pdvi-dia" aria-label="O dia de hoje">' +
                    '<span class="pdvi-dia-rotulo">Hoje' + (d ? '<small>' + dataCurta(d.hoje) + '</small>' : '') + '</span>' +
                    numero(d ? moeda(d.vendas_hoje.total) : '…', d ? d.vendas_hoje.quantidade + (d.vendas_hoje.quantidade === 1 ? ' venda' : ' vendas') : 'vendas', 'vendas') +
                    (loja
                        ? numero(d ? String(novos(d)) : '…', 'pedidos novos', 'pedidos-online', novos(d)) +
                          numero(d ? String(n('confirmado') + n('em_preparo')) : '…', 'em preparo', 'pedidos-online') +
                          numero(d ? String(n('pronto')) : '…', 'prontos', 'pedidos-online', n('pronto')) +
                          numero(d ? String(n('saiu_entrega')) : '…', 'em entrega', 'pedidos-online')
                        : '') +
                '</section>' +

                '<div class="pdvi-corpo">' +
                    '<nav class="pdvi-atalhos" aria-label="Atalhos do PDV">' +
                        '<h3 class="pdvi-bloco-titulo">Atalhos</h3>' +
                        ATALHOS.filter(pode).map(function (a) {
                            return '<button type="button" class="pdvi-atalho" data-ir="' + a.ir + '">' +
                                '<span class="pdvi-atalho-icone">' + icone(a.icone) + '</span>' +
                                '<span class="pdvi-atalho-textos"><span class="pdvi-atalho-nome">' + escapar(a.titulo) + '</span>' +
                                '<span class="pdvi-atalho-texto">' + escapar(a.texto) + '</span></span>' + avisoDo(a, d) + '</button>';
                        }).join('') +
                    '</nav>' +

                    '<div class="pdvi-lado">' +
                        (loja
                            ? '<section class="pdvi-os" aria-label="Pedidos online em andamento">' +
                                '<h3 class="pdvi-bloco-titulo">Pedidos online em andamento' +
                                    '<button type="button" class="botao-texto-link" data-ir="pedidos-online">Abrir o quadro</button></h3>' +
                                (!d ? vazio('Carregando...') : d.ultimos_pedidos.length
                                    ? '<ul class="pdvi-fila">' + d.ultimos_pedidos.map(function (o) {
                                        return '<li class="pdvi-os-item">' +
                                            '<div class="pdvi-os-cabeca"><strong>' + escapar(o.numero) + '</strong>' + etiqueta('status_encomenda', o.status) + '</div>' +
                                            '<div class="pdvi-os-quem">' + escapar(o.cliente) + ' · ' +
                                                escapar(o.tipo_entrega === 'retirada' ? 'Retirada' : 'Entrega' + (o.entrega_bairro ? ' · ' + o.entrega_bairro : '')) + '</div>' +
                                            '<div class="pdvi-os-quem observacao">' + escapar(o.itens_texto) + '</div>' +
                                            '<div class="pdvi-os-pe"><span>' + (o.agendado_para ? 'Agendado ' + escapar(dataCurta(o.agendado_para).substring(0, 5) + ' ' + o.agendado_para.substring(11, 16))
                                                                                                  : escapar(horaCurta(o.criado_em))) + '</span>' +
                                                '<strong>' + moeda(o.valor_total) + '</strong>' +
                                                '<button type="button" class="botao-icone" data-abrir-pedido="' + o.id + '">Abrir</button></div>' +
                                        '</li>';
                                    }).join('') + '</ul>'
                                    : vazio('Nenhum pedido online em andamento.')) +
                              '</section>'
                            : '') +
                        '<section class="pdvi-os pdvi-acabando" aria-label="Pratos acabando">' +
                            '<h3 class="pdvi-bloco-titulo">Acabando<button type="button" class="botao-texto-link" data-ir="producao">Produzir</button></h3>' +
                            (!d ? vazio('Carregando...') : d.acabando.length
                                ? '<ul class="pdvi-acabando-lista">' + d.acabando.map(function (x) {
                                    return '<li><span>' + escapar(x.nome) + '</span><strong class="' + (x.vendavel > 0 ? 'saldo-baixo' : 'saldo-zero') + '">' +
                                        escapar(x.vendavel > 0 ? quantidadeLegivel(x.vendavel, 'porcao') : 'esgotado') + '</strong></li>';
                                }).join('') + '</ul>'
                                : vazio('Nenhum prato abaixo do mínimo.')) +
                        '</section>' +
                    '</div>' +
                '</div>' +
            '</div>';
    }

    async function carregarPdvInicio() {
        // Chamada antes de o painel terminar de abrir: o inicio.js desenha depois.
        if (!estado.config || !estado.usuario) return;
        desenhar(null);
        try {
            desenhar(await api.get('/pdv-painel'));
        } catch (erro) {
            avisar(erro.message, 'erro');
        }
    }

    raiz.addEventListener('click', function (evento) {
        const abrir = evento.target.closest('[data-abrir-pedido]');
        if (abrir && janela.Telas.pedidosOnline) {
            janela.Telas.pedidosOnline.abrir(Number(abrir.dataset.abrirPedido));
            return;
        }
        const alvo = evento.target.closest('[data-ir]');
        if (alvo) mostrarSecao(alvo.dataset.ir, true);
    });

    N.registrarTela('pdv-inicio', { titulo: 'PDV', carregar: carregarPdvInicio });
    janela.Telas = janela.Telas || {};
    janela.Telas.pdvInicio = { carregar: carregarPdvInicio };
})(window);
