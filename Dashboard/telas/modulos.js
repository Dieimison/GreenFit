// carga: usa Formato, Nucleo; publica Telas.inicio  (conferido por testes/front/carga.test.js)
/*
 * telas/modulos.js - a tela de INICIO: o que aparece logo depois do login.
 * Window.Telas.inicio.
 *
 * Em cima, a saudacao e a ferramenta em destaque (o PDV); depois a faixa
 * "agora" com o que pede atencao na cozinha e no estoque (GET /api/resumo:
 * os numeros vem prontos do servidor) - cada numero leva a tela dele; e
 * embaixo os modulos. O que o perfil nao pode usar nao aparece (financeiro
 * e admin so para o administrador; pedidos online pela regra da loja) - e
 * o servidor recusa do mesmo jeito.
 */
(function (janela) {
    'use strict';

    const { escapar, moeda } = janela.Formato;
    const N = janela.Nucleo;
    const { api, estado, mostrarSecao } = N;

    /* Icones: os mesmos tracos do menu lateral (24x24, traco). */
    const ICONE = {
        'pedidos-online': '<path d="M5 11h14l-1.5 9h-11z"/><path d="M8 11V7a4 4 0 0 1 8 0v4"/>',
        pdv: '<rect x="2" y="4" width="20" height="12" rx="2"/><path d="M6 20h12M9 16v4M15 16v4M6 8h5M6 11h3"/>',
        producao: '<path d="M6 13h12v6a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2zM4 13h16M9 9c0-2 2-2 2-4M13 9c0-2 2-2 2-4"/>',
        cardapio: '<path d="M4 4h12a4 4 0 0 1 4 4v12H8a4 4 0 0 1-4-4z"/><path d="M8 9h8M8 13h8M8 17h5"/>',
        vendas: '<circle cx="9" cy="21" r="1"/><circle cx="19" cy="21" r="1"/><path d="M1 1h4l2.7 13.4a2 2 0 0 0 2 1.6h9.7a2 2 0 0 0 2-1.6L23 6H6"/>',
        entradas: '<path d="M21 8v13H3V8M1 3h22v5H1zM10 12h4"/>',
        cadastros: '<path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/>',
        financeiro: '<path d="M12 1v22M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6"/>',
        dashboard: '<path d="M3 13h8V3H3zM13 21h8V11h-8zM3 21h8v-6H3zM13 7h8V3h-8z"/>',
        admin: '<path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/><path d="M9 12l2 2 4-4"/>',
        pedidos: '<path d="M9 5H7a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V7a2 2 0 0 0-2-2h-2"/><rect x="9" y="3" width="6" height="4" rx="1"/><path d="M9 14l2 2 4-4"/>',
        fiscal: '<path d="M4 2h16v20l-3-2-3 2-2-2-2 2-3-2-3 2z"/><path d="M8 7h8M8 11h8M8 15h5"/>',
        nota: '<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><path d="M14 2v6h6M8 13h8M8 17h5"/>',
        loja: '<path d="M3 9l1.5-5h15L21 9M3 9h18M3 9v11h18V9M9 20v-6h6v6"/>',
        configuracoes: '<circle cx="12" cy="12" r="3"/><path d="M12 1v3M12 20v3M4.2 4.2l2.1 2.1M17.7 17.7l2.1 2.1M1 12h3M20 12h3M4.2 19.8l2.1-2.1M17.7 6.3l2.1-2.1"/>',
    };

    /* Os modulos, na ordem do dia a dia. quem: todos | loja | financeiro | admin. */
    const MODULOS = [
        { secao: 'pedidos-online', titulo: 'Pedidos online', texto: 'O quadro da cozinha: aceitar, preparar e entregar os pedidos do app.', quem: 'loja' },
        { secao: 'pdv-inicio', icone: 'pdv', titulo: 'PDV (balcão)', texto: 'Vender no balcão: pratos, adicionais, pagamento e troco.', quem: 'todos' },
        { secao: 'producao', titulo: 'Produção', texto: 'Planejar e concluir o que a cozinha produz, com a baixa dos insumos.', quem: 'todos' },
        { secao: 'cardapio', titulo: 'Cardápio', texto: 'Pratos com foto, nutrição, preço, ficha técnica e adicionais.', quem: 'todos' },
        { secao: 'pedidos', titulo: 'Entradas', texto: 'Tudo o que chega: a nota do fornecedor (XML ou digitada) vira lote e conta a pagar.', quem: 'todos' },
        { secao: 'entradas', titulo: 'Estoque', texto: 'Lotes de insumos e pratos, validade, perdas e ajustes.', quem: 'todos' },
        { secao: 'vendas', titulo: 'Vendas', texto: 'Consultar, editar e cancelar as vendas do balcão e da loja.', quem: 'todos' },
        { secao: 'cadastros', titulo: 'Cadastros', texto: 'Clientes, insumos, fornecedores e formas de pagamento.', quem: 'todos' },
        { secao: 'dashboard', titulo: 'Resultados', texto: 'Receita, custo, lucro e os pratos que mais vendem.', quem: 'todos' },
        { secao: 'financeiro', titulo: 'Financeiro', texto: 'Contas a pagar e a receber, baixas e caixa.', quem: 'financeiro' },
        { secao: 'loja', titulo: 'Loja online', texto: 'Funcionamento, horários, bairros e taxas, cupons e avaliações.', quem: 'admin' },
        { secao: 'fiscal', titulo: 'Fiscal', texto: 'Regime, inscrição estadual, CFOP e naturezas de operação.', quem: 'admin' },
        { secao: 'admin', titulo: 'Empresa e regras', texto: 'Regras da loja, dados da empresa e listas.', quem: 'admin' },
        { secao: 'configuracoes', titulo: 'Minha conta', texto: 'Trocar a senha e, para o admin, a equipe.', quem: 'todos' },
        { secao: null, titulo: 'Nota fiscal', texto: 'Emitir NFC-e e NF-e e calcular os tributos.', quem: 'admin', planejado: 'Em planejamento' },
    ];

    function icone(nome) {
        return '<svg viewBox="0 0 24 24" aria-hidden="true">' + (ICONE[nome] || ICONE.cadastros) + '</svg>';
    }

    function saudacao() {
        const h = new Date().getHours();
        return h < 12 ? 'Bom dia' : (h < 18 ? 'Boa tarde' : 'Boa noite');
    }

    function pode(m) {
        const c = estado.config;
        return m.quem === 'todos' || (m.quem === 'loja' && c.pode_operar_loja) ||
               (m.quem === 'financeiro' && c.pode_ver_financeiro) || (m.quem === 'admin' && c.pode_admin);
    }

    /* Um numero da faixa "agora": alerta quando pede atencao. */
    function agora(valor, umRotulo, variosRotulo, ir, alerta) {
        const n = valor === null ? '…' : String(valor);
        return '<button type="button" class="agora-item' + (alerta && valor ? ' agora-alerta' : '') + '" data-ir="' + ir + '">' +
            '<strong>' + escapar(n) + '</strong><span>' + escapar(valor === 1 ? umRotulo : variosRotulo) + '</span></button>';
    }

    function desenhar(resumo) {
        const c = (resumo && resumo.cards) || null;
        const v = function (k) { return c ? Number(c[k] || 0) : null; };
        const primeiroNome = String(estado.usuario.nome || '').trim().split(/\s+/)[0];
        const visiveis = MODULOS.filter(pode);

        document.getElementById('inicioConteudo').innerHTML =
            '<div class="inicio-cabeca">' +
                '<h2 class="inicio-ola">' + escapar(saudacao() + (primeiroNome ? ', ' + primeiroNome : '')) + '</h2>' +
                '<p class="inicio-loja">' + escapar(estado.config.empresa || 'Green Fit') +
                    (c && estado.config.pode_ver_financeiro ? ' · hoje: ' + v('vendas_hoje') + (v('vendas_hoje') === 1 ? ' venda, ' : ' vendas, ') + moeda(c.faturado_hoje) : '') + '</p>' +
            '</div>' +

            '<button type="button" class="inicio-destaque" data-ir="pdv">' +
                '<span class="destaque-rotulo">Ferramenta em destaque</span>' +
                '<span class="destaque-titulo">Abrir o PDV</span>' +
                '<span class="destaque-texto">Venda no balcão: toque no prato, escolha os adicionais, o pagamento e finalize. ' +
                    'O estoque baixa pelo lote que vence primeiro.</span>' +
                '<span class="destaque-tecla"><kbd>F2</kbd> abre o PDV de qualquer tela</span>' +
            '</button>' +

            '<div class="inicio-agora inicio-agora-gf" aria-label="Situação agora">' +
                (estado.config.pode_operar_loja ? agora(v('pedidos_abertos'), 'pedido online em andamento', 'pedidos online em andamento', 'pedidos-online', true) : '') +
                agora(v('porcoes_prontas'), 'porção pronta para vender', 'porções prontas para vender', 'cardapio', false) +
                agora(v('pratos_repor'), 'prato para repor', 'pratos para repor', 'producao', true) +
                agora(v('producoes_hoje'), 'produção para hoje', 'produções para hoje', 'producao', true) +
                agora(v('lotes_vencendo'), 'lote vencendo', 'lotes vencendo', 'entradas', true) +
                agora(v('lotes_vencidos'), 'lote vencido', 'lotes vencidos', 'entradas', true) +
                agora(v('insumos_em_falta'), 'insumo abaixo do mínimo', 'insumos abaixo do mínimo', 'pedidos', true) +
            '</div>' +

            '<h3 class="inicio-secao">Módulos</h3>' +
            '<div class="inicio-modulos">' +
                visiveis.map(function (m) {
                    const nomeIcone = m.icone || m.secao || 'nota';
                    if (m.planejado) {
                        return '<div class="modulo modulo-planejado" aria-disabled="true">' + icone(nomeIcone) +
                            '<span class="modulo-titulo">' + escapar(m.titulo) +
                                ' <span class="etiqueta" style="--cor-etiqueta:var(--atencao)">' + escapar(m.planejado) + '</span></span>' +
                            '<span class="modulo-texto">' + escapar(m.texto) + '</span></div>';
                    }
                    return '<button type="button" class="modulo" data-ir="' + m.secao + '">' + icone(nomeIcone) +
                        '<span class="modulo-titulo">' + escapar(m.titulo) + '</span>' +
                        '<span class="modulo-texto">' + escapar(m.texto) + '</span></button>';
                }).join('') +
            '</div>';
    }

    async function carregarInicio() {
        desenhar(null);   // a tela abre na hora; os numeros chegam depois
        try {
            desenhar(await api.get('/resumo'));
        } catch (erro) {
            // sem os numeros a tela continua util: os modulos estao ali
        }
    }

    document.getElementById('inicioConteudo').addEventListener('click', function (evento) {
        const alvo = evento.target.closest('[data-ir]');
        if (alvo) mostrarSecao(alvo.dataset.ir, true);
    });

    N.registrarTela('inicio', { titulo: 'Início', carregar: carregarInicio });
    janela.Telas = janela.Telas || {};
    janela.Telas.inicio = { carregar: carregarInicio, icone: icone };   // icone: a tela de entrada do PDV usa os mesmos
})(window);
