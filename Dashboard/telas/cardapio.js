// carga: usa Formato, Nucleo, Janela; publica Telas.cardapio  (conferido por testes/front/carga.test.js)
/*
 * telas/cardapio.js - CARDAPIO: pratos, categorias e grupos de adicionais.
 * Window.Telas.cardapio.
 *
 *   Pratos       grade de cartoes (foto, preco de/por, kcal e proteina,
 *                selos, estoque, na loja / fora, margem para o admin) e o
 *                formulario em abas: Basico, Nutricao, Validade, Ficha
 *                tecnica (com custo previsto e margem), Adicionais, Fotos, Fiscal
 *   Categorias   as secoes do cardapio (ordem em que aparecem na loja)
 *   Adicionais   grupos ("Escolha o molho": obrigatorio 1) com as opcoes
 *
 * O servidor confere tudo (api/rotas/pratos.php): preco so o admin muda,
 * promocional menor que o preco, prato na loja precisa de preco, etc. A
 * tela mostra a mensagem como veio. Foto: reduzida aqui (ate 1280 px, JPG,
 * menos de 1 MB) antes de mandar.
 */
(function (janela) {
    'use strict';

    const { escapar, moeda } = janela.Formato;
    const N = janela.Nucleo;
    const { api, estado, mensagemDe, avisar, rotuloDe, dominio, opcoesDoDominio, etiquetaTexto, vazio, tabelaHtml,
            quantidadeLegivel, selosHtml, urlFotoPrato, carregarPratos, carregarCatalogos } = N;
    const J = janela.Janela;

    const LADO_MAX = 1280;
    const BYTES_MAX = 1000000;

    const raiz = document.getElementById('cardapioConteudo');
    const filtro = { aba: 'pratos', busca: '', categoria: '', situacao: 'ativos' };
    let fotosNovas = [];
    let fotosRemover = [];
    let pratoEmEdicao = null;

    async function carregar() {
        await Promise.all([carregarPratos(), carregarCatalogos()]);
        desenhar();
    }

    // ------------------------------------------------------------------
    // Pratos: grade
    // ------------------------------------------------------------------
    const SITUACOES = [['ativos', 'Ativos'], ['loja', 'Na loja online'], ['fora', 'Fora da loja'], ['sem_estoque', 'Sem estoque'],
                       ['repor', 'Abaixo do mínimo'], ['inativos', 'Inativos'], ['', 'Todos']];

    function pratosFiltrados() {
        const busca = filtro.busca.trim().toLowerCase();
        return estado.pratos.filter(function (p) {
            if (filtro.categoria && String(p.categoria_id || '') !== filtro.categoria) return false;
            switch (filtro.situacao) {
                case 'ativos': if (!p.ativo) return false; break;
                case 'loja': if (!p.ativo || !p.publicado) return false; break;
                case 'fora': if (p.publicado && p.ativo) return false; break;
                case 'sem_estoque': if (!p.ativo || p.feito_na_hora || p.disponivel > 0) return false; break;
                case 'repor': if (!p.repor) return false; break;
                case 'inativos': if (p.ativo) return false; break;
            }
            if (busca) {
                const texto = [p.nome, p.categoria, p.descricao, p.ingredientes].concat((p.tags || []).map(function (t) { return rotuloDe('tags_prato', t); }))
                    .filter(Boolean).join(' ').toLowerCase();
                if (!texto.includes(busca)) return false;
            }
            return true;
        });
    }

    function fotoHtml(p) {
        return p.fotos && p.fotos.length
            ? '<img src="' + escapar(urlFotoPrato(p.fotos[0])) + '" alt="" loading="lazy">'
            : '<span class="cz-sem-foto" aria-hidden="true"><svg viewBox="0 0 24 24"><path d="M12 21c-4.5-2-7-6-7-10a7 7 0 0 1 14 0c0 4-2.5 8-7 10z"/><path d="M12 21V9"/><path d="M12 13l3-3M12 16l-3-3"/></svg></span>';
    }

    function estoqueHtml(p) {
        if (p.feito_na_hora) return '<span class="cz-estoque cz-estoque-hora">Feito na hora</span>';
        const partes = ['<strong class="' + (p.disponivel <= 0 ? 'saldo-zero' : (p.repor ? 'saldo-baixo' : 'saldo-ok')) + '">' +
            escapar(quantidadeLegivel(p.disponivel, 'porcao')) + '</strong>'];
        if (p.reservado) partes.push(p.reservado + ' reservada' + (p.reservado === 1 ? '' : 's'));
        if (p.vencendo) partes.push('<span class="saldo-baixo">' + p.vencendo + ' vencendo</span>');
        if (p.vencido) partes.push('<span class="saldo-zero">' + p.vencido + ' vencida' + (p.vencido === 1 ? '' : 's') + '</span>');
        return '<span class="cz-estoque">' + partes.join(' · ') + '</span>';
    }

    function cartaoPrato(p) {
        const promo = p.preco_promocional && p.preco_promocional < p.preco;
        const etiquetas = [];
        if (!p.ativo) etiquetas.push(etiquetaTexto('Inativo', '--tinta-fraca'));
        else etiquetas.push(p.publicado ? etiquetaTexto('Na loja', '--bom') : etiquetaTexto('Fora da loja', '--tinta-fraca'));
        if (p.repor) etiquetas.push(etiquetaTexto('Repor', '--atencao'));
        if (p.tipo === 'revenda') etiquetas.push(etiquetaTexto('Revenda', '--serie-1'));
        const macros = [p.kcal !== null && p.kcal !== undefined ? p.kcal + ' kcal' : null,
                        p.proteinas ? String(p.proteinas).replace('.', ',') + ' g proteína' : null,
                        p.porcao_g ? p.porcao_g + ' g' : null].filter(Boolean).join(' · ');
        const margem = estado.config.pode_ver_custo && p.custo_porcao !== undefined
            ? '<p class="cz-margem">' + (p.custo_porcao > 0 ? 'Custo ' + moeda(p.custo_porcao) + (p.margem !== null && p.margem !== undefined
                ? ' · margem <strong class="' + (p.margem < 50 ? 'saldo-baixo' : 'saldo-ok') + '">' + String(p.margem).replace('.', ',') + '%</strong>' : '')
                : '<span class="observacao">' + (p.tipo === 'revenda' ? 'custo: o do lote comprado' : 'sem ficha técnica: custo desconhecido') + '</span>') + '</p>'
            : '';
        const acoes = ['<button type="button" class="botao botao-pequeno" data-acao="editar-prato" data-id="' + p.id + '">Editar</button>'];
        if (p.ativo && p.tipo === 'producao' && !p.feito_na_hora) {
            acoes.push('<button type="button" class="botao-icone" data-acao="produzir-prato" data-id="' + p.id + '">Produzir</button>');
        }
        if (p.ativo && p.tipo === 'revenda') {
            acoes.push('<button type="button" class="botao-icone" data-acao="entrada-prato" data-id="' + p.id + '">Entrada</button>');
        }
        if (!p.feito_na_hora) acoes.push('<button type="button" class="botao-icone" data-acao="ficha-prato" data-id="' + p.id + '">Estoque</button>');
        if (p.ativo) {
            acoes.push('<button type="button" class="botao-icone" data-acao="publicar-prato" data-id="' + p.id + '">' +
                (p.publicado ? 'Tirar da loja' : 'Pôr na loja') + '</button>');
        }
        return '<article class="cz-prato' + (p.ativo ? '' : ' cz-prato-inativo') + '">' +
            '<div class="cz-prato-foto">' + fotoHtml(p) +
                (p.destaque ? '<span class="cz-selo-foto cz-selo-destaque">Destaque</span>' : '') +
                (promo ? '<span class="cz-selo-foto cz-selo-promo">Promoção</span>' : '') +
            '</div>' +
            '<div class="cz-prato-corpo">' +
                '<small class="cz-prato-categoria">' + escapar(p.categoria || 'Sem categoria') + '</small>' +
                '<h4 class="cz-prato-nome">' + escapar(p.nome) + '</h4>' +
                '<p class="cz-prato-preco">' + (promo ? '<s>' + moeda(p.preco) + '</s> <strong>' + moeda(p.preco_promocional) + '</strong>'
                                                       : '<strong>' + (p.preco > 0 ? moeda(p.preco) : 'sem preço') + '</strong>') + '</p>' +
                (macros ? '<p class="cz-macros">' + escapar(macros) + '</p>' : '') +
                (p.tags && p.tags.length ? '<div class="cz-selos">' + selosHtml(p.tags) + '</div>' : '') +
                '<p class="cz-linha-estoque">' + estoqueHtml(p) + '</p>' +
                margem +
                '<div class="cz-etiquetas">' + etiquetas.join(' ') + '</div>' +
            '</div>' +
            '<div class="cz-prato-acoes">' + acoes.join('') + '</div>' +
        '</article>';
    }

    function gradePratosHtml() {
        const lista = pratosFiltrados();
        if (!lista.length) {
            return vazio(estado.pratos.length ? 'Nenhum prato com estes filtros.' : 'O cardápio está vazio. Comece por "+ Novo prato".');
        }
        return '<div class="cz-grade-pratos">' + lista.map(cartaoPrato).join('') + '</div>';
    }

    function abaPratosHtml() {
        const ativos = estado.pratos.filter(function (p) { return p.ativo; });
        const naLoja = ativos.filter(function (p) { return p.publicado; }).length;
        const semEstoque = ativos.filter(function (p) { return !p.feito_na_hora && p.disponivel <= 0; }).length;
        return '<div class="secao-topo">' +
                '<div><p class="secao-descricao">' + ativos.length + ' prato(s) ativo(s), ' + naLoja + ' na loja online' +
                    (semEstoque ? ', <strong class="saldo-zero">' + semEstoque + ' sem estoque</strong>' : '') +
                    '. O cliente vê na loja só o que está ativo, com preço e "na loja".</p></div>' +
                '<div class="grupo-botoes"><button type="button" class="botao" data-acao="novo-prato">+ Novo prato</button></div>' +
            '</div>' +
            '<div class="barra-filtros">' +
                '<input type="search" id="czBuscaPrato" placeholder="Buscar prato, ingrediente, selo..." value="' + escapar(filtro.busca) + '">' +
                '<select id="czCategoriaPrato" aria-label="Categoria"><option value="">Todas as categorias</option>' +
                    estado.categorias.map(function (c) {
                        return '<option value="' + c.id + '"' + (filtro.categoria === String(c.id) ? ' selected' : '') + '>' + escapar(c.nome) + '</option>';
                    }).join('') + '</select>' +
                '<select id="czSituacaoPrato" aria-label="Situação">' + SITUACOES.map(function (s) {
                    return '<option value="' + s[0] + '"' + (filtro.situacao === s[0] ? ' selected' : '') + '>' + escapar(s[1]) + '</option>';
                }).join('') + '</select>' +
            '</div>' +
            '<div id="czGradePratos">' + gradePratosHtml() + '</div>';
    }

    // ------------------------------------------------------------------
    // Categorias e adicionais: listas
    // ------------------------------------------------------------------
    function abaCategoriasHtml() {
        return '<div class="secao-topo">' +
                '<div><p class="secao-descricao">As seções do cardápio, na ordem em que aparecem na loja (menor primeiro). ' +
                    'Categoria sem prato ativo não aparece para o cliente.</p></div>' +
                '<div class="grupo-botoes"><button type="button" class="botao" data-acao="nova-categoria">+ Nova categoria</button></div>' +
            '</div>' +
            '<div class="table-section">' + (estado.categorias.length ? tabelaHtml({
                colunas: ['Categoria', { titulo: 'Ordem', classe: 'numero' }, { titulo: 'Pratos', classe: 'numero' }, 'Situação',
                          { titulo: 'Ações', classe: 'coluna-acoes' }],
                linhas: estado.categorias.map(function (c) {
                    return ['<strong>' + escapar(c.nome) + '</strong>' + (c.descricao ? '<br><small class="observacao">' + escapar(c.descricao) + '</small>' : ''),
                            { html: String(c.ordem), classe: 'numero' }, { html: String(c.pratos || 0), classe: 'numero' },
                            etiquetaTexto(c.ativo ? 'Ativa' : 'Inativa', c.ativo ? '--bom' : '--tinta-fraca'),
                            { classe: 'coluna-acoes', html: '<button type="button" class="botao-icone" data-acao="editar-categoria" data-id="' + c.id + '">Editar</button>' +
                                (estado.config.pode_excluir ? ' <button type="button" class="botao-icone perigo" data-acao="excluir-categoria" data-id="' + c.id + '">Excluir</button>' : '') }];
                }),
            }) : vazio('Nenhuma categoria.')) + '</div>';
    }

    function regraDoGrupo(g) {
        if (!g.minimo) return 'Opcional · até ' + g.maximo;
        return 'Obrigatório · escolher ' + (g.minimo === g.maximo ? g.minimo : g.minimo + ' a ' + g.maximo);
    }

    function abaAdicionaisHtml() {
        return '<div class="secao-topo">' +
                '<div><p class="secao-descricao">Os extras que o cliente escolhe no prato ("Turbine seu prato", "Escolha o molho"). ' +
                    'O preço soma no prato e as calorias entram na conta do pedido.</p></div>' +
                '<div class="grupo-botoes"><button type="button" class="botao" data-acao="novo-grupo">+ Novo grupo</button></div>' +
            '</div>' +
            (estado.grupos.length ? '<div class="cz-grade-grupos">' + estado.grupos.map(function (g) {
                return '<article class="cz-grupo-adicional' + (g.ativo ? '' : ' cz-prato-inativo') + '">' +
                    '<div class="cz-grupo-cabeca"><h4>' + escapar(g.nome) + '</h4>' +
                        etiquetaTexto(regraDoGrupo(g), g.minimo ? '--laranja' : '--acento') +
                        (g.ativo ? '' : ' ' + etiquetaTexto('Inativo', '--tinta-fraca')) + '</div>' +
                    (g.descricao ? '<p class="observacao">' + escapar(g.descricao) + '</p>' : '') +
                    '<ul class="cz-opcoes">' + g.adicionais.map(function (a) {
                        return '<li class="' + (a.ativo ? '' : 'cz-opcao-inativa') + '"><span>' + escapar(a.nome) + '</span>' +
                            '<span>' + (a.preco > 0 ? '+ ' + moeda(a.preco) : 'grátis') + (a.kcal ? ' · ' + a.kcal + ' kcal' : '') + '</span></li>';
                    }).join('') + '</ul>' +
                    '<p class="observacao">Em ' + g.pratos + (g.pratos === 1 ? ' prato' : ' pratos') + '</p>' +
                    '<div class="cz-prato-acoes"><button type="button" class="botao botao-pequeno" data-acao="editar-grupo" data-id="' + g.id + '">Editar</button>' +
                        (estado.config.pode_excluir ? '<button type="button" class="botao-icone perigo" data-acao="excluir-grupo" data-id="' + g.id + '">Excluir</button>' : '') +
                    '</div></article>';
            }).join('') + '</div>' : vazio('Nenhum grupo de adicionais. Crie, por exemplo, "Escolha o molho" (obrigatório, 1).'));
    }

    function desenhar() {
        const abas = [['pratos', 'Pratos', estado.pratos.filter(function (p) { return p.ativo; }).length],
                      ['categorias', 'Categorias', estado.categorias.length], ['adicionais', 'Adicionais', estado.grupos.length]];
        raiz.innerHTML = '<div class="sub-abas cz-abas cz-abas-topo">' + abas.map(function (a) {
                return '<button type="button" class="sub-aba' + (filtro.aba === a[0] ? ' ativa' : '') + '" data-aba-cardapio="' + a[0] + '">' +
                    escapar(a[1]) + ' <span class="cz-contagem">' + a[2] + '</span></button>';
            }).join('') + '</div>' +
            (filtro.aba === 'pratos' ? abaPratosHtml() : filtro.aba === 'categorias' ? abaCategoriasHtml() : abaAdicionaisHtml());
    }

    raiz.addEventListener('click', function (evento) {
        const aba = evento.target.closest('[data-aba-cardapio]');
        if (aba) {
            filtro.aba = aba.dataset.abaCardapio;
            desenhar();
        }
    });
    raiz.addEventListener('input', function (evento) {
        if (evento.target.id !== 'czBuscaPrato') return;
        filtro.busca = evento.target.value;
        document.getElementById('czGradePratos').innerHTML = gradePratosHtml();
    });
    raiz.addEventListener('change', function (evento) {
        if (evento.target.id === 'czCategoriaPrato') filtro.categoria = evento.target.value;
        else if (evento.target.id === 'czSituacaoPrato') filtro.situacao = evento.target.value;
        else return;
        document.getElementById('czGradePratos').innerHTML = gradePratosHtml();
    });

    // ------------------------------------------------------------------
    // Pedacos de formulario (o do prato e montado aqui, com abas)
    // ------------------------------------------------------------------
    function campo(nome, rotulo, controle, opcoes) {
        opcoes = opcoes || {};
        return '<div class="campo' + (opcoes.total ? ' campo-total' : '') + '"' + (opcoes.atributos || '') + '>' +
            '<label for="cz-' + nome + '">' + escapar(rotulo) + '</label>' + controle +
            (opcoes.dica ? '<small class="dica"' + (opcoes.idDica ? ' id="' + opcoes.idDica + '"' : '') + '>' + escapar(opcoes.dica) + '</small>' : '') +
            '</div>';
    }

    function entrada(nome, valor, extra) {
        return '<input id="cz-' + nome + '" name="' + nome + '" value="' + escapar(valor === null || valor === undefined ? '' : valor) + '"' + (extra || '') + '>';
    }

    function numero(nome, valor, passo, extra) {
        return entrada(nome, valor, ' type="number" min="0" step="' + (passo || '1') + '" inputmode="decimal"' + (extra || ''));
    }

    function selecao(nome, valor, opcoes, extra) {
        return '<select id="cz-' + nome + '" name="' + nome + '"' + (extra || '') + '>' + opcoes.map(function (o) {
            return '<option value="' + escapar(o.valor) + '"' + (String(o.valor) === String(valor === null || valor === undefined ? '' : valor) ? ' selected' : '') + '>' +
                escapar(o.rotulo) + '</option>';
        }).join('') + '</select>';
    }

    function interruptor(nome, ligado, texto, extra) {
        return '<label class="interruptor"><input type="checkbox" id="cz-' + nome + '" name="' + nome + '"' + (ligado ? ' checked' : '') + (extra || '') + '>' +
            '<span class="interruptor-trilho"><span class="interruptor-bola"></span></span>' +
            '<span class="interruptor-texto">' + escapar(texto) + '</span></label>';
    }

    function texto(nome, valor, linhas) {
        return '<textarea id="cz-' + nome + '" name="' + nome + '" rows="' + (linhas || 2) + '">' + escapar(valor || '') + '</textarea>';
    }

    // ---- ficha tecnica ----
    function insumoDe(id) { return estado.insumos.find(function (i) { return String(i.id) === String(id); }); }

    function linhaFichaHtml(insumoId, quantidade) {
        const ativos = estado.insumos.filter(function (i) { return i.ativo || String(i.id) === String(insumoId); });
        return '<div class="cz-ficha-linha" data-ficha-linha>' +
            '<select data-ficha-insumo aria-label="Insumo"><option value="">— insumo —</option>' + ativos.map(function (i) {
                return '<option value="' + i.id + '"' + (String(i.id) === String(insumoId) ? ' selected' : '') + '>' + escapar(i.nome) + '</option>';
            }).join('') + '</select>' +
            '<div class="cz-ficha-qtd"><input type="number" data-ficha-qtd min="1" step="1" inputmode="numeric" aria-label="Quantidade por porção" value="' +
                escapar(quantidade || '') + '"><span data-ficha-unidade></span></div>' +
            '<small class="observacao cz-ficha-info" data-ficha-info></small>' +
            '<button type="button" class="botao-icone perigo" data-ficha-remover aria-label="Tirar da ficha">Tirar</button>' +
        '</div>';
    }

    function precoAtualDoForm() {
        const corpo = J.modalCorpo;
        const promo = Number(String((corpo.querySelector('[name="preco_promocional"]') || {}).value || '').replace(',', '.')) || 0;
        const preco = Number(String((corpo.querySelector('[name="preco"]') || {}).value || '').replace(',', '.')) || 0;
        return promo > 0 && promo < preco ? promo : preco;
    }

    /* Recalcula unidade, conversao, custo de cada linha e o total da ficha. */
    function recalcularFicha() {
        const caixa = J.modalCorpo.querySelector('[data-editor="ficha"]');
        if (!caixa) return;
        const custoVisivel = !!estado.config.pode_ver_custo;
        let total = 0;
        let semCusto = 0;
        caixa.querySelectorAll('[data-ficha-linha]').forEach(function (linha) {
            const i = insumoDe(linha.querySelector('[data-ficha-insumo]').value);
            const q = Math.round(Number(linha.querySelector('[data-ficha-qtd]').value) || 0);
            linha.querySelector('[data-ficha-unidade]').textContent = i ? i.unidade : '';
            const partes = [];
            if (i && q && (i.unidade === 'g' || i.unidade === 'ml')) {
                partes.push('= ' + (q / 1000).toLocaleString('pt-BR', { maximumFractionDigits: 3 }) + (i.unidade === 'g' ? ' kg' : ' L'));
            }
            if (i) partes.push('tem ' + quantidadeLegivel(i.saldo, i.unidade));
            if (custoVisivel && i && q) {
                if (Number(i.custo_medio) > 0) {
                    const c = q * Number(i.custo_medio);
                    total += c;
                    partes.push(moeda(c));
                } else {
                    semCusto++;
                    partes.push('sem custo (nenhuma compra)');
                }
            }
            linha.querySelector('[data-ficha-info]').textContent = partes.join(' · ');
        });
        const resumo = J.modalCorpo.querySelector('[data-ficha-total]');
        if (!resumo) return;
        if (!custoVisivel) { resumo.textContent = ''; return; }
        const preco = precoAtualDoForm();
        const margem = preco > 0 && total > 0 ? Math.round((preco - total) / preco * 1000) / 10 : null;
        resumo.innerHTML = 'Custo previsto por porção: <strong>' + moeda(total) + '</strong>' +
            (margem !== null ? ' · margem sobre ' + moeda(preco) + ': <strong class="' + (margem < 50 ? 'saldo-baixo' : 'saldo-ok') + '">' +
                String(margem).replace('.', ',') + '%</strong>' : '') +
            (semCusto ? ' <small class="observacao">(' + semCusto + ' insumo(s) ainda sem compra, fora da conta)</small>' : '') +
            '<br><small class="observacao">Pelo custo médio dos lotes em estoque. O custo de verdade de cada lote sai da produção.</small>';
    }

    /* Estimativa de kcal pelos macros (4/4/9), ao vivo, como conferencia. */
    function recalcularKcal() {
        const corpo = J.modalCorpo;
        const dica = corpo.querySelector('#czDicaKcal');
        if (!dica) return;
        const v = function (n) { return Number(String((corpo.querySelector('[name="' + n + '"]') || {}).value || '').replace(',', '.')) || 0; };
        const estimada = Math.round(v('proteinas') * 4 + v('carboidratos') * 4 + v('gorduras') * 9);
        dica.textContent = estimada ? 'Pelos macros: cerca de ' + estimada + ' kcal.' : 'Por porção.';
    }

    function ajustarTipoPrato() {
        const corpo = J.modalCorpo;
        const tipo = corpo.querySelector('[name="tipo"]');
        const hora = corpo.querySelector('[name="feito_na_hora"]');
        if (!tipo || !hora) return;
        if (tipo.value === 'revenda') hora.checked = false;
        hora.disabled = tipo.value === 'revenda';
        const minimo = corpo.querySelector('[data-campo-minimo]');
        if (minimo) minimo.classList.toggle('oculta', hora.checked);
        const avisoFicha = corpo.querySelector('[data-aviso-ficha]');
        if (avisoFicha) {
            avisoFicha.textContent = tipo.value === 'revenda'
                ? 'Prato de revenda (comprado pronto) não precisa de ficha técnica: o custo vem do lote comprado.'
                : hora.checked ? 'Feito na hora: a ficha dá o custo de cada venda (os insumos não são baixados sozinhos).'
                    : 'A produção baixa estes insumos, por porção, do lote que vence primeiro.';
        }
    }

    // ---- fotos ----
    function fotosNaJanela() { return J.modalCorpo.querySelectorAll('.cz-foto').length; }

    function reduzir(arquivo) {
        return new Promise(function (resolver, recusar) {
            if (!/^image\/(jpeg|png|webp)$/.test(arquivo.type)) { recusar(new Error('não é uma foto JPG, PNG ou WEBP.')); return; }
            const leitor = new FileReader();
            leitor.onerror = function () { recusar(new Error('não consegui ler o arquivo.')); };
            leitor.onload = function () {
                const img = new Image();
                img.onerror = function () { recusar(new Error('o arquivo não abriu como foto.')); };
                img.onload = function () {
                    const escala = Math.min(1, LADO_MAX / Math.max(img.width, img.height));
                    const tela = document.createElement('canvas');
                    tela.width = Math.max(1, Math.round(img.width * escala));
                    tela.height = Math.max(1, Math.round(img.height * escala));
                    const ctx = tela.getContext('2d');
                    ctx.fillStyle = '#ffffff';   // PNG transparente vira fundo branco no JPG
                    ctx.fillRect(0, 0, tela.width, tela.height);
                    ctx.drawImage(img, 0, 0, tela.width, tela.height);
                    let qualidade = 0.82;
                    let url = tela.toDataURL('image/jpeg', qualidade);
                    while (url.length * 0.75 > BYTES_MAX && qualidade > 0.4) {
                        qualidade -= 0.12;
                        url = tela.toDataURL('image/jpeg', qualidade);
                    }
                    if (url.length * 0.75 > BYTES_MAX) { recusar(new Error('a foto continua grande demais.')); return; }
                    resolver(url);
                };
                img.src = leitor.result;
            };
            leitor.readAsDataURL(arquivo);
        });
    }

    async function acrescentarFotos(arquivos) {
        const maximo = estado.config.fotos_max || 4;
        for (const arquivo of arquivos) {
            if (fotosNaJanela() >= maximo) {
                avisar('Cada prato leva no máximo ' + maximo + ' fotos.', 'erro');
                break;
            }
            try {
                const url = await reduzir(arquivo);
                fotosNovas.push(url);
                const fig = document.createElement('figure');
                fig.className = 'cz-foto';
                fig.dataset.fotoNova = url.slice(-40);
                fig.innerHTML = '<img src="' + url + '" alt=""><button type="button" class="botao-icone perigo" data-remover-nova>Remover</button>';
                J.modalCorpo.querySelector('[data-fotos]').appendChild(fig);
            } catch (erro) {
                avisar('"' + arquivo.name + '": ' + erro.message, 'erro');
            }
        }
    }

    // ---- o formulario inteiro ----
    const ABAS_PRATO = [['basico', 'Básico'], ['nutricao', 'Nutrição'], ['validade', 'Validade'], ['ficha', 'Ficha técnica'],
                        ['adicionais', 'Adicionais'], ['fotos', 'Fotos'], ['fiscal', 'Fiscal']];

    function formularioPratoHtml(p) {
        const admin = !!estado.config.pode_admin;
        const novo = !p.id;
        const tags = p.tags || [];
        const gruposDoPrato = (p.grupos || []).map(function (g) { return g.id; });
        const categorias = [{ valor: '', rotulo: '— sem categoria —' }].concat(estado.categorias.filter(function (c) {
            return c.ativo || c.id === p.categoria_id;
        }).map(function (c) { return { valor: c.id, rotulo: c.nome }; }));

        const basico =
            campo('nome', 'Nome do prato', entrada('nome', p.nome, ' maxlength="120" autocomplete="off"'), { total: true }) +
            campo('categoria_id', 'Categoria', selecao('categoria_id', p.categoria_id || '', categorias)) +
            campo('tipo', 'Como chega ao cliente', selecao('tipo', p.tipo || 'producao', opcoesDoDominio('tipos_prato'))) +
            campo('feito_na_hora', 'Feito na hora?', interruptor('feito_na_hora', !!p.feito_na_hora, 'Sim, preparado quando o pedido chega'),
                  { dica: 'Sem estoque: vende enquanto estiver ativo (bowls, saladas montadas na hora).' }) +
            campo('preco', 'Preço (R$)', numero('preco', p.preco ? Number(p.preco).toFixed(2) : '', '0.01', admin ? '' : ' disabled'),
                  { dica: admin ? 'No balcão e na loja online.' : 'Só o administrador muda o preço.' }) +
            campo('preco_promocional', 'Preço promocional (R$)', numero('preco_promocional', p.preco_promocional ? Number(p.preco_promocional).toFixed(2) : '', '0.01', admin ? '' : ' disabled'),
                  { dica: 'Menor que o preço: aparece "de/por" na loja. Vazio = sem promoção.' }) +
            campo('estoque_minimo', 'Estoque mínimo (porções)', numero('estoque_minimo', p.estoque_minimo || '', '1'),
                  { dica: 'Abaixo disso aparece "repor". Vazio usa ' + estado.config.estoque_baixo + '.', atributos: ' data-campo-minimo' }) +
            campo('ordem', 'Ordem na categoria', numero('ordem', p.ordem || 0, '1'), { dica: 'Menor aparece primeiro.' }) +
            campo('publicado', 'Na loja online', interruptor('publicado', novo ? true : !!p.publicado, 'Aparece para o cliente')) +
            campo('destaque', 'Destaque', interruptor('destaque', !!p.destaque, 'Em destaque no topo da loja')) +
            campo('ativo', 'Ativo', interruptor('ativo', novo ? true : !!p.ativo, 'No cardápio (PDV e loja)')) +
            campo('descricao', 'Descrição (o cliente vê)', texto('descricao', p.descricao, 3), { total: true });

        const selos = '<div class="campo campo-total"><label>Selos</label><div class="cz-pilulas" data-editor="selos">' +
            dominio('tags_prato').map(function (t) {
                return '<label class="cz-pilula"><input type="checkbox" value="' + escapar(t.valor) + '"' + (tags.indexOf(t.valor) >= 0 ? ' checked' : '') +
                    '><span>' + escapar(t.rotulo) + '</span></label>';
            }).join('') + '</div><small class="dica">O cliente filtra o cardápio por eles (low carb, vegano, sem glúten...).</small></div>';

        const nutricao =
            campo('porcao_g', 'Porção (g)', numero('porcao_g', p.porcao_g)) +
            campo('kcal', 'Calorias (kcal)', numero('kcal', p.kcal), { dica: 'Por porção.', idDica: 'czDicaKcal' }) +
            campo('proteinas', 'Proteínas (g)', numero('proteinas', p.proteinas, '0.1')) +
            campo('carboidratos', 'Carboidratos (g)', numero('carboidratos', p.carboidratos, '0.1')) +
            campo('gorduras', 'Gorduras (g)', numero('gorduras', p.gorduras, '0.1')) +
            campo('fibras', 'Fibras (g)', numero('fibras', p.fibras, '0.1')) +
            campo('sodio_mg', 'Sódio (mg)', numero('sodio_mg', p.sodio_mg)) +
            selos +
            campo('ingredientes', 'Ingredientes (o cliente vê)', texto('ingredientes', p.ingredientes, 3), { total: true }) +
            campo('alergenicos', 'Alergênicos', entrada('alergenicos', p.alergenicos, ' maxlength="300"'),
                  { total: true, dica: 'Ex.: contém ovo e derivados de leite. Pode conter traços de castanhas.' });

        const lotes = (p.lotes || []);
        const validade =
            campo('conservacao', 'Conservação', selecao('conservacao', p.conservacao || 'resfriado', opcoesDoDominio('conservacoes'))) +
            campo('validade_dias', 'Validade (dias)', numero('validade_dias', p.validade_dias === undefined ? 3 : p.validade_dias),
                  { dica: 'Quantos dias o lote produzido dura. 0 = informar em cada lote.' }) +
            campo('modo_preparo', 'Como aquecer / consumir', texto('modo_preparo', p.modo_preparo, 2),
                  { total: true, dica: 'Ex.: micro-ondas 3 min com a tampa entreaberta. Congelado: descongele na geladeira.' }) +
            (lotes.length ? '<div class="campo campo-total"><label>Lotes em estoque agora</label><ul class="cz-lotes-ficha">' + lotes.map(function (l) {
                return '<li><strong>' + l.saldo + ' porç' + (l.saldo === 1 ? 'ão' : 'ões') + '</strong> · ' + escapar(l.lote ? 'lote ' + l.lote : 'sem lote') +
                    ' · ' + escapar(N.textoValidade(l.dias_validade)) + (l.producao_numero ? ' <small class="observacao">(' + escapar(l.producao_numero) + ')</small>' : '') + '</li>';
            }).join('') + '</ul></div>' : '');

        const ficha = '<div class="campo-total"><p class="observacao" data-aviso-ficha></p>' +
            '<div class="cz-ficha" data-editor="ficha">' +
                '<div class="cz-ficha-cabeca"><span>Insumo</span><span>Por porção</span><span></span><span></span></div>' +
                ((p.ficha || []).map(function (f) { return linhaFichaHtml(f.insumo_id, f.quantidade); }).join('') || linhaFichaHtml('', '')) +
            '</div>' +
            '<button type="button" class="botao botao-secundario botao-pequeno" data-ficha-nova>+ Adicionar insumo</button>' +
            '<p class="cz-ficha-total" data-ficha-total></p>' +
            '<small class="dica">Quantidade na unidade do insumo (g, ml ou un) para UMA porção. Insumo que não está na lista: cadastre em Cadastros &gt; Insumos.</small>' +
            '</div>';

        const adicionais = '<div class="campo-total"><div class="cz-pilulas cz-pilulas-grupos" data-editor="grupos">' +
            (estado.grupos.length ? estado.grupos.filter(function (g) { return g.ativo || gruposDoPrato.indexOf(g.id) >= 0; }).map(function (g) {
                return '<label class="cz-grupo-opcao"><input type="checkbox" value="' + g.id + '"' + (gruposDoPrato.indexOf(g.id) >= 0 ? ' checked' : '') + '>' +
                    '<span><strong>' + escapar(g.nome) + '</strong><small>' + escapar(regraDoGrupo(g)) + ' · ' +
                    escapar(g.adicionais.filter(function (a) { return a.ativo; }).map(function (a) { return a.nome; }).join(', ')) + '</small></span></label>';
            }).join('') : '<p class="observacao">Nenhum grupo criado ainda. Crie na aba Adicionais do Cardápio.</p>') +
            '</div><small class="dica">O cliente escolhe as opções destes grupos ao pôr o prato no carrinho.</small></div>';

        const maximo = estado.config.fotos_max || 4;
        const fotos = '<div class="campo-total"><div class="cz-fotos" data-fotos>' + (p.fotos || []).map(function (f) {
                return '<figure class="cz-foto" data-foto-existente="' + f + '"><img src="' + escapar(urlFotoPrato(f)) + '" alt="">' +
                    '<button type="button" class="botao-icone perigo" data-remover-foto="' + f + '">Remover</button></figure>';
            }).join('') + '</div>' +
            '<label class="botao botao-secundario botao-pequeno cz-escolher-foto">Escolher fotos' +
                '<input type="file" data-arquivos-foto accept="image/jpeg,image/png,image/webp" multiple hidden></label>' +
            '<small class="dica">Até ' + maximo + ' fotos. A primeira é a capa na loja. JPG, PNG ou WEBP: a foto é reduzida aqui antes de enviar.</small></div>';

        const fiscal =
            campo('ncm', 'NCM', entrada('ncm', p.ncm), { dica: 'Refeição pronta costuma ser 2106.90.90; confira com o contador.' }) +
            campo('cest', 'CEST', entrada('cest', p.cest)) +
            campo('origem', 'Origem da mercadoria', selecao('origem', p.origem === null || p.origem === undefined ? '' : String(p.origem),
                [{ valor: '', rotulo: '— não informada —' }].concat(opcoesDoDominio('origens_mercadoria')))) +
            campo('unidade', 'Unidade', entrada('unidade', p.unidade || 'UN', ' maxlength="6"')) +
            campo('gtin', 'GTIN (código de barras)', entrada('gtin', p.gtin));

        const paineis = { basico: basico, nutricao: nutricao, validade: validade, ficha: ficha, adicionais: adicionais, fotos: fotos, fiscal: fiscal };
        return '<div class="campo-total cz-form-prato">' +
            '<div class="sub-abas cz-abas-form" role="tablist">' + ABAS_PRATO.map(function (a, i) {
                return '<button type="button" class="sub-aba' + (i === 0 ? ' ativa' : '') + '" data-aba-prato="' + a[0] + '">' + escapar(a[1]) + '</button>';
            }).join('') + '</div>' +
            ABAS_PRATO.map(function (a, i) {
                return '<div class="cz-painel-form' + (i === 0 ? '' : ' oculta') + '" data-painel-prato="' + a[0] + '">' + paineis[a[0]] + '</div>';
            }).join('') +
            '</div>';
    }

    async function abrirPrato(id) {
        if (!estado.insumos.length || !estado.grupos) await carregarCatalogos();
        const p = id ? (await api.get('/pratos/' + id)).prato : {};
        fotosNovas = [];
        fotosRemover = [];
        pratoEmEdicao = p;
        J.abrirModal({
            titulo: id ? p.nome : 'Novo prato',
            textoSalvar: id ? 'Salvar prato' : 'Cadastrar prato',
            html: formularioPratoHtml(p),
            aoAbrir: function () {
                ajustarTipoPrato();
                recalcularFicha();
                recalcularKcal();
            },
            aoSalvar: async function (v) {
                const corpo = Object.assign({}, v);
                ['feito_na_hora', 'publicado', 'destaque', 'ativo'].forEach(function (c) { corpo[c] = v[c] ? 1 : 0; });
                if (!estado.config.pode_admin) {
                    delete corpo.preco;
                    delete corpo.preco_promocional;
                }
                corpo.tags = Array.from(J.modalCorpo.querySelectorAll('[data-editor="selos"] input:checked')).map(function (c) { return c.value; });
                corpo.grupos = Array.from(J.modalCorpo.querySelectorAll('[data-editor="grupos"] input:checked')).map(function (c) { return Number(c.value); });
                const ficha = [];
                J.modalCorpo.querySelectorAll('[data-ficha-linha]').forEach(function (linha, n) {
                    const insumo = linha.querySelector('[data-ficha-insumo]').value;
                    const q = linha.querySelector('[data-ficha-qtd]').value;
                    if (!insumo && !q) return;
                    if (!insumo) throw new Error('Linha ' + (n + 1) + ' da ficha técnica: escolha o insumo (ou tire a linha).');
                    if (!(Number(q) >= 1)) throw new Error('Linha ' + (n + 1) + ' da ficha técnica: informe a quantidade por porção.');
                    ficha.push({ insumo_id: Number(insumo), quantidade: Math.round(Number(q)) });
                });
                corpo.ficha = ficha;
                corpo.fotos_novas = fotosNovas;
                corpo.fotos_remover = fotosRemover;
                const r = id ? await api.put('/pratos/' + id, corpo) : await api.post('/pratos', corpo);
                avisar(mensagemDe(r, 'Prato gravado.'));
                await carregar();
            },
        });
    }

    /*
     * Eventos de dentro da janela, ligados UMA vez (a janela e reaproveitada:
     * ouvinte posto a cada abertura se acumularia). So agem dentro do
     * formulario do prato (.cz-form-prato) ou do grupo (.cz-form-grupo).
     */
    J.modalCorpo.addEventListener('click', function (evento) {
        const alvo = evento.target;
        const abaPrato = alvo.closest('[data-aba-prato]');
        if (abaPrato) {
            const qual = abaPrato.dataset.abaPrato;
            J.modalCorpo.querySelectorAll('[data-aba-prato]').forEach(function (b) { b.classList.toggle('ativa', b === abaPrato); });
            J.modalCorpo.querySelectorAll('[data-painel-prato]').forEach(function (d) { d.classList.toggle('oculta', d.dataset.painelPrato !== qual); });
            if (qual === 'ficha') recalcularFicha();
            return;
        }
        if (alvo.closest('[data-ficha-nova]')) {
            J.modalCorpo.querySelector('[data-editor="ficha"]').insertAdjacentHTML('beforeend', linhaFichaHtml('', ''));
            recalcularFicha();
            const ultima = J.modalCorpo.querySelectorAll('[data-ficha-insumo]');
            ultima[ultima.length - 1].focus();
            return;
        }
        const remover = alvo.closest('[data-ficha-remover]');
        if (remover) {
            remover.closest('[data-ficha-linha]').remove();
            recalcularFicha();
            return;
        }
        const fotoExistente = alvo.closest('[data-remover-foto]');
        if (fotoExistente) {
            fotosRemover.push(Number(fotoExistente.dataset.removerFoto));
            fotoExistente.closest('figure').remove();
            return;
        }
        const fotoNova = alvo.closest('[data-remover-nova]');
        if (fotoNova) {
            const fig = fotoNova.closest('figure');
            const img = fig.querySelector('img').getAttribute('src');
            fotosNovas = fotosNovas.filter(function (u) { return u !== img; });
            fig.remove();
            return;
        }
        if (alvo.closest('[data-opcao-nova]')) {
            J.modalCorpo.querySelector('[data-editor="opcoes"]').insertAdjacentHTML('beforeend', linhaOpcaoHtml({ ativo: 1 }));
            const nomes = J.modalCorpo.querySelectorAll('[data-opcao-nome]');
            nomes[nomes.length - 1].focus();
            return;
        }
        const remOpcao = alvo.closest('[data-opcao-remover]');
        if (remOpcao) remOpcao.closest('[data-opcao-linha]').remove();
    });

    J.modalCorpo.addEventListener('input', function (evento) {
        if (!evento.target.closest('.cz-form-prato')) return;
        if (evento.target.closest('[data-editor="ficha"]') || ['preco', 'preco_promocional'].indexOf(evento.target.name) >= 0) recalcularFicha();
        if (['proteinas', 'carboidratos', 'gorduras'].indexOf(evento.target.name) >= 0) recalcularKcal();
    });

    J.modalCorpo.addEventListener('change', function (evento) {
        const alvo = evento.target;
        if (!alvo.closest('.cz-form-prato')) return;
        if (alvo.matches('[data-arquivos-foto]')) {
            acrescentarFotos(Array.from(alvo.files));
            alvo.value = '';
            return;
        }
        if (alvo.name === 'tipo' || alvo.name === 'feito_na_hora') ajustarTipoPrato();
        if (alvo.closest('[data-editor="ficha"]')) recalcularFicha();
    });

    // ------------------------------------------------------------------
    // Categorias
    // ------------------------------------------------------------------
    function abrirCategoria(c) {
        c = c || {};
        J.abrirModal({
            titulo: c.id ? 'Categoria: ' + c.nome : 'Nova categoria',
            campos: [
                { nome: 'nome', rotulo: 'Nome', valor: c.nome, obrigatorio: true, largura: 'total' },
                { nome: 'descricao', rotulo: 'Descrição (aparece na loja)', valor: c.descricao, largura: 'total' },
                { nome: 'ordem', rotulo: 'Ordem no cardápio', tipo: 'number', passo: '1', valor: c.ordem === undefined ? '' : c.ordem,
                  dica: 'Menor aparece primeiro.' },
                { nome: 'ativo', rotulo: 'Ativa?', tipo: 'checkbox', valor: c.ativo === undefined ? true : !!c.ativo, textoSim: 'Sim, aparece no cardápio' },
            ],
            aoSalvar: async function (v) {
                const r = c.id ? await api.put('/categorias/' + c.id, v) : await api.post('/categorias', v);
                avisar(mensagemDe(r, 'Categoria gravada.'));
                await carregar();
            },
        });
    }

    // ------------------------------------------------------------------
    // Grupos de adicionais
    // ------------------------------------------------------------------
    function linhaOpcaoHtml(a) {
        return '<div class="cz-opcao-linha" data-opcao-linha' + (a.id ? ' data-opcao-id="' + a.id + '"' : '') + '>' +
            '<input data-opcao-nome placeholder="Ex.: Ovo cozido" aria-label="Nome da opção" maxlength="80" value="' + escapar(a.nome || '') + '">' +
            '<label class="cz-mini"><span>R$</span><input type="number" data-opcao-preco min="0" step="0.01" inputmode="decimal" aria-label="Preço" value="' +
                escapar(a.preco === undefined ? '' : a.preco) + '"></label>' +
            '<label class="cz-mini"><span>kcal</span><input type="number" data-opcao-kcal min="0" step="1" aria-label="Calorias" value="' + escapar(a.kcal || '') + '"></label>' +
            '<label class="cz-mini"><span>prot. g</span><input type="number" data-opcao-proteinas min="0" step="0.1" aria-label="Proteínas" value="' + escapar(a.proteinas || '') + '"></label>' +
            '<label class="cz-check"><input type="checkbox" data-opcao-ativo' + (a.ativo === undefined || a.ativo ? ' checked' : '') + '> ativa</label>' +
            '<button type="button" class="botao-icone perigo" data-opcao-remover aria-label="Tirar a opção">Tirar</button>' +
        '</div>';
    }

    function abrirGrupo(g) {
        g = g || { minimo: 0, maximo: 1, ativo: 1, adicionais: [] };
        J.abrirModal({
            titulo: g.id ? 'Grupo: ' + g.nome : 'Novo grupo de adicionais',
            html: '<div class="campo-total cz-form-grupo"><div class="modal-corpo-interno">' +
                campo('g-nome', 'Nome do grupo', '<input id="cz-g-nome" name="nome" maxlength="80" value="' + escapar(g.nome || '') + '" placeholder="Ex.: Escolha o molho">', { total: true }) +
                campo('g-descricao', 'Explicação para o cliente', '<input id="cz-g-descricao" name="descricao" maxlength="200" value="' + escapar(g.descricao || '') + '">', { total: true }) +
                campo('g-minimo', 'Mínimo a escolher', '<input id="cz-g-minimo" name="minimo" type="number" min="0" max="20" step="1" value="' + g.minimo + '">',
                      { dica: '0 = opcional; 1 = obrigatório escolher pelo menos um.' }) +
                campo('g-maximo', 'Máximo a escolher', '<input id="cz-g-maximo" name="maximo" type="number" min="1" max="20" step="1" value="' + g.maximo + '">') +
                campo('g-ativo', 'Ativo', interruptor('ativo', !!g.ativo, 'Aparece nos pratos')) +
                '</div>' +
                '<h4 class="sub-titulo">Opções</h4>' +
                '<div class="cz-opcoes-editor" data-editor="opcoes">' + (g.adicionais.length ? g.adicionais : [{ ativo: 1 }]).map(linhaOpcaoHtml).join('') + '</div>' +
                '<button type="button" class="botao botao-secundario botao-pequeno" data-opcao-nova>+ Adicionar opção</button>' +
                '<small class="dica cz-bloco">Preço 0 = sem custo (ex.: escolher o molho). As calorias e a proteína somam no prato.</small>' +
                '</div>',
            aoSalvar: async function (v) {
                const adicionais = [];
                J.modalCorpo.querySelectorAll('[data-opcao-linha]').forEach(function (linha) {
                    const nome = linha.querySelector('[data-opcao-nome]').value.trim();
                    if (!nome) return;
                    adicionais.push({
                        id: linha.dataset.opcaoId ? Number(linha.dataset.opcaoId) : null, nome: nome,
                        preco: linha.querySelector('[data-opcao-preco]').value || 0,
                        kcal: linha.querySelector('[data-opcao-kcal]').value || 0,
                        proteinas: linha.querySelector('[data-opcao-proteinas]').value || 0,
                        ativo: linha.querySelector('[data-opcao-ativo]').checked ? 1 : 0,
                    });
                });
                const corpo = { nome: v.nome, descricao: v.descricao, minimo: v.minimo, maximo: v.maximo, ativo: v.ativo ? 1 : 0, adicionais: adicionais };
                const r = g.id ? await api.put('/grupos-adicionais/' + g.id, corpo) : await api.post('/grupos-adicionais', corpo);
                avisar(mensagemDe(r, 'Grupo gravado.'));
                await carregar();
            },
        });
    }

    // ------------------------------------------------------------------
    // Acoes
    // ------------------------------------------------------------------
    function pratoDe(id) { return estado.pratos.find(function (p) { return p.id === id; }); }

    N.registrarAcoes({
        'novo-prato': function () { return abrirPrato(null); },
        'editar-prato': abrirPrato,
        'publicar-prato': async function (id) {
            const p = pratoDe(id);
            if (!p) return;
            avisar(mensagemDe(await api.put('/pratos/' + id, { publicado: p.publicado ? 0 : 1 }),
                p.publicado ? 'Prato fora da loja online.' : 'Prato na loja online.'));
            await carregar();
        },
        'produzir-prato': async function (id) {
            N.mostrarSecao('producao', true);
            const p = pratoDe(id);
            const sugestao = p ? Math.max((p.estoque_minimo || estado.config.estoque_baixo) * 2 - p.disponivel, 1) : null;
            return janela.Telas.producao.novaProducao(id, sugestao);
        },
        // Prato de revenda (ou estoque inicial) entra pela tela Entradas, com a linha ja escolhida.
        'entrada-prato': function (id) {
            return janela.Telas.pedidos.novaEntrada({ tipo_item: 'prato', prato_id: id });
        },
        'ficha-prato': function (id) {
            const p = pratoDe(id);
            return janela.Telas.movimentacao.ficha({ prato_id: id }, p ? p.nome : '');
        },
        'nova-categoria': function () { return abrirCategoria(null); },
        'editar-categoria': function (id) { return abrirCategoria(estado.categorias.find(function (c) { return c.id === id; })); },
        'excluir-categoria': async function (id) {
            const c = estado.categorias.find(function (x) { return x.id === id; });
            if (!confirm('Excluir a categoria "' + (c ? c.nome : '') + '"?')) return;
            avisar(mensagemDe(await api.remover('/categorias/' + id), 'Categoria excluída.'));
            await carregar();
        },
        'novo-grupo': function () { return abrirGrupo(null); },
        'editar-grupo': function (id) { return abrirGrupo(estado.grupos.find(function (g) { return g.id === id; })); },
        'excluir-grupo': async function (id) {
            const g = estado.grupos.find(function (x) { return x.id === id; });
            if (!confirm('Excluir o grupo "' + (g ? g.nome : '') + '"? Ele sai de todos os pratos (os pedidos antigos guardam o nome).')) return;
            avisar(mensagemDe(await api.remover('/grupos-adicionais/' + id), 'Grupo excluído.'));
            await carregar();
        },
    });

    N.registrarTela('cardapio', { titulo: 'Cardápio', carregar: carregar });
    janela.Telas = janela.Telas || {};
    janela.Telas.cardapio = { carregar: carregar, abrirPrato: abrirPrato };
})(window);
