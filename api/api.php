<?php
/**
 * api/api.php - o roteador da API do Green Fit. Chamado pelo servidor.php;
 * os scripts de dados/ tambem podem inclui-lo (so define funcoes - quem
 * atende a requisicao e tratarApi()).
 *
 *   api/nucleo.php             constantes, dominios, banco, senha, validacao, sessao
 *   api/rotas/acesso.php       login, troca de senha, /config, usuarios
 *   api/rotas/painel.php       /resumo, /pdv-painel, /financeiro, /relatorios
 *   api/rotas/catalogo.php     cadastros simples (crudCatalogo + configuracao)
 *   api/rotas/pratos.php       cardapio: pratos (ficha tecnica, fotos, adicionais), grupos de adicionais
 *   api/rotas/estoque.php      entradas (lotes), movimentacoes, ficha do item, saida por lote (FIFO)
 *   api/rotas/producao.php     ordens de producao (planejar, concluir, cancelar)
 *   api/rotas/vendas.php       vendas (PDV e loja online)
 *   api/rotas/lancamentos.php  financeiro (a pagar e a receber)
 *   api/rotas/admin.php        listas de opcoes, empresa, regras por chave
 *   api/rotas/fiscal.php       dados fiscais da empresa, CFOP, naturezas de operacao
 *   api/rotas/pedidos.php      pedido de entrada (rascunho, XML da NF-e, confirmar, cancelar)
 *   api/rotas/loja.php         loja online: cardapio e conta do cliente (/api/loja/..., sessao
 *                              propria); pedidos online, ajustes e horarios (painel)
 *
 * Rotas (todas sob /api, JSON):
 *   POST /login  POST /logout  GET /sessao  GET /config  POST /trocar-senha  GET /ambiente
 *   GET /resumo  GET /pdv-painel  GET /financeiro (admin)  GET /relatorios (admin)
 *   /clientes /fornecedores /insumos /categorias /formas-pagamento /bairros (admin) /cupons (admin)
 *   /pratos  GET /fotos-prato/{id}  /grupos-adicionais
 *   /entradas  /movimentacoes  /producoes  POST /producoes/{id}/concluir|cancelar
 *   /vendas  /lancamentos (admin)  /usuarios (admin)  POST /usuarios/{id}/destravar
 *   /listas  /chaves (admin)  /empresa (admin)  /fiscal (admin)  /cfops  /naturezas
 *   /pedidos  POST /pedidos/{id}/confirmar|cancelar
 *   /encomendas  POST /encomendas/{id}/confirmar|avancar|cancelar
 *   /loja-ajustes (admin)  /horarios (admin)   /loja/... (cliente: ver api/rotas/loja.php)
 *   GET /<rota>/{id} devolve um registro, ou 404.
 *
 * Perfis: admin faz tudo. cozinha e atendimento nao entram em financeiro,
 * relatorios, lancamentos, usuarios e ajustes da loja, nao excluem nada,
 * nao estornam dinheiro e nao recebem custo nem lucro.
 *
 * Toda requisicao que muda dado precisa de JSON e de Origin (ou Referer)
 * do proprio host. Todo erro volta {"ok": false, "erro": "<frase>"}.
 */

declare(strict_types=1);

require_once __DIR__ . '/nucleo.php';
require_once __DIR__ . '/rotas/acesso.php';
require_once __DIR__ . '/rotas/painel.php';
require_once __DIR__ . '/rotas/catalogo.php';
require_once __DIR__ . '/rotas/pratos.php';
require_once __DIR__ . '/rotas/estoque.php';
require_once __DIR__ . '/rotas/producao.php';
require_once __DIR__ . '/rotas/vendas.php';
require_once __DIR__ . '/rotas/lancamentos.php';
require_once __DIR__ . '/rotas/admin.php';
require_once __DIR__ . '/rotas/fiscal.php';
require_once __DIR__ . '/rotas/pedidos.php';
require_once __DIR__ . '/rotas/loja.php';

