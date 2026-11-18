// carga: usa Formato, RegrasPdv, Nucleo, Janela; publica Telas.pdv  (conferido por testes/front/carga.test.js)
/*
 * telas/pdv.js - o PDV do balcao: vender PRATOS do cardapio. Window.Telas.pdv.
 *
 *   esquerda   a grade do cardapio (foto, preco, porcoes que da para vender
 *              agora), com as categorias e a busca
 *   direita    a venda: cliente, itens (com os adicionais), desconto, total,
 *              pagamento, troco e observacao
 *
 * Prato com adicionais ("Escolha o molho", "Turbine seu prato") abre o
 * seletor: minimo e maximo de cada grupo conferidos aqui e de novo no
 * servidor. O mesmo prato com os mesmos adicionais soma na mesma linha.
 *
 * Grava pelo POST /api/vendas: quem escolhe o lote (o que vence primeiro)
 * e quem confere estoque, reserva da loja online e as regras da loja
 * (Admin > Regras) e o servidor. O PDV so mostra antes o que ele vai
 * conferir (limite de desconto, cliente obrigatorio, preco travado, fiado).
 *
 * A venda em andamento fica guardada enquanto o painel estiver aberto:
 * sair do PDV e voltar nao perde o carrinho.
 *
 * Teclado: F2 busca (de qualquer tela, abre o PDV) - Enter adiciona o
 * primeiro da busca - F4 pagamento - F10 ou Ctrl+Enter finaliza - Esc limpa
 * a busca (com a busca vazia, volta para a entrada do PDV).
 */
