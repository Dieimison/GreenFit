// carga: usa Formato; publica Loja  (conferido por testes/front/carga.test.js)
/*
 * loja.js - o app do cliente do Green Fit (estilo app de delivery). Window.Loja.
 *
 * Uma pagina so, com as telas pelo endereco (#/...):
 *   #/                     cardapio: capa da loja, busca, categorias, selos, destaques
 *   #/busca                o mesmo cardapio, com a busca em foco
 *   #/prato/ID             o prato numa janela por cima do cardapio (adicionais, nutricao)
 *   #/sacola               a sacola e o finalizar (entrega/retirada, pagamento, cupom, cashback)
 *   #/entrar  #/criar-conta  #/esqueci
 *   #/pedidos              meus pedidos (pedir de novo)
 *   #/pedido/ID            acompanhar o pedido (Pix, etapas, avaliacao)
 *   #/perfil[/dados|/enderecos|/favoritos|/cashback]
 *
 * Quem decide tudo e o servidor (/api/loja/...): preco, taxa, cupom,
 * cashback, o que esta disponivel, se a loja aceita pedido. A tela so
 * mostra, guarda a sacola neste navegador e pede. Os totais da sacola vem
 * do POST /api/loja/carrinho (a conta de verdade), a cada mudanca.
 */
