// carga: usa Formato, Nucleo, Janela; publica Telas.pedidosOnline  (conferido por testes/front/carga.test.js)
/*
 * telas/pedidos-online.js - o gestor de pedidos da loja online (o quadro
 * da cozinha, no jeito dos apps de delivery). Window.Telas.pedidosOnline.
 *
 *   Novos        aguardando a loja aceitar (pagamento na entrega) ou
 *                aguardando o Pix (com o tempo que falta para pagar)
 *   Em preparo   confirmado (venda feita) e em preparo
 *   Prontos      embalado: espera o entregador ou o cliente buscar
 *   Em entrega   saiu para entrega
 *   Concluídos   entregues e cancelados de hoje
 *
 * Cada cartao tem o botao do proximo passo (o servidor diz qual e: proximo)
 * e, no detalhe, tudo o que a cozinha e o entregador precisam. O quadro se
 * atualiza sozinho a cada 15 s enquanto esta aberto; pedido NOVO toca um
 * bip (desliga no botao do som) e o titulo da aba mostra quantos esperam.
 * Em qualquer tela do painel, o contador do menu (Pedidos online) se
 * atualiza a cada 30 s.
 *
 * Quem decide e o servidor (api/rotas/loja.php): aceitar/confirmar faz a
 * venda (estoque pelo lote que vence primeiro + conta a receber); cancelar
 * pedido ja pago e estorno e so o admin faz (403 para os outros).
 */