(function (janela) {
    'use strict';

    const { escapar, moeda, deCentavos, hoje } = janela.Formato;
    const R = janela.RegrasPdv;
    const N = janela.Nucleo;
    const { api, estado, avisar, rotuloDe, mensagemDe, formaPadrao, mostrarSecao, carregarCatalogos, carregarPratos,
            urlFotoPrato, quantidadeLegivel } = N;
    const J = janela.Janela;

    const raiz = document.getElementById('pdvConteudo');

    /* A venda em andamento. */
    const venda = {
        itens: [],          // { chave, prato_id, nome, adicionais: [{id, nome, preco}], quantidade, preco, tabela, vendavel }
        clienteId: '',
        clienteNovo: false, clienteNome: '', clienteFone: '',
        desconto: '',
        modoDesconto: 'reais',
        formaId: '',
        parcelas: 1,
        pago: true,
        recebido: '',
        vencimento: '',
        observacoes: '',
    };
    const tela = { busca: '', categoria: 'todos', gravando: false, montada: false, concluida: null, grupos: {} };

    // ------------------------------------------------------------------
    // Regras da loja que o PDV mostra (o servidor confere)
    // ------------------------------------------------------------------
    function admin() { return !!estado.config.pode_admin; }
    function chaveDaLoja(nome, padrao) {
        const c = estado.config.chaves || {};
        return c[nome] === undefined ? padrao : c[nome];
    }
    function limiteDesconto() { return Number(chaveDaLoja('venda.desconto_maximo_equipe', 100)); }
    function podeMudarPreco() { return admin() || !!chaveDaLoja('venda.alterar_preco_equipe', false); }
    function exigeCliente() { return !!chaveDaLoja('venda.exigir_cliente', false); }
    function podePrazo() { return admin() || !!chaveDaLoja('venda.prazo_equipe', false); }

    function formasDoPdv() {
        return estado.formasPagamento.filter(function (f) { return f.ativo && (f.tipo !== 'prazo' || podePrazo()); });
    }
    function formaEscolhida() {
        return estado.formasPagamento.find(function (f) { return String(f.id) === String(venda.formaId); }) || null;
    }

    // ------------------------------------------------------------------
    // O cardapio do PDV
    // ------------------------------------------------------------------
    function pratosDoPdv() {
        return (estado.pratos || []).filter(function (p) { return p.ativo; }).map(function (p) {
            return Object.assign({}, p, {
                categoria: p.categoria_id || 'sem',
                categoriaNome: p.categoria || 'Sem categoria',
                procura: [p.nome, p.categoria, (p.tags || []).map(function (t) { return rotuloDe('tags_prato', t); }).join(' ')].join(' '),
                exatos: [p.gtin].filter(Boolean),
            });
        });
    }
    function pratoPorId(id) {
        return (estado.pratos || []).find(function (p) { return p.id === Number(id); }) || null;
    }
    /* Porcoes que ainda cabem (vendavel menos o que ja esta no carrinho); null = sem limite. */
    function sobra(p) {
        if (p.vendavel === null || p.vendavel === undefined) return null;
        const ja = venda.itens.reduce(function (s, i) { return s + (i.prato_id === p.id ? i.quantidade : 0); }, 0);
        return Math.max(0, p.vendavel - ja);
    }
    function categoriasComPrato() {
        const vistas = {};
        pratosDoPdv().forEach(function (p) { vistas[p.categoria] = p.categoriaNome; });
        const ordem = (estado.categorias || []).map(function (c) { return c.id; });
        return Object.keys(vistas).sort(function (a, b) {
            const ia = ordem.indexOf(Number(a));
            const ib = ordem.indexOf(Number(b));
            return (ia === -1 ? 999 : ia) - (ib === -1 ? 999 : ib);
        }).map(function (id) { return [id, vistas[id]]; });
    }

    // ------------------------------------------------------------------
    // Desenho
    // ------------------------------------------------------------------
    function montar() {
        raiz.innerHTML =
            '<div class="pdv pdv-gf">' +
            '<header class="pdv-topo">' +
                '<div class="pdv-marca"><strong>PDV</strong><span id="pdvLoja"></span></div>' +
                '<div class="pdv-teclas" aria-hidden="true"><span><kbd>F2</kbd> buscar</span><span><kbd>F4</kbd> pagamento</span>' +
                    '<span><kbd>F10</kbd> finalizar</span></div>' +
                '<div class="pdv-operador" id="pdvOperador"></div>' +
                '<button type="button" class="botao botao-secundario" data-pdv="sair">Sair do PDV</button>' +
            '</header>' +
            '<div class="pdv-corpo">' +
                '<section class="pdv-catalogo" aria-label="Cardápio">' +
                    '<label class="pdv-busca" for="pdvBusca">' +
                        '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="11" cy="11" r="7"/><path d="M21 21l-4.3-4.3"/></svg>' +
                        '<input type="search" id="pdvBusca" autocomplete="off" spellcheck="false" ' +
                            'placeholder="Buscar prato (nome, categoria, selo) ou código de barras" aria-controls="pdvPratos">' +
                    '</label>' +
                    '<div class="pdv-filtros pdv-categorias" id="pdvCategorias" role="group" aria-label="Categoria"></div>' +
                    '<div class="pdv-pratos" id="pdvPratos" aria-live="polite"></div>' +
                '</section>' +
                '<section class="pdv-cupom" id="pdvCupom" aria-label="Venda atual">' +
                    '<div class="pdv-cliente" id="pdvCliente"></div>' +
                    '<div class="pdv-itens" id="pdvItens"></div>' +
                    '<div class="pdv-resumo" id="pdvResumo"></div>' +
                    '<div class="pdv-pagamento" id="pdvPagamento"></div>' +
                    '<label class="pdv-observacao" for="pdvObservacoes">Observação da venda (opcional)' +
                        '<input type="text" id="pdvObservacoes" data-pdv-campo="observacoes" maxlength="500" ' +
                            'placeholder="Ex.: retirar às 18h, sem talher"></label>' +
                    '<p class="pdv-erro" id="pdvErro" role="alert"></p>' +
                    '<div class="pdv-acoes">' +
                        '<button type="button" class="botao botao-secundario" data-pdv="limpar">Cancelar venda</button>' +
                        '<button type="button" class="pdv-finalizar" id="pdvFinalizar" data-pdv="finalizar"></button>' +
                    '</div>' +
                '</section>' +
            '</div>' +
            '<div class="pdv-concluida oculta" id="pdvConcluida" role="dialog" aria-modal="true" aria-labelledby="pdvConcluidaTitulo"></div>' +
            '</div>';
        tela.montada = true;
        /* A barra "Ver a venda" do celular mora no body: dentro da secao (que tem transform
           da animacao de entrada) o position: fixed ficaria preso a secao, e nao a tela.
           So aparece com o PDV aberto (body.tela-cheia) e some quando o cupom esta na tela. */
        const barra = document.createElement('button');
        barra.type = 'button';
        barra.id = 'pdvBarraCarrinho';
        barra.className = 'pdv-barra-carrinho';
        barra.hidden = true;
        barra.addEventListener('click', mostrarCupomNoCelular);
        document.body.appendChild(barra);
        // "Venda registrada" tambem: no celular a secao e longa e a janela ficaria fora da vista.
        const concluida = document.getElementById('pdvConcluida');
        document.body.appendChild(concluida);
        concluida.addEventListener('click', aoClicar);
        if ('IntersectionObserver' in janela) {
            new IntersectionObserver(function (vistos) {
                barra.classList.toggle('com-cupom', vistos[0].isIntersecting);
            }, { threshold: 0.05 }).observe(document.getElementById('pdvCupom'));
        }
    }

    function desenharTopo() {
        document.getElementById('pdvLoja').textContent = estado.config.empresa || 'Green Fit';
        document.getElementById('pdvOperador').textContent = 'Operador: ' + (estado.usuario.nome || estado.usuario.usuario);
        document.getElementById('pdvCategorias').innerHTML = [['todos', 'Tudo']].concat(categoriasComPrato()).map(function (c) {
            return '<button type="button" class="pdv-filtro" data-pdv="categoria" data-valor="' + escapar(c[0]) + '" aria-pressed="' +
                (String(c[0]) === String(tela.categoria)) + '">' + escapar(c[1]) + '</button>';
        }).join('');
    }

    function fotoHtml(p) {
        return p.fotos && p.fotos.length
            ? '<img src="' + urlFotoPrato(p.fotos[0]) + '" alt="" loading="lazy">'
            : '<span class="pdv-prato-sem-foto" aria-hidden="true">' + escapar((p.nome || '?').trim().charAt(0).toUpperCase()) + '</span>';
    }

    function desenharPratos() {
        const caixa = document.getElementById('pdvPratos');
        const todos = pratosDoPdv();
        if (!todos.length) {
            caixa.innerHTML = '<p class="pdv-vazio">Nenhum prato ativo no cardápio. Cadastre os pratos em Cardápio.</p>';
            return;
        }
        const lista = R.buscar(todos, tela.busca, tela.categoria);
        if (!lista.length) {
            caixa.innerHTML = '<p class="pdv-vazio">Nada encontrado para "' + escapar(tela.busca) + '".</p>';
            return;
        }
        caixa.innerHTML = lista.map(function (p, n) {
            const resta = sobra(p);
            const esgotado = resta === 0;
            const promo = p.preco_promocional && p.preco_promocional < p.preco;
            return '<button type="button" class="pdv-prato' + (esgotado ? ' esgotado' : '') + (n === 0 && tela.busca.trim() ? ' destaque' : '') +
                '" data-pdv="adicionar" data-id="' + p.id + '"' + (esgotado ? ' disabled aria-disabled="true"' : '') + '>' +
                '<span class="pdv-prato-foto">' + fotoHtml(p) + '</span>' +
                '<span class="pdv-prato-nome">' + escapar(p.nome) + '</span>' +
                '<span class="pdv-prato-pe">' +
                    '<span class="pdv-prato-preco">' + (promo ? '<s>' + moeda(p.preco) + '</s> ' : '') + moeda(p.preco_atual) + '</span>' +
                    '<span class="pdv-prato-estoque' + (resta !== null && resta <= 3 ? ' pouco' : '') + '">' +
                        (resta === null ? 'feito na hora' : esgotado ? 'esgotado' : quantidadeLegivel(resta, 'porcao')) + '</span>' +
                '</span>' +
            '</button>';
        }).join('');
    }

    function desenharCliente() {
        const opcoes = estado.clientes.map(function (c) {
            return '<option value="' + c.id + '"' + (String(c.id) === String(venda.clienteId) ? ' selected' : '') + '>' +
                   escapar(c.nome + (c.telefone ? ' (' + c.telefone + ')' : '')) + '</option>';
        }).join('');
        const escolhido = estado.clientes.find(function (c) { return String(c.id) === String(venda.clienteId); });
        document.getElementById('pdvCliente').innerHTML =
            '<label for="pdvClienteSelect">Cliente' + (exigeCliente() ? ' <span class="pdv-obrigatorio">obrigatório nesta loja</span>' : '') + '</label>' +
            '<div class="pdv-cliente-linha">' +
                '<select id="pdvClienteSelect" data-pdv-campo="cliente"' + (venda.clienteNovo ? ' disabled' : '') + '>' +
                    '<option value="">' + (exigeCliente() ? '— escolha o cliente —' : 'Consumidor (sem cadastro)') + '</option>' + opcoes +
                '</select>' +
                '<button type="button" class="botao-icone" data-pdv="cliente-novo" aria-pressed="' + venda.clienteNovo + '">' +
                    (venda.clienteNovo ? 'Escolher da lista' : '+ Cliente novo') + '</button>' +
            '</div>' +
            (venda.clienteNovo
                ? '<div class="pdv-cliente-novo">' +
                    '<input type="text" id="pdvClienteNome" data-pdv-campo="cliente-nome" value="' + escapar(venda.clienteNome) + '" placeholder="Nome" aria-label="Nome do cliente novo" maxlength="120">' +
                    '<input type="tel" id="pdvClienteFone" data-pdv-campo="cliente-fone" value="' + escapar(venda.clienteFone) + '" placeholder="Telefone (opcional)" aria-label="Telefone do cliente novo" maxlength="30">' +
                    '<small class="pdv-cliente-dica">É cadastrado junto com a venda (se o telefone já existe, usa o cadastro que já tem).</small>' +
                  '</div>'
                : (escolhido && (escolhido.restricoes || escolhido.objetivo)
                    ? '<p class="pdv-cliente-info">' + (escolhido.objetivo ? escapar(rotuloDe('objetivos', escolhido.objetivo)) : '') +
                        (escolhido.restricoes ? (escolhido.objetivo ? ' · ' : '') + '<strong>Restrição: ' + escapar(escolhido.restricoes) + '</strong>' : '') + '</p>'
                    : ''));
    }

    function textoAdicionais(i) {
        return i.adicionais.map(function (a) { return a.nome; }).join(', ');
    }

    function desenharItens() {
        const caixa = document.getElementById('pdvItens');
        if (!venda.itens.length) {
            caixa.innerHTML = '<p class="pdv-vazio">Nenhum prato ainda. Toque num prato do cardápio, ou busque e aperte Enter.</p>';
            return;
        }
        const preco = podeMudarPreco();
        caixa.innerHTML = '<ol class="pdv-linhas">' + venda.itens.map(function (i, n) {
            const subtotal = R.totais([i], 0, 'reais').bruto;
            const mexeu = Math.round(R.lerReais(i.preco) * 100) !== Math.round(i.tabela * 100);
            return '<li class="pdv-linha">' +
                '<div class="linha-nome"><span>' + escapar(i.nome) + '</span>' +
                    (i.adicionais.length ? '<small>+ ' + escapar(textoAdicionais(i)) + '</small>' : '') + '</div>' +
                '<div class="linha-qtd">' +
                    '<button type="button" class="botao-icone" data-pdv="menos" data-n="' + n + '" aria-label="Uma porção a menos">−</button>' +
                    '<input type="number" min="1" step="1" value="' + i.quantidade + '" data-pdv-campo="quantidade" data-n="' + n +
                        '" aria-label="Quantidade de ' + escapar(i.nome) + '">' +
                    '<button type="button" class="botao-icone" data-pdv="mais" data-n="' + n + '" aria-label="Uma porção a mais">+</button>' +
                '</div>' +
                '<div class="linha-preco">' +
                    '<input type="text" inputmode="decimal" value="' + escapar(R.lerReais(i.preco).toFixed(2).replace('.', ',')) +
                        '" data-pdv-campo="preco" data-n="' + n + '"' +
                        (preco ? '' : ' readonly title="Nesta loja só o administrador muda o preço. Use o desconto."') +
                        ' aria-label="Preço unitário de ' + escapar(i.nome) + '">' +
                    (mexeu ? '<small>cardápio ' + moeda(i.tabela) + '</small>' : '') +
                '</div>' +
                '<div class="linha-subtotal">' + moeda(deCentavos(subtotal)) + '</div>' +
                '<button type="button" class="botao-icone perigo-leve" data-pdv="remover" data-n="' + n + '" aria-label="Tirar ' +
                    escapar(i.nome) + ' da venda">×</button>' +
                '</li>';
        }).join('') + '</ol>';
    }

    function contas() {
        return R.totais(venda.itens, venda.desconto, venda.modoDesconto);
    }

    function desenharResumo() {
        const t = contas();
        const limite = limiteDesconto();
        const confere = R.descontoNoLimite(t.bruto, t.desconto, limite, admin());
        document.getElementById('pdvResumo').innerHTML =
            '<div class="resumo-linha"><span>Itens</span><span>' + moeda(deCentavos(t.bruto)) + '</span></div>' +
            '<div class="resumo-linha resumo-desconto' + (confere.ok ? '' : ' fora-do-limite') + '">' +
                '<label for="pdvDesconto">Desconto</label>' +
                '<span class="desconto-campo">' +
                    '<input type="text" inputmode="decimal" id="pdvDesconto" data-pdv-campo="desconto" value="' + escapar(venda.desconto) + '" placeholder="0">' +
                    '<button type="button" class="desconto-modo" data-pdv="modo-desconto" aria-label="Trocar entre reais e porcentagem">' +
                        (venda.modoDesconto === 'porcento' ? '%' : 'R$') + '</button>' +
                '</span>' +
                '<span>− ' + moeda(deCentavos(t.desconto)) + '</span>' +
            '</div>' +
            (!admin() && limite < 100
                ? '<p class="resumo-nota">Seu limite: até ' + limite + '% (' + moeda(deCentavos(confere.maximo)) + ' nesta venda).</p>' : '') +
            '<div class="resumo-total"><span>Total</span><strong id="pdvTotal">' + moeda(deCentavos(t.total)) + '</strong></div>';
        atualizarBotaoFinalizar(t);
    }

    function desenharPagamento() {
        const formas = formasDoPdv();
        if (!formaEscolhida() || !formas.some(function (f) { return String(f.id) === String(venda.formaId); })) {
            escolherForma(formas.some(function (f) { return String(f.id) === String(formaPadrao()); }) ? formaPadrao()
                          : (formas[0] ? formas[0].id : ''), false);
        }
        const forma = formaEscolhida();
        const t = contas();
        const parcelavel = !!forma && forma.tipo === 'cartao' && estado.config.parcelas_max > 1;
        const mostraRecebido = !!forma && forma.tipo === 'vista' && venda.pago && venda.parcelas === 1;
        const mostraVencimento = !venda.pago || venda.parcelas > 1;
        const troco = R.troco(t.total, venda.recebido);
        const maxParcelas = estado.config.parcelas_max;

        document.getElementById('pdvPagamento').innerHTML =
            '<div class="pagamento-titulo">Pagamento</div>' +
            '<div class="pdv-formas" role="radiogroup" aria-label="Forma de pagamento">' +
                formas.map(function (f) {
                    const sim = String(f.id) === String(venda.formaId);
                    return '<button type="button" role="radio" class="pdv-forma" aria-checked="' + sim + '" data-pdv="forma" data-id="' + f.id + '">' +
                        escapar(f.nome) + '</button>';
                }).join('') +
                (!podePrazo() ? '<span class="pagamento-nota">Fiado só com o administrador.</span>' : '') +
            '</div>' +
            '<div class="pagamento-detalhe">' +
                (parcelavel
                    ? '<label class="pagamento-campo">Parcelas <select data-pdv-campo="parcelas">' +
                        Array.from({ length: maxParcelas }, function (_, k) { return k + 1; }).map(function (p) {
                            return '<option value="' + p + '"' + (p === venda.parcelas ? ' selected' : '') + '>' + p + 'x</option>';
                        }).join('') + '</select></label>'
                    : '') +
                (venda.parcelas === 1
                    ? '<label class="pagamento-campo pagamento-recebi"><input type="checkbox" data-pdv-campo="pago"' + (venda.pago ? ' checked' : '') + '> ' +
                        'Já recebi agora</label>'
                    : '<span class="pagamento-nota">Parcelado: uma conta a receber por parcela, de mês em mês.</span>') +
                (mostraVencimento
                    ? '<label class="pagamento-campo">' + (venda.parcelas > 1 ? 'Vencimento da 1ª parcela' : 'Vencimento') +
                        ' <input type="date" data-pdv-campo="vencimento" value="' + escapar(venda.vencimento || hoje()) + '"></label>'
                    : '') +
                (mostraRecebido
                    ? '<label class="pagamento-campo">Recebido <input type="text" inputmode="decimal" data-pdv-campo="recebido" value="' +
                        escapar(venda.recebido) + '" placeholder="' + escapar(moeda(deCentavos(t.total))) + '"></label>' +
                      (troco === null ? ''
                        : '<span class="pdv-troco' + (troco < 0 ? ' falta' : '') + '">' +
                            (troco < 0 ? 'Falta ' + moeda(deCentavos(-troco)) : 'Troco ' + moeda(deCentavos(troco))) + '</span>')
                    : '') +
            '</div>';
    }

    function atualizarBotaoFinalizar(t) {
        t = t || contas();
        const botao = document.getElementById('pdvFinalizar');
        botao.disabled = tela.gravando || !venda.itens.length;
        botao.innerHTML = tela.gravando ? 'Gravando...'
            : '<span>Finalizar venda</span><strong>' + moeda(deCentavos(t.total)) + '</strong><kbd>F10</kbd>';
        const barra = document.getElementById('pdvBarraCarrinho');
        const unidades = venda.itens.reduce(function (s, i) { return s + i.quantidade; }, 0);
        barra.hidden = !unidades;
        barra.innerHTML = '<span class="barra-qtd">' + unidades + '</span><span>Ver a venda</span><strong>' + moeda(deCentavos(t.total)) + '</strong>';
    }

    function desenharTudo() {
        desenharTopo();
        desenharPratos();
        desenharCliente();
        desenharItens();
        desenharResumo();
        desenharPagamento();
        document.getElementById('pdvObservacoes').value = venda.observacoes;
    }

    /* Mexeu em quantidade, preco, desconto ou recebido: so as contas, sem perder o foco do campo. */
    function recalcular() {
        const t = contas();
        raiz.querySelectorAll('.pdv-linha').forEach(function (li, n) {
            const i = venda.itens[n];
            if (i) li.querySelector('.linha-subtotal').textContent = moeda(deCentavos(R.totais([i], 0, 'reais').bruto));
        });
        const limite = limiteDesconto();
        const confere = R.descontoNoLimite(t.bruto, t.desconto, limite, admin());
        const linhaDesconto = raiz.querySelector('.resumo-desconto');
        linhaDesconto.classList.toggle('fora-do-limite', !confere.ok);
        linhaDesconto.lastElementChild.textContent = '− ' + moeda(deCentavos(t.desconto));
        raiz.querySelector('.resumo-linha span:last-child').textContent = moeda(deCentavos(t.bruto));
        document.getElementById('pdvTotal').textContent = moeda(deCentavos(t.total));
        const nota = raiz.querySelector('.resumo-nota');
        if (nota) nota.textContent = 'Seu limite: até ' + limite + '% (' + moeda(deCentavos(confere.maximo)) + ' nesta venda).';
        const troco = raiz.querySelector('.pdv-troco');
        const campoRecebido = raiz.querySelector('[data-pdv-campo="recebido"]');
        if (campoRecebido) {
            campoRecebido.placeholder = moeda(deCentavos(t.total));
            const valor = R.troco(t.total, venda.recebido);
            if (troco && valor === null) troco.remove();
            else if (valor !== null) {
                const alvo = troco || campoRecebido.closest('.pagamento-campo').insertAdjacentElement('afterend', document.createElement('span'));
                alvo.className = 'pdv-troco' + (valor < 0 ? ' falta' : '');
                alvo.textContent = valor < 0 ? 'Falta ' + moeda(deCentavos(-valor)) : 'Troco ' + moeda(deCentavos(valor));
            }
        }
        atualizarBotaoFinalizar(t);
        erro('');
    }

    function erro(texto) {
        document.getElementById('pdvErro').textContent = texto || '';
    }

    // ------------------------------------------------------------------
    // Adicionar prato (com o seletor de adicionais)
    // ------------------------------------------------------------------
    /* Os grupos de adicionais do prato (GET /pratos/{id}), guardados para a proxima vez. */
    async function gruposDoPrato(p) {
        if (tela.grupos[p.id]) return tela.grupos[p.id];
        const detalhe = (await api.get('/pratos/' + p.id)).prato;
        tela.grupos[p.id] = (detalhe.grupos || []).map(function (g) {
            const completo = (estado.grupos || []).find(function (x) { return x.id === g.id; });
            return Object.assign({}, g, { opcoes: completo ? completo.adicionais.filter(function (a) { return a.ativo; }) : [] });
        }).filter(function (g) { return g.opcoes.length; });
        return tela.grupos[p.id];
    }

    function colocarNoCarrinho(p, adicionais, quantidade) {
        const chave = R.chaveDaLinha(p.id, adicionais.map(function (a) { return a.id; }));
        if (!R.cabe(venda.itens, p.id, p.vendavel, quantidade)) {
            erro('Só há ' + quantidadeLegivel(p.vendavel, 'porcao') + ' de "' + p.nome + '" para vender agora (o resto está reservado ou acabou).');
            return false;
        }
        const tabela = deCentavos(Math.round(p.preco_atual * 100) + R.acrescimo(adicionais));
        const ja = venda.itens.find(function (i) { return i.chave === chave; });
        if (ja) ja.quantidade += quantidade;
        else venda.itens.push({ chave: chave, prato_id: p.id, nome: p.nome, adicionais: adicionais, quantidade: quantidade,
                                preco: tabela, tabela: tabela, vendavel: p.vendavel });
        tela.busca = '';
        const busca = document.getElementById('pdvBusca');
        if (busca) busca.value = '';
        desenharPratos();
        desenharItens();
        desenharResumo();
        desenharPagamento();
        erro('');
        return true;
    }

    async function adicionar(id) {
        const p = pratoPorId(id);
        if (!p) return;
        if (sobra(p) === 0) { erro('"' + p.nome + '" esgotou.'); return; }
        let grupos;
        try {
            grupos = await gruposDoPrato(p);
        } catch (falha) {
            erro(falha.message);
            return;
        }
        if (!grupos.length) {
            colocarNoCarrinho(p, [], 1);
            if (janela.innerWidth > 860) document.getElementById('pdvBusca').focus();
            return;
        }
        abrirSeletor(p, grupos);
    }

    function abrirSeletor(p, grupos) {
        const html = '<div class="campo-total pdv-seletor">' +
            '<p class="pdv-seletor-preco">' + moeda(p.preco_atual) + (p.kcal ? ' · ' + p.kcal + ' kcal' : '') + '</p>' +
            grupos.map(function (g) {
                const radio = g.maximo === 1;
                const regra = g.minimo > 0 ? (g.minimo === g.maximo ? 'Escolha ' + g.minimo : 'Escolha de ' + g.minimo + ' a ' + g.maximo)
                                           : 'Opcional · até ' + g.maximo;
                return '<fieldset class="pdv-grupo" data-grupo="' + g.id + '" data-max="' + g.maximo + '">' +
                    '<legend>' + escapar(g.nome) + ' <span class="pdv-grupo-regra' + (g.minimo > 0 ? ' obrigatorio' : '') + '">' + escapar(regra) +
                        (g.minimo > 0 ? ' · obrigatório' : '') + '</span></legend>' +
                    g.opcoes.map(function (o) {
                        return '<label class="pdv-opcao"><input type="' + (radio ? 'radio' : 'checkbox') + '" name="g' + g.id + '" value="' + o.id + '">' +
                            '<span class="pdv-opcao-nome">' + escapar(o.nome) + '</span>' +
                            '<span class="pdv-opcao-preco">' + (o.preco > 0 ? '+ ' + moeda(o.preco) : 'sem custo') + '</span></label>';
                    }).join('') +
                '</fieldset>';
            }).join('') +
            '<div class="pdv-seletor-qtd"><span>Quantidade</span>' +
                '<button type="button" class="botao-icone" data-seletor="menos" aria-label="Menos">−</button>' +
                '<input type="number" id="pdvSeletorQtd" min="1" step="1" value="1" aria-label="Quantidade">' +
                '<button type="button" class="botao-icone" data-seletor="mais" aria-label="Mais">+</button>' +
            '</div></div>';
        J.abrirModal({
            titulo: p.nome,
            html: html,
            textoSalvar: 'Adicionar à venda',

            aoSalvar: async function () {
                const corpo = J.modalCorpo;
                const escolhidos = {};
                const adicionais = [];
                grupos.forEach(function (g) {
                    const marcados = Array.from(corpo.querySelectorAll('.pdv-grupo[data-grupo="' + g.id + '"] input:checked'));
                    escolhidos[g.id] = marcados.length;
                    marcados.forEach(function (m) {
                        const o = g.opcoes.find(function (x) { return String(x.id) === m.value; });
                        if (o) adicionais.push({ id: o.id, nome: o.nome, preco: o.preco });
                    });
                });
                const problema = R.problemaNosGrupos(grupos, escolhidos);
                if (problema) throw new Error(problema);
                const q = Math.floor(Number(document.getElementById('pdvSeletorQtd').value)) || 1;
                if (!colocarNoCarrinho(p, adicionais, Math.max(1, q))) {
                    throw new Error(document.getElementById('pdvErro').textContent);
                }
            },
        });
    }

    /* O seletor mora no corpo do modal (que e sempre o mesmo): um ouvinte so, para todas as aberturas. */
    J.modalCorpo.addEventListener('change', function (evento) {
        const caixa = evento.target.closest('.pdv-grupo');
        if (!caixa || evento.target.type !== 'checkbox') return;
        const max = Number(caixa.dataset.max);
        if (caixa.querySelectorAll('input:checked').length > max) {
            evento.target.checked = false;
            avisar('Em "' + caixa.querySelector('legend').firstChild.textContent.trim() + '" dá para escolher no máximo ' + max + '.', 'erro');
        }
    });
    J.modalCorpo.addEventListener('click', function (evento) {
        const b = evento.target.closest('[data-seletor]');
        if (!b) return;
        const campo = document.getElementById('pdvSeletorQtd');
        campo.value = String(Math.max(1, (Math.floor(Number(campo.value)) || 1) + (b.dataset.seletor === 'mais' ? 1 : -1)));
    });

    // ------------------------------------------------------------------
    // Pagamento, limpeza e finalizar
    // ------------------------------------------------------------------
    function escolherForma(id, redesenhar) {
        venda.formaId = id ? String(id) : '';
        const f = formaEscolhida();
        venda.parcelas = 1;
        venda.pago = !f || f.tipo !== 'prazo';
        if (!f || f.tipo !== 'vista') venda.recebido = '';
        if (redesenhar !== false) desenharPagamento();
    }

    function limparVenda() {
        venda.itens = [];
        venda.clienteId = '';
        venda.clienteNovo = false;
        venda.clienteNome = '';
        venda.clienteFone = '';
        venda.desconto = '';
        venda.modoDesconto = 'reais';
        venda.recebido = '';
        venda.vencimento = '';
        venda.observacoes = '';
        escolherForma('', false);
        tela.busca = '';
        const busca = document.getElementById('pdvBusca');
        if (busca) busca.value = '';
        erro('');
    }

    /* O que o servidor vai recusar, dito antes (a mesma regra; ele confere de novo). */
    function problemaAntesDeEnviar(t) {
        if (!venda.itens.length) return 'Coloque pelo menos um prato na venda.';
        const temCliente = venda.clienteId || (venda.clienteNovo && venda.clienteNome.trim());
        if (exigeCliente() && !temCliente) return 'Escolha o cliente: nesta loja toda venda é feita com o cliente identificado.';
        if (venda.clienteNovo && !venda.clienteNome.trim()) return 'Escreva o nome do cliente novo (ou volte para "Escolher da lista").';
        if (t.total <= 0) return 'O total ficou em R$ 0,00. Cortesia ou degustação sai por Estoque > Movimentar > Degustação / cortesia.';
        const confere = R.descontoNoLimite(t.bruto, t.desconto, limiteDesconto(), admin());
        if (!confere.ok) return 'Desconto acima do seu limite (' + moeda(deCentavos(confere.maximo)) + '). Para mais, peça a um administrador.';
        if (!venda.formaId) return 'Escolha a forma de pagamento.';
        const troco = venda.pago && venda.parcelas === 1 ? R.troco(t.total, venda.recebido) : null;
        if (troco !== null && troco < 0) return 'O valor recebido é menor que o total: falta ' + moeda(deCentavos(-troco)) + '.';
        return '';
    }

    async function finalizar() {
        if (tela.gravando) return;
        const t = contas();
        const problema = problemaAntesDeEnviar(t);
        if (problema) { erro(problema); mostrarCupomNoCelular(); return; }
        tela.gravando = true;
        atualizarBotaoFinalizar(t);
        const itensDaVenda = venda.itens.map(function (i) { return Object.assign({}, i, { adicionais: i.adicionais.slice() }); });
        try {
            const resposta = await api.post('/vendas', {
                cliente_id: venda.clienteNovo ? null : (venda.clienteId || null),
                cliente_nome: venda.clienteNovo ? venda.clienteNome.trim() : null,
                cliente_telefone: venda.clienteNovo ? (venda.clienteFone.trim() || null) : null,
                itens: venda.itens.map(function (i) {
                    return { prato_id: i.prato_id, quantidade: i.quantidade, valor_unitario: deCentavos(Math.round(R.lerReais(i.preco) * 100)),
                             adicionais: i.adicionais.length ? textoAdicionais(i) : null,
                             acrescimo_adicionais: deCentavos(R.acrescimo(i.adicionais)) };
                }),
                desconto: deCentavos(t.desconto),
                forma_pagamento_id: venda.formaId ? Number(venda.formaId) : null,
                parcelas: venda.parcelas,
                pago: venda.parcelas === 1 && venda.pago,
                vencimento: (!venda.pago || venda.parcelas > 1) ? (venda.vencimento || hoje()) : null,
                observacoes: venda.observacoes.trim() || null,
            });
            const troco = venda.pago && venda.parcelas === 1 ? R.troco(t.total, venda.recebido) : null;
            const forma = formaEscolhida();
            const cliente = venda.clienteNovo ? venda.clienteNome.trim()
                : ((estado.clientes.find(function (c) { return String(c.id) === String(venda.clienteId); }) || {}).nome || '');
            tela.concluida = {
                id: resposta.id, numero: resposta.numero, total: t.total, bruto: t.bruto, desconto: t.desconto, troco: troco,
                recebido: venda.recebido, itens: itensDaVenda, cliente: cliente, quando: new Date(),
                forma: forma ? forma.nome + (venda.parcelas > 1 ? ' em ' + venda.parcelas + 'x' : '') : 'Forma não informada',
                pago: venda.pago, mensagem: mensagemDe(resposta, 'Venda registrada.'),
            };
            const clienteNovo = venda.clienteNovo;
            limparVenda();
            await Promise.all([carregarPratos(), clienteNovo ? carregarCatalogos() : Promise.resolve()]);
            desenharTudo();
            mostrarConcluida();
        } catch (falha) {
            erro(falha.message);
            mostrarCupomNoCelular();
            try { await carregarPratos(); desenharPratos(); } catch (e) { /* segue com o que tem */ }
        } finally {
            tela.gravando = false;
            atualizarBotaoFinalizar();
        }
    }

    function mostrarConcluida() {
        const c = tela.concluida;
        const caixa = document.getElementById('pdvConcluida');
        caixa.innerHTML =
            '<div class="concluida-caixa">' +
                '<h2 id="pdvConcluidaTitulo">' + escapar(c.mensagem) + '</h2>' +
                '<p class="concluida-total">' + moeda(deCentavos(c.total)) + '</p>' +
                '<p class="concluida-forma">' + escapar(c.forma) + (c.pago ? ' · recebido' : ' · fica a receber no Financeiro') + '</p>' +
                (c.troco !== null && c.troco > 0 ? '<p class="concluida-troco">Troco: <strong>' + moeda(deCentavos(c.troco)) + '</strong></p>' : '') +
                '<div class="concluida-acoes">' +
                    '<button type="button" class="botao botao-secundario" data-pdv="recibo">Imprimir recibo</button>' +
                    '<button type="button" class="botao botao-secundario" data-pdv="ver-venda">Ver a venda</button>' +
                    '<button type="button" class="botao" data-pdv="nova-venda" id="pdvNovaVenda">Nova venda <kbd>Enter</kbd></button>' +
                '</div>' +
            '</div>';
        caixa.classList.remove('oculta');
        document.getElementById('pdvNovaVenda').focus();
    }

    function fecharConcluida() {
        tela.concluida = null;
        document.getElementById('pdvConcluida').classList.add('oculta');
        if (janela.innerWidth > 860) document.getElementById('pdvBusca').focus();
        janela.scrollTo({ top: 0 });
    }

    /* O recibo de 80 mm (a mesma folha de impressao da comanda: vendas.css). */
    function imprimirRecibo() {
        const c = tela.concluida;
        if (!c) return;
        const d = c.quando;
        const quando = String(d.getDate()).padStart(2, '0') + '/' + String(d.getMonth() + 1).padStart(2, '0') + '/' + d.getFullYear() + ' ' +
                       String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0');
        const linha = function (a, b) { return '<div class="gf-impressao-linha"><span>' + a + '</span><span>' + b + '</span></div>'; };
        const folha = document.createElement('div');
        folha.className = 'gf-impressao';
        folha.innerHTML =
            '<div class="gf-impressao-cabeca"><strong>' + escapar(estado.config.empresa || 'Green Fit') + '</strong>' +
                '<span>Venda ' + escapar(c.numero || '#' + c.id) + '</span><span>' + escapar(quando) + '</span></div>' +
            (c.cliente ? '<p>Cliente: ' + escapar(c.cliente) + '</p>' : '') +
            '<hr>' +
            c.itens.map(function (i) {
                return '<div class="gf-impressao-item">' + linha(i.quantidade + 'x ' + escapar(i.nome),
                        moeda(deCentavos(R.totais([i], 0, 'reais').bruto))) +
                    (i.adicionais.length ? '<div>+ ' + escapar(textoAdicionais(i)) + '</div>' : '') + '</div>';
            }).join('') +
            '<hr>' +
            (c.desconto > 0 ? linha('Itens', moeda(deCentavos(c.bruto))) + linha('Desconto', '− ' + moeda(deCentavos(c.desconto))) : '') +
            '<div class="gf-impressao-linha gf-impressao-total"><span>TOTAL</span><span>' + moeda(deCentavos(c.total)) + '</span></div>' +
            linha(escapar(c.forma), '') +
            (c.troco !== null && c.troco > 0 ? linha('Recebido', moeda(R.lerReais(c.recebido))) + linha('Troco', moeda(deCentavos(c.troco))) : '') +
            '<p class="gf-impressao-rodape">Obrigado! Comida de verdade, do jeito que o seu corpo pede.<br>Documento sem valor fiscal.</p>';
        if (janela.Telas.pedidosOnline && janela.Telas.pedidosOnline.imprimirFolha) janela.Telas.pedidosOnline.imprimirFolha(folha);
    }

    /* No celular o cupom fica embaixo da grade: leva ate ele. */
    function mostrarCupomNoCelular() {
        if (janela.innerWidth <= 860) document.getElementById('pdvCupom').scrollIntoView({ behavior: 'smooth', block: 'start' });
    }

    // ------------------------------------------------------------------
    // Eventos
    // ------------------------------------------------------------------
    function aoClicar(evento) {
        const alvo = evento.target.closest('[data-pdv]');
        if (!alvo) return;
        const n = Number(alvo.dataset.n);
        switch (alvo.dataset.pdv) {
            case 'adicionar': adicionar(alvo.dataset.id); break;
            case 'categoria':
                tela.categoria = alvo.dataset.valor;
                desenharTopo(); desenharPratos(); break;
            case 'menos':
                if (venda.itens[n].quantidade > 1) venda.itens[n].quantidade--;
                desenharItens(); desenharResumo(); desenharPratos(); break;
            case 'mais': {
                const i = venda.itens[n];
                if (R.cabe(venda.itens, i.prato_id, i.vendavel, 1)) i.quantidade++;
                else erro('Só há ' + quantidadeLegivel(i.vendavel, 'porcao') + ' de "' + i.nome + '" para vender agora.');
                desenharItens(); desenharResumo(); desenharPratos(); break;
            }
            case 'remover':
                venda.itens.splice(n, 1);
                desenharItens(); desenharResumo(); desenharPratos(); desenharPagamento(); break;
            case 'modo-desconto':
                venda.modoDesconto = venda.modoDesconto === 'reais' ? 'porcento' : 'reais';
                desenharResumo(); desenharPagamento(); break;
            case 'forma': escolherForma(alvo.dataset.id); desenharResumo(); break;
            case 'cliente-novo':
                venda.clienteNovo = !venda.clienteNovo;
                if (venda.clienteNovo) venda.clienteId = '';
                desenharCliente();
                if (venda.clienteNovo) document.getElementById('pdvClienteNome').focus();
                break;
            case 'limpar':
                if (venda.itens.length && !confirm('Cancelar esta venda? Os pratos saem do carrinho e nada é gravado.')) return;
                limparVenda(); desenharTudo(); break;
            case 'finalizar': finalizar(); break;
            case 'nova-venda': fecharConcluida(); break;
            case 'recibo': imprimirRecibo(); break;
            case 'ver-venda': {
                const id = tela.concluida && tela.concluida.id;
                fecharConcluida();
                if (id && janela.Telas.vendas && janela.Telas.vendas.verVenda) {
                    janela.Telas.vendas.verVenda(id).catch(function (e) { avisar(e.message, 'erro'); });
                } else {
                    mostrarSecao('vendas', true);
                }
                break;
            }
            case 'sair': mostrarSecao('pdv-inicio', true); break;
        }
    }
    raiz.addEventListener('click', aoClicar);

    raiz.addEventListener('input', function (evento) {
        const campo = evento.target.dataset.pdvCampo;
        if (evento.target.id === 'pdvBusca') {
            tela.busca = evento.target.value;
            desenharPratos();
            return;
        }
        if (!campo) return;
        const n = Number(evento.target.dataset.n);
        if (campo === 'quantidade') {
            const i = venda.itens[n];
            const q = Math.floor(Number(evento.target.value));
            if (q >= 1) {
                const outras = venda.itens.reduce(function (s, x, k) { return s + (k !== n && x.prato_id === i.prato_id ? x.quantidade : 0); }, 0);
                i.quantidade = i.vendavel === null || i.vendavel === undefined ? q : Math.min(q, Math.max(1, i.vendavel - outras));
            }
            recalcular();
        } else if (campo === 'preco') {
            venda.itens[n].preco = R.lerReais(evento.target.value);
            recalcular();
        } else if (campo === 'desconto') {
            venda.desconto = evento.target.value;
            recalcular();
        } else if (campo === 'recebido') {
            venda.recebido = evento.target.value;
            recalcular();
        } else if (campo === 'observacoes') {
            venda.observacoes = evento.target.value;
        } else if (campo === 'vencimento') {
            venda.vencimento = evento.target.value;
        } else if (campo === 'cliente-nome') {
            venda.clienteNome = evento.target.value;
            erro('');
        } else if (campo === 'cliente-fone') {
            venda.clienteFone = evento.target.value;
        }
    });

    raiz.addEventListener('change', function (evento) {
        const campo = evento.target.dataset.pdvCampo;
        if (campo === 'cliente') { venda.clienteId = evento.target.value; desenharCliente(); erro(''); }
        if (campo === 'parcelas') {
            venda.parcelas = Number(evento.target.value) || 1;
            if (venda.parcelas > 1) { venda.pago = false; venda.recebido = ''; }
            desenharPagamento();
        }
        if (campo === 'pago') { venda.pago = evento.target.checked; if (!venda.pago) venda.recebido = ''; desenharPagamento(); }
        if (campo === 'quantidade' || campo === 'preco') { desenharItens(); desenharResumo(); desenharPratos(); }
    });

    /* Enter na busca adiciona o primeiro; Esc limpa (vazia: volta para a entrada). */
    raiz.addEventListener('keydown', function (evento) {
        if (evento.target.id !== 'pdvBusca') return;
        if (evento.key === 'Enter') {
            evento.preventDefault();
            const primeiro = R.buscar(pratosDoPdv(), tela.busca, tela.categoria).find(function (p) { return sobra(p) !== 0; });
            if (primeiro && tela.busca.trim()) adicionar(primeiro.id);
        } else if (evento.key === 'Escape') {
            evento.preventDefault();
            if (!evento.target.value) { mostrarSecao('pdv-inicio', true); return; }
            evento.target.value = '';
            tela.busca = '';
            desenharPratos();
        }
    });

    /* Teclas do caixa. F2 abre o PDV de qualquer tela (sem janela aberta). */
    document.addEventListener('keydown', function (evento) {
        if (J.aberta() || !document.getElementById('trocaSenha').classList.contains('oculta')) return;
        if (evento.key === 'F2') {
            evento.preventDefault();
            if (estado.secaoAtual !== 'pdv') { mostrarSecao('pdv', true); return; }
            if (!tela.concluida) document.getElementById('pdvBusca').focus();
            return;
        }
        if (estado.secaoAtual !== 'pdv') return;
        if (tela.concluida) {
            if (evento.key === 'Enter' || evento.key === 'Escape') { evento.preventDefault(); fecharConcluida(); }
            return;
        }
        if (evento.key === 'F4') {
            evento.preventDefault();
            const forma = raiz.querySelector('.pdv-forma[aria-checked="true"]') || raiz.querySelector('.pdv-forma');
            if (forma) forma.focus();
        } else if (evento.key === 'F10' || (evento.key === 'Enter' && (evento.ctrlKey || evento.metaKey))) {
            evento.preventDefault();
            finalizar();
        } else if (evento.key === 'Escape' && evento.target === document.body) {
            mostrarSecao('pdv-inicio', true);
        }
    });

    async function carregarPdv() {
        if (!tela.montada) montar();
        tela.grupos = {};
        await Promise.all([carregarCatalogos(), carregarPratos()]);
        if (!venda.itens.length) venda.formaId = '';
        // Prato que saiu do cardapio (ou esgotou) enquanto o PDV estava fechado sai do carrinho; o limite e o de agora.
        venda.itens = venda.itens.filter(function (i) {
            const p = pratoPorId(i.prato_id);
            if (p && p.ativo) i.vendavel = p.vendavel;
            return !!(p && p.ativo);
        });
        desenharTudo();
        if (tela.concluida) mostrarConcluida();
        else if (janela.innerWidth > 860) document.getElementById('pdvBusca').focus();
    }

    N.registrarTela('pdv', { titulo: 'PDV', carregar: carregarPdv, telaCheia: true });
    janela.Telas = janela.Telas || {};
    janela.Telas.pdv = { carregar: carregarPdv };
})(window);