(function (janela) {
    'use strict';

    const { escapar, moeda } = janela.Formato;
    const raiz = document.getElementById('conteudo');
    const folha = document.getElementById('folha');
    const folhaFundo = document.getElementById('folhaFundo');
    const CHAVE_SACOLA = 'greenfit-sacola-v1';
    const CHAVE_PREF = 'greenfit-preferencias-v1';
    const CHAVE_VOLTAR = 'greenfit-voltar';
    const TERMINADOS = ['entregue', 'cancelada'];

    const estado = {
        vitrine: null, conta: null, enderecos: null, pagina: null,
        busca: '', selos: [], relogio: 0, contagem: 0, calculo: 0, focoAntes: null,
        folhaAberta: false, abriuFolha: false, ultimoCarrinho: null,
    };
    const preferencias = Object.assign({ modo: 'entrega', bairro_id: null }, ler(CHAVE_PREF, {}));
    const sacola = Object.assign({ itens: [] }, ler(CHAVE_SACOLA, {}));
    const finalizar = {
        endereco_id: null, novoEndereco: false, endereco: {}, pagamento: null, troco: '', cupom: null, cupomErro: '',
        usar_cashback: false, quando: 'agora', data: '', hora: '', observacoes: '',
    };

    // ------------------------------------------------------------------
    // Icones (24x24, traco)
    // ------------------------------------------------------------------
    const ICONE = {
        prato: '<path d="M6 24h36a18 18 0 0 1-36 0z"/><path d="M16 42h16"/><path d="M24 22c0-8 6-12 12-12-1 7-5 12-12 12z"/><path d="M24 22c-1-6-5-9-10-9 0 6 4 9 10 9z"/>',
        fogo: '<path d="M12 22c4 0 7-3 7-7 0-4-3-6-4-10-2 2-3 4-3 6-1-1-2-2-2-4-2 2-5 5-5 8 0 4 3 7 7 7z"/>',
        musculo: '<path d="M6 7v10M18 7v10M3 10v4M21 10v4M6 12h12"/>',
        relogio: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
        folha: '<path d="M5 19c0-8 6-14 15-14-1 9-6 15-14 15"/><path d="M5 19c3-4 6-7 10-9"/>',
        coracao: '<path d="M12 20s-7-4.4-7-10a4 4 0 0 1 7-2.6A4 4 0 0 1 19 10c0 5.6-7 10-7 10z"/>',
        estrela: '<path d="M12 2.8l2.8 5.9 6.4.8-4.7 4.4 1.2 6.4L12 17.2l-5.7 3.1 1.2-6.4-4.7-4.4 6.4-.8z"/>',
        voltar: '<path d="M15 18l-6-6 6-6"/>',
        fechar: '<path d="M6 6l12 12M18 6L6 18"/>',
        check: '<path d="M5 12.5l4.2 4L19 7"/>',
        moto: '<circle cx="6" cy="17" r="3"/><circle cx="18" cy="17" r="3"/><path d="M9 17h6l-2-6H9M15 7h3l2 6"/>',
        loja: '<path d="M3 9l1.5-5h15L21 9M3 9h18M4 9v11h16V9M9 20v-6h6v6"/>',
        pix: '<path d="M12 3l4 4-4 4-4-4zM12 13l4 4-4 4-4-4zM3 12l4-4 4 4-4 4zM13 12l4-4 4 4-4 4z"/>',
        cartao: '<rect x="3" y="6" width="18" height="13" rx="2"/><path d="M3 10h18M7 15h4"/>',
        dinheiro: '<rect x="3" y="6" width="18" height="12" rx="2"/><circle cx="12" cy="12" r="2.5"/><path d="M6 9v.01M18 15v.01"/>',
        vale: '<path d="M4 7h16v4a2 2 0 0 0 0 4v4H4v-4a2 2 0 0 0 0-4z"/><path d="M10 7v12"/>',
        whatsapp: '<path d="M4 20l1.3-3.9A8 8 0 1 1 8 19z"/><path d="M9 9.5c.3 2 2.5 4.2 4.5 4.5l1-1.2 2 .8c-.2 1.3-1.2 2-2.5 1.9-3-.4-5.6-3-6-6-.1-1.3.6-2.3 1.9-2.5l.8 2z"/>',
        instagram: '<rect x="3" y="3" width="18" height="18" rx="5"/><circle cx="12" cy="12" r="4"/><path d="M17.5 6.5v.01"/>',
        endereco: '<path d="M12 21s-7-6.5-7-12a7 7 0 0 1 14 0c0 5.5-7 12-7 12z"/><circle cx="12" cy="9" r="2.5"/>',
        moeda: '<circle cx="12" cy="12" r="9"/><path d="M14.5 9.5c-.5-1-1.5-1.5-2.5-1.5-1.4 0-2.5.8-2.5 2s1 1.7 2.5 2 2.5.8 2.5 2-1.1 2-2.5 2c-1 0-2-.5-2.5-1.5M12 6.5v11"/>',
        alvo: '<circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="5"/><circle cx="12" cy="12" r="1"/>',
        pedido: '<path d="M9 4h6a1 1 0 0 1 1 1v1h2a1 1 0 0 1 1 1v13a1 1 0 0 1-1 1H6a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h2V5a1 1 0 0 1 1-1z"/><path d="M9 12h6M9 16h4"/>',
        usuario: '<circle cx="12" cy="8" r="4"/><path d="M4 21a8 8 0 0 1 16 0"/>',
        sair: '<path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4M16 17l5-5-5-5M21 12H9"/>',
        sacola: '<path d="M5 8h14l-1.2 12.2a1 1 0 0 1-1 .8H7.2a1 1 0 0 1-1-.8z"/><path d="M9 8V6a3 3 0 0 1 6 0v2"/>',
        busca: '<circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/>',
        aviso: '<path d="M12 3l9.5 17h-19z"/><path d="M12 10v4M12 17v.01"/>',
        seta: '<path d="M9 18l6-6-6-6"/>',
    };
    function svg(nome, viewBox) {
        return '<svg viewBox="' + (viewBox || (nome === 'prato' ? '0 0 48 48' : '0 0 24 24')) + '" aria-hidden="true">' + ICONE[nome] + '</svg>';
    }

    // ------------------------------------------------------------------
    // Servidor e memoria do navegador
    // ------------------------------------------------------------------
    async function api(caminho, metodo, corpo) {
        let r;
        try {
            r = await fetch('/api/loja' + caminho, {
                method: metodo || 'GET', credentials: 'same-origin',
                headers: { 'Content-Type': 'application/json' },
                body: corpo === undefined ? undefined : JSON.stringify(corpo),
            });
        } catch (e) {
            throw new Error('Sem conexão com a loja. Confira a internet e tente de novo.');
        }
        let dados = {};
        try { dados = await r.json(); } catch (e) { /* resposta sem JSON */ }
        if (!r.ok || dados.ok === false) {
            const erro = new Error(dados.erro || 'Não foi possível falar com a loja agora. Tente de novo.');
            erro.status = r.status;
            throw erro;
        }
        return dados;
    }

    function ler(chave, padrao) {
        try {
            const v = JSON.parse(localStorage.getItem(chave) || 'null');
            return v === null ? padrao : v;
        } catch (e) { return padrao; }
    }
    function gravar(chave, valor) {
        try { localStorage.setItem(chave, JSON.stringify(valor)); } catch (e) { /* sem memoria: vale so nesta pagina */ }
    }
    function guardarVoltar(destino) {
        try { sessionStorage.setItem(CHAVE_VOLTAR, destino); } catch (e) { /* sem memoria */ }
    }
    function tirarVoltar() {
        try {
            const v = sessionStorage.getItem(CHAVE_VOLTAR);
            sessionStorage.removeItem(CHAVE_VOLTAR);
            return v;
        } catch (e) { return null; }
    }

    function avisar(texto, tipo) {
        const caixa = document.getElementById('avisos');
        const aviso = document.createElement('div');
        aviso.className = 'aviso' + (tipo === 'erro' ? ' aviso-erro' : '');
        aviso.setAttribute('role', tipo === 'erro' ? 'alert' : 'status');
        aviso.textContent = texto;
        caixa.appendChild(aviso);
        setTimeout(function () { aviso.classList.add('saindo'); }, 3800);
        setTimeout(function () { aviso.remove(); }, 4200);
    }

    /** Roda a acao com o botao travado: toque duplo nao manda duas vezes. */
    async function travado(botao, acao, textoEsperando) {
        if (!botao || botao.disabled) return;
        const original = botao.innerHTML;
        botao.disabled = true;
        botao.setAttribute('aria-busy', 'true');
        if (textoEsperando) botao.textContent = textoEsperando;
        try {
            await acao();
        } catch (erro) {
            avisar(erro.message, 'erro');
        } finally {
            if (botao.isConnected) {
                botao.disabled = false;
                botao.removeAttribute('aria-busy');
                botao.innerHTML = original;
            }
        }
    }

    // ------------------------------------------------------------------
    // Pequenas contas e textos
    // ------------------------------------------------------------------
    function normalizar(t) {
        return String(t || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
    }
    function numero(n, casas) {
        return Number(n || 0).toLocaleString('pt-BR', { maximumFractionDigits: casas === undefined ? 0 : casas });
    }
    function primeiroNome(nome) {
        return String(nome || '').trim().split(/\s+/)[0] || '';
    }
    function rotuloDominio(nome, valor) {
        const lista = (estado.vitrine && estado.vitrine.dominios && estado.vitrine.dominios[nome]) || [];
        const achado = lista.find(function (d) { return d.valor === valor; });
        return achado ? achado.rotulo : valor;
    }
    function telefoneBr(n) {
        const d = String(n || '').replace(/\D/g, '');
        if (d.length === 11) return '(' + d.slice(0, 2) + ') ' + d.slice(2, 7) + '-' + d.slice(7);
        if (d.length === 10) return '(' + d.slice(0, 2) + ') ' + d.slice(2, 6) + '-' + d.slice(6);
        return d;
    }
    function linkWhats(numeroLoja, texto) {
        const d = String(numeroLoja || '').replace(/\D/g, '');
        if (!d) return null;
        return 'https://wa.me/55' + d + (texto ? '?text=' + encodeURIComponent(texto) : '');
    }
    function hojeIso() {
        const d = new Date();
        return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
    }
    /** "hoje às 12:30", "amanhã às 11:00", "12/11 às 19:00". */
    function quandoTexto(dt) {
        if (!dt) return '';
        const dia = String(dt).substring(0, 10);
        const hora = String(dt).substring(11, 16);
        const hoje = hojeIso();
        const amanha = new Date(Date.now() + 86400000);
        const amanhaIso = amanha.getFullYear() + '-' + String(amanha.getMonth() + 1).padStart(2, '0') + '-' + String(amanha.getDate()).padStart(2, '0');
        const p = dia.split('-');
        const nomeDia = dia === hoje ? 'hoje' : (dia === amanhaIso ? 'amanhã' : p[2] + '/' + p[1]);
        return nomeDia + ' às ' + hora;
    }
    function dataHoraCurta(dt) {
        if (!dt) return '';
        const p = String(dt).substring(0, 10).split('-');
        return p[2] + '/' + p[1] + '/' + p[0] + ' ' + String(dt).substring(11, 16);
    }

    function pratoPorId(id) {
        return ((estado.vitrine && estado.vitrine.pratos) || []).find(function (p) { return p.id === Number(id); }) || null;
    }
    function loja() { return (estado.vitrine && estado.vitrine.loja) || {}; }

    function fotoHtml(p, classe, alt) {
        const id = p && p.fotos && p.fotos.length ? p.fotos[0] : (typeof p === 'number' ? p : null);
        return '<div class="foto-prato' + (classe ? ' ' + classe : '') + '">' +
            (id ? '<img src="/api/loja/fotos/' + id + '" alt="' + escapar(alt || '') + '" loading="lazy" width="300" height="300">'
                : '<span class="sem-foto">' + svg('prato') + '</span>') +
            '</div>';
    }

    // ------------------------------------------------------------------
    // Sacola (fica neste navegador)
    // ------------------------------------------------------------------
    function chaveItem(pratoId, adicionais, observacao) {
        const ads = (adicionais || []).map(function (a) { return a.id + 'x' + (a.quantidade || 1); }).sort().join(',');
        return pratoId + '|' + ads + '|' + normalizar(observacao).trim();
    }
    function gravarSacola() {
        gravar(CHAVE_SACOLA, sacola);
        atualizarIndicadores();
    }
    function adicionalDoPrato(p, id) {
        for (const g of (p.grupos || [])) {
            const o = g.opcoes.find(function (x) { return x.id === Number(id); });
            if (o) return Object.assign({ grupo: g.nome }, o);
        }
        return null;
    }
    /** Preco de uma unidade do item (prato + adicionais), pelo cardapio carregado. */
    function precoItem(item) {
        const p = pratoPorId(item.prato_id);
        if (!p) return 0;
        return (item.adicionais || []).reduce(function (soma, a) {
            const o = adicionalDoPrato(p, a.id);
            return soma + (o ? o.preco * (a.quantidade || 1) : 0);
        }, p.preco_atual);
    }
    function kcalItem(item) {
        const p = pratoPorId(item.prato_id);
        if (!p || p.kcal === null) return 0;
        return (item.adicionais || []).reduce(function (soma, a) {
            const o = adicionalDoPrato(p, a.id);
            return soma + (o ? o.kcal * (a.quantidade || 1) : 0);
        }, p.kcal);
    }
    function totalSacola() {
        return sacola.itens.reduce(function (s, i) { return s + precoItem(i) * i.quantidade; }, 0);
    }
    function unidadesSacola() {
        return sacola.itens.reduce(function (s, i) { return s + i.quantidade; }, 0);
    }
    function noCarrinho(pratoId) {
        return sacola.itens.filter(function (i) { return i.prato_id === pratoId; }).reduce(function (s, i) { return s + i.quantidade; }, 0);
    }
    function adicionarNaSacola(item) {
        const chave = chaveItem(item.prato_id, item.adicionais, item.observacao);
        const igual = sacola.itens.find(function (i) { return i.chave === chave; });
        if (igual) igual.quantidade = Math.min(30, igual.quantidade + item.quantidade);
        else sacola.itens.push(Object.assign({ chave: chave }, item));
        gravarSacola();
    }
    /* Prato que saiu do cardapio, ou adicional que nao existe mais: sai da sacola com aviso. */
    function conferirSacola() {
        if (!estado.vitrine) return;
        const antes = sacola.itens.length;
        sacola.itens = sacola.itens.filter(function (i) {
            const p = pratoPorId(i.prato_id);
            return p && (i.adicionais || []).every(function (a) { return adicionalDoPrato(p, a.id); });
        });
        if (sacola.itens.length !== antes) {
            avisar('Um item da sua sacola saiu do cardápio e foi retirado.', 'erro');
            gravarSacola();
        }
    }

    function atualizarIndicadores() {
        const qtd = unidadesSacola();
        const contador = document.getElementById('contadorSacola');
        contador.hidden = qtd === 0;
        contador.textContent = String(qtd);
        const barra = document.getElementById('barraSacola');
        const esconder = ['sacola', 'pedido', 'entrar', 'criar-conta', 'esqueci'].indexOf(estado.pagina) !== -1;
        barra.hidden = qtd === 0 || esconder;
        document.body.classList.toggle('com-barra', !barra.hidden);
        document.body.classList.toggle('pagina-sacola', estado.pagina === 'sacola');
        document.getElementById('barraSacolaQtd').textContent = String(qtd);
        document.getElementById('barraSacolaTotal').textContent = moeda(totalSacola());
        desenharSacolaLateral();
    }

    function atualizarConta() {
        document.getElementById('rotuloConta').textContent = estado.conta ? primeiroNome(estado.conta.nome) : 'Entrar';
    }

    function marcarNavegacao(nome) {
        document.querySelectorAll('[data-nav]').forEach(function (a) {
            const ativo = a.dataset.nav === nome;
            a.classList.toggle('ativo', ativo);
            if (ativo) a.setAttribute('aria-current', 'page'); else a.removeAttribute('aria-current');
        });
    }

    // ------------------------------------------------------------------
    // Cardapio
    // ------------------------------------------------------------------
    function faixaTaxa() {
        const taxas = (estado.vitrine.bairros || []).map(function (b) { return b.taxa; });
        if (!taxas.length) return 'sem bairros cadastrados';
        const min = Math.min.apply(null, taxas);
        const max = Math.max.apply(null, taxas);
        if (max === 0) return 'entrega grátis';
        return min === max ? moeda(min) : 'de ' + moeda(min) + ' a ' + moeda(max);
    }
    function bairroEscolhido() {
        return (estado.vitrine.bairros || []).find(function (b) { return b.id === Number(preferencias.bairro_id); }) || null;
    }
    function modoAtual() {
        const l = loja();
        if (preferencias.modo === 'retirada' && l.aceita_retirada) return 'retirada';
        if (preferencias.modo === 'entrega' && l.aceita_entrega) return 'entrega';
        return l.aceita_entrega ? 'entrega' : 'retirada';
    }

    function infoModoHtml() {
        const l = loja();
        const modo = modoAtual();
        if (modo === 'retirada') {
            return '<div class="modo-info"><span>' + svg('loja').replace('<svg', '<svg width="0"') + '<strong>Retirada</strong> · pronto em ~' +
                l.tempo_preparo_min + ' min · grátis</span></div>' +
                (l.endereco_retirada ? '<p class="modo-info">' + escapar(l.endereco_retirada) + '</p>' : '');
        }
        const b = bairroEscolhido();
        const tempo = l.tempo_preparo_min + (b ? b.tempo_min : 10);
        const taxa = b ? (b.taxa > 0 ? moeda(b.taxa) : 'grátis') : faixaTaxa();
        return '<div class="modo-info"><span><strong>Entrega</strong> · ' + tempo + '-' + (tempo + 15) + ' min · ' + escapar(taxa) + '</span>' +
            (l.frete_gratis_acima > 0 ? '<span class="pilula pilula-lima">Grátis acima de ' + moeda(l.frete_gratis_acima) + '</span>' : '') + '</div>' +
            '<div class="seletor-bairro"><label for="bairroTopo">Entregar em</label>' +
            '<select id="bairroTopo" class="campo-solto"><option value="">Escolha seu bairro</option>' +
            (estado.vitrine.bairros || []).map(function (bb) {
                return '<option value="' + bb.id + '"' + (b && b.id === bb.id ? ' selected' : '') + '>' + escapar(bb.nome) +
                    ' · ' + (bb.taxa > 0 ? moeda(bb.taxa) : 'grátis') + '</option>';
            }).join('') + '</select></div>';
    }

    function capaHtml() {
        const l = loja();
        const aberto = l.aberta_agora;
        const avaliacoes = l.avaliacoes > 0
            ? '<span class="nota">' + svg('estrela') + numero(l.nota, 1) + '</span><span>(' + l.avaliacoes + (l.avaliacoes === 1 ? ' avaliação' : ' avaliações') + ')</span>'
            : '<span class="pilula pilula-lima">Novo por aqui</span>';
        const opcoes = [];
        if (l.aceita_entrega) opcoes.push(['entrega', 'Entrega']);
        if (l.aceita_retirada) opcoes.push(['retirada', 'Retirada']);
        return '<div class="capa">' +
                '<img class="capa-imagem" src="../Img/greenfit-marca.jpg" alt="' + escapar(l.nome) + ': comida saudável" width="1380" height="752">' +
                '<div class="loja-cartao">' +
                    '<div class="loja-linha"><h1 class="loja-nome">' + escapar(l.nome) + '</h1>' +
                        '<span class="status ' + (aberto ? 'status-aberto' : 'status-fechado') + '">' + escapar(l.texto || '') + '</span></div>' +
                    (l.slogan ? '<p class="loja-slogan">' + escapar(l.slogan) + '</p>' : '') +
                    '<div class="loja-meta">' + avaliacoes +
                        (l.pedido_minimo > 0 ? '<span>Pedido mínimo ' + moeda(l.pedido_minimo) + '</span>' : '') +
                        (l.cashback_percentual > 0 ? '<span class="pilula pilula-dourada">' + l.cashback_percentual + '% de cashback</span>' : '') +
                    '</div>' +
                    (opcoes.length ? '<div class="modo-entrega">' +
                        (opcoes.length > 1 ? '<div class="segmentado" role="group" aria-label="Entrega ou retirada">' + opcoes.map(function (o) {
                            return '<button type="button" data-modo="' + o[0] + '" aria-pressed="' + (modoAtual() === o[0]) + '">' + o[1] + '</button>';
                        }).join('') + '</div>' : '') +
                        '<div id="infoModo">' + infoModoHtml() + '</div></div>' : '') +
                '</div>' +
            '</div>' +
            (l.aviso ? '<div class="aviso-loja">' + svg('folha') + '<span>' + escapar(l.aviso) + '</span></div>' : '') +
            (!aberto ? '<div class="aviso-loja fechada">' + svg('relogio') + '<span>' + escapar(l.texto || 'Loja fechada') +
                (l.aceita_pedidos ? '. Você pode montar a sacola e agendar o pedido.' : '. Dá para ver o cardápio, mas os pedidos estão pausados.') +
                '</span></div>' : '');
    }

    function cartaoPrato(p) {
        const esgotado = p.disponivel === 0;
        const fav = estado.conta && estado.conta.favoritos.indexOf(p.id) !== -1;
        const nutri = [];
        if (p.kcal !== null) nutri.push('<span>' + svg('fogo') + numero(p.kcal) + ' kcal</span>');
        if (p.proteinas !== null) nutri.push('<span>' + svg('musculo') + numero(p.proteinas, 1) + ' g proteína</span>');
        const etiquetas = [];
        if (p.preco_promocional) etiquetas.push('<span class="pilula pilula-laranja">Promoção</span>');
        if (esgotado) etiquetas.push('<span class="pilula pilula-cinza">Esgotado</span>');
        else if (p.disponivel !== null && p.disponivel <= 3) etiquetas.push('<span class="pilula pilula-aviso">' + (p.disponivel === 1 ? 'Última porção' : 'Últimas ' + p.disponivel + ' porções') + '</span>');
        if (p.feito_na_hora) etiquetas.push('<span class="pilula pilula-verde">Feito na hora</span>');
        if (p.mais_vendido) etiquetas.push('<span class="pilula pilula-dourada">Mais pedido</span>');
        return '<article class="cartao-prato' + (esgotado ? ' esgotado' : '') + '">' +
            '<div>' +
                '<h3 class="cartao-prato-nome"><a href="#/prato/' + p.id + '" class="link-prato" data-prato="' + p.id + '">' + escapar(p.nome) + '</a></h3>' +
                (p.descricao ? '<p class="cartao-prato-desc">' + escapar(p.descricao) + '</p>' : '') +
                (nutri.length ? '<div class="nutri-mini">' + nutri.join('') + '</div>' : '') +
                selosHtml(p.tags, 3) +
                '<div class="linha-preco">' + precoHtml(p) + '</div>' +
                (etiquetas.length ? '<div class="etiquetas-prato">' + etiquetas.join('') + '</div>' : '') +
            '</div>' +
            '<div style="position:relative">' + fotoHtml(p, '', p.nome) +
                (esgotado ? '' : '') +
                '<button type="button" class="coracao" data-favorito="' + p.id + '" aria-pressed="' + !!fav + '" aria-label="' +
                    (fav ? 'Tirar dos favoritos: ' : 'Guardar nos favoritos: ') + escapar(p.nome) + '">' + svg('coracao') + '</button>' +
            '</div>' +
        '</article>';
    }

    function cartaoDestaque(p) {
        return '<a class="cartao-destaque" href="#/prato/' + p.id + '" data-prato="' + p.id + '">' +
            fotoHtml(p, '', p.nome) +
            '<div class="cartao-destaque-corpo"><div class="cartao-destaque-nome">' + escapar(p.nome) + '</div>' +
            (p.kcal !== null ? '<div class="nutri-mini"><span>' + svg('fogo') + numero(p.kcal) + ' kcal</span>' +
                (p.proteinas !== null ? '<span>' + svg('musculo') + numero(p.proteinas, 1) + ' g prot.</span>' : '') + '</div>' : '') +
            '<div class="linha-preco">' + precoHtml(p) + '</div></div></a>';
    }

    function precoHtml(p) {
        if (p.preco_promocional) {
            return '<span class="preco promo">' + moeda(p.preco_promocional) + '</span><span class="preco-antigo">' + moeda(p.preco) + '</span>';
        }
        return '<span class="preco">' + moeda(p.preco_atual) + '</span>';
    }

    function selosHtml(tags, maximo) {
        if (!tags || !tags.length) return '';
        const mostrar = maximo ? tags.slice(0, maximo) : tags;
        return '<div class="selos">' + mostrar.map(function (t) {
            return '<span class="selo selo-' + escapar(t) + '">' + escapar(rotuloDominio('tags_prato', t)) + '</span>';
        }).join('') + (maximo && tags.length > maximo ? '<span class="selo">+' + (tags.length - maximo) + '</span>' : '') + '</div>';
    }

    function rodapeHtml() {
        const l = loja();
        const hoje = new Date().getDay();
        const whats = linkWhats(l.whatsapp, 'Olá! Vim pelo app da ' + l.nome + '.');
        return '<footer class="rodape"><div class="rodape-grade">' +
            '<div><h3>' + escapar(l.nome) + '</h3><p>' + escapar(l.slogan || 'Comida saudável de verdade.') + '</p>' +
                (l.endereco_retirada ? '<p style="margin-top:8px">' + escapar(l.endereco_retirada) + '</p>' : '') + '</div>' +
            '<div><h3>Horário de funcionamento</h3><table class="horarios"><tbody>' +
                (estado.vitrine.horarios || []).map(function (h) {
                    return '<tr' + (h.dia === hoje ? ' class="hoje"' : '') + '><td>' + escapar(h.nome) + '</td><td>' +
                        (h.aberto ? escapar(h.abre + ' às ' + h.fecha) : 'Fechado') + '</td></tr>';
                }).join('') + '</tbody></table></div>' +
            '<div><h3>Fale com a gente</h3><div class="rodape-links">' +
                (whats ? '<a href="' + whats + '" target="_blank" rel="noopener">' + svg('whatsapp') + 'WhatsApp ' + escapar(telefoneBr(l.whatsapp)) + '</a>' : '') +
                (l.instagram ? '<a href="https://instagram.com/' + encodeURIComponent(l.instagram) + '" target="_blank" rel="noopener">' + svg('instagram') + '@' + escapar(l.instagram) + '</a>' : '') +
            '</div></div>' +
            '</div><p class="rodape-fraco">Pagamento por Pix ou na entrega · <a href="../Login/index.html">Área da equipe</a></p></footer>';
    }

    function telaInicio(focarBusca) {
        estado.pagina = 'inicio';
        marcarNavegacao(focarBusca ? 'busca' : 'inicio');
        const v = estado.vitrine;
        const comPratos = v.categorias.filter(function (c) { return v.pratos.some(function (p) { return p.categoria_id === c.id; }); });
        const selosUsados = (v.dominios.tags_prato || []).filter(function (t) {
            return v.pratos.some(function (p) { return p.tags.indexOf(t.valor) !== -1; });
        });
        raiz.innerHTML =
            '<div class="layout-cardapio"><div>' +
            capaHtml() +
            '<div class="busca-caixa" role="search">' + svg('busca') +
                '<label class="sr-only" for="campoBusca">Buscar no cardápio</label>' +
                '<input type="search" id="campoBusca" placeholder="Buscar prato, ingrediente..." autocomplete="off" value="' + escapar(estado.busca) + '">' +
                '<button type="button" class="busca-limpar" id="limparBusca" aria-label="Limpar busca"' + (estado.busca ? '' : ' hidden') + '>&times;</button>' +
            '</div>' +
            '<div class="barra-categorias" id="barraCategorias"><div class="rolagem-chips" role="navigation" aria-label="Categorias">' +
                comPratos.map(function (c) { return '<button type="button" class="chip" data-categoria="' + c.id + '">' + escapar(c.nome) + '</button>'; }).join('') +
            '</div></div>' +
            (selosUsados.length ? '<div class="rolagem-chips filtros-selos" role="group" aria-label="Filtrar por selo">' +
                selosUsados.map(function (t) {
                    return '<button type="button" class="chip" data-selo="' + escapar(t.valor) + '" aria-pressed="' + (estado.selos.indexOf(t.valor) !== -1) + '">' +
                        escapar(t.rotulo) + '</button>';
                }).join('') + '</div>' : '') +
            '<div id="listaCardapio"></div>' +
            '</div><aside class="sacola-lateral" id="sacolaLateral" aria-label="Sua sacola"></aside></div>' +
            rodapeHtml();
        desenharCardapio();
        desenharSacolaLateral();
        ligarCategoriasGrudadas();
        if (focarBusca) {
            const campo = document.getElementById('campoBusca');
            campo.scrollIntoView({ block: 'center' });
            campo.focus();
        }
    }

    function filtrados() {
        const termo = normalizar(estado.busca).trim();
        return estado.vitrine.pratos.filter(function (p) {
            if (estado.selos.length && !estado.selos.every(function (s) { return p.tags.indexOf(s) !== -1; })) return false;
            if (!termo) return true;
            return normalizar(p.nome + ' ' + (p.descricao || '') + ' ' + (p.ingredientes || '') + ' ' + (p.categoria || '')).indexOf(termo) !== -1;
        });
    }

    function desenharCardapio() {
        const lista = document.getElementById('listaCardapio');
        if (!lista) return;
        const v = estado.vitrine;
        if (!v.pratos.length) {
            lista.innerHTML = '<div class="vazio">' + svg('prato') + '<h2>Cardápio em preparação</h2><p>Volte daqui a pouco: a cozinha está montando o cardápio.</p></div>';
            return;
        }
        if (estado.busca.trim() || estado.selos.length) {
            const achados = filtrados();
            lista.innerHTML = '<p class="resultado-busca" role="status">' + (achados.length ? achados.length + (achados.length === 1 ? ' prato encontrado' : ' pratos encontrados') : 'Nenhum prato encontrado') + '</p>' +
                (achados.length ? '<div class="lista-pratos" style="margin-top:12px">' + achados.map(cartaoPrato).join('') + '</div>'
                    : '<div class="vazio">' + svg('busca') + '<h2>Nada por aqui</h2><p>Tente outro nome ou tire algum filtro.</p>' +
                      '<button type="button" class="botao botao-claro" id="limparFiltros">Limpar busca e filtros</button></div>');
            return;
        }
        const destaques = v.pratos.filter(function (p) { return p.destaque && p.disponivel !== 0; });
        const maisPedidos = v.pratos.filter(function (p) { return p.mais_vendido && !p.destaque; });
        let html = '';
        if (destaques.length) {
            html += '<section><div class="secao-titulo"><h2>Destaques da casa</h2></div><div class="carrossel">' + destaques.map(cartaoDestaque).join('') + '</div></section>';
        }
        if (maisPedidos.length) {
            html += '<section><div class="secao-titulo"><h2>Mais pedidos</h2></div><div class="carrossel">' + maisPedidos.map(cartaoDestaque).join('') + '</div></section>';
        }
        v.categorias.forEach(function (c) {
            const daCat = v.pratos.filter(function (p) { return p.categoria_id === c.id; });
            if (!daCat.length) return;
            daCat.sort(function (a, b) { return (a.disponivel === 0) - (b.disponivel === 0); });
            html += '<section class="secao-categoria" id="cat-' + c.id + '" data-secao-categoria="' + c.id + '">' +
                '<div class="secao-titulo"><div><h2>' + escapar(c.nome) + '</h2>' + (c.descricao ? '<p>' + escapar(c.descricao) + '</p>' : '') + '</div></div>' +
                '<div class="lista-pratos">' + daCat.map(cartaoPrato).join('') + '</div></section>';
        });
        const semCategoria = v.pratos.filter(function (p) { return !p.categoria_id || !v.categorias.some(function (c) { return c.id === p.categoria_id; }); });
        if (semCategoria.length) {
            html += '<section class="secao-categoria"><div class="secao-titulo"><h2>Outros</h2></div><div class="lista-pratos">' + semCategoria.map(cartaoPrato).join('') + '</div></section>';
        }
        lista.innerHTML = html;
        observarCategorias();
    }

    /* A categoria que esta na tela fica marcada na barra (IntersectionObserver: barato). */
    let observador = null;
    function observarCategorias() {
        if (observador) observador.disconnect();
        if (!('IntersectionObserver' in window)) return;
        observador = new IntersectionObserver(function (entradas) {
            entradas.forEach(function (e) {
                if (!e.isIntersecting) return;
                const id = e.target.dataset.secaoCategoria;
                document.querySelectorAll('[data-categoria]').forEach(function (chip) {
                    const ativo = chip.dataset.categoria === id;
                    chip.classList.toggle('ativo', ativo);
                    if (ativo && chip.parentElement) {
                        chip.parentElement.scrollTo({ left: chip.offsetLeft - 16, behavior: 'smooth' });
                    }
                });
            });
        }, { rootMargin: '-140px 0px -60% 0px' });
        document.querySelectorAll('[data-secao-categoria]').forEach(function (s) { observador.observe(s); });
    }

    function ligarCategoriasGrudadas() {
        const barra = document.getElementById('barraCategorias');
        if (!barra || !('IntersectionObserver' in window)) return;
        const sentinela = document.createElement('div');
        barra.parentElement.insertBefore(sentinela, barra);
        new IntersectionObserver(function (e) {
            barra.classList.toggle('grudada', !e[0].isIntersecting);
        }).observe(sentinela);
    }

    function desenharSacolaLateral() {
        const lado = document.getElementById('sacolaLateral');
        if (!lado) return;
        if (!sacola.itens.length) {
            lado.innerHTML = '<div class="cartao"><h2>Sua sacola</h2><p class="cartao-sub">Está vazia. Escolha um prato para começar.</p></div>';
            return;
        }
        lado.innerHTML = '<div class="cartao"><h2>Sua sacola <span class="pilula pilula-verde">' + unidadesSacola() + ' itens</span></h2>' +
            sacola.itens.map(function (i) {
                const p = pratoPorId(i.prato_id);
                return '<div class="resumo-linha"><span>' + i.quantidade + 'x ' + escapar(p ? p.nome : 'Prato') + '</span><span>' + moeda(precoItem(i) * i.quantidade) + '</span></div>';
            }).join('') +
            '<div class="resumo-total"><span>Subtotal</span><span>' + moeda(totalSacola()) + '</span></div>' +
            '<a class="botao botao-largo" href="#/sacola" style="margin-top:14px">Ver sacola e finalizar</a></div>';
    }

    // ------------------------------------------------------------------
    // Janela do prato
    // ------------------------------------------------------------------
    function abrirPrato(id) {
        const p = pratoPorId(id);
        if (!p) {
            avisar('Este prato não está mais no cardápio.', 'erro');
            fecharFolha(true);
            return;
        }
        const l = loja();
        const escolhas = {};   // grupo_id -> [adicional_id]
        (p.grupos || []).forEach(function (g) { escolhas[g.id] = []; });
        let quantidade = 1;
        const livre = p.disponivel === null ? 30 : Math.max(0, p.disponivel - noCarrinho(p.id));

        const nutriLinhas = [];
        if (p.fibras !== null) nutriLinhas.push(['Fibras', numero(p.fibras, 1) + ' g']);
        if (p.sodio_mg !== null) nutriLinhas.push(['Sódio', numero(p.sodio_mg) + ' mg']);
        const temMacros = p.kcal !== null || p.proteinas !== null || p.carboidratos !== null || p.gorduras !== null;
        const conservacao = rotuloDominio('conservacoes', p.conservacao);
        const validade = p.feito_na_hora ? 'Preparado na hora do pedido' :
            (p.validade_dias > 0 ? conservacao + ' · consumir em até ' + p.validade_dias + (p.validade_dias === 1 ? ' dia' : ' dias') : conservacao);

        const galeria = p.fotos.length
            ? '<div class="galeria" id="galeria">' + p.fotos.map(function (f, i) {
                return '<img src="/api/loja/fotos/' + f + '" alt="' + escapar(p.nome) + (p.fotos.length > 1 ? ' (foto ' + (i + 1) + ')' : '') + '" width="600" height="450">';
              }).join('') + '</div>' + (p.fotos.length > 1 ? '<div class="galeria-pontos" aria-hidden="true">' + p.fotos.map(function () { return '<span></span>'; }).join('') + '</div>' : '')
            : '<div class="galeria">' + fotoHtml(p, '', '') + '</div>';

        folha.innerHTML =
            '<div class="folha-alca" aria-hidden="true"></div>' +
            '<button type="button" class="botao-icone folha-fechar" data-fechar-folha aria-label="Fechar">' + svg('fechar') + '</button>' +
            '<div class="folha-rolagem">' + galeria +
            '<div class="folha-corpo">' +
                '<h2 class="folha-titulo" id="folhaTitulo">' + escapar(p.nome) + '</h2>' +
                selosHtml(p.tags) +
                (p.descricao ? '<p class="folha-desc">' + escapar(p.descricao) + '</p>' : '') +
                '<div class="linha-preco">' + precoHtml(p) +
                    (p.nota ? '<span class="nota" style="margin-left:auto">' + svg('estrela') + numero(p.nota, 1) + ' <small style="color:var(--tinta-fraca);font-weight:400">(' + p.avaliacoes + ')</small></span>' : '') +
                '</div>' +
                (p.disponivel !== null && p.disponivel > 0 && p.disponivel <= 3 ? '<p class="aviso-inline" style="margin-top:10px">Corre: ' +
                    (p.disponivel === 1 ? 'só resta 1 porção.' : 'só restam ' + p.disponivel + ' porções.') + '</p>' : '') +
                (temMacros ? '<div class="folha-bloco"><h3>Informação nutricional' + (p.porcao_g ? ' <small style="font-weight:400;color:var(--tinta-fraca)">(porção de ' + p.porcao_g + ' g)</small>' : '') + '</h3>' +
                    '<div class="macros">' +
                        '<div class="macro kcal"><strong>' + (p.kcal !== null ? numero(p.kcal) : '—') + '</strong><span>kcal</span></div>' +
                        '<div class="macro"><strong>' + (p.proteinas !== null ? numero(p.proteinas, 1) + 'g' : '—') + '</strong><span>proteínas</span></div>' +
                        '<div class="macro"><strong>' + (p.carboidratos !== null ? numero(p.carboidratos, 1) + 'g' : '—') + '</strong><span>carboidratos</span></div>' +
                        '<div class="macro"><strong>' + (p.gorduras !== null ? numero(p.gorduras, 1) + 'g' : '—') + '</strong><span>gorduras</span></div>' +
                    '</div>' +
                    (nutriLinhas.length ? '<table class="tabela-nutri"><tbody>' + nutriLinhas.map(function (n) { return '<tr><td>' + n[0] + '</td><td>' + n[1] + '</td></tr>'; }).join('') + '</tbody></table>' : '') +
                '</div>' : '') +
                (p.grupos || []).map(grupoHtml).join('') +
                (p.ingredientes ? '<div class="folha-bloco"><h3>Ingredientes</h3><p>' + escapar(p.ingredientes) + '</p></div>' : '') +
                (p.alergenicos ? '<div class="folha-bloco"><h3>Alergênicos</h3><p>' + escapar(p.alergenicos) + '</p></div>' : '') +
                '<div class="folha-bloco"><h3>Conservação</h3><p>' + escapar(validade) + '</p>' +
                    (p.modo_preparo ? '<p style="margin-top:4px">' + escapar(p.modo_preparo) + '</p>' : '') + '</div>' +
                '<div class="campo"><label for="obsPrato">Alguma observação?</label>' +
                    '<textarea id="obsPrato" maxlength="140" placeholder="Ex.: sem cebola, molho à parte"></textarea>' +
                    '<span class="contador-texto" id="obsContador">0/140</span></div>' +
            '</div></div>' +
            '<div class="folha-rodape">' +
                '<div class="passo" role="group" aria-label="Quantidade">' +
                    '<button type="button" data-qtd="-1" aria-label="Diminuir">&minus;</button>' +
                    '<output id="qtdPrato" aria-live="polite">1</output>' +
                    '<button type="button" data-qtd="1" aria-label="Aumentar">+</button>' +
                '</div>' +
                '<button type="button" class="botao" id="adicionarPrato"></button>' +
            '</div>';

        function grupoHtml(g) {
            const radio = g.maximo === 1;
            const regra = radio ? 'Escolha 1' : (g.minimo > 0 ? 'Escolha de ' + g.minimo + ' a ' + g.maximo : 'Escolha até ' + g.maximo);
            return '<fieldset class="grupo" data-grupo="' + g.id + '" style="padding:0">' +
                '<legend class="sr-only">' + escapar(g.nome) + '</legend>' +
                '<div class="grupo-topo"><div><h3>' + escapar(g.nome) + '</h3><p>' + escapar(g.descricao || regra) + '</p></div>' +
                    (g.minimo > 0 ? '<span class="pilula pilula-verde">Obrigatório</span>' : '<span class="pilula pilula-cinza">Opcional</span>') + '</div>' +
                g.opcoes.map(function (o) {
                    return '<label class="opcao"><input type="' + (radio ? 'radio' : 'checkbox') + '" name="g' + g.id + '" value="' + o.id + '" data-grupo-op="' + g.id + '">' +
                        '<span class="opcao-texto"><span class="opcao-nome">' + escapar(o.nome) + '</span>' +
                        (o.kcal || o.proteinas ? '<span class="opcao-info">' + (o.kcal ? '+' + numero(o.kcal) + ' kcal' : '') +
                            (o.proteinas ? (o.kcal ? ' · ' : '') + '+' + numero(o.proteinas, 1) + ' g proteína' : '') + '</span>' : '') + '</span>' +
                        '<span class="opcao-preco">' + (o.preco > 0 ? '+ ' + moeda(o.preco) : 'Grátis') + '</span></label>';
                }).join('') + '</fieldset>';
        }

        function faltando() {
            return (p.grupos || []).find(function (g) { return escolhas[g.id].length < g.minimo; }) || null;
        }

        function atualizarRodape() {
            const unit = (p.grupos || []).reduce(function (s, g) {
                return s + escolhas[g.id].reduce(function (ss, id) { return ss + (adicionalDoPrato(p, id) || { preco: 0 }).preco; }, 0);
            }, p.preco_atual);
            const botao = document.getElementById('adicionarPrato');
            document.getElementById('qtdPrato').textContent = String(quantidade);
            folha.querySelector('[data-qtd="-1"]').disabled = quantidade <= 1;
            folha.querySelector('[data-qtd="1"]').disabled = quantidade >= livre;
            if (p.disponivel === 0) {
                botao.disabled = true;
                botao.textContent = 'Esgotado';
            } else if (livre <= 0) {
                botao.disabled = true;
                botao.textContent = 'Você já pegou todas as porções';
            } else if (!l.aceita_pedidos) {
                botao.disabled = true;
                botao.textContent = 'Pedidos pausados agora';
            } else {
                botao.disabled = false;
                const falta = faltando();
                botao.innerHTML = '<span>' + (falta ? 'Complete as escolhas' : 'Adicionar') + '</span><span class="numero">' + moeda(unit * quantidade) + '</span>';
            }
        }

        folha.addEventListener('change', function (e) {
            const alvo = e.target;
            if (!alvo.dataset || !alvo.dataset.grupoOp) return;
            const g = p.grupos.find(function (x) { return x.id === Number(alvo.dataset.grupoOp); });
            const marcados = Array.from(folha.querySelectorAll('[data-grupo-op="' + g.id + '"]:checked')).map(function (i) { return Number(i.value); });
            escolhas[g.id] = marcados;
            if (g.maximo > 1) {
                folha.querySelectorAll('[data-grupo-op="' + g.id + '"]').forEach(function (i) {
                    const travar = !i.checked && marcados.length >= g.maximo;
                    i.disabled = travar;
                    i.closest('.opcao').classList.toggle('desligada', travar);
                });
            }
            folha.querySelector('[data-grupo="' + g.id + '"]').classList.remove('falta');
            atualizarRodape();
        });
        folha.querySelector('#obsPrato').addEventListener('input', function () {
            document.getElementById('obsContador').textContent = this.value.length + '/140';
        });
        folha.querySelectorAll('[data-qtd]').forEach(function (b) {
            b.addEventListener('click', function () {
                quantidade = Math.max(1, Math.min(livre, quantidade + Number(b.dataset.qtd)));
                atualizarRodape();
            });
        });
        document.getElementById('adicionarPrato').addEventListener('click', function () {
            const falta = faltando();
            if (falta) {
                const bloco = folha.querySelector('[data-grupo="' + falta.id + '"]');
                bloco.classList.add('falta');
                bloco.scrollIntoView({ behavior: 'smooth', block: 'center' });
                avisar('Escolha uma opção em "' + falta.nome + '".', 'erro');
                return;
            }
            const adicionais = [];
            Object.keys(escolhas).forEach(function (gid) { escolhas[gid].forEach(function (id) { adicionais.push({ id: id, quantidade: 1 }); }); });
            adicionarNaSacola({ prato_id: p.id, quantidade: quantidade, adicionais: adicionais,
                                observacao: folha.querySelector('#obsPrato').value.trim() });
            avisar(quantidade + 'x ' + p.nome + ' na sacola.');
            fecharFolha();
        });

        atualizarRodape();
        estado.focoAntes = document.activeElement;
        folha.hidden = false;
        folhaFundo.hidden = false;
        estado.folhaAberta = true;
        document.body.style.overflow = 'hidden';
        folha.querySelector('[data-fechar-folha]').focus();
    }

    function fecharFolha(semVoltar) {
        if (!estado.folhaAberta) return;
        estado.folhaAberta = false;
        folha.hidden = true;
        folhaFundo.hidden = true;
        folha.innerHTML = '';
        document.body.style.overflow = '';
        if (estado.focoAntes && estado.focoAntes.isConnected) estado.focoAntes.focus();
        if (!semVoltar && /^#\/prato\//.test(location.hash)) {
            if (estado.abriuFolha) history.back(); else history.replaceState(null, '', '#/');
        }
        estado.abriuFolha = false;
    }

    folhaFundo.addEventListener('click', function () { fecharFolha(); });
    folha.addEventListener('click', function (e) { if (e.target.closest('[data-fechar-folha]')) fecharFolha(); });
    document.addEventListener('keydown', function (e) { if (e.key === 'Escape' && estado.folhaAberta) fecharFolha(); });

    // ------------------------------------------------------------------
    // Sacola e finalizar
    // ------------------------------------------------------------------
    function diasParaAgendar() {
        const l = loja();
        const dias = [];
        const nomes = ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb'];
        for (let d = 0; d <= (l.agenda_dias || 7); d++) {
            const data = new Date(Date.now() + d * 86400000);
            const h = (estado.vitrine.horarios || []).find(function (x) { return x.dia === data.getDay(); });
            if (!h || !h.aberto) continue;
            const iso = data.getFullYear() + '-' + String(data.getMonth() + 1).padStart(2, '0') + '-' + String(data.getDate()).padStart(2, '0');
            const horas = horariosDoDia(iso, h);
            if (!horas.length) continue;
            dias.push({ iso: iso, rotulo: (d === 0 ? 'Hoje' : d === 1 ? 'Amanhã' : nomes[data.getDay()]) + ', ' + iso.slice(8) + '/' + iso.slice(5, 7), horas: horas });
        }
        return dias;
    }
    function horariosDoDia(iso, h) {
        const l = loja();
        const minimo = Date.now() + ((l.tempo_preparo_min || 40) + 5) * 60000;
        const saida = [];
        const [ha, ma] = h.abre.split(':').map(Number);
        const [hf, mf] = h.fecha.split(':').map(Number);
        const p = iso.split('-').map(Number);
        for (let t = ha * 60 + ma; t < hf * 60 + mf; t += 30) {
            const momento = new Date(p[0], p[1] - 1, p[2], Math.floor(t / 60), t % 60).getTime();
            if (momento < minimo) continue;
            saida.push(String(Math.floor(t / 60)).padStart(2, '0') + ':' + String(t % 60).padStart(2, '0'));
        }
        return saida;
    }

    async function telaSacola() {
        estado.pagina = 'sacola';
        marcarNavegacao('');
        atualizarIndicadores();
        if (!sacola.itens.length) {
            raiz.innerHTML = cabecalho('Sacola', '#/') + '<div class="vazio">' + svg('sacola') +
                '<h2>Sua sacola está vazia</h2><p>Que tal uma marmita fit ou um bowl caprichado?</p><a class="botao" href="#/">Ver o cardápio</a></div>';
            return;
        }
        if (estado.conta && estado.enderecos === null) {
            try { estado.enderecos = (await api('/enderecos')).itens; } catch (e) { estado.enderecos = []; }
        }
        prepararFinalizar();
        desenharSacola();
        calcularDepois(0);
    }

    function prepararFinalizar() {
        const l = loja();
        const formas = pagamentosAceitos();
        if (!formas.some(function (f) { return f[0] === finalizar.pagamento; })) finalizar.pagamento = formas.length ? formas[0][0] : null;
        if (!l.aberta_agora) finalizar.quando = 'agendar';
        const atendidos = (estado.enderecos || []).filter(function (e) { return e.atendido; });
        if (estado.conta && !finalizar.novoEndereco && !atendidos.some(function (e) { return e.id === finalizar.endereco_id; })) {
            finalizar.endereco_id = atendidos.length ? atendidos[0].id : null;
            if (!atendidos.length) finalizar.novoEndereco = true;
        }
        if (finalizar.novoEndereco && !finalizar.endereco.bairro_id && preferencias.bairro_id) finalizar.endereco.bairro_id = preferencias.bairro_id;
        if (estado.conta && !finalizar.endereco.destinatario) finalizar.endereco.destinatario = estado.conta.nome;
    }

    function pagamentosAceitos() {
        const l = loja();
        const naEntrega = modoAtual() === 'retirada' ? 'na retirada' : 'na entrega';
        const lista = [];
        if (l.aceita_pix) lista.push(['pix', 'Pix', 'Pague agora pelo app (copia e cola)', 'pix']);
        if (l.aceita_pagamento_entrega) {
            lista.push(['cartao_entrega', 'Cartão ' + naEntrega, 'Débito ou crédito na maquininha', 'cartao']);
            lista.push(['dinheiro_entrega', 'Dinheiro ' + naEntrega, 'Avise se precisa de troco', 'dinheiro']);
            lista.push(['vr_entrega', 'Vale-refeição ' + naEntrega, 'VR / VA na maquininha', 'vale']);
        }
        return lista;
    }

    function cabecalho(titulo, voltar) {
        return '<div class="pagina-topo">' + (voltar ? '<a class="voltar" href="' + voltar + '" aria-label="Voltar">' + svg('voltar') + '</a>' : '') +
            '<h1>' + escapar(titulo) + '</h1></div>';
    }

    function desenharSacola() {
        const l = loja();
        const modo = modoAtual();
        const c = estado.conta;
        const itensHtml = sacola.itens.map(function (i, n) {
            const p = pratoPorId(i.prato_id);
            const ads = (i.adicionais || []).map(function (a) { const o = adicionalDoPrato(p, a.id); return o ? o.nome : ''; }).filter(Boolean);
            return '<div class="item-sacola">' + fotoHtml(p, '', '') +
                '<div><div class="item-nome">' + escapar(p.nome) + '</div>' +
                (ads.length ? '<div class="item-extra">' + escapar(ads.join(', ')) + '</div>' : '') +
                (i.observacao ? '<div class="item-extra">Obs.: ' + escapar(i.observacao) + '</div>' : '') +
                '<div class="item-linha"><span class="preco">' + moeda(precoItem(i) * i.quantidade) + '</span>' +
                    '<div style="display:flex;align-items:center;gap:8px">' +
                    '<div class="passo passo-pequeno" role="group" aria-label="Quantidade de ' + escapar(p.nome) + '">' +
                        '<button type="button" data-item-qtd="-1" data-item="' + n + '" aria-label="Diminuir"' + (i.quantidade <= 1 ? ' disabled' : '') + '>&minus;</button>' +
                        '<output>' + i.quantidade + '</output>' +
                        '<button type="button" data-item-qtd="1" data-item="' + n + '" aria-label="Aumentar">+</button></div>' +
                    '<button type="button" class="item-remover" data-remover="' + n + '">Remover</button></div></div></div></div>';
        }).join('');

        const opcoesModo = [];
        if (l.aceita_entrega) opcoesModo.push(['entrega', 'Entrega']);
        if (l.aceita_retirada) opcoesModo.push(['retirada', 'Retirada']);

        let entregaHtml = '';
        if (modo === 'entrega') {
            if (!c) {
                entregaHtml = '<div class="campo"><label for="bairroSacola">Bairro (para calcular a taxa)</label>' + selectBairros('bairroSacola', preferencias.bairro_id) + '</div>';
            } else {
                const lista = estado.enderecos || [];
                entregaHtml = '<div class="opcoes-lista" role="radiogroup" aria-label="Endereço de entrega">' +
                    lista.map(function (e) {
                        return '<label class="opcao-cartao' + (e.atendido ? '' : ' indisponivel') + '"><input type="radio" name="endereco" value="' + e.id + '"' +
                            (finalizar.endereco_id === e.id && !finalizar.novoEndereco ? ' checked' : '') + (e.atendido ? '' : ' disabled') + '>' + svg('endereco') +
                            '<span class="opcao-cartao-texto"><strong>' + escapar(e.apelido || (e.logradouro + ', ' + e.numero)) + '</strong>' +
                            '<span>' + escapar((e.apelido ? e.logradouro + ', ' + e.numero + ' · ' : '') + (e.complemento ? e.complemento + ' · ' : '') + e.bairro) +
                            (e.atendido ? ' · taxa ' + (e.taxa > 0 ? moeda(e.taxa) : 'grátis') : ' · ainda não entregamos neste bairro') + '</span></span></label>';
                    }).join('') +
                    '<label class="opcao-cartao"><input type="radio" name="endereco" value="novo"' + (finalizar.novoEndereco ? ' checked' : '') + '>' + svg('endereco') +
                        '<span class="opcao-cartao-texto"><strong>Novo endereço</strong><span>Ele fica guardado na sua conta</span></span></label></div>' +
                    (finalizar.novoEndereco ? formEnderecoHtml(finalizar.endereco, 'novo') : '');
            }
        } else {
            entregaHtml = '<p class="cartao-sub" style="margin-top:8px">' + svg('loja').replace('<svg', '<svg style="width:18px;height:18px;vertical-align:-4px;fill:none;stroke:var(--verde);stroke-width:2"') + ' ' +
                escapar(l.endereco_retirada || 'Retire no balcão da loja.') + '</p>' +
                (l.endereco_retirada ? '<a class="botao-texto" target="_blank" rel="noopener" href="https://www.google.com/maps/search/?api=1&query=' + encodeURIComponent(l.endereco_retirada) + '">Ver no mapa</a>' : '');
        }

        const dias = l.aceita_agendamento ? diasParaAgendar() : [];
        if (finalizar.quando === 'agendar' && dias.length && !dias.some(function (d) { return d.iso === finalizar.data; })) finalizar.data = dias[0].iso;
        const diaSel = dias.find(function (d) { return d.iso === finalizar.data; });
        if (diaSel && diaSel.horas.indexOf(finalizar.hora) === -1) finalizar.hora = diaSel.horas[0];
        const quandoHtml = '<div class="opcoes-lista" role="radiogroup" aria-label="Quando">' +
            '<label class="opcao-cartao' + (l.aberta_agora ? '' : ' indisponivel') + '"><input type="radio" name="quando" value="agora"' + (finalizar.quando === 'agora' ? ' checked' : '') + (l.aberta_agora ? '' : ' disabled') + '>' + svg('relogio') +
                '<span class="opcao-cartao-texto"><strong>O quanto antes</strong><span>' + (l.aberta_agora ? 'Cerca de ' + (l.tempo_preparo_min + (modo === 'entrega' ? 15 : 0)) + ' min' : escapar(l.texto)) + '</span></span></label>' +
            (l.aceita_agendamento ? '<label class="opcao-cartao"><input type="radio" name="quando" value="agendar"' + (finalizar.quando === 'agendar' ? ' checked' : '') + (dias.length ? '' : ' disabled') + '>' + svg('pedido') +
                '<span class="opcao-cartao-texto"><strong>Agendar</strong><span>' + (dias.length ? 'Escolha o dia e a hora' : 'Sem horários disponíveis') + '</span></span></label>' : '') +
            '</div>' +
            (finalizar.quando === 'agendar' && dias.length ? '<div class="grade-campos"><div class="campo"><label for="diaAgenda">Dia</label><select id="diaAgenda">' +
                dias.map(function (d) { return '<option value="' + d.iso + '"' + (d.iso === finalizar.data ? ' selected' : '') + '>' + escapar(d.rotulo) + '</option>'; }).join('') +
                '</select></div><div class="campo"><label for="horaAgenda">Hora</label><select id="horaAgenda">' +
                (diaSel ? diaSel.horas.map(function (h) { return '<option' + (h === finalizar.hora ? ' selected' : '') + '>' + h + '</option>'; }).join('') : '') +
                '</select></div></div>' : '') +
            (!l.aceita_pedidos ? '<p class="aviso-inline erro" style="margin-top:10px">A loja não está aceitando pedidos agora.</p>' : '');

        const pagamentos = pagamentosAceitos();
        const pagamentoHtml = '<div class="opcoes-lista" role="radiogroup" aria-label="Forma de pagamento">' + pagamentos.map(function (f) {
            return '<label class="opcao-cartao"><input type="radio" name="pagamento" value="' + f[0] + '"' + (finalizar.pagamento === f[0] ? ' checked' : '') + '>' + svg(f[3]) +
                '<span class="opcao-cartao-texto"><strong>' + escapar(f[1]) + '</strong><span>' + escapar(f[2]) + '</span></span></label>';
        }).join('') + '</div>' +
            (finalizar.pagamento === 'dinheiro_entrega' ? '<div class="campo"><label for="trocoPara">Troco para quanto?</label>' +
                '<input id="trocoPara" inputmode="decimal" placeholder="Ex.: 100,00 (deixe vazio se não precisa)" value="' + escapar(finalizar.troco) + '"></div>' : '') +
            (!pagamentos.length ? '<p class="aviso-inline erro">A loja não configurou formas de pagamento.</p>' : '');

        let descontosHtml = '';
        if (c) {
            descontosHtml = '<div class="cartao"><h2>Cupom e cashback</h2>' +
                (finalizar.cupom
                    ? '<div class="cupom-aplicado"><span>Cupom ' + escapar(finalizar.cupom) + ' aplicado</span><button type="button" class="botao-texto" id="tirarCupom">Remover</button></div>'
                    : '<div class="cupom-linha"><label class="sr-only" for="campoCupom">Código do cupom</label>' +
                      '<input id="campoCupom" placeholder="Código do cupom" autocomplete="off" maxlength="20">' +
                      '<button type="button" class="botao botao-claro" id="aplicarCupom">Aplicar</button></div>') +
                (finalizar.cupomErro ? '<p class="erro-campo" role="alert">' + escapar(finalizar.cupomErro) + '</p>' : '') +
                (c.cashback > 0 ? '<label class="check"><input type="checkbox" id="usarCashback"' + (finalizar.usar_cashback ? ' checked' : '') + '>' +
                    '<span>Usar meu cashback (saldo ' + moeda(c.cashback) + ')<br><small class="dica">Paga até metade do valor dos pratos.</small></span></label>' : '') +
                '</div>';
        }

        raiz.innerHTML = cabecalho('Sacola', '#/') +
            '<div class="layout-sacola"><div>' +
            '<div class="cartao"><h2>Seus itens <a class="botao-texto" href="#/">+ Adicionar mais</a></h2>' + itensHtml + '</div>' +
            (opcoesModo.length > 1 ? '<div class="cartao"><h2>Como você quer receber?</h2><div class="segmentado" role="group" aria-label="Entrega ou retirada" style="margin-top:8px">' +
                opcoesModo.map(function (o) { return '<button type="button" data-modo="' + o[0] + '" aria-pressed="' + (modo === o[0]) + '">' + o[1] + '</button>'; }).join('') +
                '</div>' + entregaHtml + '</div>'
              : '<div class="cartao"><h2>' + (modo === 'entrega' ? 'Entrega' : 'Retirada') + '</h2>' + entregaHtml + '</div>') +
            '<div class="cartao"><h2>Quando?</h2>' + quandoHtml + '</div>' +
            (c ? '<div class="cartao"><h2>Pagamento</h2>' + pagamentoHtml + '</div>' : '') +
            descontosHtml +
            (c ? '<div class="cartao"><div class="campo" style="margin-top:0"><label for="obsPedido">Observação para a loja</label>' +
                '<textarea id="obsPedido" maxlength="300" placeholder="Ex.: interfone não funciona, deixar na portaria">' + escapar(finalizar.observacoes) + '</textarea></div></div>' : '') +
            '</div><div class="coluna-resumo">' +
                '<div class="cartao" id="nutriPedido"></div>' +
                '<div class="cartao" id="resumoPedido"><p class="cartao-sub">Calculando...</p></div>' +
                '<div class="acao-fixa" id="acaoPedido"></div>' +
            '</div></div>';
        desenharNutricao(null);
        desenharAcao();
    }

    function selectBairros(id, valor) {
        return '<select id="' + id + '"><option value="">Escolha o bairro</option>' + (estado.vitrine.bairros || []).map(function (b) {
            return '<option value="' + b.id + '"' + (Number(valor) === b.id ? ' selected' : '') + '>' + escapar(b.nome) + ' · ' +
                (b.taxa > 0 ? moeda(b.taxa) : 'grátis') + '</option>';
        }).join('') + '</select>';
    }

    function formEnderecoHtml(e, prefixo) {
        const v = function (k) { return escapar(e[k] || ''); };
        return '<div class="grade-campos" data-form-endereco="' + prefixo + '">' +
            '<div class="campo largo"><label for="' + prefixo + '-destinatario">Quem recebe</label><input id="' + prefixo + '-destinatario" data-end="destinatario" maxlength="100" value="' + v('destinatario') + '" autocomplete="name"></div>' +
            '<div class="campo largo"><label for="' + prefixo + '-bairro">Bairro</label>' + selectBairros(prefixo + '-bairro', e.bairro_id).replace('<select ', '<select data-end="bairro_id" ') +
                '<small>Só aparecem os bairros onde entregamos.</small></div>' +
            '<div class="campo largo"><label for="' + prefixo + '-logradouro">Rua</label><input id="' + prefixo + '-logradouro" data-end="logradouro" maxlength="120" value="' + v('logradouro') + '" autocomplete="address-line1"></div>' +
            '<div class="campo"><label for="' + prefixo + '-numero">Número</label><input id="' + prefixo + '-numero" data-end="numero" maxlength="10" value="' + v('numero') + '" inputmode="numeric"></div>' +
            '<div class="campo"><label for="' + prefixo + '-cep">CEP (opcional)</label><input id="' + prefixo + '-cep" data-end="cep" maxlength="9" value="' + v('cep') + '" inputmode="numeric" autocomplete="postal-code"></div>' +
            '<div class="campo largo"><label for="' + prefixo + '-complemento">Complemento</label><input id="' + prefixo + '-complemento" data-end="complemento" maxlength="60" value="' + v('complemento') + '" placeholder="Apto, bloco, casa"></div>' +
            '<div class="campo largo"><label for="' + prefixo + '-referencia">Ponto de referência</label><input id="' + prefixo + '-referencia" data-end="referencia" maxlength="100" value="' + v('referencia') + '"></div>' +
            '<div class="campo largo"><label for="' + prefixo + '-apelido">Apelido (opcional)</label><input id="' + prefixo + '-apelido" data-end="apelido" maxlength="30" value="' + v('apelido') + '" placeholder="Casa, Trabalho"></div>' +
            '</div>';
    }

    function corpoDoCarrinho(paraGravar) {
        const modo = modoAtual();
        const corpo = {
            itens: sacola.itens.map(function (i) { return { prato_id: i.prato_id, quantidade: i.quantidade, adicionais: i.adicionais, observacao: i.observacao || null }; }),
            tipo_entrega: modo,
        };
        if (modo === 'entrega') {
            if (estado.conta && !finalizar.novoEndereco && finalizar.endereco_id) corpo.endereco_id = finalizar.endereco_id;
            else if (paraGravar && finalizar.novoEndereco) corpo.endereco = finalizar.endereco;
            else {
                const b = finalizar.novoEndereco ? finalizar.endereco.bairro_id : preferencias.bairro_id;
                if (b) corpo.bairro_id = Number(b);
            }
        }
        if (finalizar.cupom) corpo.cupom = finalizar.cupom;
        if (finalizar.usar_cashback) corpo.usar_cashback = 1;
        if (paraGravar) {
            corpo.pagamento = finalizar.pagamento;
            if (finalizar.pagamento === 'dinheiro_entrega' && finalizar.troco.trim()) corpo.troco_para = finalizar.troco.replace(/\./g, '').replace(',', '.');
            if (finalizar.quando === 'agendar' && finalizar.data && finalizar.hora) corpo.agendado_para = finalizar.data + ' ' + finalizar.hora;
            if (finalizar.observacoes.trim()) corpo.observacoes = finalizar.observacoes.trim();
        }
        return corpo;
    }

    function calcularDepois(espera) {
        clearTimeout(estado.calculo);
        estado.calculo = setTimeout(calcular, espera === undefined ? 350 : espera);
    }

    let tentandoCupom = null;
    async function calcular() {
        if (estado.pagina !== 'sacola' || !sacola.itens.length) return;
        if (!estado.conta) {
            const modo = modoAtual();
            const b = modo === 'entrega' ? bairroEscolhido() : null;
            const subtotal = totalSacola();
            const l = loja();
            const gratis = l.frete_gratis_acima > 0 && subtotal >= l.frete_gratis_acima;
            const taxa = b && !gratis ? b.taxa : 0;
            estado.ultimoCarrinho = { local: true, produtos: subtotal, taxa: taxa, desconto: 0, cashback: 0, total: subtotal + taxa,
                avisos: [], nutricao: { kcal: sacola.itens.reduce(function (s, i) { return s + kcalItem(i) * i.quantidade; }, 0), proteinas: null },
                semBairro: modo === 'entrega' && !b, frete_gratis: gratis, pedido_minimo: l.pedido_minimo };
            desenharResumo(null);
            return;
        }
        const pedido = corpoDoCarrinho(false);
        try {
            const r = await api('/carrinho', 'POST', pedido);
            if (estado.pagina !== 'sacola') return;
            if (tentandoCupom) { finalizar.cupomErro = ''; avisar('Cupom ' + tentandoCupom + ' aplicado!'); tentandoCupom = null; desenharSacola(); }
            estado.ultimoCarrinho = r.carrinho;
            desenharResumo(null);
        } catch (erro) {
            if (estado.pagina !== 'sacola') return;
            if (tentandoCupom) {
                finalizar.cupom = null;
                finalizar.cupomErro = erro.message;
                tentandoCupom = null;
                desenharSacola();
                calcularDepois(0);
                return;
            }
            if (erro.status === 401) { estado.conta = null; atualizarConta(); desenharSacola(); calcularDepois(0); return; }
            estado.ultimoCarrinho = null;
            desenharResumo(erro.message);
        }
    }

    function desenharNutricao(c) {
        const caixa = document.getElementById('nutriPedido');
        if (!caixa) return;
        const kcal = c && c.nutricao ? c.nutricao.kcal : sacola.itens.reduce(function (s, i) { return s + kcalItem(i) * i.quantidade; }, 0);
        const prot = c && c.nutricao && c.nutricao.proteinas !== null ? c.nutricao.proteinas : null;
        if (!kcal) { caixa.hidden = true; return; }
        caixa.hidden = false;
        const meta = estado.conta && estado.conta.meta_kcal;
        const pct = meta ? Math.round(kcal / meta * 100) : 0;
        caixa.innerHTML = '<div class="nutri-pedido">' + svg('alvo') + '<div><strong>Seu pedido: ' + numero(kcal) + ' kcal' +
            (prot !== null ? ' · ' + numero(prot, 1) + ' g de proteína' : '') + '</strong>' +
            (meta ? '<p class="cartao-sub">' + pct + '% da sua meta de ' + numero(meta) + ' kcal por dia</p>'
                  : '<p class="cartao-sub">' + (estado.conta ? '<a href="#/perfil/dados">Defina sua meta de calorias</a> para acompanhar aqui.' : 'Entre para comparar com a sua meta diária.') + '</p>') +
            '</div></div>' +
            (meta ? '<div class="barra-meta' + (pct > 100 ? ' passou' : '') + '" role="img" aria-label="' + pct + '% da meta"><span style="width:' + Math.min(100, pct) + '%"></span></div>' : '');
    }

    function desenharResumo(erro) {
        const caixa = document.getElementById('resumoPedido');
        if (!caixa) return;
        const c = estado.ultimoCarrinho;
        desenharNutricao(c);
        if (erro || !c) {
            caixa.innerHTML = '<h2>Resumo</h2><p class="aviso-inline erro" role="alert">' + escapar(erro || 'Não foi possível calcular agora.') + '</p>';
            desenharAcao();
            return;
        }
        const modo = modoAtual();
        const linhas = ['<div class="resumo-linha"><span>Subtotal</span><span>' + moeda(c.produtos) + '</span></div>'];
        if (modo === 'entrega') {
            linhas.push('<div class="resumo-linha"><span>Taxa de entrega' + (c.bairro ? ' (' + escapar(c.bairro) + ')' : '') + '</span><span>' +
                (c.semBairro ? 'escolha o bairro' : (c.taxa > 0 ? moeda(c.taxa) : 'Grátis')) + '</span></div>');
        }
        if (c.desconto > 0) linhas.push('<div class="resumo-linha desconto"><span>Cupom ' + escapar(c.cupom ? c.cupom.codigo : '') + '</span><span>- ' + moeda(c.desconto) + '</span></div>');
        if (c.cashback > 0) linhas.push('<div class="resumo-linha desconto"><span>Cashback</span><span>- ' + moeda(c.cashback) + '</span></div>');
        const avisos = (c.avisos || []).slice();
        if (c.pedido_minimo > 0 && c.produtos < c.pedido_minimo) avisos.push('O pedido mínimo é de ' + moeda(c.pedido_minimo) + ' em pratos.');
        caixa.innerHTML = '<h2>Resumo</h2>' + linhas.join('') +
            '<div class="resumo-total"><span>Total</span><span>' + moeda(c.total) + '</span></div>' +
            (avisos.length ? '<div class="avisos-carrinho">' + avisos.map(function (a) { return '<p class="aviso-inline">' + escapar(a) + '</p>'; }).join('') + '</div>' : '') +
            (c.cashback_previsto > 0 ? '<p class="cashback-previsto">' + svg('moeda') + 'Você ganha ' + moeda(c.cashback_previsto) + ' de cashback quando o pedido for entregue.</p>' : '') +
            (c.local ? '<p class="cartao-sub" style="margin-top:10px">Entre na sua conta para usar cupom, cashback e finalizar.</p>' : '');
        desenharAcao();
    }

    function desenharAcao() {
        const caixa = document.getElementById('acaoPedido');
        if (!caixa) return;
        const c = estado.ultimoCarrinho;
        if (!estado.conta) {
            caixa.innerHTML = '<a class="botao" href="#/entrar" data-voltar="#/sacola"><span>Entrar para finalizar</span><span class="numero">' +
                moeda(c ? c.total : totalSacola()) + '</span></a>' +
                '<p class="troca-modo" style="margin-top:8px">Novo por aqui? <a href="#/criar-conta" data-voltar="#/sacola">Criar conta</a></p>';
            return;
        }
        const l = loja();
        const bloqueio = !c ? 'Confira a sacola' : !l.aceita_pedidos ? 'Loja fechada agora' :
            (c.pedido_minimo > 0 && c.produtos < c.pedido_minimo) ? 'Pedido mínimo ' + moeda(c.pedido_minimo) : null;
        caixa.innerHTML = '<button type="button" class="botao" id="fazerPedido"' + (bloqueio ? ' disabled' : '') + '><span>' +
            escapar(bloqueio || 'Fazer pedido') + '</span><span class="numero">' + (c ? moeda(c.total) : '') + '</span></button>';
    }

    function conferirAntesDePedir() {
        const modo = modoAtual();
        if (modo === 'entrega') {
            if (finalizar.novoEndereco) {
                const e = finalizar.endereco;
                if (!e.destinatario || !e.logradouro || !e.numero || !e.bairro_id) return 'Preencha o endereço: quem recebe, bairro, rua e número.';
            } else if (!finalizar.endereco_id) {
                return 'Escolha o endereço de entrega.';
            }
        }
        if (!finalizar.pagamento) return 'Escolha a forma de pagamento.';
        if (finalizar.quando === 'agendar' && (!finalizar.data || !finalizar.hora)) return 'Escolha o dia e a hora do agendamento.';
        if (finalizar.quando === 'agora' && !loja().aberta_agora) return 'A loja está fechada agora: agende o pedido.';
        return null;
    }

    async function fazerPedido(botao) {
        const problema = conferirAntesDePedir();
        if (problema) { avisar(problema, 'erro'); return; }
        await travado(botao, async function () {
            const r = await api('/encomendas', 'POST', corpoDoCarrinho(true));
            sacola.itens = [];
            gravarSacola();
            finalizar.cupom = null;
            finalizar.usar_cashback = false;
            finalizar.observacoes = '';
            estado.enderecos = null;
            estado.ultimoCarrinho = null;
            avisar(r.mensagem || 'Pedido feito!');
            location.hash = '#/pedido/' + r.id;
        }, 'Enviando o pedido...');
    }

    // ------------------------------------------------------------------
    // Conta: entrar, criar, perfil
    // ------------------------------------------------------------------
    function telaEntrar() {
        estado.pagina = 'entrar';
        marcarNavegacao('perfil');
        atualizarIndicadores();
        raiz.innerHTML = '<div class="formulario-conta">' + cabecalho('Entrar', '#/') +
            '<p class="cartao-sub">Entre para acompanhar pedidos, guardar endereços e ganhar cashback.</p>' +
            '<form id="formEntrar" class="cartao" novalidate>' +
                '<div class="campo" style="margin-top:0"><label for="entrarEmail">E-mail</label><input type="email" id="entrarEmail" autocomplete="email" required></div>' +
                '<div class="campo"><label for="entrarSenha">Senha</label><input type="password" id="entrarSenha" autocomplete="current-password" required></div>' +
                '<p class="erro-campo" id="erroEntrar" role="alert" hidden></p>' +
                '<button type="submit" class="botao botao-largo">Entrar</button>' +
                '<p class="troca-modo"><a href="#/esqueci">Esqueci a senha</a></p>' +
            '</form>' +
            '<p class="troca-modo">Ainda não tem conta? <a href="#/criar-conta">Criar conta grátis</a></p></div>';
        document.getElementById('formEntrar').addEventListener('submit', function (e) {
            e.preventDefault();
            const botao = this.querySelector('button[type=submit]');
            const erro = document.getElementById('erroEntrar');
            travado(botao, async function () {
                erro.hidden = true;
                try {
                    const r = await api('/entrar', 'POST', { email: document.getElementById('entrarEmail').value.trim(), senha: document.getElementById('entrarSenha').value });
                    entrou(r.conta, 'Bem-vindo(a) de volta, ' + primeiroNome(r.conta.nome) + '!');
                } catch (er) {
                    erro.textContent = er.message;
                    erro.hidden = false;
                }
            }, 'Entrando...');
        });
        document.getElementById('entrarEmail').focus();
    }

    function entrou(conta, mensagem) {
        estado.conta = conta;
        estado.enderecos = null;
        atualizarConta();
        avisar(mensagem);
        location.hash = tirarVoltar() || '#/';
    }

    function objetivosHtml(valor) {
        return '<div class="objetivos" role="radiogroup" aria-label="Seu objetivo">' + (estado.vitrine.dominios.objetivos || []).map(function (o) {
            return '<label><input type="radio" name="objetivo" value="' + escapar(o.valor) + '"' + (valor === o.valor ? ' checked' : '') + '><span>' + escapar(o.rotulo) + '</span></label>';
        }).join('') + '</div>';
    }
    const DICA_META = {
        emagrecer: 'Uma referência comum para emagrecer fica entre 1.400 e 1.900 kcal por dia.',
        ganhar_massa: 'Para ganhar massa, muita gente fica entre 2.400 e 3.200 kcal por dia.',
        manter: 'Para manter o peso, a média de um adulto fica entre 1.800 e 2.500 kcal.',
        saude: 'Sem meta? Tudo bem: deixe em branco e acompanhe só o que pedir.',
    };

    function telaCriarConta() {
        estado.pagina = 'criar-conta';
        marcarNavegacao('perfil');
        atualizarIndicadores();
        raiz.innerHTML = '<div class="formulario-conta">' + cabecalho('Criar conta', '#/entrar') +
            '<p class="cartao-sub">Rapidinho: com a conta você acompanha o pedido e ganha cashback.</p>' +
            '<form id="formConta" class="cartao" novalidate>' +
                '<div class="campo" style="margin-top:0"><label for="contaNome">Nome</label><input id="contaNome" autocomplete="name" maxlength="100" required></div>' +
                '<div class="campo"><label for="contaEmail">E-mail</label><input type="email" id="contaEmail" autocomplete="email" maxlength="120" required></div>' +
                '<div class="campo"><label for="contaTelefone">Celular com DDD</label><input type="tel" id="contaTelefone" autocomplete="tel" inputmode="tel" placeholder="(48) 99999-0000" required></div>' +
                '<div class="campo"><label for="contaSenha">Senha</label><input type="password" id="contaSenha" autocomplete="new-password" required>' +
                    '<small>Pelo menos 8 caracteres, com letras e números.</small></div>' +
                '<div class="campo"><span class="rotulo">Seu objetivo (opcional)</span>' + objetivosHtml(null) + '</div>' +
                '<div class="campo"><label for="contaMeta">Meta de calorias por dia (opcional)</label><input id="contaMeta" type="number" inputmode="numeric" min="800" max="6000" step="50" placeholder="Ex.: 1800">' +
                    '<small id="dicaMeta">Usamos para mostrar quanto do seu dia cada pedido representa.</small></div>' +
                '<label class="check"><input type="checkbox" id="contaNovidades"><span>Quero receber novidades e cupons</span></label>' +
                '<p class="erro-campo" id="erroConta" role="alert" hidden></p>' +
                '<button type="submit" class="botao botao-largo">Criar minha conta</button>' +
            '</form>' +
            '<p class="troca-modo">Já tem conta? <a href="#/entrar">Entrar</a></p></div>';
        const form = document.getElementById('formConta');
        form.addEventListener('change', function (e) {
            if (e.target.name === 'objetivo') document.getElementById('dicaMeta').textContent = DICA_META[e.target.value] || '';
        });
        form.addEventListener('submit', function (e) {
            e.preventDefault();
            const botao = form.querySelector('button[type=submit]');
            const erro = document.getElementById('erroConta');
            const objetivo = form.querySelector('input[name=objetivo]:checked');
            travado(botao, async function () {
                erro.hidden = true;
                try {
                    const r = await api('/conta', 'POST', {
                        nome: document.getElementById('contaNome').value.trim(), email: document.getElementById('contaEmail').value.trim(),
                        telefone: document.getElementById('contaTelefone').value.trim(), senha: document.getElementById('contaSenha').value,
                        objetivo: objetivo ? objetivo.value : null, meta_kcal: document.getElementById('contaMeta').value || null,
                        aceita_novidades: document.getElementById('contaNovidades').checked ? 1 : 0,
                    });
                    entrou(r.conta, r.mensagem || 'Conta criada!');
                } catch (er) {
                    erro.textContent = er.message;
                    erro.hidden = false;
                }
            }, 'Criando...');
        });
        document.getElementById('contaNome').focus();
    }

    function telaEsqueci() {
        estado.pagina = 'esqueci';
        atualizarIndicadores();
        const l = loja();
        const whats = linkWhats(l.whatsapp, 'Olá! Esqueci a senha da minha conta no app da ' + l.nome + '.');
        raiz.innerHTML = '<div class="formulario-conta">' + cabecalho('Esqueci a senha', '#/entrar') +
            '<div class="cartao"><p>Por segurança, a troca de senha é feita com a loja. Mande uma mensagem com o e-mail da sua conta e a gente resolve rapidinho.</p>' +
            (whats ? '<a class="botao botao-largo" style="margin-top:16px" target="_blank" rel="noopener" href="' + whats + '">' + svg('whatsapp').replace('<svg', '<svg style="width:20px;height:20px;fill:none;stroke:#fff;stroke-width:2"') + 'Falar no WhatsApp</a>' : '') +
            '</div></div>';
    }

    function exigirConta(destino) {
        if (estado.conta) return true;
        guardarVoltar(destino);
        raiz.innerHTML = '<div class="vazio">' + svg('usuario') + '<h2>Entre na sua conta</h2>' +
            '<p>Para ver seus pedidos, endereços e cashback.</p>' +
            '<a class="botao botao-largo" href="#/entrar">Entrar</a>' +
            '<p class="troca-modo">Novo por aqui? <a href="#/criar-conta">Criar conta</a></p></div>';
        return false;
    }

    async function telaPerfil(sub) {
        estado.pagina = 'perfil';
        marcarNavegacao('perfil');
        atualizarIndicadores();
        if (!exigirConta('#/perfil' + (sub ? '/' + sub : ''))) return;
        if (sub === 'dados') return telaDados();
        if (sub === 'enderecos') return telaEnderecos();
        if (sub === 'favoritos') return telaFavoritos();
        if (sub === 'cashback') return telaCashback();
        const c = estado.conta;
        const l = loja();
        const whats = linkWhats(l.whatsapp, 'Olá! Sou ' + c.nome + ', cliente do app.');
        const item = function (href, icone, texto, extra, atributos) {
            return '<a href="' + href + '"' + (atributos || '') + '>' + svg(icone) + '<span>' + texto + '</span>' + (extra ? '<small>' + extra + '</small>' : '') + svg('seta') + '</a>';
        };
        raiz.innerHTML =
            '<div class="perfil-cabeca"><div class="avatar" aria-hidden="true">' + escapar(primeiroNome(c.nome).charAt(0).toUpperCase()) + '</div>' +
                '<div><h1>Olá, ' + escapar(primeiroNome(c.nome)) + '</h1><p>' + escapar(c.email) + '</p></div></div>' +
            '<a class="cartao-cashback" href="#/perfil/cashback"><div><small>Seu cashback</small><strong>' + moeda(c.cashback) + '</strong></div>' +
                (l.cashback_percentual > 0 ? '<span class="pilula">' + l.cashback_percentual + '% em cada pedido</span>' : '') + '</a>' +
            '<div class="cartao"><div class="meta-resumo"><div><div class="cartao-titulo">Minha meta</div><p class="cartao-sub">' +
                (c.objetivo ? escapar(rotuloDominio('objetivos', c.objetivo)) : 'Sem objetivo definido') +
                (c.meta_kcal ? ' · ' + numero(c.meta_kcal) + ' kcal por dia' : '') + '</p></div>' +
                '<a class="botao botao-claro botao-pequeno" href="#/perfil/dados">Editar</a></div></div>' +
            '<nav class="menu-conta" aria-label="Minha conta">' +
                item('#/pedidos', 'pedido', 'Meus pedidos', c.pedidos ? String(c.pedidos) : '') +
                item('#/perfil/favoritos', 'coracao', 'Favoritos', c.favoritos.length ? String(c.favoritos.length) : '') +
                item('#/perfil/enderecos', 'endereco', 'Endereços') +
                item('#/perfil/cashback', 'moeda', 'Cashback', moeda(c.cashback)) +
                item('#/perfil/dados', 'usuario', 'Dados pessoais e meta') +
                (whats ? item(whats, 'whatsapp', 'Falar com a loja', '', ' target="_blank" rel="noopener"') : '') +
                '<button type="button" class="sair" id="botaoSair">' + svg('sair') + '<span>Sair</span></button>' +
            '</nav>';
        document.getElementById('botaoSair').addEventListener('click', async function () {
            try { await api('/sair', 'POST', {}); } catch (e) { /* sai mesmo assim */ }
            estado.conta = null;
            estado.enderecos = null;
            atualizarConta();
            avisar('Você saiu da conta.');
            location.hash = '#/';
        });
    }

    function telaDados() {
        const c = estado.conta;
        raiz.innerHTML = '<div class="formulario-conta">' + cabecalho('Dados e meta', '#/perfil') +
            '<form id="formDados" class="cartao" novalidate>' +
                '<div class="campo" style="margin-top:0"><label for="dadosNome">Nome</label><input id="dadosNome" maxlength="100" value="' + escapar(c.nome) + '" autocomplete="name"></div>' +
                '<div class="campo"><label for="dadosTelefone">Celular com DDD</label><input id="dadosTelefone" type="tel" value="' + escapar(telefoneBr(c.telefone)) + '" autocomplete="tel"></div>' +
                '<div class="campo"><label>E-mail</label><input value="' + escapar(c.email) + '" disabled></div>' +
                '<div class="campo"><span class="rotulo">Objetivo</span>' + objetivosHtml(c.objetivo) + '</div>' +
                '<div class="campo"><label for="dadosMeta">Meta de calorias por dia</label><input id="dadosMeta" type="number" inputmode="numeric" min="800" max="6000" step="50" value="' + (c.meta_kcal || '') + '" placeholder="Ex.: 1800">' +
                    '<small id="dicaMeta">' + escapar(DICA_META[c.objetivo] || 'Deixe vazio se não quiser acompanhar.') + '</small></div>' +
                '<div class="campo"><label for="dadosRestricoes">Restrições alimentares</label><input id="dadosRestricoes" maxlength="200" value="' + escapar(c.restricoes || '') + '" placeholder="Ex.: sem lactose, alergia a amendoim"></div>' +
                '<label class="check"><input type="checkbox" id="dadosNovidades"' + (c.aceita_novidades ? ' checked' : '') + '><span>Quero receber novidades e cupons</span></label>' +
                '<p class="erro-campo" id="erroDados" role="alert" hidden></p>' +
                '<button type="submit" class="botao botao-largo">Salvar</button>' +
            '</form></div>';
        const form = document.getElementById('formDados');
        form.addEventListener('change', function (e) {
            if (e.target.name === 'objetivo') document.getElementById('dicaMeta').textContent = DICA_META[e.target.value] || '';
        });
        form.addEventListener('submit', function (e) {
            e.preventDefault();
            const objetivo = form.querySelector('input[name=objetivo]:checked');
            const erro = document.getElementById('erroDados');
            travado(form.querySelector('button[type=submit]'), async function () {
                erro.hidden = true;
                try {
                    const r = await api('/conta', 'PUT', {
                        nome: document.getElementById('dadosNome').value.trim(), telefone: document.getElementById('dadosTelefone').value.trim(),
                        objetivo: objetivo ? objetivo.value : null, meta_kcal: document.getElementById('dadosMeta').value || null,
                        restricoes: document.getElementById('dadosRestricoes').value.trim() || null,
                        aceita_novidades: document.getElementById('dadosNovidades').checked ? 1 : 0,
                    });
                    estado.conta = r.conta;
                    atualizarConta();
                    avisar(r.mensagem || 'Perfil atualizado.');
                    location.hash = '#/perfil';
                } catch (er) {
                    erro.textContent = er.message;
                    erro.hidden = false;
                }
            }, 'Salvando...');
        });
    }

    async function telaEnderecos() {
        raiz.innerHTML = cabecalho('Endereços', '#/perfil') + '<p class="carregando">Carregando...</p>';
        try { estado.enderecos = (await api('/enderecos')).itens; } catch (e) { avisar(e.message, 'erro'); estado.enderecos = []; }
        const novo = {};
        function desenhar() {
            raiz.innerHTML = cabecalho('Endereços', '#/perfil') +
                '<div class="cartao">' + (estado.enderecos.length ? estado.enderecos.map(function (e) {
                    return '<div class="endereco-item"><div><strong>' + escapar(e.apelido || e.logradouro + ', ' + e.numero) + '</strong>' +
                        '<small>' + escapar((e.apelido ? e.logradouro + ', ' + e.numero + ' · ' : '') + (e.complemento ? e.complemento + ' · ' : '') + e.bairro + ' · ' + e.cidade) + '</small>' +
                        (e.atendido ? '' : '<small style="color:var(--erro)">Ainda não entregamos neste bairro</small>') + '</div>' +
                        '<button type="button" class="botao-texto" data-apagar-endereco="' + e.id + '" style="color:var(--erro)">Apagar</button></div>';
                }).join('') : '<p class="cartao-sub">Nenhum endereço guardado ainda.</p>') + '</div>' +
                '<form class="cartao" id="formEndereco" novalidate><h2>Novo endereço</h2>' + formEnderecoHtml(novo, 'end') +
                '<button type="submit" class="botao botao-largo" style="margin-top:16px">Guardar endereço</button></form>';
            document.getElementById('formEndereco').addEventListener('input', function (e) {
                if (e.target.dataset.end) novo[e.target.dataset.end] = e.target.value;
            });
            document.getElementById('formEndereco').addEventListener('change', function (e) {
                if (e.target.dataset.end) novo[e.target.dataset.end] = e.target.value;
            });
            document.getElementById('formEndereco').addEventListener('submit', function (e) {
                e.preventDefault();
                travado(this.querySelector('button[type=submit]'), async function () {
                    await api('/enderecos', 'POST', novo);
                    avisar('Endereço guardado.');
                    Object.keys(novo).forEach(function (k) { delete novo[k]; });
                    estado.enderecos = (await api('/enderecos')).itens;
                    desenhar();
                }, 'Guardando...');
            });
        }
        estado.redesenharEnderecos = desenhar;
        desenhar();
    }

    function telaFavoritos() {
        const favs = estado.conta.favoritos.map(pratoPorId).filter(Boolean);
        raiz.innerHTML = cabecalho('Favoritos', '#/perfil') +
            (favs.length ? '<div class="lista-pratos" style="margin-top:12px">' + favs.map(cartaoPrato).join('') + '</div>'
                : '<div class="vazio">' + svg('coracao') + '<h2>Nenhum favorito ainda</h2><p>Toque no coração de um prato para guardar aqui.</p><a class="botao" href="#/">Ver o cardápio</a></div>');
    }

    async function telaCashback() {
        raiz.innerHTML = cabecalho('Cashback', '#/perfil') + '<p class="carregando">Carregando...</p>';
        let r;
        try { r = await api('/cashback'); } catch (e) { avisar(e.message, 'erro'); return; }
        const l = loja();
        raiz.innerHTML = cabecalho('Cashback', '#/perfil') +
            '<div class="cartao-cashback" style="margin-top:8px"><div><small>Saldo disponível</small><strong>' + moeda(r.saldo) + '</strong></div></div>' +
            '<div class="cartao"><h2>Como funciona</h2><p class="cartao-sub">' + (l.cashback_percentual > 0
                ? 'A cada pedido entregue, ' + l.cashback_percentual + '% do valor dos pratos volta para você. Use no próximo pedido, na sacola (paga até metade dos pratos).'
                : 'O programa de cashback está pausado no momento. Seu saldo continua valendo.') + '</p></div>' +
            '<div class="cartao"><h2>Extrato</h2>' + (r.extrato.length ? r.extrato.map(function (x) {
                const mais = x.tipo !== 'uso';
                return '<div class="extrato-linha"><div>' + escapar(x.descricao || x.rotulo) + '<small>' + escapar(dataHoraCurta(x.criado_em)) + ' · ' + escapar(x.rotulo) + '</small></div>' +
                    '<span class="' + (mais ? 'mais' : 'menos') + '">' + (mais ? '+ ' : '- ') + moeda(x.valor) + '</span></div>';
            }).join('') : '<p class="cartao-sub">Nenhum movimento ainda.</p>') + '</div>';
    }

    // ------------------------------------------------------------------
    // Pedidos
    // ------------------------------------------------------------------
    async function telaPedidos() {
        estado.pagina = 'pedidos';
        marcarNavegacao('pedidos');
        atualizarIndicadores();
        if (!exigirConta('#/pedidos')) return;
        raiz.innerHTML = cabecalho('Meus pedidos') + '<p class="carregando">Carregando...</p>';
        let lista;
        try { lista = (await api('/encomendas')).itens; } catch (e) { avisar(e.message, 'erro'); return; }
        if (estado.pagina !== 'pedidos') return;
        if (!lista.length) {
            raiz.innerHTML = cabecalho('Meus pedidos') + '<div class="vazio">' + svg('pedido') + '<h2>Nenhum pedido ainda</h2>' +
                '<p>Seu primeiro pedido saudável está a poucos toques.</p><a class="botao" href="#/">Ver o cardápio</a></div>';
            return;
        }
        const abertos = lista.filter(function (e) { return TERMINADOS.indexOf(e.status) === -1; });
        const outros = lista.filter(function (e) { return TERMINADOS.indexOf(e.status) !== -1; });
        const cartao = function (e) {
            return '<article class="cartao-pedido">' + fotoHtml(e.foto, '', '') +
                '<div><div class="pedido-topo"><span class="pedido-numero">Pedido ' + escapar(e.numero) + '</span>' +
                    '<span class="status-pedido st-' + escapar(e.status) + '">' + escapar(rotuloStatus(e)) + '</span></div>' +
                '<p class="pedido-itens">' + escapar(e.itens_texto) + '</p>' +
                '<p class="pedido-meta">' + escapar(dataHoraCurta(e.criado_em)) + ' · ' + moeda(e.valor_total) + ' · ' +
                    (e.tipo_entrega === 'retirada' ? 'Retirada' : 'Entrega') + '</p>' +
                '<div class="pedido-acoes">' +
                    (TERMINADOS.indexOf(e.status) === -1 ? '<a class="botao botao-pequeno" href="#/pedido/' + e.id + '">Acompanhar</a>'
                        : '<a class="botao botao-contorno botao-pequeno" href="#/pedido/' + e.id + '">Detalhes</a>') +
                    (TERMINADOS.indexOf(e.status) !== -1 ? '<button type="button" class="botao botao-claro botao-pequeno" data-repetir="' + e.id + '">Pedir de novo</button>' : '') +
                    (e.status === 'entregue' && !e.avaliacao_nota ? '<a class="botao-texto" href="#/pedido/' + e.id + '#avaliar">Avaliar</a>' : '') +
                '</div></div></article>';
        };
        raiz.innerHTML = cabecalho('Meus pedidos') +
            (abertos.length ? '<h2 class="secao-titulo" style="font-size:16px">Em andamento</h2><div class="lista-pedidos">' + abertos.map(cartao).join('') + '</div>' : '') +
            (outros.length ? '<h2 class="secao-titulo" style="font-size:16px">Anteriores</h2><div class="lista-pedidos">' + outros.map(cartao).join('') + '</div>' : '');
    }

    function rotuloStatus(e) {
        if (e.status === 'pronto') return e.tipo_entrega === 'retirada' ? 'Pronto para retirar' : 'Pronto, saindo já';
        if (e.status === 'confirmado') return 'Confirmado';
        return e.status_rotulo || rotuloDominio('status_encomenda', e.status);
    }

    async function repetirPedido(id, botao) {
        await travado(botao, async function () {
            const e = (await api('/encomendas/' + id)).encomenda;
            let fora = 0;
            let colocados = 0;
            e.itens.forEach(function (i) {
                const p = pratoPorId(i.prato_id);
                if (!p || p.disponivel === 0) { fora++; return; }
                const ads = (i.adicionais || []).filter(function (a) { return a.id && adicionalDoPrato(p, a.id); })
                    .map(function (a) { return { id: a.id, quantidade: a.quantidade }; });
                if (ads.length !== (i.adicionais || []).length) fora++;
                const obrigatorioFaltando = (p.grupos || []).some(function (g) {
                    return ads.filter(function (a) { return g.opcoes.some(function (o) { return o.id === a.id; }); }).length < g.minimo;
                });
                if (obrigatorioFaltando) return;
                adicionarNaSacola({ prato_id: p.id, quantidade: p.disponivel === null ? i.quantidade : Math.min(i.quantidade, p.disponivel),
                                    adicionais: ads, observacao: i.observacao || '' });
                colocados++;
            });
            if (!colocados) { avisar('Os pratos deste pedido não estão disponíveis agora.', 'erro'); return; }
            avisar(fora ? 'Sacola montada. Algum item mudou ou saiu do cardápio: confira antes de pedir.' : 'Sacola montada com o mesmo pedido!', fora ? 'erro' : undefined);
            location.hash = '#/sacola';
        }, 'Montando...');
    }

    async function telaPedido(id) {
        estado.pagina = 'pedido';
        marcarNavegacao('pedidos');
        atualizarIndicadores();
        if (!exigirConta('#/pedido/' + id)) return;
        if (!raiz.querySelector('[data-pedido="' + id + '"]')) raiz.innerHTML = cabecalho('Pedido', '#/pedidos') + '<p class="carregando">Carregando...</p>';
        let e;
        try {
            e = (await api('/encomendas/' + id)).encomenda;
        } catch (erro) {
            if (estado.pagina === 'pedido') raiz.innerHTML = cabecalho('Pedido', '#/pedidos') + '<div class="vazio"><h2>Não encontramos este pedido</h2><p>' + escapar(erro.message) + '</p><a class="botao" href="#/pedidos">Meus pedidos</a></div>';
            return;
        }
        if (estado.pagina !== 'pedido' || location.hash.indexOf('#/pedido/' + id) !== 0) return;
        const rolagem = window.scrollY;
        const jaDesenhado = !!raiz.querySelector('[data-pedido="' + id + '"]');
        const comentario = document.getElementById('comentarioAvaliacao');
        if (comentario && comentario.value) return;   // a pessoa esta escrevendo a avaliacao: nao redesenha por cima
        desenharPedido(e);
        if (jaDesenhado) window.scrollTo(0, rolagem);
        if (location.hash.indexOf('#avaliar') !== -1) {
            const av = document.getElementById('blocoAvaliar');
            if (av) av.scrollIntoView({ block: 'center' });
        }
        clearTimeout(estado.relogio);
        if (TERMINADOS.indexOf(e.status) === -1) {
            estado.relogio = setTimeout(function () { if (estado.pagina === 'pedido') telaPedido(id); }, 20000);
        }
    }

    function titulosDoPedido(e) {
        const retirada = e.tipo_entrega === 'retirada';
        switch (e.status) {
            case 'aguardando_pagamento': return ['Aguardando o Pix', 'Pague o Pix para a cozinha começar o seu pedido.'];
            case 'aguardando_aceite': return ['Pedido enviado', 'A loja já vai confirmar o seu pedido.'];
            case 'confirmado': return ['Pedido confirmado', 'A cozinha já recebeu o seu pedido.'];
            case 'em_preparo': return ['Em preparo', 'Estamos preparando tudo com carinho.'];
            case 'pronto': return retirada ? ['Pronto para retirar', 'Pode vir buscar no balcão.'] : ['Pronto', 'Embalado e esperando o entregador.'];
            case 'saiu_entrega': return ['Saiu para entrega', 'Fique de olho no telefone!'];
            case 'entregue': return [retirada ? 'Retirado' : 'Entregue', 'Bom apetite!'];
            default: return ['Pedido cancelado', e.motivo_cancelamento || ''];
        }
    }

    function desenharPedido(e) {
        const l = loja();
        const [titulo, sub] = titulosDoPedido(e);
        const retirada = e.tipo_entrega === 'retirada';
        const previsao = e.agendado_para ? 'Agendado para ' + quandoTexto(e.agendado_para) : (e.previsao && TERMINADOS.indexOf(e.status) === -1 ? 'Previsão: ' + quandoTexto(e.previsao) : '');
        const rotuloEtapa = { confirmado: 'Pedido confirmado', em_preparo: 'Em preparo', pronto: retirada ? 'Pronto para retirar' : 'Pronto', saiu_entrega: 'Saiu para entrega', entregue: retirada ? 'Retirado' : 'Entregue' };
        const eventoDe = {};
        (e.eventos || []).slice().reverse().forEach(function (ev) { if (!eventoDe[ev.status]) eventoDe[ev.status] = ev; });
        const recebido = (e.eventos || []).slice().reverse()[0];
        const etapas = '<ol class="etapas">' +
            '<li class="etapa feito"><span class="etapa-ponto">' + svg('check') + '</span><div><div class="etapa-nome">Pedido recebido</div>' +
                '<div class="etapa-obs">' + escapar(e.pagamento_rotulo) + '</div></div><span class="etapa-hora">' + escapar(recebido ? recebido.momento.substring(11, 16) : '') + '</span></li>' +
            (e.trilha || []).map(function (t) {
                const ev = eventoDe[t.status];
                return '<li class="etapa' + (t.feito ? ' feito' : '') + (t.atual ? ' atual' : '') + '"' + (t.atual ? ' aria-current="step"' : '') + '>' +
                    '<span class="etapa-ponto">' + (t.feito ? svg('check') : '') + '</span><div><div class="etapa-nome">' + escapar(rotuloEtapa[t.status] || t.rotulo) + '</div>' +
                    (ev && ev.observacao && t.feito ? '<div class="etapa-obs">' + escapar(ev.observacao) + '</div>' : '') + '</div>' +
                    '<span class="etapa-hora">' + escapar(t.momento ? t.momento.substring(11, 16) : '') + '</span></li>';
            }).join('') + '</ol>';

        const whats = linkWhats(e.whatsapp_loja || l.whatsapp, 'Olá! Sobre o meu pedido ' + e.numero + ' na ' + l.nome + '.');
        let pix = '';
        if (e.pix) {
            pix = '<section class="quadro-pix" aria-labelledby="tituloPix"><h2 id="tituloPix">Pague com Pix</h2>' +
                '<p class="cartao-sub">Valor: <strong style="color:var(--tinta);font-size:17px">' + moeda(e.pix.valor) + '</strong>' +
                    (e.pix.recebedor ? ' · para ' + escapar(e.pix.recebedor) : '') + '</p>' +
                '<div class="chave-pix"><span id="chavePix">' + escapar(e.pix.chave || '') + '</span>' +
                    '<button type="button" class="botao botao-pequeno" id="copiarPix">Copiar chave</button></div>' +
                '<p class="cartao-sub" style="margin-top:10px">Pague em até <span class="contagem" id="contagemPix" data-ate="' + escapar(e.pix.pagar_ate) + '">--:--</span> ' +
                    '(até ' + escapar(String(e.pix.pagar_ate).substring(11, 16)) + '). Depois disso o pedido é cancelado sozinho.</p>' +
                (whats ? '<a class="botao botao-contorno botao-largo" style="margin-top:12px" target="_blank" rel="noopener" href="' +
                    linkWhats(e.whatsapp_loja || l.whatsapp, 'Olá! Paguei o Pix do pedido ' + e.numero + ' (' + moeda(e.pix.valor) + '). Segue o comprovante.') + '">Enviar comprovante no WhatsApp</a>' : '') +
                '</section>';
        }

        const itens = (e.itens || []).map(function (i) {
            return '<div class="item-sacola">' + fotoHtml(i.foto, '', '') + '<div><div class="item-nome">' + i.quantidade + 'x ' + escapar(i.descricao) + '</div>' +
                (i.adicionais.length ? '<div class="item-extra">' + escapar(i.adicionais.map(function (a) { return (a.quantidade > 1 ? a.quantidade + 'x ' : '') + a.nome; }).join(', ')) + '</div>' : '') +
                (i.observacao ? '<div class="item-extra">Obs.: ' + escapar(i.observacao) + '</div>' : '') +
                '<div class="item-linha"><span class="preco" style="font-size:14px">' + moeda(i.subtotal) + '</span>' +
                    (i.kcal ? '<span class="cartao-sub">' + numero(i.kcal * i.quantidade) + ' kcal</span>' : '') + '</div></div></div>';
        }).join('');

        const totais = '<div class="resumo-linha"><span>Subtotal</span><span>' + moeda(e.valor_produtos) + '</span></div>' +
            (!retirada ? '<div class="resumo-linha"><span>Taxa de entrega</span><span>' + (e.taxa_entrega > 0 ? moeda(e.taxa_entrega) : 'Grátis') + '</span></div>' : '') +
            (e.desconto > 0 ? '<div class="resumo-linha desconto"><span>Cupom ' + escapar(e.cupom_codigo || '') + '</span><span>- ' + moeda(e.desconto) + '</span></div>' : '') +
            (e.cashback_usado > 0 ? '<div class="resumo-linha desconto"><span>Cashback</span><span>- ' + moeda(e.cashback_usado) + '</span></div>' : '') +
            '<div class="resumo-total"><span>Total</span><span>' + moeda(e.valor_total) + '</span></div>' +
            (e.troco_para ? '<p class="cartao-sub" style="margin-top:6px">Troco para ' + moeda(e.troco_para) + '</p>' : '') +
            (e.cashback_gerado > 0 ? '<p class="cashback-previsto">' + svg('moeda') + 'Você ganhou ' + moeda(e.cashback_gerado) + ' de cashback com este pedido.</p>' : '');

        const local = retirada
            ? '<div class="cartao"><h2>Retirada</h2><p class="cartao-sub">' + escapar(e.retirada || l.endereco_retirada || 'No balcão da loja') + '</p></div>'
            : (e.entrega ? '<div class="cartao"><h2>Entrega</h2><p class="cartao-sub">' + escapar(e.entrega.logradouro + ', ' + e.entrega.numero +
                (e.entrega.complemento ? ' · ' + e.entrega.complemento : '') + ' · ' + e.entrega.bairro + ' · ' + e.entrega.cidade) + '</p>' +
                (e.entrega.referencia ? '<p class="cartao-sub">Referência: ' + escapar(e.entrega.referencia) + '</p>' : '') +
                '<p class="cartao-sub">Recebe: ' + escapar(e.entrega.destinatario || '') + '</p></div>' : '');

        let avaliacao = '';
        if (e.pode_avaliar) {
            avaliacao = '<section class="cartao" id="blocoAvaliar"><h2>Como foi o seu pedido?</h2><p class="cartao-sub">Sua avaliação ajuda a cozinha a melhorar.</p>' +
                '<div class="estrelas" role="radiogroup" aria-label="Nota de 1 a 5">' + [1, 2, 3, 4, 5].map(function (n) {
                    return '<button type="button" role="radio" aria-checked="false" data-nota="' + n + '" aria-label="' + n + (n === 1 ? ' estrela' : ' estrelas') + '">' + svg('estrela') + '</button>';
                }).join('') + '</div>' +
                '<div class="campo"><label for="comentarioAvaliacao">Comentário (opcional)</label><textarea id="comentarioAvaliacao" maxlength="300" placeholder="O que você achou?"></textarea></div>' +
                '<button type="button" class="botao botao-largo" id="enviarAvaliacao" style="margin-top:12px" disabled>Enviar avaliação</button></section>';
        } else if (e.avaliacao_nota) {
            avaliacao = '<div class="cartao"><h2>Sua avaliação</h2><div class="estrelas" aria-label="' + e.avaliacao_nota + ' de 5 estrelas">' +
                [1, 2, 3, 4, 5].map(function (n) { return '<span class="' + (n <= e.avaliacao_nota ? 'acesa' : '') + '" style="display:inline-flex">' + svg('estrela').replace('<svg', '<svg style="width:26px;height:26px;fill:' + (n <= e.avaliacao_nota ? 'var(--dourado)' : '#e2ddd2') + '"') + '</span>'; }).join('') +
                '</div>' + (e.avaliacao_comentario ? '<p class="cartao-sub" style="margin-top:6px">"' + escapar(e.avaliacao_comentario) + '"</p>' : '') + '</div>';
        }

        raiz.innerHTML = '<div data-pedido="' + e.id + '">' + cabecalho('Pedido ' + e.numero, '#/pedidos') +
            '<div class="acompanhar-grade"><div>' +
            '<section class="acompanhar-topo' + (e.status === 'cancelada' ? ' cancelado' : '') + '" aria-live="polite"><small>' + escapar(dataHoraCurta(e.criado_em)) + '</small>' +
                '<h2>' + escapar(titulo) + '</h2><p>' + escapar(sub) + '</p>' + (previsao ? '<p style="margin-top:6px;font-weight:600">' + escapar(previsao) + '</p>' : '') + '</section>' +
            pix +
            (e.status !== 'cancelada' ? '<div class="cartao"><h2>Acompanhe</h2>' + etapas + '</div>' : '') +
            avaliacao +
            local +
            '</div><div>' +
            '<div class="cartao"><h2>Itens</h2>' + itens +
                (e.nutricao && e.nutricao.kcal ? '<p class="cartao-sub" style="margin-top:8px">Total: ' + numero(e.nutricao.kcal) + ' kcal · ' + numero(e.nutricao.proteinas, 1) + ' g de proteína</p>' : '') +
            '</div>' +
            '<div class="cartao"><h2>Pagamento</h2><p class="cartao-sub">' + escapar(e.pagamento_rotulo) + '</p>' + totais + '</div>' +
            (e.observacoes ? '<div class="cartao"><h2>Sua observação</h2><p class="cartao-sub">' + escapar(e.observacoes) + '</p></div>' : '') +
            '<div class="cartao" style="display:grid;gap:10px">' +
                (whats ? '<a class="botao botao-claro" target="_blank" rel="noopener" href="' + whats + '">Falar com a loja no WhatsApp</a>' : '') +
                (TERMINADOS.indexOf(e.status) !== -1 ? '<button type="button" class="botao botao-contorno" data-repetir="' + e.id + '">Pedir de novo</button>' : '') +
                (e.pode_cancelar ? '<button type="button" class="botao botao-perigo" id="cancelarPedido">Cancelar pedido</button>' : '') +
            '</div>' +
            '</div></div></div>';

        if (e.pix) iniciarContagem();
        const copiar = document.getElementById('copiarPix');
        if (copiar) copiar.addEventListener('click', function () { copiarTexto(e.pix.chave); });
        const cancelar = document.getElementById('cancelarPedido');
        if (cancelar) cancelar.addEventListener('click', function () {
            if (!confirm('Cancelar o pedido ' + e.numero + '? Nada foi cobrado ainda.')) return;
            travado(cancelar, async function () {
                const r = await api('/encomendas/' + e.id + '/cancelar', 'POST', {});
                avisar(r.mensagem || 'Pedido cancelado.');
                telaPedido(e.id);
            }, 'Cancelando...');
        });
        const blocoAv = document.getElementById('blocoAvaliar');
        if (blocoAv) {
            let nota = 0;
            blocoAv.querySelectorAll('[data-nota]').forEach(function (b) {
                b.addEventListener('click', function () {
                    nota = Number(b.dataset.nota);
                    blocoAv.querySelectorAll('[data-nota]').forEach(function (x) {
                        const acesa = Number(x.dataset.nota) <= nota;
                        x.classList.toggle('acesa', acesa);
                        x.setAttribute('aria-checked', String(Number(x.dataset.nota) === nota));
                    });
                    document.getElementById('enviarAvaliacao').disabled = false;
                });
            });
            document.getElementById('enviarAvaliacao').addEventListener('click', function () {
                const botao = this;
                travado(botao, async function () {
                    const r = await api('/encomendas/' + e.id + '/avaliar', 'POST', { nota: nota, comentario: document.getElementById('comentarioAvaliacao').value.trim() || null });
                    avisar(r.mensagem || 'Obrigado!');
                    document.getElementById('comentarioAvaliacao').value = '';
                    telaPedido(e.id);
                }, 'Enviando...');
            });
        }
    }

    function iniciarContagem() {
        clearInterval(estado.contagem);
        function passo() {
            const caixa = document.getElementById('contagemPix');
            if (!caixa) { clearInterval(estado.contagem); return; }
            const ate = String(caixa.dataset.ate).replace(' ', 'T');
            const resta = Math.max(0, Math.floor((new Date(ate).getTime() - Date.now()) / 1000));
            caixa.textContent = String(Math.floor(resta / 60)).padStart(2, '0') + ':' + String(resta % 60).padStart(2, '0');
            if (resta <= 0) clearInterval(estado.contagem);
        }
        passo();
        estado.contagem = setInterval(passo, 1000);
    }

    function copiarTexto(texto) {
        const pronto = function () { avisar('Chave Pix copiada. Cole no app do seu banco.'); };
        if (navigator.clipboard && window.isSecureContext) {
            navigator.clipboard.writeText(texto).then(pronto, function () { copiarAntigo(texto) ? pronto() : avisar('Copie a chave manualmente.', 'erro'); });
        } else if (copiarAntigo(texto)) {
            pronto();
        } else {
            avisar('Copie a chave manualmente.', 'erro');
        }
    }
    function copiarAntigo(texto) {
        const area = document.createElement('textarea');
        area.value = texto;
        area.setAttribute('readonly', '');
        area.style.position = 'fixed';
        area.style.opacity = '0';
        document.body.appendChild(area);
        area.select();
        let ok = false;
        try { ok = document.execCommand('copy'); } catch (e) { ok = false; }
        area.remove();
        return ok;
    }

    // ------------------------------------------------------------------
    // Eventos da pagina (delegados no conteudo)
    // ------------------------------------------------------------------
    raiz.addEventListener('click', function (e) {
        const prato = e.target.closest('[data-prato]');
        if (prato && !e.target.closest('[data-favorito]')) {
            e.preventDefault();
            estado.abriuFolha = true;
            location.hash = '#/prato/' + prato.dataset.prato;
            return;
        }
        const cartao = e.target.closest('.cartao-prato');
        if (cartao && !e.target.closest('button, a')) {
            const link = cartao.querySelector('[data-prato]');
            if (link) { estado.abriuFolha = true; location.hash = '#/prato/' + link.dataset.prato; }
            return;
        }
        const fav = e.target.closest('[data-favorito]');
        if (fav) { e.preventDefault(); alternarFavorito(Number(fav.dataset.favorito)); return; }
        const cat = e.target.closest('[data-categoria]');
        if (cat) {
            if (estado.busca || estado.selos.length) { estado.busca = ''; estado.selos = []; telaInicio(); }
            const alvo = document.getElementById('cat-' + cat.dataset.categoria);
            if (alvo) alvo.scrollIntoView({ behavior: 'smooth', block: 'start' });
            return;
        }
        const selo = e.target.closest('[data-selo]');
        if (selo) {
            const v = selo.dataset.selo;
            const i = estado.selos.indexOf(v);
            if (i === -1) estado.selos.push(v); else estado.selos.splice(i, 1);
            selo.setAttribute('aria-pressed', String(i === -1));
            desenharCardapio();
            return;
        }
        if (e.target.closest('#limparBusca') || e.target.closest('#limparFiltros')) {
            estado.busca = '';
            estado.selos = [];
            telaInicio(true);
            return;
        }
        const modo = e.target.closest('[data-modo]');
        if (modo) {
            preferencias.modo = modo.dataset.modo;
            gravar(CHAVE_PREF, preferencias);
            if (estado.pagina === 'sacola') { prepararFinalizar(); desenharSacola(); calcularDepois(0); }
            else {
                document.querySelectorAll('[data-modo]').forEach(function (b) { b.setAttribute('aria-pressed', String(b.dataset.modo === preferencias.modo)); });
                document.getElementById('infoModo').innerHTML = infoModoHtml();
            }
            return;
        }
        const voltar = e.target.closest('[data-voltar]');
        if (voltar) guardarVoltar(voltar.dataset.voltar);
        const repetir = e.target.closest('[data-repetir]');
        if (repetir) { repetirPedido(Number(repetir.dataset.repetir), repetir); return; }
        // Sacola
        const qtd = e.target.closest('[data-item-qtd]');
        if (qtd) {
            const item = sacola.itens[Number(qtd.dataset.item)];
            if (!item) return;
            const p = pratoPorId(item.prato_id);
            const novo = item.quantidade + Number(qtd.dataset.itemQtd);
            const limite = p && p.disponivel !== null ? p.disponivel - (noCarrinho(p.id) - item.quantidade) : 30;
            if (novo > limite) { avisar('De "' + p.nome + '" só restam ' + p.disponivel + ' porções.', 'erro'); return; }
            item.quantidade = Math.max(1, Math.min(30, novo));
            gravarSacola();
            desenharSacola();
            calcularDepois();
            return;
        }
        const remover = e.target.closest('[data-remover]');
        if (remover) {
            sacola.itens.splice(Number(remover.dataset.remover), 1);
            gravarSacola();
            if (!sacola.itens.length) telaSacola(); else { desenharSacola(); calcularDepois(); }
            return;
        }
        if (e.target.closest('#aplicarCupom')) {
            const campo = document.getElementById('campoCupom');
            const codigo = campo.value.trim().toUpperCase();
            if (!codigo) { campo.focus(); return; }
            finalizar.cupom = codigo;
            finalizar.cupomErro = '';
            tentandoCupom = codigo;
            calcularDepois(0);
            return;
        }
        if (e.target.closest('#tirarCupom')) {
            finalizar.cupom = null;
            finalizar.cupomErro = '';
            desenharSacola();
            calcularDepois(0);
            return;
        }
        const pedir = e.target.closest('#fazerPedido');
        if (pedir) { fazerPedido(pedir); return; }
        const apagarEnd = e.target.closest('[data-apagar-endereco]');
        if (apagarEnd) apagarEndereco(Number(apagarEnd.dataset.apagarEndereco));
    });

    async function apagarEndereco(id) {
        if (!confirm('Apagar este endereço? Os pedidos já feitos continuam com o endereço deles.')) return;
        try {
            await api('/enderecos/' + id, 'DELETE');
            estado.enderecos = (await api('/enderecos')).itens;
            avisar('Endereço apagado.');
            if (estado.redesenharEnderecos && /enderecos/.test(location.hash)) estado.redesenharEnderecos();
        } catch (er) { avisar(er.message, 'erro'); }
    }

    raiz.addEventListener('input', function (e) {
        const alvo = e.target;
        if (alvo.id === 'campoBusca') {
            estado.busca = alvo.value;
            document.getElementById('limparBusca').hidden = !alvo.value;
            clearTimeout(estado.buscando);
            estado.buscando = setTimeout(desenharCardapio, 180);
            return;
        }
        if (alvo.dataset && alvo.dataset.end && alvo.closest('[data-form-endereco="novo"]')) {
            finalizar.endereco[alvo.dataset.end] = alvo.value;
            return;
        }
        if (alvo.id === 'trocoPara') finalizar.troco = alvo.value;
        if (alvo.id === 'obsPedido') finalizar.observacoes = alvo.value;
    });

    raiz.addEventListener('change', function (e) {
        const alvo = e.target;
        if (alvo.id === 'bairroTopo' || alvo.id === 'bairroSacola') {
            preferencias.bairro_id = alvo.value ? Number(alvo.value) : null;
            gravar(CHAVE_PREF, preferencias);
            if (alvo.id === 'bairroTopo') document.getElementById('infoModo').innerHTML = infoModoHtml();
            else calcularDepois(0);
            return;
        }
        if (alvo.dataset && alvo.dataset.end && alvo.closest('[data-form-endereco="novo"]')) {
            finalizar.endereco[alvo.dataset.end] = alvo.value;
            if (alvo.dataset.end === 'bairro_id') calcularDepois(0);
            return;
        }
        if (alvo.name === 'endereco') {
            finalizar.novoEndereco = alvo.value === 'novo';
            if (!finalizar.novoEndereco) finalizar.endereco_id = Number(alvo.value);
            desenharSacola();
            calcularDepois(0);
            return;
        }
        if (alvo.name === 'quando') { finalizar.quando = alvo.value; desenharSacola(); calcularDepois(0); return; }
        if (alvo.id === 'diaAgenda') { finalizar.data = alvo.value; finalizar.hora = ''; desenharSacola(); calcularDepois(0); return; }
        if (alvo.id === 'horaAgenda') { finalizar.hora = alvo.value; return; }
        if (alvo.name === 'pagamento') { finalizar.pagamento = alvo.value; desenharSacola(); calcularDepois(0); return; }
        if (alvo.id === 'usarCashback') { finalizar.usar_cashback = alvo.checked; calcularDepois(0); }
    });

    raiz.addEventListener('keydown', function (e) {
        if (e.target.id === 'campoCupom' && e.key === 'Enter') { e.preventDefault(); document.getElementById('aplicarCupom').click(); }
    });

    async function alternarFavorito(id) {
        if (!estado.conta) {
            guardarVoltar(location.hash || '#/');
            avisar('Entre na sua conta para guardar favoritos.');
            location.hash = '#/entrar';
            return;
        }
        const tinha = estado.conta.favoritos.indexOf(id) !== -1;
        try {
            if (tinha) await api('/favoritos/' + id, 'DELETE');
            else await api('/favoritos', 'POST', { prato_id: id });
            if (tinha) estado.conta.favoritos = estado.conta.favoritos.filter(function (x) { return x !== id; });
            else estado.conta.favoritos.push(id);
            document.querySelectorAll('[data-favorito="' + id + '"]').forEach(function (b) { b.setAttribute('aria-pressed', String(!tinha)); });
            avisar(tinha ? 'Tirado dos favoritos.' : 'Guardado nos favoritos.');
            if (estado.pagina === 'perfil' && /favoritos/.test(location.hash)) telaFavoritos();
        } catch (erro) {
            avisar(erro.message, 'erro');
        }
    }

    // ------------------------------------------------------------------
    // Rotas
    // ------------------------------------------------------------------
    async function rotear() {
        const hash = location.hash || '#/';
        clearTimeout(estado.relogio);
        clearInterval(estado.contagem);
        if (!estado.vitrine) return;
        let m;
        // Enderecos antigos (v8): #/encomendas e #/encomenda/ID
        if (/^#\/encomendas\/?$/.test(hash)) { location.replace('#/pedidos'); return; }
        if ((m = hash.match(/^#\/encomenda\/(\d+)/))) { location.replace('#/pedido/' + m[1]); return; }
        if ((m = hash.match(/^#\/prato\/(\d+)/))) {
            if (estado.pagina !== 'inicio') telaInicio();
            abrirPrato(Number(m[1]));
            return;
        }
        fecharFolha(true);
        if (hash === '#/' || hash === '#' || hash === '') {
            if (estado.pagina !== 'inicio' || !document.getElementById('listaCardapio')) telaInicio();
            else marcarNavegacao('inicio');
        } else if (hash === '#/busca') telaInicio(true);
        else if (hash === '#/sacola') await telaSacola();
        else if (hash === '#/entrar') { if (estado.conta) { location.replace(tirarVoltar() || '#/perfil'); return; } telaEntrar(); }
        else if (hash === '#/criar-conta') { if (estado.conta) { location.replace(tirarVoltar() || '#/perfil'); return; } telaCriarConta(); }
        else if (hash === '#/esqueci') telaEsqueci();
        else if (hash === '#/pedidos') await telaPedidos();
        else if ((m = hash.match(/^#\/pedido\/(\d+)/))) await telaPedido(Number(m[1]));
        else if ((m = hash.match(/^#\/perfil(?:\/(\w+))?/))) await telaPerfil(m[1] || null);
        else { location.replace('#/'); return; }
        atualizarIndicadores();
        if (!/^#\/prato\//.test(hash) && hash.indexOf('#avaliar') === -1 && hash !== '#/' && hash !== '#/busca') window.scrollTo(0, 0);
    }

    window.addEventListener('hashchange', rotear);

    async function iniciar() {
        try {
            const [v, s] = await Promise.all([
                api('/vitrine'),
                api('/sessao').catch(function () { return null; }),
            ]);
            estado.vitrine = v;
            estado.conta = s ? s.conta : null;
        } catch (erro) {
            raiz.innerHTML = '<div class="vazio">' + svg('aviso') + '<h2>Não conseguimos abrir a loja</h2><p>' + escapar(erro.message) + '</p>' +
                '<button type="button" class="botao" onclick="location.reload()">Tentar de novo</button></div>';
            return;
        }
        const l = loja();
        document.getElementById('nomeLoja').textContent = l.nome;
        document.title = l.nome + ' - Peça sua comida saudável';
        const status = document.getElementById('statusTopo');
        status.textContent = l.texto || '';
        status.classList.toggle('aberto', !!l.aberta_agora);
        atualizarConta();
        conferirSacola();
        atualizarIndicadores();
        rotear();
    }

    iniciar();

    janela.Loja = { estado: estado, sacola: sacola, rotear: rotear };
})(window);
