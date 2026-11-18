/*
 * testes/front/e2e/rodar.js - roteiros de tela num navegador de verdade
 * (Chromium pelo Playwright). Sobe o PROPRIO servidor numa porta livre,
 * sobre um banco temporario novo, enche com testes/fluxos.test.php e
 * confere, no computador (1366 px) e no celular (390 px):
 *
 *   - o painel: cada secao abre sem erro de JavaScript, desenha conteudo
 *     e nenhuma tela fica mais larga que o aparelho (sem rolagem lateral);
 *   - a loja do cliente: o cardapio aparece com os pratos e cabe no celular;
 *   - a tela de login: abre sem erro e cabe no celular.
 *
 * Saida: 0 = passou, 1 = falhou, 77 = sem Playwright (o rodar.php mostra
 * PULADO). Playwright: E2E_PLAYWRIGHT (caminho do pacote) ou node_modules.
 * Prints de cada tela: E2E_PRINTS (pasta), se definido.
 */
'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');
const net = require('net');
const { spawn, spawnSync } = require('child_process');

const RAIZ = path.join(__dirname, '..', '..', '..');
const PHP = process.env.E2E_PHP || 'php';
const PRINTS = process.env.E2E_PRINTS || '';

let playwright;
try {
    playwright = require(process.env.E2E_PLAYWRIGHT || 'playwright');
} catch (e) {
    console.log('PULADO: Playwright nao encontrado (defina E2E_PLAYWRIGHT com o caminho do pacote).');
    process.exit(77);
}

const SECOES = ['inicio', 'pedidos-online', 'pdv-inicio', 'producao', 'cardapio', 'entradas', 'pedidos', 'vendas', 'cadastros',
                'dashboard', 'financeiro', 'loja', 'fiscal', 'admin', 'configuracoes'];
const TAMANHOS = [['computador', 1366, 900], ['celular', 390, 844]];

function portaLivre() {
    return new Promise(function (resolver) {
        const s = net.createServer();
        s.listen(0, '127.0.0.1', function () { const p = s.address().port; s.close(function () { resolver(p); }); });
    });
}

function esperarPorta(porta) {
    return new Promise(function (resolver, rejeitar) {
        let tentativas = 0;
        (function tentar() {
            const c = net.connect(porta, '127.0.0.1', function () { c.end(); resolver(); });
            c.on('error', function () {
                if (++tentativas > 50) return rejeitar(new Error('o servidor nao subiu'));
                setTimeout(tentar, 200);
            });
        })();
    });
}