(function (janela) {
    'use strict';

    const { escapar, moeda, dataCurta, horaCurta } = janela.Formato;
    const N = janela.Nucleo;
    const { api, estado, avisar, mensagemDe, etiqueta, rotuloDe, vazio, mostrarSecao } = N;
    const J = janela.Janela;

    const raiz = document.getElementById('pedidosOnlineConteudo');
    const CHAVE_SOM = 'greenfit-som-pedidos';
    const ATUALIZA_QUADRO_MS = 15000;
    const ATUALIZA_MENU_MS = 30000;

    const COLUNAS = [
        { id: 'novos', titulo: 'Novos', status: ['aguardando_aceite', 'aguardando_pagamento'], vazio: 'Nenhum pedido esperando. Quando um cliente pedir, ele aparece aqui com um bip.' },
        { id: 'preparo', titulo: 'Em preparo', aba: 'Preparo', status: ['confirmado', 'em_preparo'], vazio: 'Nada na cozinha agora.' },
        { id: 'prontos', titulo: 'Prontos', status: ['pronto'], vazio: 'Nenhum pedido pronto esperando.' },
        { id: 'entrega', titulo: 'Em entrega', aba: 'Entrega', status: ['saiu_entrega'], vazio: 'Nenhum pedido na rua.' },
        { id: 'concluidos', titulo: 'Concluídos hoje', aba: 'Feitos', status: ['entregue', 'cancelada'], vazio: 'Nenhum pedido concluído hoje ainda.' },
    ];

    /* O botao principal de cada estado: rotulo e o que ele faz. */
    function acaoPrincipal(e) {
        if (e.status === 'aguardando_aceite') return { rotulo: 'Aceitar pedido', acao: 'confirmar' };
        if (e.status === 'aguardando_pagamento') return { rotulo: 'Confirmar Pix recebido', acao: 'confirmar' };
        if (!e.proximo) return null;
        const rotulos = { em_preparo: 'Iniciar preparo', pronto: 'Marcar como pronto', saiu_entrega: 'Saiu para entrega',
                          entregue: e.tipo_entrega === 'retirada' ? 'Cliente retirou' : 'Entregue' };
        return { rotulo: rotulos[e.proximo] || e.proximo_rotulo, acao: 'avancar' };
    }

    const tela = {
        itens: [], carregado: false, aba: 'novos', atualizadoEm: null,
        diferencaRelogio: 0,       // relogio do servidor - relogio daqui (ms)
        novosConhecidos: null,     // ids dos pedidos novos ja vistos (null = ainda nao carregou)
        relogio: null, gravando: {},
    };
    let tituloBase = document.title;
    let novosNoMenu = null;

    // ------------------------------------------------------------------
    // Som e titulo da aba
    // ------------------------------------------------------------------
    function somLigado() {
        try { return localStorage.getItem(CHAVE_SOM) !== '0'; } catch (erro) { return true; }
    }
    function trocarSom() {
        try { localStorage.setItem(CHAVE_SOM, somLigado() ? '0' : '1'); } catch (erro) { /* so nesta sessao */ }
        if (somLigado()) bip();
        desenhar();
    }

    let audio = null;
    /* Dois toques curtos e agudos (o navegador so toca depois de um clique na pagina). */
    function bip() {
        if (!somLigado()) return;
        try {
            const Contexto = janela.AudioContext || janela.webkitAudioContext;
            if (!Contexto) return;
            audio = audio || new Contexto();
            if (audio.state === 'suspended') audio.resume();
            [0, 0.22].forEach(function (atraso) {
                const osc = audio.createOscillator();
                const ganho = audio.createGain();
                osc.type = 'sine';
                osc.frequency.value = 880;
                ganho.gain.setValueAtTime(0.0001, audio.currentTime + atraso);
                ganho.gain.exponentialRampToValueAtTime(0.25, audio.currentTime + atraso + 0.02);
                ganho.gain.exponentialRampToValueAtTime(0.0001, audio.currentTime + atraso + 0.18);
                osc.connect(ganho).connect(audio.destination);
                osc.start(audio.currentTime + atraso);
                osc.stop(audio.currentTime + atraso + 0.2);
            });
        } catch (erro) {
            // sem som: o contador e o destaque continuam
        }
    }

    /* Contador do menu e titulo da aba: quantos pedidos esperam a loja. */
    function mostrarNovos(n) {
        const contador = document.getElementById('contadorPedidos');
        if (contador) {
            contador.textContent = String(n);
            contador.hidden = !(n > 0);
        }
        if (!/^\(\d+\) /.test(document.title)) tituloBase = document.title;
        document.title = n > 0 ? '(' + n + ') ' + tituloBase.replace(/^\(\d+\) /, '') : tituloBase.replace(/^\(\d+\) /, '');
        if (novosNoMenu !== null && n > novosNoMenu) bip();
        novosNoMenu = n;
    }

    // ------------------------------------------------------------------
    // Tempo
    // ------------------------------------------------------------------
    function paraMs(texto) {
        if (!texto) return NaN;
        const p = String(texto).replace('T', ' ').split(/[- :]/).map(Number);
        return new Date(p[0], (p[1] || 1) - 1, p[2] || 1, p[3] || 0, p[4] || 0, p[5] || 0).getTime();
    }
    function agoraNoServidor() {
        return Date.now() + tela.diferencaRelogio;
    }
    function minutosDesde(texto) {
        return Math.max(0, Math.floor((agoraNoServidor() - paraMs(texto)) / 60000));
    }
    function textoMinutos(m) {
        if (m < 1) return 'agora';
        if (m < 60) return 'há ' + m + ' min';
        const h = Math.floor(m / 60);
        return 'há ' + h + 'h' + (m % 60 ? String(m % 60).padStart(2, '0') : '');
    }
    /* "hoje 12:30", "amanhã 12:30" ou "13/11 12:30". */
    function quandoAgendado(texto) {
        const dia = String(texto).substring(0, 10);
        const hoje = new Date(agoraNoServidor());
        const amanha = new Date(hoje.getTime() + 86400000);
        const iso = function (d) { return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0'); };
        const prefixo = dia === iso(hoje) ? 'hoje' : dia === iso(amanha) ? 'amanhã' : dataCurta(dia).substring(0, 5);
        return prefixo + ' ' + horaCurta(String(texto).length === 16 ? texto + ':00' : texto);
    }
    /* Atraso do cartao: normal ate 15 min, atencao ate 30, critico depois. */
    function classeAtraso(e) {
        if (['entregue', 'cancelada'].indexOf(e.status) !== -1 || e.agendado_para) return '';
        const m = minutosDesde(e.criado_em);
        return m > 30 ? ' po-atraso-critico' : m > 15 ? ' po-atraso-atencao' : '';
    }

    // ------------------------------------------------------------------
    // Pedacos do cartao
    // ------------------------------------------------------------------
    function textoPagamento(e) {
        if (e.pagamento === 'pix') return e.status === 'aguardando_pagamento' ? 'Pix aguardando' : (e.status === 'cancelada' ? 'Pix' : 'Pix pago');
        if (e.pagamento === 'dinheiro_entrega') {
            return 'Dinheiro' + (e.troco_para ? ' · troco p/ ' + moeda(e.troco_para) : ' · sem troco');
        }
        if (e.pagamento === 'vr_entrega') return 'Vale-refeição na entrega';
        return 'Cartão na entrega';
    }

    function prazoPix(e) {
        if (e.status !== 'aguardando_pagamento' || !e.pagar_ate) return '';
        const falta = Math.ceil((paraMs(e.pagar_ate) - agoraNoServidor()) / 60000);
        return '<div class="po-pix' + (falta <= 5 ? ' po-pix-acabando' : '') + '">' +
            (falta > 0 ? 'Pagar até ' + escapar(horaCurta(e.pagar_ate)) + ' · faltam ' + falta + ' min'
                       : 'Prazo do Pix passou: o pedido vai ser cancelado sozinho') + '</div>';
    }

    function itensHtml(e) {
        return '<ul class="po-itens">' + e.itens.map(function (i) {
            return '<li><span class="po-qtd">' + i.quantidade + 'x</span><span class="po-item-nome">' + escapar(i.descricao) +
                (i.adicionais.length
                    ? '<span class="po-adicionais">' + i.adicionais.map(function (a) {
                        return '+ ' + (a.quantidade > 1 ? a.quantidade + 'x ' : '') + escapar(a.nome);
                    }).join('<br>') + '</span>' : '') +
                (i.observacao ? '<span class="po-obs">Obs: ' + escapar(i.observacao) + '</span>' : '') +
                '</span></li>';
        }).join('') + '</ul>';
    }

    function cartaoHtml(e) {
        const principal = acaoPrincipal(e);
        const fim = e.status === 'entregue' || e.status === 'cancelada';
        const m = minutosDesde(e.criado_em);
        const ocupado = !!tela.gravando[e.id];
        return '<article class="po-cartao' + classeAtraso(e) + (fim ? ' po-fim' : '') + '" data-pedido="' + e.id + '">' +
            '<div class="po-cartao-topo">' +
                '<div><strong class="po-numero">' + escapar(e.numero) + '</strong>' +
                    '<span class="po-cliente">' + escapar(e.conta ? e.conta.nome : '') +
                        (e.conta && e.conta.pedidos <= 1 && !fim ? ' <span class="po-selo po-selo-novo">1º pedido</span>' : '') + '</span></div>' +
                '<div class="po-tempo" title="Pedido feito às ' + escapar(horaCurta(e.criado_em)) + '">' +
                    (fim ? escapar(horaCurta(e.atualizado_em)) : escapar(textoMinutos(m))) + '</div>' +
            '</div>' +
            '<div class="po-selos">' +
                (fim ? etiqueta('status_encomenda', e.status) : '') +
                (e.agendado_para ? '<span class="po-selo po-selo-agenda">Agendado ' + escapar(quandoAgendado(e.agendado_para)) + '</span>' : '') +
                '<span class="po-selo ' + (e.tipo_entrega === 'retirada' ? 'po-selo-retirada">Retirada' : 'po-selo-entrega">Entrega · ' + escapar(e.entrega_bairro || '')) + '</span>' +
                '<span class="po-selo po-selo-pagamento' + (e.status === 'aguardando_pagamento' ? ' po-selo-alerta' : '') + '">' + escapar(textoPagamento(e)) + '</span>' +
            '</div>' +
            prazoPix(e) +
            itensHtml(e) +
            (e.observacoes ? '<p class="po-recado">Recado: ' + escapar(e.observacoes) + '</p>' : '') +
            (e.conta && e.conta.restricoes && !fim ? '<p class="po-restricao">Restrição: ' + escapar(e.conta.restricoes) + '</p>' : '') +
            (e.status === 'cancelada' && e.motivo_cancelamento ? '<p class="po-motivo">' + escapar(e.motivo_cancelamento) + '</p>' : '') +
            '<div class="po-cartao-pe">' +
                '<strong class="po-total">' + moeda(e.valor_total) + '</strong>' +
                '<div class="po-botoes">' +
                    '<button type="button" class="botao-icone" data-acao="po-detalhes" data-id="' + e.id + '">Detalhes</button>' +
                    (!fim ? '<button type="button" class="botao-icone" data-acao="po-imprimir" data-id="' + e.id + '" title="Imprimir a comanda">Comanda</button>' : '') +
                '</div>' +
                (principal
                    ? '<button type="button" class="botao po-principal' + (principal.acao === 'confirmar' ? ' po-principal-novo' : '') +
                        '" data-acao="po-' + principal.acao + '" data-id="' + e.id + '"' + (ocupado ? ' disabled' : '') + '>' +
                        escapar(ocupado ? 'Gravando...' : principal.rotulo) + '</button>'
                    : '') +
            '</div>' +
        '</article>';
    }

    // ------------------------------------------------------------------
    // Desenho
    // ------------------------------------------------------------------
    function daColuna(c) {
        return tela.itens.filter(function (e) { return c.status.indexOf(e.status) !== -1; });
    }

    function desenhar() {
        if (!tela.carregado) {
            raiz.innerHTML = vazio('Carregando os pedidos...');
            return;
        }
        const som = somLigado();
        const contagens = {};
        COLUNAS.forEach(function (c) { contagens[c.id] = daColuna(c).length; });
        raiz.innerHTML =
            '<div class="po">' +
            '<div class="po-barra">' +
                '<div class="po-barra-texto">' +
                    '<strong>' + (contagens.novos ? contagens.novos + (contagens.novos === 1 ? ' pedido esperando a loja' : ' pedidos esperando a loja')
                                                  : 'Nenhum pedido esperando') + '</strong>' +
                    '<span>Atualiza sozinho' + (tela.atualizadoEm ? ' · última vez às ' + escapar(tela.atualizadoEm) : '') + '</span>' +
                '</div>' +
                '<div class="po-barra-botoes">' +
                    '<button type="button" class="botao botao-secundario botao-pequeno" data-acao="po-som" aria-pressed="' + som + '" title="Bip quando chega pedido novo">' +
                        (som ? 'Som ligado' : 'Som desligado') + '</button>' +
                    '<button type="button" class="botao botao-secundario botao-pequeno" data-acao="po-atualizar">Atualizar</button>' +
                    '<a class="botao botao-secundario botao-pequeno" href="../Loja/index.html" target="_blank" rel="noopener">Ver a loja</a>' +
                '</div>' +
            '</div>' +
            '<div class="po-abas" role="tablist" aria-label="Colunas do quadro">' +
                COLUNAS.map(function (c) {
                    return '<button type="button" role="tab" class="po-aba' + (tela.aba === c.id ? ' ativa' : '') + (c.id === 'novos' && contagens.novos ? ' po-aba-alerta' : '') +
                        '" aria-selected="' + (tela.aba === c.id) + '" data-po-aba="' + c.id + '">' + escapar(c.aba || c.titulo) +
                        ' <small>' + contagens[c.id] + '</small></button>';
                }).join('') +
            '</div>' +
            '<div class="po-quadro">' +
                COLUNAS.map(function (c) {
                    const lista = daColuna(c);
                    return '<section class="po-coluna po-coluna-' + c.id + (tela.aba === c.id ? ' ativa' : '') + '" aria-label="' + escapar(c.titulo) + '">' +
                        '<h3 class="po-coluna-titulo">' + escapar(c.titulo) + '<span>' + lista.length + '</span></h3>' +
                        '<div class="po-cartoes">' + (lista.length ? lista.map(cartaoHtml).join('') : '<p class="po-vazio">' + escapar(c.vazio) + '</p>') + '</div>' +
                    '</section>';
                }).join('') +
            '</div>' +
            '</div>';
    }

    // ------------------------------------------------------------------
    // Carga
    // ------------------------------------------------------------------
    async function buscar(silencioso) {
        const r = await api.get('/encomendas?quadro=1');
        if (r.agora) tela.diferencaRelogio = paraMs(r.agora) - Date.now();
        tela.itens = r.itens || [];
        tela.carregado = true;
        const agora = new Date();
        tela.atualizadoEm = String(agora.getHours()).padStart(2, '0') + ':' + String(agora.getMinutes()).padStart(2, '0');
        const novos = tela.itens.filter(function (e) { return COLUNAS[0].status.indexOf(e.status) !== -1; }).map(function (e) { return e.id; });
        if (tela.novosConhecidos && novos.some(function (id) { return tela.novosConhecidos.indexOf(id) === -1; })) {
            bip();
            if (!silencioso || estado.secaoAtual === 'pedidos-online') tela.aba = 'novos';
        }
        tela.novosConhecidos = novos;
        novosNoMenu = novos.length;   // o bip ja foi dado aqui
        mostrarNovos(novos.length);
        if (estado.secaoAtual === 'pedidos-online') desenhar();
    }

    async function carregarPedidosOnline() {
        if (!estado.config || !estado.config.pode_operar_loja) {
            raiz.innerHTML = vazio('Os pedidos online estão só com o administrador nesta loja (Empresa e regras > Regras).');
            return;
        }
        desenhar();
        await buscar(false);
        clearInterval(tela.relogio);
        tela.relogio = setInterval(function () {
            if (estado.secaoAtual !== 'pedidos-online') { clearInterval(tela.relogio); tela.relogio = null; return; }
            if (document.hidden) return;
            buscar(true).catch(function () { /* na proxima volta tenta de novo */ });
        }, ATUALIZA_QUADRO_MS);
    }

    /* Em qualquer tela: o contador do menu (leve: so a contagem por situacao). */
    async function conferirMenu() {
        if (!estado.config || !estado.config.pode_operar_loja || document.hidden) return;
        if (estado.secaoAtual === 'pedidos-online' && tela.relogio) return;   // o quadro ja faz
        try {
            const r = await api.get('/encomendas?status=aguardando_aceite');
            const c = r.contagem || {};
            mostrarNovos((c.aguardando_aceite || 0) + (c.aguardando_pagamento || 0));
        } catch (erro) {
            // sem rede agora: tenta na proxima volta
        }
    }
    setTimeout(conferirMenu, 4000);
    setInterval(conferirMenu, ATUALIZA_MENU_MS);

    // ------------------------------------------------------------------
    // Acoes
    // ------------------------------------------------------------------
    function pedido(id) {
        return tela.itens.find(function (e) { return e.id === id; }) || null;
    }

    async function comTrava(id, trabalho) {
        if (tela.gravando[id]) return;
        tela.gravando[id] = true;
        if (estado.secaoAtual === 'pedidos-online') desenhar();
        try {
            await trabalho();
        } catch (erro) {
            avisar(erro.message, 'erro');
        } finally {
            delete tela.gravando[id];
            try { await buscar(true); } catch (erro) { desenhar(); }
        }
    }

    function confirmar(id) {
        const e = pedido(id);
        if (!e) return;
        if (e.status === 'aguardando_pagamento' &&
            !janela.confirm('Confirmar que o Pix de ' + moeda(e.valor_total) + ' do pedido ' + e.numero + ' caiu na conta? ' +
                            'A venda é registrada e o estoque baixa.')) return;
        return comTrava(id, async function () {
            avisar(mensagemDe(await api.post('/encomendas/' + id + '/confirmar', {}), 'Pedido confirmado.'));
            if (J.aberta()) J.fecharModal();
        });
    }

    function avancar(id) {
        const e = pedido(id);
        if (!e || !e.proximo) return;
        return comTrava(id, async function () {
            avisar(mensagemDe(await api.post('/encomendas/' + id + '/avancar', { para: e.proximo }), 'Pedido atualizado.'));
            if (J.aberta()) J.fecharModal();
        });
    }

    function cancelar(id) {
        const e = pedido(id);
        if (!e) return;
        const pago = e.pagamento === 'pix' && e.status !== 'aguardando_pagamento';
        J.abrirModal({
            titulo: 'Cancelar o pedido ' + e.numero,
            textoSalvar: 'Cancelar pedido',
            campos: [
                { tipo: 'html', html: '<p class="campo-total po-aviso-cancelar">O cliente vê o cancelamento e o motivo no app.' +
                    (e.status === 'aguardando_aceite' || e.status === 'aguardando_pagamento' ? ' Nada foi cobrado ainda.'
                        : ' A venda é cancelada e as porções voltam ao estoque.' + (pago ? ' O Pix já recebido vira estorno: devolva o dinheiro ao cliente (só o administrador pode).' : '')) + '</p>' },
                { nome: 'motivo', rotulo: 'Motivo (o cliente vê)', tipo: 'textarea', obrigatorio: true, largura: 'total',
                  dica: 'Ex.: acabou o prato, fora da área de entrega, cliente desistiu por telefone.' },
            ],
            aoSalvar: async function (valores) {
                const r = await api.post('/encomendas/' + id + '/cancelar', { motivo: valores.motivo });
                avisar(mensagemDe(r, 'Pedido cancelado.'));
                await buscar(true);
            },
        });
    }

    function detalhes(id) {
        const e = pedido(id);
        if (!e) return;
        const principal = acaoPrincipal(e);
        const end = e.entrega;
        const fone = String(e.telefone || (e.conta && e.conta.telefone) || '').replace(/\D/g, '');
        const zap = fone ? 'https://wa.me/55' + fone + '?text=' + encodeURIComponent('Olá, ' + (e.conta ? e.conta.nome.split(' ')[0] : '') +
            '! Aqui é da ' + (estado.config.empresa || 'Green Fit') + ', sobre o seu pedido ' + e.numero + '.') : '';
        const linhaTotal = function (rotulo, valor, classe) {
            return '<div class="po-total-linha' + (classe ? ' ' + classe : '') + '"><span>' + escapar(rotulo) + '</span><span>' + valor + '</span></div>';
        };
        const html =
            '<div class="campo-total po-detalhe">' +
                '<div class="po-detalhe-topo">' + etiqueta('status_encomenda', e.status) +
                    '<span class="observacao">feito em ' + escapar(dataCurta(e.criado_em)) + ' às ' + escapar(horaCurta(e.criado_em)) +
                    (e.agendado_para ? ' · agendado para ' + escapar(quandoAgendado(e.agendado_para)) : '') +
                    (e.previsao && e.status !== 'entregue' && e.status !== 'cancelada' ? ' · previsão ' + escapar(horaCurta(e.previsao)) : '') + '</span></div>' +
                (e.status === 'cancelada' ? '<p class="modal-erro-texto">Cancelado: ' + escapar(e.motivo_cancelamento || '') + '</p>' : '') +
                prazoPix(e) +
                '<div class="po-detalhe-grade">' +
                    '<div><h4 class="sub-titulo">Cliente</h4><p>' + escapar(e.conta.nome) +
                        (e.conta.pedidos ? ' <span class="observacao">(' + e.conta.pedidos + (e.conta.pedidos === 1 ? ' pedido' : ' pedidos') + ')</span>' : '') +
                        '<br>' + (fone ? '<a href="tel:' + escapar(fone) + '">' + escapar(e.telefone || e.conta.telefone) + '</a>' : '') +
                        (zap ? ' · <a href="' + escapar(zap) + '" target="_blank" rel="noopener">WhatsApp</a>' : '') +
                        '<br><span class="observacao">' + escapar(e.conta.email || '') + '</span></p>' +
                        (e.conta.objetivo ? '<p class="observacao">Objetivo: ' + escapar(rotuloDe('objetivos', e.conta.objetivo)) + '</p>' : '') +
                        (e.conta.restricoes ? '<p class="po-restricao">Restrição: ' + escapar(e.conta.restricoes) + '</p>' : '') + '</div>' +
                    '<div><h4 class="sub-titulo">' + (e.tipo_entrega === 'retirada' ? 'Retirada na loja' : 'Entregar em') + '</h4>' +
                        (end
                            ? '<p>' + escapar(end.destinatario || '') + '<br>' + escapar(end.logradouro + ', ' + end.numero + (end.complemento ? ' - ' + end.complemento : '')) +
                              '<br>' + escapar(end.bairro + ' - ' + end.cidade + '/' + end.uf) + (end.cep ? '<br>CEP ' + escapar(end.cep) : '') + '</p>' +
                              (end.referencia ? '<p class="po-recado">Referência: ' + escapar(end.referencia) + '</p>' : '') +
                              '<a class="observacao" target="_blank" rel="noopener" href="https://www.google.com/maps/search/?api=1&query=' +
                                escapar(encodeURIComponent(end.logradouro + ', ' + end.numero + ' - ' + end.bairro + ', ' + end.cidade)) + '">Abrir no mapa</a>'
                            : '<p>' + escapar(e.retirada || 'O cliente busca no balcão.') + '</p>') +
                    '</div>' +
                '</div>' +
                '<h4 class="sub-titulo">Itens</h4>' + itensHtml(e) +
                (e.observacoes ? '<p class="po-recado">Recado do cliente: ' + escapar(e.observacoes) + '</p>' : '') +
                (e.nutricao && e.nutricao.kcal ? '<p class="observacao">Nutrição do pedido: ' + e.nutricao.kcal + ' kcal · ' +
                    String(e.nutricao.proteinas).replace('.', ',') + ' g de proteína</p>' : '') +
                '<div class="po-totais">' +
                    linhaTotal('Pratos', moeda(e.valor_produtos)) +
                    (e.tipo_entrega === 'entrega' ? linhaTotal('Taxa de entrega', e.taxa_entrega > 0 ? moeda(e.taxa_entrega) : 'grátis') : '') +
                    (e.desconto > 0 ? linhaTotal('Desconto' + (e.cupom_codigo ? ' (cupom ' + e.cupom_codigo + ')' : ''), '− ' + moeda(e.desconto)) : '') +
                    (e.cashback_usado > 0 ? linhaTotal('Cashback usado', '− ' + moeda(e.cashback_usado)) : '') +
                    linhaTotal('Total', '<strong>' + moeda(e.valor_total) + '</strong>', 'po-total-final') +
                    linhaTotal('Pagamento', escapar(textoPagamento(e))) +
                '</div>' +
                (e.venda ? '<p class="observacao">Venda ' + escapar(e.venda.numero) + ' (' + escapar(rotuloDe('status_venda', e.venda.status)) + ').</p>' : '') +
                (e.avaliacao_nota ? '<p class="po-avaliacao">Avaliação: ' + '★'.repeat(e.avaliacao_nota) + '☆'.repeat(5 - e.avaliacao_nota) +
                    (e.avaliacao_comentario ? ' · “' + escapar(e.avaliacao_comentario) + '”' : '') + '</p>' : '') +
                '<details class="po-eventos"><summary>Linha do tempo (' + e.eventos.length + ')</summary><ul>' +
                    e.eventos.map(function (ev) {
                        return '<li><strong>' + escapar(ev.rotulo) + '</strong> · ' + escapar(dataCurta(ev.momento).substring(0, 5) + ' ' + horaCurta(ev.momento)) +
                            (ev.usuario ? ' · ' + escapar(ev.usuario) : '') + (ev.observacao ? '<br><span class="observacao">' + escapar(ev.observacao) + '</span>' : '') + '</li>';
                    }).join('') + '</ul></details>' +
                '<div class="po-detalhe-acoes">' +
                    (e.pode_cancelar ? '<button type="button" class="botao botao-secundario po-cancelar" data-acao="po-cancelar" data-id="' + e.id + '">Cancelar pedido</button>' : '') +
                    '<button type="button" class="botao botao-secundario" data-acao="po-imprimir" data-id="' + e.id + '">Imprimir comanda</button>' +
                    (principal ? '<button type="button" class="botao po-principal' + (principal.acao === 'confirmar' ? ' po-principal-novo' : '') + '" data-acao="po-' + principal.acao + '" data-id="' + e.id + '">' + escapar(principal.rotulo) + '</button>' : '') +
                '</div>' +
            '</div>';
        J.abrirModal({ titulo: 'Pedido ' + e.numero, html: html, somenteLeitura: true });
    }

    /* A comanda de 80 mm: so ela aparece na impressao (vendas.css, @media print). */
    function imprimir(id) {
        const e = pedido(id);
        if (!e) return;
        const end = e.entrega;
        const linha = function (a, b) { return '<div class="gf-impressao-linha"><span>' + a + '</span><span>' + b + '</span></div>'; };
        const folha = document.createElement('div');
        folha.className = 'gf-impressao';
        folha.innerHTML =
            '<div class="gf-impressao-cabeca"><strong>' + escapar(estado.config.empresa || 'Green Fit') + '</strong>' +
                '<span>Pedido ' + escapar(e.numero) + '</span><span>' + escapar(dataCurta(e.criado_em) + ' ' + horaCurta(e.criado_em)) + '</span></div>' +
            '<div class="gf-impressao-destaque">' + (e.tipo_entrega === 'retirada' ? 'RETIRADA' : 'ENTREGA') +
                (e.agendado_para ? ' · AGENDADO ' + escapar(quandoAgendado(e.agendado_para)) : '') + '</div>' +
            '<p>' + escapar(e.conta.nome) + (e.telefone ? ' · ' + escapar(e.telefone) : '') + '</p>' +
            (end ? '<p>' + escapar(end.logradouro + ', ' + end.numero + (end.complemento ? ' - ' + end.complemento : '')) + '<br>' +
                   escapar(end.bairro) + (end.referencia ? '<br>Ref.: ' + escapar(end.referencia) : '') + '</p>' : '') +
            '<hr>' +
            e.itens.map(function (i) {
                return '<div class="gf-impressao-item"><strong>' + i.quantidade + 'x ' + escapar(i.descricao) + '</strong>' +
                    i.adicionais.map(function (a) { return '<div>+ ' + (a.quantidade > 1 ? a.quantidade + 'x ' : '') + escapar(a.nome) + '</div>'; }).join('') +
                    (i.observacao ? '<div class="gf-impressao-obs">OBS: ' + escapar(i.observacao) + '</div>' : '') + '</div>';
            }).join('') +
            (e.observacoes ? '<div class="gf-impressao-obs">RECADO: ' + escapar(e.observacoes) + '</div>' : '') +
            (e.conta.restricoes ? '<div class="gf-impressao-obs">RESTRIÇÃO: ' + escapar(e.conta.restricoes) + '</div>' : '') +
            '<hr>' +
            linha('Pratos', moeda(e.valor_produtos)) +
            (e.taxa_entrega > 0 ? linha('Entrega', moeda(e.taxa_entrega)) : '') +
            (e.desconto + e.cashback_usado > 0 ? linha('Descontos', '− ' + moeda(e.desconto + e.cashback_usado)) : '') +
            '<div class="gf-impressao-linha gf-impressao-total"><span>TOTAL</span><span>' + moeda(e.valor_total) + '</span></div>' +
            '<p>' + escapar(textoPagamento(e)) + '</p>';
        imprimirFolha(folha);
    }

    function imprimirFolha(folha) {
        document.querySelectorAll('.gf-impressao').forEach(function (x) { x.remove(); });
        document.body.appendChild(folha);
        document.body.classList.add('gf-imprimindo');
        const limpar = function () {
            document.body.classList.remove('gf-imprimindo');
            folha.remove();
            janela.removeEventListener('afterprint', limpar);
        };
        janela.addEventListener('afterprint', limpar);
        janela.print();
        setTimeout(limpar, 1500);   // navegador sem afterprint
    }

    N.registrarAcoes({
        'po-detalhes': detalhes,
        'po-confirmar': confirmar,
        'po-avancar': avancar,
        'po-cancelar': cancelar,
        'po-imprimir': imprimir,
        'po-som': trocarSom,
        'po-atualizar': function () {
            return buscar(false).then(function () { avisar('Quadro atualizado.'); });
        },
    });

    raiz.addEventListener('click', function (evento) {
        const aba = evento.target.closest('[data-po-aba]');
        if (aba) {
            tela.aba = aba.dataset.poAba;
            desenhar();
        }
    });

    N.registrarTela('pedidos-online', { titulo: 'Pedidos online', carregar: carregarPedidosOnline });
    janela.Telas = janela.Telas || {};
    janela.Telas.pedidosOnline = { carregar: carregarPedidosOnline, abrir: function (id) {
        mostrarSecao('pedidos-online', true);
        const espera = setInterval(function () {
            if (tela.carregado && pedido(id)) { clearInterval(espera); detalhes(id); }
        }, 150);
        setTimeout(function () { clearInterval(espera); }, 5000);
    }, imprimirFolha: imprimirFolha };
})(window);