/* Rotas com acao (/rota/{id}/acao) e as acoes que cada uma aceita. */
const ACOES_DAS_ROTAS = [
    'usuarios'   => ['destravar'],
    'pedidos'    => ['confirmar', 'cancelar'],
    'producoes'  => ['concluir', 'cancelar'],
    'encomendas' => ['confirmar', 'avancar', 'cancelar'],
];

function tratarApi(string $caminho): void
{
    // A pilha do erro nunca leva os argumentos (uma senha, por exemplo).
    ini_set('zend.exception_ignore_args', '1');
    $metodo = strtoupper($_SERVER['REQUEST_METHOD'] ?? 'GET');

    try {
        $partes = array_values(array_filter(explode('/', (string) preg_replace('#^/api/?#i', '', $caminho)), 'strlen'));
        $rota   = strtolower($partes[0] ?? '');
        $id     = null;
        $acao   = null;

        // Loja online do cliente: outra sessao, outras regras (api/rotas/loja.php).
        if ($rota === 'loja') {
            conferirOrigem($metodo);
            tratarLoja(array_slice($partes, 1), $metodo,
                       in_array($metodo, ['POST', 'PUT', 'PATCH', 'DELETE'], true) ? corpoJson() : []);
            return;
        }
        if (count($partes) > 3) {
            throw new ErroApi(404, 'Rota não encontrada: ' . $caminho);
        }
        if (isset($partes[1])) {
            // id e sempre inteiro positivo: "abc" nao vira "sem id".
            if (!ctype_digit($partes[1]) || (int) $partes[1] < 1) {
                throw new ErroApi(404, 'Registro não encontrado.');
            }
            $id = (int) $partes[1];
        }
        if (isset($partes[2])) {
            $acao = strtolower($partes[2]);
        }

        conferirOrigem($metodo);
        $corpo    = in_array($metodo, ['POST', 'PUT', 'PATCH', 'DELETE'], true) ? corpoJson() : [];
        $consulta = $_GET;

        if ($rota === 'login' && $metodo === 'POST' && $id === null) {
            login($corpo);
            return;
        }
        // Sem sessao: a tela de login e a vitrine tambem mostram a faixa "Banco de teste".
        if ($rota === 'ambiente' && $metodo === 'GET' && $id === null) {
            responder(200, ['ok' => true, 'banco_de_teste' => chaveLigada('sistema.banco_de_teste')]);
            return;
        }

        $usuario = usuarioDaSessao($expirou);
        $semSessao = $expirou ? 'Sua sessão passou de ' . intdiv(SESSAO_SEGUNDOS, 3600) . ' horas e foi encerrada. Entre de novo.' : null;

        if ($rota === 'sessao' && $metodo === 'GET') {
            if (!$usuario) {
                responder(401, ['ok' => false, 'erro' => $semSessao ?? 'Sessão expirada.']);
                return;
            }
            $usuario['trocar_senha'] = !empty($_SESSION['trocar_senha']);
            responder(200, ['ok' => true, 'usuario' => $usuario]);
            return;
        }
        if ($rota === 'logout' && $metodo === 'POST') {
            encerrarSessao();
            responder(200, ['ok' => true]);
            return;
        }
        if (!$usuario) {
            responder(401, ['ok' => false, 'erro' => $semSessao ?? 'Faça login para continuar.']);
            return;
        }
        // Senha fraca ou provisoria: so troca a senha, le a config e sai.
        if (!empty($_SESSION['trocar_senha']) && !in_array($rota, ['trocar-senha', 'config'], true)) {
            responder(403, ['ok' => false, 'erro' => 'Troque sua senha para continuar.', 'trocar_senha' => true]);
            return;
        }

        [$codigo, $resposta] = executar($rota, $id, $acao, $metodo, $corpo, $consulta, $usuario);
        if ($codigo !== 0) {
            responder($codigo, $resposta);
        }
    } catch (ErroApi $erro) {
        responder($erro->codigo, ['ok' => false, 'erro' => $erro->getMessage()] + $erro->extra);
    } catch (Throwable $erro) {
        registrarErro($erro, $metodo, $caminho);
        // Rede de seguranca: FK que estoura vira uma frase que da para agir.
        if (strpos($erro->getMessage(), 'FOREIGN KEY constraint failed') !== false) {
            responder(400, ['ok' => false, 'erro' => 'Não foi possível gravar: este registro está ligado a outro (ou '
                . 'aponta para um que não existe). Desfaça a ligação no documento que depende dele primeiro.']);
            return;
        }
        responder(500, ['ok' => false, 'erro' => 'Erro interno. Tente de novo; se continuar, avise o suporte.']);
    }
}