(async function principal() {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'greenfit-e2e-'));
    const banco = path.join(tmp, 'banco.sqlite');
    const ambiente = Object.assign({}, process.env, {
        GREENFIT_DB: banco, GREENFIT_BACKUPS: path.join(tmp, 'bk'), GREENFIT_LOG: path.join(tmp, 'erros.log'),
        GREENFIT_SENHA_INICIAL: 'Inicial-Teste-2026',
    });
    const instalar = spawnSync(PHP, ['dados/aplicar-estrutura.php', banco], { cwd: RAIZ, env: ambiente, encoding: 'utf8' });
    if (instalar.status !== 0) { console.log('FALHOU: instalar o banco\n' + instalar.stdout + instalar.stderr); process.exit(1); }

    const porta = await portaLivre();
    const base = 'http://127.0.0.1:' + porta;
    const servidor = spawn(PHP, ['-S', '127.0.0.1:' + porta, 'servidor.php'], { cwd: RAIZ, env: ambiente, stdio: 'ignore' });
    let falhas = 0;
    const falhar = function (texto) { falhas++; console.log('  FALHA ' + texto); };
    let navegador;
    try {
        await esperarPorta(porta);
        const fluxos = spawnSync(PHP, ['testes/fluxos.test.php'], { cwd: RAIZ, env: Object.assign({}, ambiente, { BASE_URL: base }), encoding: 'utf8' });
        if (fluxos.status !== 0) { console.log('FALHOU: encher o banco pela suite de fluxos\n' + fluxos.stdout.slice(-2000)); process.exit(1); }
        if (PRINTS) fs.mkdirSync(PRINTS, { recursive: true });

        navegador = await playwright.chromium.launch();
        for (const [nome, largura, altura] of TAMANHOS) {
            // ---------------- painel (admin) ----------------
            const ctx = await navegador.newContext({ viewport: { width: largura, height: altura }, baseURL: base });
            const login = await ctx.request.post('/api/login', { data: { usuario: 'admin', senha: 'Testador-Fit-2026' }, headers: { Origin: base } });
            if (!login.ok()) { falhar('login do admin pela API (' + login.status() + ')'); continue; }
            const pagina = await ctx.newPage();
            const erros = [];
            pagina.on('pageerror', function (e) { erros.push(e.message); });
            pagina.on('console', function (m) { if (m.type() === 'error' && !/favicon|fonts\.g/.test(m.text())) erros.push('console: ' + m.text()); });
            await pagina.goto('/Dashboard/dashboard.html#inicio');
            await pagina.waitForTimeout(1200);
            for (const secao of SECOES) {
                erros.length = 0;
                const antes = falhas;
                await pagina.evaluate(function (s) { window.Nucleo.mostrarSecao(s, true); }, secao);
                await pagina.waitForTimeout(900);
                const medida = await pagina.evaluate(function (s) {
                    const el = document.getElementById('secao-' + s);
                    return { largura: document.documentElement.scrollWidth, tela: window.innerWidth,
                             visivel: !!el && !el.classList.contains('oculta'), texto: el ? el.innerText.trim().length : 0 };
                }, secao);
                const rotulo = 'painel ' + secao + ' (' + nome + ')';
                if (!medida.visivel) falhar(rotulo + ': a secao nao abriu');
                if (medida.texto < 20) falhar(rotulo + ': a secao ficou vazia');
                if (medida.largura > medida.tela + 2) falhar(rotulo + ': mais larga que a tela (' + medida.largura + ' > ' + medida.tela + ')');
                if (erros.length) falhar(rotulo + ': erro de JavaScript: ' + erros.slice(0, 2).join(' | '));
                if (PRINTS) await pagina.screenshot({ path: path.join(PRINTS, 'painel-' + secao + '-' + nome + '.png'), fullPage: false });
                if (falhas === antes) console.log('  ok    ' + rotulo);
            }

            // ------- menu em grupos e a entrada unica (v2), pelo clique, como a pessoa faz -------
            {
                erros.length = 0;
                const antes = falhas;
                const rotulo = 'menu em grupos e entrada unica (' + nome + ')';
                const abrirMenu = async function () {
                    if (largura < 860) { await pagina.click('#abrirMenu'); await pagina.waitForTimeout(450); }
                };
                const vista = function () {
                    return pagina.evaluate(function () {
                        const aberta = Array.from(document.querySelectorAll('.secao')).find(function (s) { return !s.classList.contains('oculta'); });
                        return { secao: aberta ? aberta.id.replace('secao-', '') : null,
                                 abertos: Array.from(document.querySelectorAll('nav .menu-grupo')).filter(function (g) {
                                     return !g.querySelector('.submenu').hidden; }).map(function (g) { return g.dataset.grupo; }).join(','),
                                 aceso: (document.querySelector('nav .menu-grupo.tem-ativo') || { dataset: {} }).dataset.grupo || '',
                                 titulo: document.getElementById('tituloPagina').textContent,
                                 linhas: document.querySelectorAll('#secao-pedidos .pedido-linha').length,
                                 documento: ((document.querySelector('#secao-pedidos .secao-titulo') || {}).textContent || '').trim(),
                                 pagamento: !!document.getElementById('pedidoPago') };
                    });
                };
                await pagina.evaluate(function () { window.Nucleo.mostrarSecao('inicio', true); });
                await pagina.waitForTimeout(600);
                let v = await vista();
                if (v.abertos !== '') falhar(rotulo + ': no Inicio os grupos deviam estar fechados (abertos: ' + v.abertos + ')');
                await abrirMenu();
                await pagina.click('.menu-grupo[data-grupo="administrativo"] .menu-grupo-botao');
                await pagina.click('nav a[data-secao="fiscal"]');
                await pagina.waitForTimeout(900);
                v = await vista();
                if (v.secao !== 'fiscal' || v.abertos !== 'administrativo' || v.aceso !== 'administrativo') {
                    falhar(rotulo + ': Administrativo > Fiscal pelo clique: ' + JSON.stringify(v));
                }
                await abrirMenu();
                await pagina.click('.menu-grupo[data-grupo="cozinha"] .menu-grupo-botao');
                await pagina.click('nav a[data-secao="entradas"]');
                await pagina.waitForTimeout(1000);
                v = await vista();
                if (v.secao !== 'entradas' || v.abertos !== 'cozinha' || v.titulo !== 'Estoque') falhar(rotulo + ': Cozinha > Estoque: ' + JSON.stringify(v));
                if ((await pagina.$$('[data-acao="nova-entrada-insumo"], [data-acao="nova-entrada-prato"]')).length) {
                    falhar(rotulo + ': o Estoque ainda lanca entrada avulsa');
                }
                // O lote que veio de documento abre a Entrada dele (a suite de fluxos confirmou uma de frango).
                await pagina.click('[data-aba-estoque="insumos"]');
                await pagina.waitForTimeout(300);
                const doc = await pagina.$('[data-acao="ver-documento-entrada"]');
                if (!doc) falhar(rotulo + ': nenhum lote mostra a Entrada de origem');
                else {
                    await doc.click();
                    await pagina.waitForTimeout(1300);
                    v = await vista();
                    if (v.secao !== 'pedidos' || v.titulo !== 'Entradas' || v.documento.indexOf('PE-') !== 0) {
                        falhar(rotulo + ': "Entrada PE-..." do lote nao abriu o documento: ' + JSON.stringify(v));
                    }
                }
                // "+ Nova entrada" do Estoque: a tela Entradas, entrada nova com uma linha e o "Ja paguei".
                await pagina.evaluate(function () { window.Nucleo.mostrarSecao('entradas', true); });
                await pagina.waitForTimeout(900);
                await pagina.click('[data-acao="estoque-nova-entrada"]');
                await pagina.waitForTimeout(1300);
                v = await vista();
                if (v.secao !== 'pedidos' || v.documento.indexOf('Nova entrada') !== 0 || v.linhas !== 1 || !v.pagamento) {
                    falhar(rotulo + ': "+ Nova entrada" do Estoque: ' + JSON.stringify(v));
                }
                const largo = await pagina.evaluate(function () { return document.documentElement.scrollWidth > window.innerWidth + 2; });
                if (largo) falhar(rotulo + ': a entrada nova ficou mais larga que a tela');
                if (erros.length) falhar(rotulo + ': erro de JavaScript: ' + erros.slice(0, 2).join(' | '));
                if (PRINTS) await pagina.screenshot({ path: path.join(PRINTS, 'entrada-nova-' + nome + '.png'), fullPage: false });
                if (falhas === antes) console.log('  ok    ' + rotulo);
            }
            await ctx.close();

            // ---------------- loja do cliente e login ----------------
            for (const [tela, url, procurar] of [['loja', '/Loja/index.html', 'Frango grelhado com batata-doce'], ['login', '/Login/index.html', '']]) {
                const ctx2 = await navegador.newContext({ viewport: { width: largura, height: altura }, baseURL: base });
                const p2 = await ctx2.newPage();
                const erros2 = [];
                const antes2 = falhas;
                p2.on('pageerror', function (e) { erros2.push(e.message); });
                await p2.goto(url);
                await p2.waitForTimeout(1500);
                const m = await p2.evaluate(function (alvo) {
                    return { largura: document.documentElement.scrollWidth, tela: window.innerWidth,
                             achou: !alvo || document.body.innerText.indexOf(alvo) !== -1 };
                }, procurar);
                const rotulo = tela + ' (' + nome + ')';
                if (!m.achou) falhar(rotulo + ': nao achei "' + procurar + '" na tela');
                if (m.largura > m.tela + 2) falhar(rotulo + ': mais larga que a tela (' + m.largura + ' > ' + m.tela + ')');
                if (erros2.length) falhar(rotulo + ': erro de JavaScript: ' + erros2.slice(0, 2).join(' | '));
                if (PRINTS) await p2.screenshot({ path: path.join(PRINTS, tela + '-' + nome + '.png'), fullPage: false });
                if (falhas === antes2) console.log('  ok    ' + rotulo);
                await ctx2.close();
            }
        }
    } catch (e) {
        falhar('roteiro interrompido: ' + e.message);
    } finally {
        if (navegador) await navegador.close();
        servidor.kill();
    }
    console.log(falhas ? '\nFALHOU: ' + falhas + ' problema(s) de tela.' : '\nOK: painel, loja e login abrem sem erro e cabem no celular.');
    process.exit(falhas ? 1 : 0);
})();
