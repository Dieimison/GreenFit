// carga: usa Formato, Nucleo, Janela; publica Telas.loja  (conferido por testes/front/carga.test.js)
/*
 * telas/loja.js - a loja online do lado do dono (so admin). Window.Telas.loja.
 *
 *   Ajustes      aberta ou pausada, nome e aviso no app, entrega e retirada,
 *                pedido minimo, entrega gratis, Pix e pagamento na entrega,
 *                agendamento, cashback e contato (GET/PUT /api/loja-ajustes)
 *   Horarios     o funcionamento de cada dia (GET/PUT /api/horarios)
 *   Bairros      onde entrega, com a taxa e o tempo de viagem (/api/bairros)
 *   Cupons       codigos de desconto (/api/cupons)
 *   Avaliacoes   as notas que os clientes deram aos pedidos entregues
 *
 * Os pedidos em si ficam no quadro (Pedidos online). Quem confere tudo e o
 * servidor (api/rotas/loja.php e catalogo.php); a tela so mostra e pede.
 */
(function (janela) {
    'use strict';

    const { escapar, moeda, dataCurta, horaCurta } = janela.Formato;
    const N = janela.Nucleo;
    const { api, avisar, mensagemDe, opcoesDoDominio, etiquetaTexto, tabelaHtml, vazio } = N;
    const J = janela.Janela;

    const raiz = document.getElementById('lojaConteudo');
    const ABAS = [['ajustes', 'Ajustes'], ['horarios', 'Horários'], ['bairros', 'Bairros e taxas'], ['cupons', 'Cupons'], ['avaliacoes', 'Avaliações']];
    let aba = 'ajustes';
    const dados = { ajustes: null, horarios: [], bairros: [], cupons: [], avaliacoes: null };

    function enderecoDaLoja() {
        return janela.location.origin + '/loja';
    }

    // ------------------------------------------------------------------
    // Desenho
    // ------------------------------------------------------------------
    function desenhar() {
        const a = dados.ajustes;
        const f = a ? a.funcionamento : null;
        raiz.innerHTML =
            '<div class="loja-faixa lj-faixa">' +
                '<div class="lj-estado">' +
                    (a ? (a.aberta ? etiquetaTexto(f && f.aberta_agora ? 'Aberta agora' : 'Ligada (fora do horário)', f && f.aberta_agora ? '--bom' : '--atencao')
                                   : etiquetaTexto('Pausada: não recebe pedidos', '--critico')) : '') +
                    (f ? '<span class="observacao">' + escapar(f.texto) + '</span>' : '') +
                '</div>' +
                '<div class="lj-endereco">' +
                    '<span class="observacao">Endereço para divulgar:</span> <code>' + escapar(enderecoDaLoja()) + '</code>' +
                    '<button type="button" class="botao-icone" data-lj="copiar">Copiar</button>' +
                    '<a class="botao botao-pequeno botao-secundario" href="../Loja/index.html" target="_blank" rel="noopener">Abrir a loja como o cliente vê</a>' +
                '</div>' +
            '</div>' +
            '<div class="sub-abas" role="tablist" aria-label="Partes da loja online">' +
                ABAS.map(function (x) {
                    return '<button type="button" role="tab" aria-selected="' + (x[0] === aba) + '" class="sub-aba' + (x[0] === aba ? ' ativa' : '') +
                        '" data-lj-aba="' + x[0] + '">' + escapar(x[1]) + '</button>';
                }).join('') +
            '</div>' +
            '<div class="admin-painel">' + ({ ajustes: desenharAjustes, horarios: desenharHorarios, bairros: desenharBairros,
                                               cupons: desenharCupons, avaliacoes: desenharAvaliacoes }[aba])() + '</div>';
    }

    function interruptor(nome, ligado, texto, dica) {
        return '<div class="campo campo-total lj-interruptor">' +
            '<label class="interruptor"><input type="checkbox" name="' + nome + '"' + (ligado ? ' checked' : '') + '>' +
            '<span class="interruptor-trilho"><span class="interruptor-bola"></span></span>' +
            '<span class="interruptor-texto">' + escapar(texto) + '</span></label>' +
            (dica ? '<small class="dica">' + escapar(dica) + '</small>' : '') + '</div>';
    }

    function campo(nome, rotulo, valor, extra) {
        extra = extra || {};
        const id = 'lj-' + nome;
        const v = valor === null || valor === undefined ? '' : valor;
        return '<div class="campo' + (extra.total ? ' campo-total' : '') + '"><label for="' + id + '">' + escapar(rotulo) + '</label>' +
            (extra.tipo === 'textarea'
                ? '<textarea id="' + id + '" name="' + nome + '" rows="2"' + (extra.attrs || '') + '>' + escapar(v) + '</textarea>'
                : '<input type="' + (extra.tipo || 'text') + '" id="' + id + '" name="' + nome + '" value="' + escapar(v) + '"' + (extra.attrs || '') + '>') +
            (extra.dica ? '<small class="dica">' + escapar(extra.dica) + '</small>' : '') + '</div>';
    }

    function bloco(titulo, cor, corpo) {
        return '<fieldset class="lj-bloco"><legend><span style="background:var(' + cor + ')"></span>' + escapar(titulo) + '</legend>' +
            '<div class="formulario lj-campos">' + corpo + '</div></fieldset>';
    }

    function desenharAjustes() {
        const a = dados.ajustes;
        if (!a) return vazio('Carregando...');
        const dinheiro = ' min="0" step="0.01" inputmode="decimal"';
        return '<form id="formLojaAjustes" class="lj-form">' +
            '<div class="lj-abrir' + (a.aberta ? ' ligada' : '') + '">' +
                '<label class="interruptor lj-interruptor-grande"><input type="checkbox" name="aberta"' + (a.aberta ? ' checked' : '') + '>' +
                '<span class="interruptor-trilho"><span class="interruptor-bola"></span></span>' +
                '<span class="interruptor-texto"><strong>Loja aberta para pedidos</strong>' +
                    '<small>Desligada, o cardápio continua no ar, mas ninguém finaliza pedido. Ligada, vale o horário de funcionamento.</small></span></label>' +
            '</div>' +
            bloco('Como a loja aparece no app', '--acento',
                campo('nome_vitrine', 'Nome no app', a.nome_vitrine, { attrs: ' maxlength="80"', dica: 'Vazio: o nome da empresa (' + a.nome + ').' }) +
                campo('slogan', 'Frase de apresentação', a.slogan, { total: true, attrs: ' maxlength="140"', dica: 'Aparece embaixo do nome.' }) +
                campo('mensagem_aviso', 'Aviso no topo (opcional)', a.mensagem_aviso, { total: true, attrs: ' maxlength="200"',
                      dica: 'Ex.: "Cardápio novo de verão!" ou "Hoje fechamos às 18h". Vazio: sem aviso.' })) +
            bloco('Entrega e retirada', '--serie-1',
                interruptor('aceita_entrega', a.aceita_entrega, 'Fazer entregas', 'Só nos bairros cadastrados (aba Bairros e taxas), cada um com a sua taxa.') +
                interruptor('aceita_retirada', a.aceita_retirada, 'Cliente pode retirar na loja') +
                campo('endereco_retirada', 'Endereço para retirada', a.endereco_retirada, { total: true, attrs: ' maxlength="200"',
                      dica: 'O cliente vê ao escolher retirar. Obrigatório com a retirada ligada.' }) +
                campo('tempo_preparo_min', 'Tempo de preparo (minutos)', a.tempo_preparo_min, { tipo: 'number', attrs: ' min="5" max="600" step="1"',
                      dica: 'Somado ao tempo de viagem do bairro: é a previsão que o cliente vê.' }) +
                campo('pedido_minimo', 'Pedido mínimo em pratos (R$)', a.pedido_minimo, { tipo: 'number', attrs: dinheiro, dica: '0 = sem mínimo.' }) +
                campo('frete_gratis_acima', 'Entrega grátis a partir de (R$)', a.frete_gratis_acima, { tipo: 'number', attrs: dinheiro, dica: '0 = nunca grátis.' })) +
            bloco('Pagamento', '--serie-3',
                interruptor('aceita_pix', a.aceita_pix, 'Pix na hora do pedido', 'O cliente vê a chave e paga; a cozinha começa quando você confirma que o Pix caiu.') +
                campo('chave_pix', 'Chave Pix', a.chave_pix, { attrs: ' maxlength="120"' }) +
                campo('recebedor_pix', 'Nome de quem recebe', a.recebedor_pix, { attrs: ' maxlength="80"' }) +
                campo('prazo_pagamento_min', 'Prazo para pagar o Pix (minutos)', a.prazo_pagamento_min, { tipo: 'number', attrs: ' min="5" max="1440" step="1"',
                      dica: 'Passou do prazo sem pagar: o pedido é cancelado sozinho e as porções voltam.' }) +
                interruptor('aceita_pagamento_entrega', a.aceita_pagamento_entrega, 'Pagamento na entrega (cartão, dinheiro, vale-refeição)',
                            'A loja aceita o pedido; a conta fica a receber e baixa sozinha quando o pedido é entregue.')) +
            bloco('Agendamento e fidelidade', '--dourado',
                interruptor('aceita_agendamento', a.aceita_agendamento, 'Cliente pode agendar o pedido (até 7 dias)',
                            'Fora do horário, o pedido só entra agendado.') +
                campo('cashback_percentual', 'Cashback (% dos pratos)', a.cashback_percentual, { tipo: 'number', attrs: ' min="0" max="30" step="1"',
                      dica: 'Crédito para o próximo pedido, dado quando o pedido é entregue. 0 = sem cashback. Paga no máximo metade dos pratos.' })) +
            bloco('Contato', '--serie-5',
                campo('whatsapp', 'WhatsApp da loja', a.whatsapp, { tipo: 'tel', attrs: ' maxlength="20" inputmode="tel"', dica: 'Com DDD. Vira o botão "Falar com a loja" no app.' }) +
                campo('instagram', 'Instagram', a.instagram ? '@' + a.instagram : '', { attrs: ' maxlength="60"', dica: 'Ex.: @green_fit_floripa' })) +
            '<div class="lj-salvar"><button type="submit" class="botao">Salvar ajustes</button>' +
                '<span class="observacao">Gravado às ' + escapar(horaCurta(a.atualizado_em)) + ' de ' + escapar(dataCurta(a.atualizado_em)) + '</span></div>' +
        '</form>';
    }

    function desenharHorarios() {
        return '<div class="table-section">' +
            '<h3 class="table-title"><span style="background:var(--serie-1)"></span>Horário de funcionamento</h3>' +
            '<p class="secao-descricao">Fora do horário o cliente vê "Fechado · abre amanhã às 11:00" e, se o agendamento estiver ligado, pode agendar.</p>' +
            '<form id="formLojaHorarios" class="lj-horarios">' +
                dados.horarios.map(function (h) {
                    return '<div class="lj-dia' + (h.aberto ? '' : ' fechado') + '" data-dia="' + h.dia + '">' +
                        '<label class="interruptor"><input type="checkbox" name="aberto"' + (h.aberto ? ' checked' : '') + '>' +
                            '<span class="interruptor-trilho"><span class="interruptor-bola"></span></span>' +
                            '<span class="interruptor-texto">' + escapar(h.nome) + '</span></label>' +
                        '<label class="lj-hora">Abre <input type="time" name="abre" value="' + escapar(h.abre) + '" step="300"></label>' +
                        '<label class="lj-hora">Fecha <input type="time" name="fecha" value="' + escapar(h.fecha) + '" step="300"></label>' +
                    '</div>';
                }).join('') +
                '<div class="lj-salvar"><button type="submit" class="botao">Salvar horários</button></div>' +
            '</form></div>';
    }

    function desenharBairros() {
        return '<div class="table-section">' +
            '<h3 class="table-title"><span style="background:var(--serie-1)"></span>Bairros atendidos' +
                '<button type="button" class="botao botao-pequeno" data-lj="novo-bairro">+ Bairro</button></h3>' +
            '<p class="secao-descricao">O cliente escolhe o bairro numa lista: fora dela, só retirada. A previsão de entrega soma o tempo de preparo e o tempo de viagem do bairro.</p>' +
            (dados.bairros.length
                ? tabelaHtml({
                    colunas: ['Bairro', 'Cidade', { titulo: 'Taxa', classe: 'numero' }, { titulo: 'Viagem', classe: 'numero' }, 'Situação',
                              { titulo: 'Pedidos', classe: 'numero' }, { titulo: 'Ações', classe: 'coluna-acoes' }],
                    linhas: dados.bairros.map(function (b) {
                        return { classe: b.ativo ? '' : 'linha-inativa', celulas: [
                            '<strong>' + escapar(b.nome) + '</strong>', escapar(b.cidade),
                            { classe: 'numero', html: Number(b.taxa) > 0 ? moeda(b.taxa) : 'grátis' },
                            { classe: 'numero', html: escapar(b.tempo_min + ' min') },
                            b.ativo ? etiquetaTexto('Atendido', '--bom') : etiquetaTexto('Fora da área', '--tinta-fraca'),
                            { classe: 'numero', html: String(b.pedidos || 0) },
                            { classe: 'coluna-acoes', html: '<button type="button" class="botao-icone" data-lj="editar-bairro" data-id="' + b.id + '">Editar</button>' +
                                (Number(b.pedidos) ? '' : '<button type="button" class="botao-icone perigo" data-lj="excluir-bairro" data-id="' + b.id + '">Excluir</button>') },
                        ] };
                    }),
                })
                : vazio('Nenhum bairro cadastrado: a loja só faz retirada. Clique em "+ Bairro".')) +
        '</div>';
    }

    function textoCupom(c) {
        if (c.tipo === 'percentual') return String(Number(c.valor)).replace('.', ',') + '% nos pratos';
        if (c.tipo === 'valor') return moeda(c.valor) + ' de desconto';
        return 'Entrega grátis';
    }

    function validadeCupom(c) {
        if (!c.inicio && !c.fim) return 'sempre';
        return (c.inicio ? 'de ' + dataCurta(c.inicio) : '') + (c.fim ? ' até ' + dataCurta(c.fim) : '');
    }

    function desenharCupons() {
        const hoje = new Date().toISOString().substring(0, 10);
        return '<div class="table-section">' +
            '<h3 class="table-title"><span style="background:var(--dourado)"></span>Cupons de desconto' +
                '<button type="button" class="botao botao-pequeno" data-lj="novo-cupom">+ Cupom</button></h3>' +
            '<p class="secao-descricao">O cliente digita o código no carrinho. O servidor confere validade, pedido mínimo, limite de usos e primeira compra.</p>' +
            (dados.cupons.length
                ? tabelaHtml({
                    colunas: ['Código', 'Desconto', { titulo: 'Pedido mínimo', classe: 'numero' }, 'Validade', { titulo: 'Usos', classe: 'numero' },
                              { titulo: 'Desconto dado', classe: 'numero' }, 'Situação', { titulo: 'Ações', classe: 'coluna-acoes' }],
                    linhas: dados.cupons.map(function (c) {
                        const vencido = c.fim && c.fim < hoje;
                        const esgotado = c.limite_usos && Number(c.usos) >= Number(c.limite_usos);
                        return { classe: c.ativo && !vencido ? '' : 'linha-inativa', celulas: [
                            '<code class="lj-codigo">' + escapar(c.codigo) + '</code>' + (c.descricao ? '<br><small class="observacao">' + escapar(c.descricao) + '</small>' : ''),
                            escapar(textoCupom(c)) + (Number(c.primeira_compra) ? '<br><small class="observacao">só na 1ª compra</small>' : ''),
                            { classe: 'numero', html: Number(c.pedido_minimo) > 0 ? moeda(c.pedido_minimo) : '—' },
                            escapar(validadeCupom(c)),
                            { classe: 'numero', html: String(c.usos || 0) + (c.limite_usos ? ' de ' + c.limite_usos : '') },
                            { classe: 'numero', html: moeda(c.desconto_dado || 0) },
                            !Number(c.ativo) ? etiquetaTexto('Desativado', '--tinta-fraca') : vencido ? etiquetaTexto('Vencido', '--critico')
                                : esgotado ? etiquetaTexto('Esgotado', '--atencao') : etiquetaTexto('Valendo', '--bom'),
                            { classe: 'coluna-acoes', html: '<button type="button" class="botao-icone" data-lj="editar-cupom" data-id="' + c.id + '">Editar</button>' +
                                (Number(c.usos) ? '' : '<button type="button" class="botao-icone perigo" data-lj="excluir-cupom" data-id="' + c.id + '">Excluir</button>') },
                        ] };
                    }),
                })
                : vazio('Nenhum cupom. Que tal um BEMVINDO10 para a primeira compra?')) +
        '</div>';
    }

    function estrelas(n) {
        return '<span class="lj-estrelas" aria-label="' + n + ' de 5 estrelas">' + '★'.repeat(n) + '<span class="apagada">' + '★'.repeat(5 - n) + '</span></span>';
    }

    function desenharAvaliacoes() {
        const av = dados.avaliacoes;
        if (!av) return vazio('Carregando as avaliações...');
        const notas = av.filter(function (e) { return e.avaliacao_nota; });
        if (!notas.length) {
            return '<div class="table-section">' + vazio('Nenhuma avaliação ainda. Depois de entregue, o cliente avalia o pedido no app (de 1 a 5 estrelas).') + '</div>';
        }
        const media = notas.reduce(function (s, e) { return s + e.avaliacao_nota; }, 0) / notas.length;
        const por = [5, 4, 3, 2, 1].map(function (n) {
            return [n, notas.filter(function (e) { return e.avaliacao_nota === n; }).length];
        });
        return '<div class="table-section">' +
            '<div class="lj-media">' +
                '<div class="lj-media-numero"><strong>' + media.toFixed(1).replace('.', ',') + '</strong>' + estrelas(Math.round(media)) +
                    '<span class="observacao">' + notas.length + (notas.length === 1 ? ' avaliação' : ' avaliações') + ' de ' + av.length +
                    (av.length === 1 ? ' pedido entregue' : ' pedidos entregues') + '</span></div>' +
                '<div class="lj-barras">' + por.map(function (x) {
                    const pct = Math.round(x[1] * 100 / notas.length);
                    return '<div class="lj-barra"><span>' + x[0] + ' ★</span><span class="lj-barra-trilho"><span style="width:' + pct + '%"></span></span>' +
                        '<span class="observacao">' + x[1] + '</span></div>';
                }).join('') + '</div>' +
            '</div>' +
            '<p class="observacao lj-recentes">As ' + notas.filter(function (e) { return e.detalhado; }).length + ' avaliações mais recentes:</p>' +
            '<ul class="lj-avaliacoes">' + notas.filter(function (e) { return e.detalhado; }).map(function (e) {
                return '<li class="lj-avaliacao">' +
                    '<div class="lj-avaliacao-topo">' + estrelas(e.avaliacao_nota) + '<strong>' + escapar(e.cliente || '') + '</strong>' +
                        '<span class="observacao">' + escapar(e.numero) + ' · ' + escapar(dataCurta(e.criado_em)) + '</span></div>' +
                    (e.comentario ? '<p class="lj-comentario">“' + escapar(e.comentario) + '”</p>' : '<p class="observacao">Sem comentário.</p>') +
                    '<p class="observacao">' + escapar(e.itens_texto) + '</p>' +
                '</li>';
            }).join('') + '</ul>' +
        '</div>';
    }

    // ------------------------------------------------------------------
    // Carga
    // ------------------------------------------------------------------
    async function buscarAba() {
        if (aba === 'horarios') dados.horarios = (await api.get('/horarios')).itens;
        else if (aba === 'bairros') dados.bairros = (await api.get('/bairros')).itens;
        else if (aba === 'cupons') dados.cupons = (await api.get('/cupons')).itens;
        else if (aba === 'avaliacoes') dados.avaliacoes = await buscarAvaliacoes();
    }

    /* As notas vem na lista; o comentario, no detalhe (so dos avaliados, os 40 mais recentes). */
    async function buscarAvaliacoes() {
        const lista = (await api.get('/encomendas?status=entregue')).itens;
        const avaliados = lista.filter(function (e) { return e.avaliacao_nota; }).slice(0, 40);
        const detalhes = await Promise.all(avaliados.map(function (e) {
            return api.get('/encomendas/' + e.id).then(function (r) { return r.encomenda; }).catch(function () { return null; });
        }));
        avaliados.forEach(function (e, i) {
            if (detalhes[i]) {
                e.detalhado = true;
                e.comentario = detalhes[i].avaliacao_comentario;
                e.cliente = e.cliente || (detalhes[i].conta && detalhes[i].conta.nome);
            }
        });
        return lista;
    }

    async function carregarLoja() {
        const r = await Promise.all([api.get('/loja-ajustes'), buscarAba()]);
        dados.ajustes = r[0].ajustes;
        desenhar();
    }

    // ------------------------------------------------------------------
    // Bairros e cupons (janela de cadastro)
    // ------------------------------------------------------------------
    function abrirBairro(b) {
        J.abrirModal({
            titulo: b ? 'Bairro: ' + b.nome : 'Novo bairro atendido',
            campos: [
                { nome: 'nome', rotulo: 'Bairro', valor: b ? b.nome : '', obrigatorio: true },
                { nome: 'cidade', rotulo: 'Cidade', valor: b ? b.cidade : 'Florianópolis', obrigatorio: true },
                { nome: 'taxa', rotulo: 'Taxa de entrega (R$)', tipo: 'number', valor: b ? b.taxa : '', dica: '0 = entrega grátis neste bairro.' },
                { nome: 'tempo_min', rotulo: 'Tempo de viagem (minutos)', tipo: 'number', passo: '1', minimo: 0, maximo: 300, valor: b ? b.tempo_min : 15 },
                { nome: 'ativo', rotulo: 'Situação', tipo: 'checkbox', valor: b ? !!Number(b.ativo) : true, textoSim: 'Atendido (aparece para o cliente)' },
            ],
            aoSalvar: async function (v) {
                const r = b ? await api.put('/bairros/' + b.id, v) : await api.post('/bairros', v);
                avisar(mensagemDe(r, 'Bairro gravado.'));
                await carregarLoja();
            },
        });
    }

    function abrirCupom(c) {
        J.abrirModal({
            titulo: c ? 'Cupom ' + c.codigo : 'Novo cupom',
            campos: [
                { nome: 'codigo', rotulo: 'Código (o cliente digita)', valor: c ? c.codigo : '', obrigatorio: true, dica: '3 a 20 letras ou números, sem espaço. Ex.: BEMVINDO10.' },
                { nome: 'descricao', rotulo: 'Descrição (só para a loja)', valor: c ? c.descricao : '' },
                { nome: 'tipo', rotulo: 'Tipo de desconto', tipo: 'select', valor: c ? c.tipo : 'percentual', opcoes: opcoesDoDominio('tipos_cupom') },
                { nome: 'valor', rotulo: 'Valor', tipo: 'number', valor: c ? c.valor : '', dica: 'Porcentagem: 10 = 10% nos pratos. Valor: em reais. Entrega grátis: deixe 0.' },
                { nome: 'pedido_minimo', rotulo: 'Pedido mínimo em pratos (R$)', tipo: 'number', valor: c ? c.pedido_minimo : '', dica: '0 = sem mínimo.' },
                { nome: 'inicio', rotulo: 'Válido a partir de', tipo: 'date', valor: c ? (c.inicio || '') : '' },
                { nome: 'fim', rotulo: 'Válido até', tipo: 'date', valor: c ? (c.fim || '') : '' },
                { nome: 'limite_usos', rotulo: 'Limite de usos (total)', tipo: 'number', passo: '1', minimo: 1, valor: c ? (c.limite_usos || '') : '', dica: 'Vazio = sem limite.' },
                { nome: 'limite_por_cliente', rotulo: 'Usos por cliente', tipo: 'number', passo: '1', minimo: 1, valor: c ? c.limite_por_cliente : 1 },
                { nome: 'primeira_compra', rotulo: 'Primeira compra', tipo: 'checkbox', valor: c ? !!Number(c.primeira_compra) : false, textoSim: 'Só na primeira compra do cliente' },
                { nome: 'ativo', rotulo: 'Situação', tipo: 'checkbox', valor: c ? !!Number(c.ativo) : true, textoSim: 'Ativo' },
            ],
            aoSalvar: async function (v) {
                const r = c ? await api.put('/cupons/' + c.id, v) : await api.post('/cupons', v);
                avisar(mensagemDe(r, 'Cupom gravado.'));
                await carregarLoja();
            },
        });
    }

    // ------------------------------------------------------------------
    // Eventos
    // ------------------------------------------------------------------
    function copiar(texto) {
        const feito = function () { avisar('Endereço copiado: ' + texto); };
        if (navigator.clipboard && navigator.clipboard.writeText) {
            navigator.clipboard.writeText(texto).then(feito, function () { janela.prompt('Copie o endereço:', texto); });
        } else {
            janela.prompt('Copie o endereço:', texto);
        }
    }

    raiz.addEventListener('click', async function (evento) {
        const trocar = evento.target.closest('[data-lj-aba]');
        if (trocar) {
            aba = trocar.dataset.ljAba;
            trocar.disabled = true;
            try { await carregarLoja(); } catch (erro) { desenhar(); avisar(erro.message, 'erro'); }
            return;
        }
        const alvo = evento.target.closest('[data-lj]');
        if (!alvo) return;
        const id = Number(alvo.dataset.id);
        const bairro = dados.bairros.find(function (b) { return b.id === id; });
        const cupom = dados.cupons.find(function (c) { return c.id === id; });
        try {
            switch (alvo.dataset.lj) {
                case 'copiar': copiar(enderecoDaLoja()); return;
                case 'novo-bairro': abrirBairro(null); return;
                case 'editar-bairro': abrirBairro(bairro); return;
                case 'novo-cupom': abrirCupom(null); return;
                case 'editar-cupom': abrirCupom(cupom); return;
                case 'excluir-bairro':
                    if (!janela.confirm('Excluir o bairro "' + bairro.nome + '"?')) return;
                    avisar(mensagemDe(await api.remover('/bairros/' + id), 'Bairro excluído.'));
                    break;
                case 'excluir-cupom':
                    if (!janela.confirm('Excluir o cupom ' + cupom.codigo + '?')) return;
                    avisar(mensagemDe(await api.remover('/cupons/' + id), 'Cupom excluído.'));
                    break;
                default: return;
            }
            await carregarLoja();
        } catch (erro) {
            avisar(erro.message, 'erro');
        }
    });

    /* Dia fechado fica apagado na hora em que desliga. */
    raiz.addEventListener('change', function (evento) {
        const dia = evento.target.closest('.lj-dia');
        if (dia && evento.target.name === 'aberto') dia.classList.toggle('fechado', !evento.target.checked);
        const abrir = evento.target.closest('.lj-abrir');
        if (abrir) abrir.classList.toggle('ligada', evento.target.checked);
    });

    raiz.addEventListener('submit', async function (evento) {
        const f = evento.target;
        if (f.id !== 'formLojaAjustes' && f.id !== 'formLojaHorarios') return;
        evento.preventDefault();
        const botao = f.querySelector('button[type="submit"]');
        botao.disabled = true;
        try {
            if (f.id === 'formLojaAjustes') {
                const corpo = {};
                Array.from(f.elements).forEach(function (el) {
                    if (el.name) corpo[el.name] = el.type === 'checkbox' ? (el.checked ? 1 : 0) : el.value;
                });
                avisar(mensagemDe(await api.put('/loja-ajustes', corpo), 'Ajustes gravados.'));
            } else {
                const horarios = Array.from(f.querySelectorAll('.lj-dia')).map(function (d) {
                    return { dia: Number(d.dataset.dia), aberto: d.querySelector('[name="aberto"]').checked ? 1 : 0,
                             abre: d.querySelector('[name="abre"]').value, fecha: d.querySelector('[name="fecha"]').value };
                });
                avisar(mensagemDe(await api.put('/horarios', { horarios: horarios }), 'Horários gravados.'));
            }
            await carregarLoja();
        } catch (erro) {
            avisar(erro.message, 'erro');
            botao.disabled = false;
        }
    });

    N.registrarTela('loja', { titulo: 'Loja online', carregar: carregarLoja, soAdmin: true });
    janela.Telas = janela.Telas || {};
    janela.Telas.loja = { carregar: carregarLoja };
})(window);