function executar(string $rota, ?int $id, ?string $acao, string $metodo, array $corpo, array $consulta, array $usuario): array
{
    if ($usuario['perfil'] !== 'admin') {
        if (in_array($rota, ROTAS_SO_ADMIN, true)) {
            throw new ErroApi(403, 'Seu perfil não tem acesso a esta área. Peça a um administrador.');
        }
        if ($metodo === 'DELETE') {
            throw new ErroApi(403, 'Só o administrador pode excluir registros.');
        }
    }
    if ($acao !== null && !in_array($acao, ACOES_DAS_ROTAS[$rota] ?? [], true)) {
        throw new ErroApi(404, 'Rota não encontrada.');
    }

    if (isset(catalogos()[$rota])) {
        if ($rota === 'formas-pagamento') {
            conferirQuemEscolhePadrao($id, $metodo, $corpo, $usuario);
        }
        return crudCatalogo($rota, $id, $metodo, $corpo, $consulta);
    }
    switch ($rota) {
        case 'config':
            exigir($metodo === 'GET');
            return [200, ['ok' => true, 'config' => configuracao($usuario)]];
        case 'trocar-senha':
            exigir($metodo === 'POST');
            return trocarSenha($corpo, $usuario);
        case 'resumo':
            exigir($metodo === 'GET');
            return [200, ['ok' => true] + resumo($usuario)];
        case 'pdv-painel':
            exigir($metodo === 'GET' && $id === null);
            return [200, ['ok' => true] + painelDoPdv($usuario)];
        case 'financeiro':
            exigir($metodo === 'GET');
            return [200, ['ok' => true] + financeiro()];
        case 'relatorios':
            exigir($metodo === 'GET');
            return [200, ['ok' => true] + relatorios()];
        case 'pratos':
            return pratos($id, $metodo, $corpo, $usuario, $consulta);
        case 'fotos-prato':
            exigir($metodo === 'GET');
            fotoDoPrato($id, false);
            return [0, []];   // a foto ja foi enviada (nao e JSON)
        case 'grupos-adicionais':
            return gruposAdicionais($id, $metodo, $corpo, $usuario);
        case 'entradas':
            return entradas($id, $metodo, $corpo, $usuario, $consulta);
        case 'movimentacoes':
            return movimentacoes($id, $metodo, $corpo, $usuario, $consulta);
        case 'producoes':
            return producoes($id, $acao, $metodo, $corpo, $usuario, $consulta);
        case 'vendas':
            return vendas($id, $metodo, $corpo, $usuario);
        case 'lancamentos':
            return lancamentos($id, $metodo, $corpo, $usuario, $consulta);
        case 'usuarios':
            return usuarios($id, $metodo, $corpo, $usuario, $acao);
        case 'listas':
            return listas($id, $metodo, $corpo, $consulta, $usuario);
        case 'chaves':
            return chaves($id, $metodo, $corpo, $usuario);
        case 'empresa':
            return empresa($id, $metodo, $corpo);
        case 'fiscal':
            return fiscal($id, $metodo, $corpo, $usuario);
        case 'cfops':
            return cfops($id, $metodo, $corpo, $usuario);
        case 'naturezas':
            return naturezas($id, $metodo, $corpo, $usuario);
        case 'pedidos':
            return pedidos($id, $metodo, $corpo, $usuario, $acao);
        case 'encomendas':
            return encomendasAdmin($id, $acao, $metodo, $corpo, $consulta, $usuario);
        case 'loja-ajustes':
            return ajustesDaLoja($id, $metodo, $corpo, $usuario);
        case 'horarios':
            return horariosDaLoja($id, $metodo, $corpo);
        default:
            throw new ErroApi(404, 'Rota não encontrada: /api/' . $rota);
    }
}
