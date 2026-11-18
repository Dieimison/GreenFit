// carga: usa Formato, Nucleo, Janela; publica Telas.cadastros  (conferido por testes/front/carga.test.js)
/*
 * telas/cadastros.js - Cadastros: clientes, insumos, fornecedores e formas
 * de pagamento. Window.Telas.cadastros. (Pratos, categorias e adicionais
 * moram no Cardapio.)
 *
 * As quatro listas se comportam igual: buscar, listar, editar, excluir. O
 * que muda e o desenho das colunas e o formulario: cada uma e uma
 * configuracao, nao uma tela copiada. Quem confere tudo e o servidor
 * (api/rotas/catalogo.php); a tela mostra a mensagem como veio.
 */
(function (janela) {
    'use strict';

    const { escapar, moeda, dataCurta } = janela.Formato;
    const N = janela.Nucleo;
    const { api, estado, mensagemDe, avisar, rotuloDe, opcoesDoDominio, vazio, etiquetaTexto, etiqueta, tabelaHtml,
            carregarCatalogos, quantidadeLegivel, classeSaldo } = N;
    const J = janela.Janela;
    const M = function () { return janela.Telas.movimentacao; };

    const raiz = document.getElementById('cadastrosConteudo');
    const filtro = { aba: 'clientes', busca: '', abaixoMinimo: false };

    function etiquetaAtivo(ativo, masculino) {
        return etiquetaTexto(ativo ? (masculino ? 'Ativo' : 'Ativa') : (masculino ? 'Inativo' : 'Inativa'),
                             ativo ? '--bom' : '--tinta-fraca');
    }

    /* Custo por unidade de compra (o insumo guarda o custo por g/ml/un). */
    function custoPorUnidade(c, base) {
        c = Number(c) || 0;
        if (base === 'g') return moeda(c * 1000) + '/kg';
        if (base === 'ml') return moeda(c * 1000) + '/L';
        return moeda(c) + '/un';
    }

    function camposFiscais(item) {
        return [
            { nome: '__fiscal', tipo: 'html', html: '<h4 class="sub-titulo campo-total">Dados fiscais (para a nota)</h4>' },
            { nome: 'ncm', rotulo: 'NCM', valor: item.ncm, dica: '8 números. Ex.: frango 0207.13.00; batata-doce 0714.20.00.' },
            { nome: 'cest', rotulo: 'CEST', valor: item.cest, dica: '7 números, só com substituição tributária.' },
            { nome: 'origem', rotulo: 'Origem da mercadoria', tipo: 'select', valor: item.origem === null || item.origem === undefined ? '' : String(item.origem),
              opcoes: [{ valor: '', rotulo: '— não informada —' }].concat(opcoesDoDominio('origens_mercadoria')) },
            { nome: 'gtin', rotulo: 'GTIN (código de barras)', valor: item.gtin, dica: 'O número debaixo do código de barras.' },
        ];
    }

    const CADASTROS = {
        clientes: {
            titulo: 'cliente', aba: 'Clientes', rota: '/clientes', masculino: true,
            lista: function () { return estado.clientes; },
            busca: function (c) { return [c.nome, c.telefone, c.documento, c.email, c.bairro, c.restricoes]; },
            colunas: ['Cliente', 'Contato', 'Objetivo e restrições', { titulo: 'Compras', classe: 'numero' }],
            celulas: function (c) {
                return [
                    '<strong>' + escapar(c.nome) + '</strong>' + (c.bairro ? '<br><small class="observacao">' + escapar(c.bairro) + '</small>' : ''),
                    escapar(c.telefone || '—') + (c.email ? '<br><small class="observacao">' + escapar(c.email) + '</small>' : ''),
                    (c.objetivo ? etiquetaTexto(rotuloDe('objetivos', c.objetivo), '--acento') : '<small class="observacao">—</small>') +
                        (c.restricoes ? '<br><small class="observacao">' + escapar(c.restricoes) + '</small>' : ''),
                    { html: Number(c.compras || 0) + (Number(c.compras) === 1 ? ' compra' : ' compras') +
                        '<br><small class="observacao">' + moeda(c.total_comprado || 0) +
                        (c.ultima_compra ? ' · última ' + escapar(dataCurta(c.ultima_compra)) : '') + '</small>', classe: 'numero' },
                ];
            },
            formulario: function (c) {
                c = c || {};
                return [
                    { nome: 'nome', rotulo: 'Nome', valor: c.nome, obrigatorio: true, largura: 'total' },
                    { nome: 'telefone', rotulo: 'Telefone / WhatsApp', valor: c.telefone },
                    { nome: 'email', rotulo: 'E-mail', tipo: 'email', valor: c.email },
                    { nome: 'documento', rotulo: 'CPF ou CNPJ', valor: c.documento },
                    { nome: 'bairro', rotulo: 'Bairro', valor: c.bairro },
                    { nome: 'endereco', rotulo: 'Endereço', valor: c.endereco, largura: 'total' },
                    { nome: 'objetivo', rotulo: 'Objetivo', tipo: 'select', valor: c.objetivo || '',
                      opcoes: [{ valor: '', rotulo: '— não informado —' }].concat(opcoesDoDominio('objetivos')) },
                    { nome: 'restricoes', rotulo: 'Restrições alimentares', valor: c.restricoes,
                      dica: 'Ex.: sem lactose, alergia a amendoim. A cozinha vê no pedido.' },
                    { nome: 'observacoes', rotulo: 'Observações', tipo: 'textarea', valor: c.observacoes, largura: 'total' },
                ];
            },
        },

        insumos: {
            titulo: 'insumo', aba: 'Insumos', rota: '/insumos', masculino: true, ficha: 'insumo_id',
            lista: function () {
                return estado.insumos.filter(function (i) {
                    return !filtro.abaixoMinimo || (i.ativo && i.estoque_minimo > 0 && i.saldo < i.estoque_minimo);
                });
            },
            busca: function (i) { return [i.nome, i.codigo, rotuloDe('categorias_insumo', i.categoria)]; },
            colunas: function () {
                return ['Insumo', { titulo: 'Em estoque', classe: 'numero' }]
                    .concat(estado.config.pode_ver_custo ? [{ titulo: 'Custo médio', classe: 'numero' }] : [])
                    .concat(['Fichas', 'Situação']);
            },
            celulas: function (i) {
                const abaixo = i.estoque_minimo > 0 && i.saldo < i.estoque_minimo;
                return [
                    '<strong>' + escapar(i.nome) + '</strong><br><small class="observacao">' + escapar(rotuloDe('categorias_insumo', i.categoria)) +
                        (i.codigo ? ' · cód. ' + escapar(i.codigo) : '') + '</small>',
                    { html: '<span class="' + classeSaldo(i.saldo, i.estoque_minimo) + '">' + escapar(quantidadeLegivel(i.saldo, i.unidade)) + '</span>' +
                        '<br><small class="observacao">' + (i.estoque_minimo ? 'mínimo ' + escapar(quantidadeLegivel(i.estoque_minimo, i.unidade)) : 'sem mínimo') +
                        (i.vencido > 0 ? ' · ' + escapar(quantidadeLegivel(i.vencido, i.unidade)) + ' vencido' : '') + '</small>' +
                        (abaixo ? ' ' + etiquetaTexto('comprar', '--atencao') : ''), classe: 'numero' },
                ].concat(estado.config.pode_ver_custo ? [{ html: (Number(i.custo_medio) > 0 ? escapar(custoPorUnidade(i.custo_medio, i.unidade)) : '—') +
                        '<br><small class="observacao">parado ' + moeda(i.valor_parado || 0) + '</small>', classe: 'numero' }] : [])
                  .concat([
                    i.em_fichas ? i.em_fichas + (i.em_fichas === 1 ? ' prato' : ' pratos') : '<small class="observacao">nenhuma</small>',
                    etiquetaAtivo(i.ativo, true),
                ]);
            },
            formulario: function (i) {
                i = i || {};
                const usado = i.id && (Number(i.em_fichas) > 0 || Number(i.saldo) > 0);
                return [
                    { nome: 'nome', rotulo: 'Nome do insumo', valor: i.nome, obrigatorio: true, largura: 'total' },
                    { nome: 'categoria', rotulo: 'Categoria', tipo: 'select', valor: i.categoria || 'outro', opcoes: opcoesDoDominio('categorias_insumo') },
                    { nome: 'unidade', rotulo: 'Contado em', tipo: 'select', valor: i.unidade || 'g', opcoes: opcoesDoDominio('unidades_insumo'),
                      desabilitado: !!usado,
                      dica: usado ? 'Já tem estoque ou ficha técnica: a unidade não muda (cadastre um insumo novo).'
                                  : 'A unidade do estoque: pesado em g, líquido em ml, o resto em unidades.' },
                    { tipo: 'html', nome: '__min', html: M().campoQuantidade('estoque_minimo', 'Estoque mínimo', i.unidade || 'g',
                        i.estoque_minimo || '', 'Abaixo disso o painel avisa para comprar.') },
                    { nome: 'codigo', rotulo: 'Código', valor: i.codigo },
                    { nome: 'ativo', rotulo: 'Em uso?', tipo: 'checkbox', valor: i.ativo === undefined ? true : !!i.ativo, textoSim: 'Sim, aparece nas listas' },
                    { nome: 'observacoes', rotulo: 'Observações', tipo: 'textarea', valor: i.observacoes, largura: 'total' },
                ].concat(camposFiscais(i));
            },
            aoAbrir: function () {
                const sel = J.modalCorpo.querySelector('[name="unidade"]');
                if (sel) sel.addEventListener('change', function () { M().trocarBase('estoque_minimo', sel.value); });
            },
            preparar: function (v) {
                const min = M().lerQuantidade('estoque_minimo');
                v.estoque_minimo = min === null ? 0 : min;
                if (isNaN(v.estoque_minimo)) throw new Error('Estoque mínimo inválido.');
                if (J.modalCorpo.querySelector('[name="unidade"]').disabled) delete v.unidade;
                return v;
            },
        },

        fornecedores: {
            titulo: 'fornecedor', aba: 'Fornecedores', rota: '/fornecedores', masculino: true,
            lista: function () { return estado.fornecedores; },
            busca: function (f) { return [f.nome, f.telefone, f.documento, f.email]; },
            colunas: ['Fornecedor', 'Contato', 'Documento'],
            celulas: function (f) {
                return ['<strong>' + escapar(f.nome) + '</strong>' + (f.uf ? ' <small class="observacao">' + escapar(f.uf) + '</small>' : ''),
                        escapar(f.telefone || '—') + (f.email ? '<br><small class="observacao">' + escapar(f.email) + '</small>' : ''),
                        escapar(f.documento || '—')];
            },
            formulario: function (f) {
                f = f || {};
                return [
                    { nome: 'nome', rotulo: 'Nome', valor: f.nome, obrigatorio: true, largura: 'total' },
                    { nome: 'telefone', rotulo: 'Telefone', valor: f.telefone },
                    { nome: 'documento', rotulo: 'CNPJ', valor: f.documento, dica: 'É por ele que a nota do fornecedor (XML) acha este cadastro.' },
                    { nome: 'ie', rotulo: 'Inscrição estadual', valor: f.ie },
                    { nome: 'uf', rotulo: 'UF', tipo: 'select', valor: f.uf || '',
                      opcoes: [{ valor: '', rotulo: '— não informada —' }].concat(opcoesDoDominio('ufs').map(function (u) {
                          return { valor: u.valor, rotulo: u.valor + ' - ' + u.rotulo };
                      })) },
                    { nome: 'email', rotulo: 'E-mail', tipo: 'email', valor: f.email },
                    { nome: 'endereco', rotulo: 'Endereço', valor: f.endereco, largura: 'total' },
                    { nome: 'observacoes', rotulo: 'Observações', tipo: 'textarea', valor: f.observacoes, largura: 'total' },
                ];
            },
        },

        formas: {
            titulo: 'forma de pagamento', aba: 'Formas de pagamento', rota: '/formas-pagamento', masculino: false,
            lista: function () { return estado.formasPagamento; },
            busca: function (f) { return [f.nome, rotuloDe('tipos_pagamento', f.tipo)]; },
            colunas: ['Forma', 'Tipo', 'Em uso', 'Situação'],
            celulas: function (f) {
                return [
                    '<strong>' + escapar(f.nome) + '</strong>' + (f.padrao ? ' ' + etiquetaTexto('padrão', '--acento') : '') +
                        (f.observacoes ? '<br><small class="observacao">' + escapar(f.observacoes) + '</small>' : ''),
                    escapar(rotuloDe('tipos_pagamento', f.tipo)) + (f.parcelas_padrao > 1 ? ' · ' + f.parcelas_padrao + 'x' : ''),
                    f.usos + ' registro(s)',
                    etiquetaAtivo(f.ativo, false),
                ];
            },
            formulario: function (f) {
                f = f || {};
                const tipos = opcoesDoDominio('tipos_pagamento');
                return [
                    { nome: 'nome', rotulo: 'Nome', valor: f.nome, obrigatorio: true, largura: 'total',
                      dica: 'É este texto que aparece nas listas e nos relatórios.' },
                    { nome: 'tipo', rotulo: 'Tipo', tipo: 'select', valor: f.tipo || (tipos[0] && tipos[0].valor), opcoes: tipos },
                    { nome: 'parcelas_padrao', rotulo: 'Parcelas sugeridas', tipo: 'number', valor: f.parcelas_padrao === undefined ? 1 : f.parcelas_padrao,
                      passo: '1', minimo: 1, maximo: estado.config.parcelas_max },
                ].concat(f.id ? [{ nome: 'ordem', rotulo: 'Ordem na lista', tipo: 'number', valor: f.ordem || 0, passo: '1', dica: 'Menor aparece primeiro.' }] : [])
                 .concat(estado.config.pode_admin ? [
                    { nome: 'padrao', rotulo: 'Usar como padrão nas vendas', tipo: 'checkbox', valor: !!f.padrao,
                      textoSim: 'Sim, vem marcada em toda venda nova',
                      dica: f.padrao ? 'É a padrão hoje. Para trocar, marque outra forma.' : 'Marcar aqui tira a marca da padrão atual.' },
                 ] : []).concat([
                    { nome: 'ativo', rotulo: 'Aparece nas listas?', tipo: 'checkbox', valor: f.ativo === undefined ? true : !!f.ativo,
                      textoSim: 'Sim, disponível para uso' },
                    { nome: 'observacoes', rotulo: 'Observações', tipo: 'textarea', valor: f.observacoes, largura: 'total' },
                 ]);
            },
            preparar: function (v) {
                // "padrao" so vai ligado (PUT {padrao:true} troca a padrao); desligado nao desmarca.
                if (v.padrao) v.padrao = true; else delete v.padrao;
                return v;
            },
        },
    };

    async function carregar() {
        await carregarCatalogos();
        desenhar();
    }

    function itensFiltrados() {
        const config = CADASTROS[filtro.aba];
        const busca = filtro.busca.trim().toLowerCase();
        return config.lista().filter(function (item) {
            return !busca || config.busca(item).filter(Boolean).join(' ').toLowerCase().includes(busca);
        });
    }

    function listaHtml() {
        const config = CADASTROS[filtro.aba];
        const itens = itensFiltrados();
        if (!itens.length) return vazio(config.lista().length ? 'Nada encontrado com esta busca.' : 'Nenhum ' + config.titulo + ' cadastrado ainda.');
        const colunas = typeof config.colunas === 'function' ? config.colunas() : config.colunas;
        return tabelaHtml({
            colunas: colunas.concat([{ titulo: 'Ações', classe: 'coluna-acoes' }]),
            linhas: itens.map(function (item) {
                return config.celulas(item).concat([{ classe: 'coluna-acoes', html:
                    (config.ficha ? '<button type="button" class="botao-icone" data-acao="ficha-cadastro" data-id="' + item.id + '">Ficha</button> ' : '') +
                    '<button type="button" class="botao-icone" data-acao="editar-cadastro" data-id="' + item.id + '">Editar</button>' +
                    (estado.config.pode_excluir ? ' <button type="button" class="botao-icone perigo" data-acao="excluir-cadastro" data-id="' + item.id + '">Excluir</button>' : '') }]);
            }),
        });
    }

    function desenhar() {
        const config = CADASTROS[filtro.aba];
        const descricoes = {
            clientes: 'Quem compra no balcão e na loja online. O cliente do app entra aqui no primeiro pedido confirmado.',
            insumos: 'Ingredientes e embalagens. O saldo é a soma dos lotes dentro da validade; abaixo do mínimo, o painel avisa.',
            fornecedores: 'De quem a cozinha compra. O CNPJ liga a nota (XML) ao cadastro.',
            formas: 'Como o cliente paga. Forma em uso não se exclui: desative.',
        };
        raiz.innerHTML =
            '<div class="secao-topo">' +
                '<div><p class="secao-descricao">' + escapar(descricoes[filtro.aba]) + '</p></div>' +
                '<div class="grupo-botoes">' +
                    (filtro.aba === 'insumos' ? '<button type="button" class="botao botao-secundario" data-acao="cadastro-entrada-insumo">Dar entrada</button>' : '') +
                    '<button type="button" class="botao" data-acao="novo-cadastro">+ Nov' + (config.masculino ? 'o ' : 'a ') + escapar(config.titulo) + '</button>' +
                '</div>' +
            '</div>' +
            '<div class="sub-abas cz-abas">' + Object.keys(CADASTROS).map(function (k) {
                return '<button type="button" class="sub-aba' + (filtro.aba === k ? ' ativa' : '') + '" data-aba-cadastro="' + k + '">' +
                    escapar(CADASTROS[k].aba) + '</button>';
            }).join('') + '</div>' +
            '<div class="barra-filtros">' +
                '<input type="search" id="czBuscaCadastro" placeholder="Buscar..." value="' + escapar(filtro.busca) + '">' +
                (filtro.aba === 'insumos' ? '<label class="cz-check"><input type="checkbox" id="czAbaixoMinimo"' + (filtro.abaixoMinimo ? ' checked' : '') +
                    '> Só abaixo do mínimo</label>' : '') +
            '</div>' +
            '<div class="table-section" id="czListaCadastro">' + listaHtml() + '</div>';
    }

    raiz.addEventListener('click', function (evento) {
        const aba = evento.target.closest('[data-aba-cadastro]');
        if (!aba) return;
        filtro.aba = aba.dataset.abaCadastro;
        filtro.busca = '';
        desenhar();
    });
    raiz.addEventListener('input', function (evento) {
        if (evento.target.id !== 'czBuscaCadastro') return;
        filtro.busca = evento.target.value;
        document.getElementById('czListaCadastro').innerHTML = listaHtml();
    });
    raiz.addEventListener('change', function (evento) {
        if (evento.target.id !== 'czAbaixoMinimo') return;
        filtro.abaixoMinimo = evento.target.checked;
        document.getElementById('czListaCadastro').innerHTML = listaHtml();
    });

    function abrirFormulario(item) {
        const config = CADASTROS[filtro.aba];
        const rota = config.rota;
        return J.abrirModal({
            titulo: (item ? 'Editar ' : (config.masculino ? 'Novo ' : 'Nova ')) + config.titulo,
            campos: config.formulario(item),
            aoAbrir: config.aoAbrir,
            aoSalvar: async function (valores) {
                const corpo = config.preparar ? config.preparar(valores) : valores;
                const r = item ? await api.put(rota + '/' + item.id, corpo) : await api.post(rota, corpo);
                avisar(mensagemDe(r, 'Cadastro salvo.'));
                await carregar();
            },
        });
    }

    function itemDe(id) {
        return CADASTROS[filtro.aba].lista().find(function (i) { return i.id === id; }) ||
               (filtro.aba === 'insumos' ? estado.insumos.find(function (i) { return i.id === id; }) : null);
    }

    N.registrarAcoes({
        'novo-cadastro': function () { return abrirFormulario(null); },
        'editar-cadastro': function (id) { return abrirFormulario(itemDe(id)); },
        'excluir-cadastro': async function (id) {
            const config = CADASTROS[filtro.aba];
            const item = itemDe(id);
            if (!confirm('Excluir "' + (item ? item.nome : '') + '"?')) return;
            avisar(mensagemDe(await api.remover(config.rota + '/' + id), 'Registro excluído.'));
            await carregar();
        },
        'ficha-cadastro': function (id) {
            const config = CADASTROS[filtro.aba];
            const item = itemDe(id);
            const f = {};
            f[config.ficha] = id;
            return M().ficha(f, item ? item.nome : '');
        },
        'cadastro-entrada-insumo': function () { return janela.Telas.pedidos.novaEntrada({ tipo_item: 'insumo' }); },
    });

    N.registrarTela('cadastros', { titulo: 'Cadastros', carregar: carregar });
    janela.Telas = janela.Telas || {};
    janela.Telas.cadastros = { carregar: carregar, carregarCadastros: carregar };
})(window);
