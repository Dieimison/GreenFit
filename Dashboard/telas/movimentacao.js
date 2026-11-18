// carga: usa Formato, Nucleo, Janela; publica Telas.movimentacao  (conferido por testes/front/carga.test.js)
/*
 * telas/movimentacao.js - o que entra e sai do estoque fora de compra,
 * producao e venda (vencimento, perda, degustacao, consumo da equipe,
 * reposicao, devolucao, ajuste) e a FICHA do item. Window.Telas.movimentacao.
 *
 *   abrir({ entrada_id?, depois? })            janela "Movimentar estoque"
 *   ficha({ insumo_id | prato_id | entrada_id }, titulo?)   linha do tempo com o saldo
 *   campoQuantidade(nome, rotulo, unidadeBase, valor?)      html do campo com unidade de compra
 *   lerQuantidade(nome)                        o numero JA na unidade base (g, ml, un)
 *
 * O motivo escolhe o lado do movimento (vencimento sai, reposicao entra):
 * quem preenche pensa no que aconteceu, nao em "entrada ou saida". Os
 * motivos, rotulos e lados vem do servidor (config.dominios).
 */
(function (janela) {
    'use strict';

    const { escapar, dataCurta, horaCurta, moeda } = janela.Formato;
    const N = janela.Nucleo;
    const { api, estado, mensagemDe, avisar, dominio, rotuloDe, etiqueta, vazio, cardSimples, tabelaHtml,
            quantidadeLegivel, situacaoDoLote, textoValidade, identificacaoDoLote } = N;
    const J = janela.Janela;

    const AJUDA_DO_MOTIVO = {
        reposicao: 'O fornecedor repôs sem cobrar (troca de mercadoria ruim, bonificação).',
        retorno: 'Voltou para o estoque e pode ser usado de novo.',
        devolucao: 'Saiu da loja de volta para quem vendeu.',
        vencimento: 'Passou da validade ou estragou na geladeira: vai para o descarte. O custo entra como perda.',
        perda: 'Caiu, queimou, quebrou o pote. O custo entra como perda.',
        degustacao: 'Amostra, degustação ou cortesia ao cliente. O custo entra em "Perdas e cortesias".',
        consumo_interno: 'Refeição da equipe. O custo entra em "Perdas e cortesias".',
        ajuste: 'Acerto da contagem do inventário. Escolha o lado do ajuste abaixo.',
    };

    /*
     * Unidades de compra para a unidade base do estoque: quem recebe 5 kg
     * digita 5 em "kg"; o servidor recebe 5000 (g).
     */
    function unidadesDe(base) {
        if (base === 'g') return [{ valor: 'kg', fator: 1000 }, { valor: 'g', fator: 1 }];
        if (base === 'ml') return [{ valor: 'L', fator: 1000 }, { valor: 'ml', fator: 1 }];
        if (base === 'porcao') return [{ valor: 'porções', fator: 1 }];
        return [{ valor: 'un', fator: 1 }];
    }

    /* Campo de quantidade com o seletor de unidade ao lado. valor ja na unidade base. */
    function campoQuantidade(nome, rotulo, base, valor, dica) {
        const unidades = unidadesDe(base);
        // Abre na unidade "grande" quando o valor e redondo nela (5000 g -> 5 kg).
        let escolhida = unidades[unidades.length - 1];
        let mostrar = valor === undefined || valor === null || valor === '' ? '' : Number(valor);
        if (mostrar === '' && unidades.length > 1) escolhida = unidades[0];
        if (mostrar !== '' && unidades.length > 1 && mostrar % unidades[0].fator === 0) {
            escolhida = unidades[0];
            mostrar = mostrar / unidades[0].fator;
        }
        return '<div class="campo cz-quantidade" data-quantidade="' + escapar(nome) + '" data-base="' + escapar(base) + '">' +
            '<label for="campo-' + escapar(nome) + '">' + escapar(rotulo) + '</label>' +
            '<div class="cz-quantidade-linha">' +
                '<input type="number" id="campo-' + escapar(nome) + '" data-quantidade-numero min="0" step="any" inputmode="decimal" value="' +
                    escapar(mostrar) + '">' +
                '<select data-quantidade-unidade aria-label="Unidade"' + (unidades.length === 1 ? ' disabled' : '') + '>' +
                    unidades.map(function (u) {
                        return '<option value="' + u.fator + '"' + (u === escolhida ? ' selected' : '') + '>' + escapar(u.valor) + '</option>';
                    }).join('') +
                '</select>' +
            '</div>' +
            '<small class="dica" data-quantidade-dica>' + escapar(dica || '') + '</small>' +
            '</div>';
    }

    /* Troca a unidade base de um campo de quantidade ja desenhado (insumo escolhido mudou). */
    function trocarBase(nome, base) {
        const bloco = J.modalCorpo.querySelector('[data-quantidade="' + nome + '"]');
        if (!bloco || bloco.dataset.base === base) return;
        bloco.dataset.base = base;
        const select = bloco.querySelector('[data-quantidade-unidade]');
        const unidades = unidadesDe(base);
        select.innerHTML = unidades.map(function (u, i) {
            return '<option value="' + u.fator + '"' + (i === 0 ? ' selected' : '') + '>' + escapar(u.valor) + '</option>';
        }).join('');
        select.disabled = unidades.length === 1;
    }

    /** O numero digitado convertido para a unidade base (inteiro), ou null. */
    function lerQuantidade(nome) {
        const bloco = J.modalCorpo.querySelector('[data-quantidade="' + nome + '"]');
        if (!bloco) return null;
        const digitado = String(bloco.querySelector('[data-quantidade-numero]').value).replace(',', '.').trim();
        if (digitado === '') return null;
        const n = Number(digitado) * Number(bloco.querySelector('[data-quantidade-unidade]').value);
        return isFinite(n) ? Math.round(n) : NaN;
    }

    function motivo(valor) {
        return dominio('motivos_movimentacao').find(function (m) { return m.valor === valor; });
    }

    /* Rotulo e cor de uma linha da ficha: motivo manual ou origem automatica. */
    function etiquetaDaOrigem(origem) {
        return motivo(origem) ? etiqueta('motivos_movimentacao', origem) : etiqueta('origens_estoque', origem);
    }

    /* A unidade com que um lote e contado na tela. */
    function unidadeDoLote(e) {
        return e.tipo === 'prato' ? 'porcao' : (e.unidade || 'un');
    }

    // ------------------------------------------------------------------
    // Ficha do item
    // ------------------------------------------------------------------
    async function ficha(filtro, titulo) {
        const consulta = Object.keys(filtro).map(function (k) { return k + '=' + encodeURIComponent(filtro[k]); }).join('&');
        const dados = await api.get('/movimentacoes?' + consulta);
        const movimentos = dados.movimentos || [];
        const r = dados.resumo || {};
        const unidade = dados.tipo === 'prato' ? 'porcao' : (dados.unidade || 'un');
        const q = function (n) { return quantidadeLegivel(n, unidade); };
        const custo = !!estado.config.pode_ver_custo;

        const lotes = (dados.entradas || []).filter(function (e) { return Number(e.saldo) > 0; });
        const tabela = tabelaHtml({
            colunas: ['Quando', 'Origem', 'O que aconteceu', { titulo: 'Qtd', classe: 'numero' },
                      { titulo: 'Saldo', classe: 'numero' }, { titulo: 'Ações', classe: 'coluna-acoes' }],
            linhas: movimentos.map(function (m) {
                const entrou = m.quantidade > 0;
                return [
                    dataCurta(m.data) + '<br><small class="observacao">' + escapar(horaCurta(m.data)) + '</small>',
                    etiquetaDaOrigem(m.origem),
                    escapar(m.descricao) + (m.referencia ? '<br><small class="observacao">' + escapar(m.referencia) + '</small>' : '') +
                        (custo && m.valor && !m.mov_id && m.origem === 'compra' ? '<br><small class="observacao">custo ' + moeda(m.valor) + '</small>' : ''),
                    { html: (entrou ? '+' : '−') + escapar(q(Math.abs(m.quantidade))), classe: 'numero ' + (entrou ? 'saldo-ok' : 'saldo-zero') },
                    { html: '<strong>' + escapar(q(m.saldo)) + '</strong>', classe: 'numero' },
                    { html: m.mov_id && estado.config.pode_excluir
                        ? '<button type="button" class="botao-icone perigo" data-acao="desfazer-mov" data-id="' + m.mov_id + '">Desfazer</button>'
                        : '<small class="observacao">' + (m.mov_id ? 'movimentação' : 'automático') + '</small>', classe: 'coluna-acoes' },
                ];
            }),
        });

        const lotesHtml = !filtro.entrada_id && lotes.length
            ? '<h4 class="sub-titulo">Lotes com saldo (sai primeiro o que vence antes)</h4>' +
              '<ul class="cz-lotes-ficha">' + lotes.map(function (e) {
                  const s = situacaoDoLote(e);
                  return '<li>' + etiqueta('situacoes_lote', s) + ' <strong>' + escapar(q(e.saldo)) + '</strong>' +
                      escapar(identificacaoDoLote(e) || ' · sem lote') +
                      (e.producao_numero ? ' <small class="observacao">(' + escapar(e.producao_numero) + ')</small>' : '') + '</li>';
              }).join('') + '</ul>'
            : '';

        J.abrirModal({
            titulo: 'Ficha — ' + (dados.item || titulo || 'item'),
            somenteLeitura: true,
            html: '<div class="campo-total">' +
                '<div class="stats-container cz-ficha-cards">' +
                cardSimples('Saldo agora', q(dados.saldo || 0), dados.saldo > 0 ? '--bom' : '--critico') +
                cardSimples('Total que entrou', q(r.entrou || 0), '--serie-1') +
                cardSimples('Total que saiu', q(r.saiu || 0), '--tinta-fraca') +
                cardSimples('Perdido / vencido', q(r.perdido || 0), '--critico') +
                '</div>' + lotesHtml +
                (movimentos.length ? tabela : vazio('Este item ainda não teve nenhuma movimentação.')) +
                '<p class="observacao cz-nota">Linhas <em>automáticas</em> vêm de compra, produção ou venda — para desfazer, ' +
                'mexa no documento de origem (cancele a produção, o pedido ou a venda).</p>' +
                '</div>',
        });
    }

    // ------------------------------------------------------------------
    // Movimentar estoque
    // ------------------------------------------------------------------
    function descreverLote(e) {
        return rotuloDe('tipos_entrada', e.tipo) + ': ' + e.item + identificacaoDoLote(e) +
               ' (saldo ' + quantidadeLegivel(e.saldo, unidadeDoLote(e)) + ')';
    }

    async function abrir(opcoes) {
        opcoes = opcoes || {};
        let lotes;
        if (opcoes.entrada_id) {
            lotes = [(await api.get('/entradas/' + opcoes.entrada_id)).entrada];
        } else {
            // Lote zerado entra (reposicao do fornecedor cai nele); os sem saldo vao para o fim.
            lotes = (await api.get('/entradas')).itens;
        }
        if (!lotes.length) {
            avisar('Não há lotes no estoque para movimentar.', 'erro');
            return;
        }
        const motivos = dominio('motivos_movimentacao');
        const loteInicial = lotes[0];
        // Lote vencido quase sempre vai para o descarte; o resto, o caso mais comum e a perda.
        const sugerido = opcoes.motivo || (opcoes.entrada_id && situacaoDoLote(loteInicial) === 'vencido' ? 'vencimento' : 'perda');
        const primeiro = motivo(sugerido) || motivos[0];

        const opcoesLote = (opcoes.entrada_id ? [] : [{ valor: '', rotulo: '— escolha o lote —' }]).concat(lotes.map(function (e) {
            return { valor: String(e.id), rotulo: descreverLote(e) };
        }));

        J.abrirModal({
            titulo: opcoes.entrada_id ? 'Movimentar: ' + loteInicial.item : 'Movimentar estoque',
            textoSalvar: 'Registrar',
            campos: [
                { nome: 'entrada_id', rotulo: 'Lote do estoque', tipo: 'select', valor: opcoes.entrada_id ? String(opcoes.entrada_id) : '',
                  opcoes: opcoesLote, largura: 'total' },
                { nome: 'motivo', rotulo: 'O que aconteceu?', tipo: 'select', valor: primeiro.valor,
                  opcoes: motivos.map(function (m) { return { valor: m.valor, rotulo: m.rotulo + (m.valor === 'ajuste' ? '' : (m.lado === 'saida' ? ' (sai)' : ' (entra)')) }; }),
                  dica: AJUDA_DO_MOTIVO[primeiro.valor] || ' ', largura: 'total' },
                { nome: 'tipo', rotulo: 'Lado do ajuste', tipo: 'select', valor: 'saida',
                  opcoes: [{ valor: 'entrada', rotulo: 'Sobrou: entra no estoque' }, { valor: 'saida', rotulo: 'Faltou: sai do estoque' }] },
                { tipo: 'html', nome: '__qtd', html: campoQuantidade('quantidade', 'Quantidade',
                    opcoes.entrada_id ? unidadeDoLote(loteInicial) : 'un', '', '') },
                { nome: 'observacoes', rotulo: 'Observações', tipo: 'textarea', valor: '', largura: 'total' },
            ],
            aoAbrir: function () {
                const campoLote = J.modalCorpo.querySelector('[name="entrada_id"]');
                const campoMotivo = J.modalCorpo.querySelector('[name="motivo"]');
                const campoTipo = J.modalCorpo.querySelector('[name="tipo"]');
                function ajustarLote() {
                    const e = lotes.find(function (x) { return String(x.id) === campoLote.value; });
                    trocarBase('quantidade', e ? unidadeDoLote(e) : 'un');
                    const dica = J.modalCorpo.querySelector('[data-quantidade-dica]');
                    if (dica) dica.textContent = e ? 'Saldo do lote: ' + quantidadeLegivel(e.saldo, unidadeDoLote(e)) +
                                                     (e.validade ? ' · ' + textoValidade(e.dias_validade) : '') : '';
                }
                function ajustarMotivo() {
                    const info = motivo(campoMotivo.value);
                    campoTipo.closest('.campo').classList.toggle('oculta', !info || info.valor !== 'ajuste');
                    const dica = campoMotivo.closest('.campo').querySelector('.dica');
                    if (dica && info) dica.textContent = AJUDA_DO_MOTIVO[info.valor] || ' ';
                }
                campoLote.addEventListener('change', ajustarLote);
                campoMotivo.addEventListener('change', ajustarMotivo);
                ajustarLote();
                ajustarMotivo();
            },
            aoSalvar: async function (valores) {
                const quantidade = lerQuantidade('quantidade');
                if (!quantidade || quantidade < 1) throw new Error('Informe a quantidade (maior que zero).');
                const corpo = { entrada_id: valores.entrada_id, motivo: valores.motivo, quantidade: quantidade,
                                observacoes: valores.observacoes };
                if (valores.motivo === 'ajuste') corpo.tipo = valores.tipo;
                avisar(mensagemDe(await api.post('/movimentacoes', corpo), 'Movimentação registrada.'));
                if (opcoes.depois) await opcoes.depois();
            },
        });
    }

    N.registrarAcoes({
        'nova-movimentacao': function () {
            return abrir({ depois: function () { return recarregarTelaAtual(); } });
        },
        'desfazer-mov': async function (id) {
            if (!confirm('Desfazer esta movimentação? O saldo volta ao que era antes dela.')) return;
            avisar(mensagemDe(await api.remover('/movimentacoes/' + id), 'Movimentação desfeita.'));
            J.fecharModal();
            await recarregarTelaAtual();
        },
    });

    /* Depois de mexer no estoque, a tela que estiver aberta redesenha (estoque, cadastros...). */
    function recarregarTelaAtual() {
        const t = janela.Telas || {};
        const mapa = { entradas: t.entradas, cadastros: t.cadastros, cardapio: t.cardapio, producao: t.producao };
        const tela = mapa[estado.secaoAtual];
        return tela && tela.carregar ? tela.carregar() : Promise.resolve();
    }

    janela.Telas = janela.Telas || {};
    janela.Telas.movimentacao = {
        abrir: abrir, ficha: ficha, campoQuantidade: campoQuantidade, lerQuantidade: lerQuantidade, trocarBase: trocarBase,
        unidadesDe: unidadesDe, unidadeDoLote: unidadeDoLote,
        // nome antigo (outras telas ainda podem chamar): consulta "x_id=1"
        verFichaDoItem: function (consulta, titulo) {
            const filtro = {};
            String(consulta).split('&').forEach(function (par) { const p = par.split('='); if (p[0]) filtro[p[0]] = p[1]; });
            return ficha(filtro, titulo);
        },
    };
})(window);
