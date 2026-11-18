-- ============================================================
--  GREEN FIT - Loja de comida saudável (delivery, balcão e cozinha)
--  Estrutura do banco de dados (SQLite) - versão 1
--  (a versão mora em VERSAO_BANCO, api/nucleo.php)
--
--  Este arquivo é a receita do banco NOVO: TODAS as tabelas, colunas,
--  índices, gatilhos e views que a API usa. Não rode na mão (DBeaver,
--  sqlite3): quem aplica é o
--
--      php dados\aplicar-estrutura.php
--
--  Banco novo: este arquivo inteiro + as sementes + o usuário admin.
--  Banco antigo: os passos de dados\migracoes\NNN-*.php, um por versão.
--  No fim, o banco migrado é comparado com um banco novo feito deste
--  arquivo: qualquer diferença é falha, nada é gravado.
--
--  Regra para quem mexer aqui: mudou uma TABELA (coluna, DEFAULT, CHECK,
--  FK, UNIQUE)? Suba VERSAO_BANCO e escreva o passo NNN que leva o banco
--  antigo até a mesma forma. Índices, views e gatilhos são refeitos daqui.
--
--  Nasceu do sistema da Index Celulares (mesma base: cadastro, movimento,
--  financeiro, fiscal), convertido para comida: o celular virou PRATO, a
--  peça virou INSUMO e a ordem de serviço virou ORDEM DE PRODUÇÃO.
--
--  ------------------------------------------------------------
--  COMO O BANCO ESTÁ ORGANIZADO
--
--  CADASTRO ("o que existe no mundo", não tem quantidade)
--      clientes, fornecedores, formas_pagamento
--      insumos            -> ingredientes e embalagens (g, ml ou un)
--      categorias         -> as seções do cardápio
--      pratos             -> o cardápio: nutrição, preço, validade, fotos
--      ficha_tecnica      -> quanto de cada insumo vai em UMA porção
--      grupos_adicionais, adicionais, prato_grupos -> "turbine seu prato"
--
--  MOVIMENTO ("o que entrou e o que saiu", tem quantidade)
--      entradas       -> lote que chega: insumo comprado, prato comprado
--                        pronto (revenda) ou prato PRODUZIDO na cozinha
--      producoes      -> ordem de produção: consome insumos (producao_itens)
--                        e gera um lote do prato com validade
--      movimentacoes  -> vencimento, perda, degustação, ajuste...
--      vendas         -> saída pela venda (balcão ou loja online)
--
--  FINANCEIRO
--      lancamentos, lancamentos_log
--
--  LOJA ONLINE (o "app" do cliente, estilo delivery)
--      loja_ajustes, loja_horarios, loja_bairros, cupons, loja_contas,
--      loja_enderecos, favoritos, encomendas (+ itens, adicionais,
--      eventos), cashback
--
--  O saldo NUNCA é uma coluna gravada: é calculado em vw_entradas_saldo
--  (entrou - vendido - consumido na produção + movimentações).
--
--  UNIDADES: insumo é contado em INTEIROS na unidade base dele (gramas,
--  mililitros ou unidades): 5 kg de frango = 5000 g. Assim o estoque
--  nunca guarda 4,999999 kg. O prato é contado em porções.
--  O custo do lote é o TOTAL pago (custo_total); o custo por unidade é
--  a conta custo_total / quantidade, feita na vw_entradas.
-- ============================================================

PRAGMA foreign_keys = ON;

-- ------------------------------------------------------------
-- USUÁRIOS  (quem entra no painel)
-- ------------------------------------------------------------
-- Perfis: admin faz tudo; cozinha e atendimento operam (produção, PDV,
-- pedidos), mas não veem financeiro, custo nem lucro e não excluem.
CREATE TABLE IF NOT EXISTS usuarios (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    usuario     TEXT    NOT NULL UNIQUE,
    nome        TEXT    NOT NULL,
    senha_hash  TEXT    NOT NULL,
    perfil      TEXT    NOT NULL DEFAULT 'atendimento'
                CHECK (perfil IN ('admin', 'cozinha', 'atendimento')),
    ativo       INTEGER NOT NULL DEFAULT 1 CHECK (ativo IN (0, 1)),
    ultimo_acesso TEXT,
    criado_em   TEXT    NOT NULL DEFAULT (datetime('now', 'localtime')),
    trocar_senha INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS login_tentativas (
    id       INTEGER PRIMARY KEY AUTOINCREMENT,
    usuario  TEXT    NOT NULL,
    ip       TEXT    NOT NULL DEFAULT '',
    momento  INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_login_tent_usuario ON login_tentativas (usuario, momento);
CREATE INDEX IF NOT EXISTS idx_login_tent_ip      ON login_tentativas (ip, momento);

-- ============================================================
--  CADASTROS
-- ============================================================

-- ------------------------------------------------------------
-- CLIENTES
-- ------------------------------------------------------------
-- objetivo e restricoes ajudam a cozinha e o atendimento ("sem lactose",
-- "ganhar massa"). O cliente da loja online entra aqui no 1º pedido aceito.
CREATE TABLE IF NOT EXISTS clientes (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    nome        TEXT    NOT NULL,
    telefone    TEXT,
    documento   TEXT,
    email       TEXT,
    endereco    TEXT,
    bairro      TEXT,
    objetivo    TEXT    CHECK (objetivo IS NULL OR objetivo IN ('emagrecer', 'ganhar_massa', 'manter', 'saude')),
    restricoes  TEXT,
    observacoes TEXT,
    criado_em   TEXT    NOT NULL DEFAULT (datetime('now', 'localtime'))
);

CREATE INDEX IF NOT EXISTS idx_clientes_nome     ON clientes (nome);
CREATE INDEX IF NOT EXISTS idx_clientes_telefone ON clientes (telefone);

-- ------------------------------------------------------------
-- FORNECEDORES
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS fornecedores (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    nome        TEXT    NOT NULL,
    telefone    TEXT,
    documento   TEXT,
    email       TEXT,
    endereco    TEXT,
    observacoes TEXT,
    criado_em   TEXT    NOT NULL DEFAULT (datetime('now', 'localtime')),
    ie          TEXT,
    uf          TEXT CHECK (uf IS NULL OR uf IN ('AC', 'AL', 'AP', 'AM', 'BA', 'CE', 'DF', 'ES', 'GO', 'MA', 'MT', 'MS', 'MG', 'PA', 'PB', 'PR', 'PE', 'PI', 'RJ', 'RN', 'RS', 'RO', 'RR', 'SC', 'SP', 'SE', 'TO'))
);

CREATE INDEX IF NOT EXISTS idx_fornecedores_nome ON fornecedores (nome);

-- ------------------------------------------------------------
-- FORMAS DE PAGAMENTO
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS formas_pagamento (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    nome            TEXT    NOT NULL UNIQUE,
    tipo            TEXT    NOT NULL DEFAULT 'vista'
                    CHECK (tipo IN ('vista', 'prazo', 'cartao', 'outro')),
    parcelas_padrao INTEGER NOT NULL DEFAULT 1 CHECK (parcelas_padrao > 0),
    ativo           INTEGER NOT NULL DEFAULT 1 CHECK (ativo IN (0, 1)),
    ordem           INTEGER NOT NULL DEFAULT 0,
    observacoes     TEXT,
    criado_em       TEXT    NOT NULL DEFAULT (datetime('now', 'localtime')),
    padrao          INTEGER NOT NULL DEFAULT 0 CHECK (padrao IN (0, 1))
);

CREATE INDEX IF NOT EXISTS idx_formas_ativo ON formas_pagamento (ativo, ordem);
CREATE UNIQUE INDEX IF NOT EXISTS idx_formas_padrao ON formas_pagamento (padrao) WHERE padrao = 1;

-- ------------------------------------------------------------
-- INSUMOS  (ingredientes e embalagens)
-- ------------------------------------------------------------
-- unidade é a unidade BASE do estoque: g, ml ou un. estoque_minimo está
-- nessa unidade (2000 = 2 kg de frango): abaixo dele, o painel avisa.
CREATE TABLE IF NOT EXISTS insumos (
    id             INTEGER PRIMARY KEY AUTOINCREMENT,
    nome           TEXT    NOT NULL,
    categoria      TEXT    NOT NULL DEFAULT 'outro'
                   CHECK (categoria IN ('proteina', 'carboidrato', 'legume_verdura', 'fruta', 'graos', 'laticinio',
                                        'tempero', 'bebida', 'embalagem', 'outro')),
    unidade        TEXT    NOT NULL DEFAULT 'g' CHECK (unidade IN ('g', 'ml', 'un')),
    estoque_minimo INTEGER NOT NULL DEFAULT 0 CHECK (estoque_minimo >= 0),
    codigo         TEXT,
    observacoes    TEXT,
    ativo          INTEGER NOT NULL DEFAULT 1 CHECK (ativo IN (0, 1)),
    ncm            TEXT CHECK (ncm IS NULL OR (length(ncm) = 8 AND ncm NOT GLOB '*[^0-9]*')),
    cest           TEXT CHECK (cest IS NULL OR (length(cest) = 7 AND cest NOT GLOB '*[^0-9]*')),
    origem         TEXT CHECK (origem IS NULL OR origem IN ('0', '1', '2', '3', '4', '5', '6', '7', '8')),
    gtin           TEXT,
    criado_em      TEXT    NOT NULL DEFAULT (datetime('now', 'localtime'))
);

CREATE INDEX IF NOT EXISTS idx_insumos_nome      ON insumos (nome);
CREATE INDEX IF NOT EXISTS idx_insumos_categoria ON insumos (categoria);

-- ------------------------------------------------------------
-- CATEGORIAS DO CARDÁPIO  (Marmitas fit, Bowls, Sucos...)
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS categorias (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    nome       TEXT    NOT NULL UNIQUE,
    descricao  TEXT,
    ordem      INTEGER NOT NULL DEFAULT 0,
    ativo      INTEGER NOT NULL DEFAULT 1 CHECK (ativo IN (0, 1)),
    criado_em  TEXT    NOT NULL DEFAULT (datetime('now', 'localtime'))
);

-- ------------------------------------------------------------
-- PRATOS  (o cardápio)
-- ------------------------------------------------------------
-- tipo: producao = feito na cozinha (ficha técnica + ordem de produção);
--       revenda  = comprado pronto (kombucha, barrinha) e só revendido.
-- feito_na_hora = 1: não tem lote no estoque (preparado quando o pedido
-- chega); vende enquanto estiver ativo, e o custo vem da ficha técnica.
-- Nutrição é POR PORÇÃO. tags é a lista de valores do domínio tags_prato
-- separados por vírgula ("low_carb,sem_gluten"); quem confere é a API.
-- validade_dias: quantos dias o lote produzido dura (0 = informar no lote).
-- preco é o do balcão e da loja; preco_promocional (menor) aparece como
-- "de/por" na loja online.
CREATE TABLE IF NOT EXISTS pratos (
    id                INTEGER PRIMARY KEY AUTOINCREMENT,
    nome              TEXT    NOT NULL,
    categoria_id      INTEGER REFERENCES categorias (id),
    descricao         TEXT,
    tipo              TEXT    NOT NULL DEFAULT 'producao' CHECK (tipo IN ('producao', 'revenda')),
    feito_na_hora     INTEGER NOT NULL DEFAULT 0 CHECK (feito_na_hora IN (0, 1)),
    porcao_g          INTEGER CHECK (porcao_g IS NULL OR porcao_g > 0),
    kcal              INTEGER CHECK (kcal IS NULL OR kcal >= 0),
    proteinas         REAL    CHECK (proteinas IS NULL OR proteinas >= 0),
    carboidratos      REAL    CHECK (carboidratos IS NULL OR carboidratos >= 0),
    gorduras          REAL    CHECK (gorduras IS NULL OR gorduras >= 0),
    fibras            REAL    CHECK (fibras IS NULL OR fibras >= 0),
    sodio_mg          INTEGER CHECK (sodio_mg IS NULL OR sodio_mg >= 0),
    ingredientes      TEXT,
    alergenicos       TEXT,
    tags              TEXT,
    conservacao       TEXT    NOT NULL DEFAULT 'resfriado' CHECK (conservacao IN ('congelado', 'resfriado', 'ambiente')),
    validade_dias     INTEGER NOT NULL DEFAULT 3 CHECK (validade_dias BETWEEN 0 AND 3650),
    modo_preparo      TEXT,
    preco             REAL    NOT NULL DEFAULT 0 CHECK (preco >= 0),
    preco_promocional REAL    CHECK (preco_promocional IS NULL OR preco_promocional > 0),
    estoque_minimo    INTEGER NOT NULL DEFAULT 0 CHECK (estoque_minimo >= 0),
    publicado         INTEGER NOT NULL DEFAULT 1 CHECK (publicado IN (0, 1)),
    destaque          INTEGER NOT NULL DEFAULT 0 CHECK (destaque IN (0, 1)),
    ativo             INTEGER NOT NULL DEFAULT 1 CHECK (ativo IN (0, 1)),
    ordem             INTEGER NOT NULL DEFAULT 0,
    ncm               TEXT CHECK (ncm IS NULL OR (length(ncm) = 8 AND ncm NOT GLOB '*[^0-9]*')),
    cest              TEXT CHECK (cest IS NULL OR (length(cest) = 7 AND cest NOT GLOB '*[^0-9]*')),
    origem            TEXT CHECK (origem IS NULL OR origem IN ('0', '1', '2', '3', '4', '5', '6', '7', '8')),
    unidade           TEXT    NOT NULL DEFAULT 'UN',
    gtin              TEXT,
    criado_em         TEXT    NOT NULL DEFAULT (datetime('now', 'localtime')),
    atualizado_em     TEXT    NOT NULL DEFAULT (datetime('now', 'localtime'))
);

CREATE INDEX IF NOT EXISTS idx_pratos_categoria ON pratos (categoria_id, ordem);
CREATE INDEX IF NOT EXISTS idx_pratos_nome      ON pratos (nome);

-- As fotos ficam DENTRO do banco: a cópia de segurança leva junto.
CREATE TABLE IF NOT EXISTS prato_fotos (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    prato_id   INTEGER NOT NULL REFERENCES pratos (id) ON DELETE CASCADE,
    ordem      INTEGER NOT NULL DEFAULT 0,
    tipo       TEXT    NOT NULL CHECK (tipo IN ('image/jpeg', 'image/png', 'image/webp')),
    dados      BLOB    NOT NULL,
    criado_em  TEXT    NOT NULL DEFAULT (datetime('now', 'localtime'))
);

CREATE INDEX IF NOT EXISTS idx_prato_fotos_prato ON prato_fotos (prato_id, ordem);

-- ------------------------------------------------------------
-- FICHA TÉCNICA  (a receita de UMA porção)
-- ------------------------------------------------------------
-- quantidade na unidade base do insumo (150 = 150 g de frango). A ordem de
-- produção multiplica pelo número de porções; o custo teórico do prato
-- sai daqui com o custo médio dos lotes de cada insumo.
CREATE TABLE IF NOT EXISTS ficha_tecnica (
    prato_id   INTEGER NOT NULL REFERENCES pratos  (id) ON DELETE CASCADE,
    insumo_id  INTEGER NOT NULL REFERENCES insumos (id),
    quantidade INTEGER NOT NULL CHECK (quantidade > 0),
    PRIMARY KEY (prato_id, insumo_id)
);

CREATE INDEX IF NOT EXISTS idx_ficha_insumo ON ficha_tecnica (insumo_id);

-- ------------------------------------------------------------
-- ADICIONAIS  ("Turbine seu prato", "Escolha o molho")
-- ------------------------------------------------------------
-- Um grupo diz quantos o cliente escolhe (minimo 1 = obrigatório). O
-- adicional tem preço (0 = sem custo) e nutrição, que soma no prato.
CREATE TABLE IF NOT EXISTS grupos_adicionais (
    id        INTEGER PRIMARY KEY AUTOINCREMENT,
    nome      TEXT    NOT NULL,
    descricao TEXT,
    minimo    INTEGER NOT NULL DEFAULT 0 CHECK (minimo >= 0),
    maximo    INTEGER NOT NULL DEFAULT 1 CHECK (maximo >= 1),
    ativo     INTEGER NOT NULL DEFAULT 1 CHECK (ativo IN (0, 1)),
    criado_em TEXT    NOT NULL DEFAULT (datetime('now', 'localtime')),
    CHECK (maximo >= minimo)
);

CREATE TABLE IF NOT EXISTS adicionais (
    id        INTEGER PRIMARY KEY AUTOINCREMENT,
    grupo_id  INTEGER NOT NULL REFERENCES grupos_adicionais (id) ON DELETE CASCADE,
    nome      TEXT    NOT NULL,
    preco     REAL    NOT NULL DEFAULT 0 CHECK (preco >= 0),
    kcal      INTEGER NOT NULL DEFAULT 0 CHECK (kcal >= 0),
    proteinas REAL    NOT NULL DEFAULT 0 CHECK (proteinas >= 0),
    ativo     INTEGER NOT NULL DEFAULT 1 CHECK (ativo IN (0, 1)),
    ordem     INTEGER NOT NULL DEFAULT 0
);

CREATE INDEX IF NOT EXISTS idx_adicionais_grupo ON adicionais (grupo_id, ordem);

CREATE TABLE IF NOT EXISTS prato_grupos (
    prato_id INTEGER NOT NULL REFERENCES pratos (id) ON DELETE CASCADE,
    grupo_id INTEGER NOT NULL REFERENCES grupos_adicionais (id) ON DELETE CASCADE,
    ordem    INTEGER NOT NULL DEFAULT 0,
    PRIMARY KEY (prato_id, grupo_id)
);

-- ============================================================
--  MOVIMENTO
-- ============================================================

-- ------------------------------------------------------------
-- ORDENS DE PRODUÇÃO
-- ------------------------------------------------------------
-- planejada: a lista da cozinha (não mexe no estoque).
-- concluida: os insumos saem (producao_itens, lote mais antigo primeiro)
--            e nasce o LOTE do prato (entradas.producao_id) com validade.
-- cancelada: estado final; se já estava concluída, só passa se nenhuma
--            porção do lote saiu (o lote é apagado e os insumos voltam).
CREATE TABLE IF NOT EXISTS producoes (
    id                  INTEGER PRIMARY KEY AUTOINCREMENT,
    numero              TEXT    UNIQUE,                    -- PR-2026-0001
    prato_id            INTEGER NOT NULL REFERENCES pratos (id),
    quantidade          INTEGER NOT NULL CHECK (quantidade > 0),
    status              TEXT    NOT NULL DEFAULT 'planejada'
                        CHECK (status IN ('planejada', 'concluida', 'cancelada')),
    data_producao       TEXT    NOT NULL,                  -- AAAA-MM-DD
    validade            TEXT,                              -- do lote gerado
    custo_total         REAL    NOT NULL DEFAULT 0,
    observacoes         TEXT,
    usuario_id          INTEGER REFERENCES usuarios (id),
    criado_em           TEXT    NOT NULL DEFAULT (datetime('now', 'localtime')),
    atualizado_em       TEXT    NOT NULL DEFAULT (datetime('now', 'localtime')),
    concluida_em        TEXT,
    concluida_por       INTEGER REFERENCES usuarios (id),
    cancelada_em        TEXT,
    cancelada_por       INTEGER REFERENCES usuarios (id),
    motivo_cancelamento TEXT
);

CREATE INDEX IF NOT EXISTS idx_producoes_status ON producoes (status, data_producao);
CREATE INDEX IF NOT EXISTS idx_producoes_prato  ON producoes (prato_id);

-- ------------------------------------------------------------
-- ENTRADAS  (o lote que chega ao estoque)
-- ------------------------------------------------------------
--   insumo -> insumo_id, quantidade na unidade base (g/ml/un)
--   prato  -> prato_id, em porções: comprado pronto (revenda) ou
--             produzido (producao_id aponta a ordem de produção)
-- custo_total é o que o lote custou inteiro. validade: a venda e a
-- produção pegam o lote que vence primeiro e nunca o vencido.
CREATE TABLE IF NOT EXISTS entradas (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    tipo          TEXT    NOT NULL CHECK (tipo IN ('insumo', 'prato')),
    insumo_id     INTEGER REFERENCES insumos      (id),
    prato_id      INTEGER REFERENCES pratos       (id),
    fornecedor_id INTEGER REFERENCES fornecedores (id) ON DELETE SET NULL,
    producao_id   INTEGER REFERENCES producoes    (id),
    descricao     TEXT,
    quantidade    INTEGER NOT NULL CHECK (quantidade > 0),
    custo_total   REAL    NOT NULL DEFAULT 0 CHECK (custo_total >= 0),
    lote          TEXT,
    validade      TEXT,
    nota_fiscal   TEXT,
    observacoes   TEXT,
    data_entrada  TEXT    NOT NULL DEFAULT (datetime('now', 'localtime')),
    CHECK ((tipo = 'insumo') = (insumo_id IS NOT NULL)),
    CHECK ((tipo = 'prato') = (prato_id IS NOT NULL)),
    CHECK (producao_id IS NULL OR tipo = 'prato')
);

CREATE INDEX IF NOT EXISTS idx_entradas_tipo     ON entradas (tipo);
CREATE INDEX IF NOT EXISTS idx_entradas_insumo   ON entradas (insumo_id, validade);
CREATE INDEX IF NOT EXISTS idx_entradas_prato    ON entradas (prato_id, validade);
CREATE INDEX IF NOT EXISTS idx_entradas_producao ON entradas (producao_id);
CREATE INDEX IF NOT EXISTS idx_entradas_validade ON entradas (validade);

-- O que a ordem de produção concluída consumiu, lote por lote. Custo
-- congelado na linha (o histórico não muda se o preço do insumo mudar).
CREATE TABLE IF NOT EXISTS producao_itens (
    id             INTEGER PRIMARY KEY AUTOINCREMENT,
    producao_id    INTEGER NOT NULL REFERENCES producoes (id) ON DELETE CASCADE,
    insumo_id      INTEGER NOT NULL REFERENCES insumos   (id),
    entrada_id     INTEGER NOT NULL REFERENCES entradas  (id),
    quantidade     INTEGER NOT NULL CHECK (quantidade > 0),
    custo_unitario REAL    NOT NULL DEFAULT 0,
    subtotal       REAL    NOT NULL DEFAULT 0
);

CREATE INDEX IF NOT EXISTS idx_producao_itens_producao ON producao_itens (producao_id);
CREATE INDEX IF NOT EXISTS idx_producao_itens_entrada  ON producao_itens (entrada_id);

-- ------------------------------------------------------------
-- VENDAS  (balcão e loja online: sai do estoque, entra no financeiro)
-- ------------------------------------------------------------
-- A venda da loja online é a que uma encomenda aponta (encomendas.venda_id).
CREATE TABLE IF NOT EXISTS vendas (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    numero          TEXT    UNIQUE,        -- VD-2026-0001
    cliente_id      INTEGER          REFERENCES clientes (id),
    usuario_id      INTEGER          REFERENCES usuarios (id),
    valor_bruto     REAL    NOT NULL DEFAULT 0,
    desconto        REAL    NOT NULL DEFAULT 0,
    valor_total     REAL    NOT NULL DEFAULT 0,
    custo_total     REAL    NOT NULL DEFAULT 0,
    forma_pagamento TEXT,
    parcelas        INTEGER NOT NULL DEFAULT 1 CHECK (parcelas > 0),
    status          TEXT    NOT NULL DEFAULT 'concluida'
                    CHECK (status IN ('concluida', 'cancelada')),
    data_venda      TEXT    NOT NULL DEFAULT (datetime('now', 'localtime')),
    observacoes     TEXT,
    atualizado_em   TEXT    NOT NULL DEFAULT (datetime('now', 'localtime')),
    forma_pagamento_id INTEGER REFERENCES formas_pagamento (id)
);

CREATE INDEX IF NOT EXISTS idx_vendas_data    ON vendas (data_venda);
CREATE INDEX IF NOT EXISTS idx_vendas_cliente ON vendas (cliente_id);
CREATE INDEX IF NOT EXISTS idx_vendas_status  ON vendas (status);

-- Uma linha por lote: o mesmo prato vendido de dois lotes vira duas
-- linhas. prato_id sem entrada_id = prato feito na hora; sem os dois =
-- linha avulsa (taxa de entrega, item digitado pelo admin).
CREATE TABLE IF NOT EXISTS venda_itens (
    id             INTEGER PRIMARY KEY AUTOINCREMENT,
    venda_id       INTEGER NOT NULL REFERENCES vendas   (id) ON DELETE CASCADE,
    entrada_id     INTEGER          REFERENCES entradas (id),
    prato_id       INTEGER          REFERENCES pratos   (id),
    descricao      TEXT    NOT NULL,
    adicionais     TEXT,
    quantidade     INTEGER NOT NULL DEFAULT 1 CHECK (quantidade > 0),
    valor_unitario REAL    NOT NULL DEFAULT 0,
    custo_unitario REAL    NOT NULL DEFAULT 0,
    subtotal       REAL    NOT NULL DEFAULT 0
);

CREATE INDEX IF NOT EXISTS idx_venda_itens_venda   ON venda_itens (venda_id);
CREATE INDEX IF NOT EXISTS idx_venda_itens_entrada ON venda_itens (entrada_id);
CREATE INDEX IF NOT EXISTS idx_venda_itens_prato   ON venda_itens (prato_id);

-- ------------------------------------------------------------
-- MOVIMENTAÇÕES  (o que entra e sai fora de compra, produção e venda)
-- ------------------------------------------------------------
--   reposicao        o fornecedor repôs sem cobrar        (entrada)
--   retorno          voltou para o estoque                 (entrada)
--   devolucao        devolvido ao fornecedor               (saída)
--   vencimento       passou da validade / descarte         (saída)
--   perda            caiu, quebrou, estragou               (saída)
--   degustacao       degustação, amostra ou cortesia       (saída)
--   consumo_interno  refeição da equipe                    (saída)
--   ajuste           acerto de inventário, os dois lados
CREATE TABLE IF NOT EXISTS movimentacoes (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    entrada_id    INTEGER NOT NULL REFERENCES entradas (id) ON DELETE CASCADE,
    tipo          TEXT    NOT NULL CHECK (tipo IN ('entrada', 'saida')),
    motivo        TEXT    NOT NULL DEFAULT 'ajuste'
                  CHECK (motivo IN ('reposicao', 'retorno', 'devolucao', 'vencimento', 'perda',
                                    'degustacao', 'consumo_interno', 'ajuste')),
    quantidade    INTEGER NOT NULL DEFAULT 1 CHECK (quantidade > 0),
    fornecedor_id INTEGER REFERENCES fornecedores (id) ON DELETE SET NULL,
    valor         REAL    NOT NULL DEFAULT 0,
    observacoes   TEXT,
    usuario_id    INTEGER REFERENCES usuarios (id),
    criado_em     TEXT    NOT NULL DEFAULT (datetime('now', 'localtime'))
);

CREATE INDEX IF NOT EXISTS idx_mov_entrada ON movimentacoes (entrada_id);
CREATE INDEX IF NOT EXISTS idx_mov_data    ON movimentacoes (criado_em);

-- ============================================================
--  FINANCEIRO
-- ============================================================
-- origem = 'manual'  -> digitado na tela do financeiro
--          'venda'   -> criado ao fechar uma venda (balcão ou loja)
--          'entrada' -> criado ao comprar (entrada avulsa ou pedido)
CREATE TABLE IF NOT EXISTS lancamentos (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    tipo            TEXT    NOT NULL CHECK (tipo IN ('receber', 'pagar')),
    descricao       TEXT    NOT NULL,
    categoria       TEXT,
    valor           REAL    NOT NULL DEFAULT 0,
    vencimento      TEXT,
    data_pagamento  TEXT,
    status          TEXT    NOT NULL DEFAULT 'pendente'
                    CHECK (status IN ('pendente', 'pago', 'cancelado')),
    origem          TEXT    NOT NULL DEFAULT 'manual'
                    CHECK (origem IN ('manual', 'venda', 'entrada')),
    venda_id        INTEGER REFERENCES vendas       (id) ON DELETE SET NULL,
    entrada_id      INTEGER REFERENCES entradas     (id) ON DELETE SET NULL,
    cliente_id      INTEGER REFERENCES clientes     (id) ON DELETE SET NULL,
    fornecedor_id   INTEGER REFERENCES fornecedores (id) ON DELETE SET NULL,
    forma_pagamento TEXT,
    parcela         INTEGER NOT NULL DEFAULT 1,
    total_parcelas  INTEGER NOT NULL DEFAULT 1,
    observacoes     TEXT,
    usuario_id      INTEGER REFERENCES usuarios (id),
    criado_em       TEXT    NOT NULL DEFAULT (datetime('now', 'localtime')),
    forma_pagamento_id INTEGER REFERENCES formas_pagamento (id),
    pedido_id       INTEGER REFERENCES pedidos (id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_lanc_tipo       ON lancamentos (tipo);
CREATE INDEX IF NOT EXISTS idx_lanc_status     ON lancamentos (status);
CREATE INDEX IF NOT EXISTS idx_lanc_vencimento ON lancamentos (vencimento);
CREATE INDEX IF NOT EXISTS idx_lanc_venda      ON lancamentos (venda_id);
CREATE INDEX IF NOT EXISTS idx_lanc_entrada    ON lancamentos (entrada_id);

CREATE TABLE IF NOT EXISTS lancamentos_log (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    lancamento_id INTEGER NOT NULL REFERENCES lancamentos (id) ON DELETE CASCADE,
    campo         TEXT    NOT NULL,
    valor_antes   TEXT,
    valor_depois  TEXT,
    usuario_id    INTEGER REFERENCES usuarios (id),
    criado_em     TEXT    NOT NULL DEFAULT (datetime('now', 'localtime'))
);

CREATE INDEX IF NOT EXISTS idx_lanclog_lanc ON lancamentos_log (lancamento_id, criado_em);

-- ============================================================
--  LISTAS, EMPRESA E REGRAS
-- ============================================================
CREATE TABLE IF NOT EXISTS opcoes_lista (
    id        INTEGER PRIMARY KEY AUTOINCREMENT,
    lista     TEXT    NOT NULL CHECK (lista IN ('marcas', 'categorias_lancamento')),
    valor     TEXT    NOT NULL CHECK (length(trim(valor)) > 0),
    ativo     INTEGER NOT NULL DEFAULT 1 CHECK (ativo IN (0, 1)),
    criado_em TEXT    NOT NULL DEFAULT (datetime('now', 'localtime'))
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_opcoes_lista_valor ON opcoes_lista (lista, valor COLLATE NOCASE);

CREATE TABLE IF NOT EXISTS empresas (
    id           INTEGER PRIMARY KEY AUTOINCREMENT,
    nome         TEXT    NOT NULL,
    razao_social TEXT,
    cnpj         TEXT    UNIQUE
                 CHECK (cnpj IS NULL OR (length(cnpj) = 14 AND cnpj NOT GLOB '*[^0-9A-Z]*'
                                         AND substr(cnpj, 13, 2) NOT GLOB '*[^0-9]*')),
    ativo        INTEGER NOT NULL DEFAULT 1 CHECK (ativo IN (0, 1)),
    criado_em    TEXT    NOT NULL DEFAULT (datetime('now', 'localtime'))
);

CREATE TABLE IF NOT EXISTS chaves_geral (
    chave         TEXT    PRIMARY KEY,
    valor         TEXT    NOT NULL,
    atualizado_em TEXT    NOT NULL DEFAULT (datetime('now', 'localtime')),
    usuario_id    INTEGER REFERENCES usuarios (id) ON DELETE SET NULL
);

CREATE TABLE IF NOT EXISTS chaves_empresa (
    empresa_id    INTEGER NOT NULL REFERENCES empresas (id) ON DELETE CASCADE,
    chave         TEXT    NOT NULL,
    valor         TEXT    NOT NULL,
    atualizado_em TEXT    NOT NULL DEFAULT (datetime('now', 'localtime')),
    usuario_id    INTEGER REFERENCES usuarios (id) ON DELETE SET NULL,
    PRIMARY KEY (empresa_id, chave)
);

CREATE TABLE IF NOT EXISTS chaves_historico (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    escopo     TEXT    NOT NULL CHECK (escopo IN ('geral', 'empresa')),
    empresa_id INTEGER REFERENCES empresas (id) ON DELETE SET NULL,
    chave      TEXT    NOT NULL,
    antes      TEXT,
    depois     TEXT,
    usuario_id INTEGER REFERENCES usuarios (id) ON DELETE SET NULL,
    momento    TEXT    NOT NULL DEFAULT (datetime('now', 'localtime'))
);

CREATE INDEX IF NOT EXISTS idx_chaves_hist_chave ON chaves_historico (chave, momento);

-- ============================================================
--  FISCAL: CADASTROS
-- ============================================================
-- O sistema ainda NÃO emite nota: guarda os cadastros (regime, CFOP,
-- naturezas) e registra a entrada de mercadoria com a nota do fornecedor.
CREATE TABLE IF NOT EXISTS empresa_fiscal (
    empresa_id     INTEGER PRIMARY KEY REFERENCES empresas (id) ON DELETE CASCADE,
    regime         TEXT    CHECK (regime IS NULL OR
                                  regime IN ('mei', 'simples', 'simples_excesso', 'presumido', 'real')),
    ie             TEXT,
    im             TEXT,
    cnae           TEXT,
    logradouro     TEXT,
    numero         TEXT,
    complemento    TEXT,
    bairro         TEXT,
    cep            TEXT,
    municipio_ibge TEXT    CHECK (municipio_ibge IS NULL OR
                                  (length(municipio_ibge) = 7 AND municipio_ibge NOT GLOB '*[^0-9]*')),
    municipio      TEXT,
    uf             TEXT    CHECK (uf IS NULL OR uf IN ('AC', 'AL', 'AP', 'AM', 'BA', 'CE', 'DF', 'ES', 'GO', 'MA',
                                  'MT', 'MS', 'MG', 'PA', 'PB', 'PR', 'PE', 'PI', 'RJ', 'RN', 'RS', 'RO', 'RR',
                                  'SC', 'SP', 'SE', 'TO')),
    telefone       TEXT,
    ambiente       TEXT    NOT NULL DEFAULT 'homologacao'
                           CHECK (ambiente IN ('homologacao', 'producao')),
    atualizado_em  TEXT    NOT NULL DEFAULT (datetime('now', 'localtime')),
    usuario_id     INTEGER REFERENCES usuarios (id) ON DELETE SET NULL
);

CREATE TABLE IF NOT EXISTS empresa_fiscal_historico (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    empresa_id INTEGER NOT NULL REFERENCES empresas (id) ON DELETE CASCADE,
    campo      TEXT    NOT NULL,
    antes      TEXT,
    depois     TEXT,
    usuario_id INTEGER REFERENCES usuarios (id) ON DELETE SET NULL,
    momento    TEXT    NOT NULL DEFAULT (datetime('now', 'localtime'))
);

CREATE INDEX IF NOT EXISTS idx_fiscal_hist_empresa ON empresa_fiscal_historico (empresa_id, momento);

CREATE TABLE IF NOT EXISTS cfops (
    codigo    TEXT    PRIMARY KEY
              CHECK (length(codigo) = 4 AND codigo NOT GLOB '*[^0-9]*' AND substr(codigo, 1, 1) IN ('1', '2', '3', '5', '6', '7')),
    descricao TEXT    NOT NULL,
    oficial   INTEGER NOT NULL DEFAULT 1 CHECK (oficial IN (0, 1)),
    criado_em TEXT    NOT NULL DEFAULT (datetime('now', 'localtime'))
);

CREATE TABLE IF NOT EXISTS cfop_empresa (
    empresa_id        INTEGER NOT NULL REFERENCES empresas (id) ON DELETE CASCADE,
    cfop              TEXT    NOT NULL REFERENCES cfops (codigo) ON DELETE CASCADE,
    permitido         INTEGER NOT NULL DEFAULT 1 CHECK (permitido IN (0, 1)),
    movimenta_estoque TEXT    NOT NULL DEFAULT 'nao'
                      CHECK (movimenta_estoque IN ('entra', 'sai', 'nao')),
    gera_financeiro   TEXT    NOT NULL DEFAULT 'nao'
                      CHECK (gera_financeiro IN ('pagar', 'receber', 'nao')),
    observacao        TEXT,
    atualizado_em     TEXT    NOT NULL DEFAULT (datetime('now', 'localtime')),
    PRIMARY KEY (empresa_id, cfop)
);

CREATE TABLE IF NOT EXISTS naturezas_operacao (
    id                 INTEGER PRIMARY KEY AUTOINCREMENT,
    codigo             TEXT    NOT NULL UNIQUE,
    descricao          TEXT    NOT NULL,
    sentido            TEXT    NOT NULL CHECK (sentido IN ('entrada', 'saida')),
    finalidade         TEXT    NOT NULL DEFAULT 'normal'
                       CHECK (finalidade IN ('normal', 'devolucao', 'ajuste', 'complementar')),
    cfop_interno       TEXT    REFERENCES cfops (codigo),
    cfop_interestadual TEXT    REFERENCES cfops (codigo),
    movimenta_estoque  TEXT    NOT NULL DEFAULT 'nao'
                       CHECK (movimenta_estoque IN ('entra', 'sai', 'nao')),
    gera_financeiro    TEXT    NOT NULL DEFAULT 'nao'
                       CHECK (gera_financeiro IN ('pagar', 'receber', 'nao')),
    exige_fornecedor   INTEGER NOT NULL DEFAULT 1 CHECK (exige_fornecedor IN (0, 1)),
    ativa              INTEGER NOT NULL DEFAULT 1 CHECK (ativa IN (0, 1)),
    criado_em          TEXT    NOT NULL DEFAULT (datetime('now', 'localtime'))
);

-- ============================================================
--  PEDIDO DE ENTRADA  (a mercadoria que chega com a nota)
-- ============================================================
-- Nasce RASCUNHO (digitado ou do XML da NF-e), é conferido e CONFIRMADO:
-- cada linha vira um lote em entradas e as duplicatas viram contas a
-- pagar. CANCELADO é final.
CREATE TABLE IF NOT EXISTS pedidos (
    id                  INTEGER PRIMARY KEY AUTOINCREMENT,
    numero              TEXT    UNIQUE,                 -- PE-2026-0001
    empresa_id          INTEGER NOT NULL REFERENCES empresas (id),
    natureza_id         INTEGER NOT NULL REFERENCES naturezas_operacao (id),
    cfop                TEXT    REFERENCES cfops (codigo),
    fornecedor_id       INTEGER REFERENCES fornecedores (id) ON DELETE SET NULL,
    status              TEXT    NOT NULL DEFAULT 'rascunho'
                        CHECK (status IN ('rascunho', 'confirmado', 'cancelado')),
    nota_numero         TEXT,
    nota_serie          TEXT,
    nota_chave          TEXT    CHECK (nota_chave IS NULL OR (length(nota_chave) = 44 AND nota_chave NOT GLOB '*[^0-9A-Z]*')),
    nota_emissao        TEXT,
    xml_nota            TEXT,
    data_entrada        TEXT    NOT NULL DEFAULT (datetime('now', 'localtime')),
    valor_produtos      REAL    NOT NULL DEFAULT 0,
    valor_desconto      REAL    NOT NULL DEFAULT 0,
    valor_frete         REAL    NOT NULL DEFAULT 0,
    valor_outros        REAL    NOT NULL DEFAULT 0,
    valor_total         REAL    NOT NULL DEFAULT 0,
    gerar_financeiro    INTEGER NOT NULL DEFAULT 1 CHECK (gerar_financeiro IN (0, 1)),
    forma_pagamento_id  INTEGER REFERENCES formas_pagamento (id),
    observacoes         TEXT,
    criado_por          INTEGER REFERENCES usuarios (id),
    criado_em           TEXT    NOT NULL DEFAULT (datetime('now', 'localtime')),
    atualizado_em       TEXT    NOT NULL DEFAULT (datetime('now', 'localtime')),
    confirmado_por      INTEGER REFERENCES usuarios (id),
    confirmado_em       TEXT,
    cancelado_por       INTEGER REFERENCES usuarios (id),
    cancelado_em        TEXT,
    motivo_cancelamento TEXT
);

CREATE INDEX IF NOT EXISTS idx_pedidos_status ON pedidos (status, data_entrada);
CREATE UNIQUE INDEX IF NOT EXISTS idx_pedidos_chave ON pedidos (nota_chave)
    WHERE nota_chave IS NOT NULL AND status <> 'cancelado';

-- Uma linha da nota. quantidade é a da NOTA (2,5 KG); fator converte para
-- a unidade do estoque (1 KG = 1000 g): o lote entra com quantidade x fator.
-- tipo_item NULL = ainda não ligada ao catálogo (o pedido não confirma assim).
CREATE TABLE IF NOT EXISTS pedido_itens (
    id                INTEGER PRIMARY KEY AUTOINCREMENT,
    pedido_id         INTEGER NOT NULL REFERENCES pedidos (id) ON DELETE CASCADE,
    ordem             INTEGER NOT NULL DEFAULT 1,
    tipo_item         TEXT    CHECK (tipo_item IS NULL OR tipo_item IN ('insumo', 'prato')),
    insumo_id         INTEGER REFERENCES insumos (id) ON DELETE SET NULL,
    prato_id          INTEGER REFERENCES pratos  (id) ON DELETE SET NULL,
    descricao         TEXT    NOT NULL,
    codigo_fornecedor TEXT,
    gtin              TEXT,
    ncm               TEXT,
    cest              TEXT,
    cfop_nota         TEXT,
    unidade           TEXT,
    quantidade        REAL    NOT NULL DEFAULT 1 CHECK (quantidade > 0),
    fator             INTEGER NOT NULL DEFAULT 1 CHECK (fator >= 1),
    valor_total       REAL    NOT NULL DEFAULT 0,
    valor_desconto    REAL    NOT NULL DEFAULT 0,
    lote              TEXT,
    validade          TEXT,
    entrada_id        INTEGER REFERENCES entradas (id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_pedido_itens_pedido ON pedido_itens (pedido_id, ordem);

CREATE TABLE IF NOT EXISTS pedido_parcelas (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    pedido_id  INTEGER NOT NULL REFERENCES pedidos (id) ON DELETE CASCADE,
    numero     TEXT,
    vencimento TEXT    NOT NULL,
    valor      REAL    NOT NULL CHECK (valor > 0)
);

-- "O código X deste fornecedor é o insumo Y, e 1 unidade da nota = N g":
-- aprendido ao confirmar, sugerido na próxima nota.
CREATE TABLE IF NOT EXISTS vinculos_fornecedor (
    fornecedor_id     INTEGER NOT NULL REFERENCES fornecedores (id) ON DELETE CASCADE,
    codigo_fornecedor TEXT    NOT NULL,
    tipo_item         TEXT    NOT NULL CHECK (tipo_item IN ('insumo', 'prato')),
    insumo_id         INTEGER REFERENCES insumos (id) ON DELETE CASCADE,
    prato_id          INTEGER REFERENCES pratos  (id) ON DELETE CASCADE,
    fator             INTEGER NOT NULL DEFAULT 1 CHECK (fator >= 1),
    atualizado_em     TEXT    NOT NULL DEFAULT (datetime('now', 'localtime')),
    PRIMARY KEY (fornecedor_id, codigo_fornecedor)
);

-- ============================================================
--  LOJA ONLINE  (o app do cliente)
-- ============================================================
-- O cliente monta o pedido pelo cardápio (pratos publicados), escolhe
-- entrega (bairros atendidos) ou retirada, paga por Pix agora ou na
-- entrega. O pedido RESERVA as porções até a loja aceitar; no aceite
-- nasce a venda (estoque baixa pelo lote que vence primeiro + conta a
-- receber), pela mesma função do PDV.

-- Uma linha só (id = 1).
CREATE TABLE IF NOT EXISTS loja_ajustes (
    id                     INTEGER PRIMARY KEY CHECK (id = 1),
    aberta                 INTEGER NOT NULL DEFAULT 0 CHECK (aberta IN (0, 1)),
    nome_vitrine           TEXT,
    slogan                 TEXT,
    mensagem_aviso         TEXT,
    pedido_minimo          REAL    NOT NULL DEFAULT 0 CHECK (pedido_minimo >= 0),
    frete_gratis_acima     REAL    NOT NULL DEFAULT 0 CHECK (frete_gratis_acima >= 0),
    tempo_preparo_min      INTEGER NOT NULL DEFAULT 40 CHECK (tempo_preparo_min BETWEEN 5 AND 600),
    aceita_entrega         INTEGER NOT NULL DEFAULT 1 CHECK (aceita_entrega IN (0, 1)),
    aceita_retirada        INTEGER NOT NULL DEFAULT 1 CHECK (aceita_retirada IN (0, 1)),
    endereco_retirada      TEXT,
    aceita_pix             INTEGER NOT NULL DEFAULT 1 CHECK (aceita_pix IN (0, 1)),
    aceita_pagamento_entrega INTEGER NOT NULL DEFAULT 1 CHECK (aceita_pagamento_entrega IN (0, 1)),
    prazo_pagamento_min    INTEGER NOT NULL DEFAULT 30 CHECK (prazo_pagamento_min BETWEEN 5 AND 1440),
    chave_pix              TEXT,
    recebedor_pix          TEXT,
    whatsapp               TEXT,
    instagram              TEXT,
    cashback_percentual    INTEGER NOT NULL DEFAULT 0 CHECK (cashback_percentual BETWEEN 0 AND 30),
    aceita_agendamento     INTEGER NOT NULL DEFAULT 1 CHECK (aceita_agendamento IN (0, 1)),
    atualizado_em          TEXT    NOT NULL DEFAULT (datetime('now', 'localtime')),
    usuario_id             INTEGER REFERENCES usuarios (id) ON DELETE SET NULL
);

-- Horário de funcionamento por dia da semana (0 = domingo). Fora dele o
-- pedido só entra AGENDADO (se a loja aceita agendamento).
CREATE TABLE IF NOT EXISTS loja_horarios (
    dia    INTEGER PRIMARY KEY CHECK (dia BETWEEN 0 AND 6),
    aberto INTEGER NOT NULL DEFAULT 1 CHECK (aberto IN (0, 1)),
    abre   TEXT    NOT NULL DEFAULT '11:00' CHECK (abre GLOB '[0-2][0-9]:[0-5][0-9]'),
    fecha  TEXT    NOT NULL DEFAULT '21:00' CHECK (fecha GLOB '[0-2][0-9]:[0-5][0-9]')
);

-- Bairros atendidos, cada um com a taxa e o tempo de viagem.
CREATE TABLE IF NOT EXISTS loja_bairros (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    nome       TEXT    NOT NULL,
    cidade     TEXT    NOT NULL DEFAULT 'Florianópolis',
    taxa       REAL    NOT NULL DEFAULT 0 CHECK (taxa >= 0),
    tempo_min  INTEGER NOT NULL DEFAULT 15 CHECK (tempo_min BETWEEN 0 AND 300),
    ativo      INTEGER NOT NULL DEFAULT 1 CHECK (ativo IN (0, 1)),
    criado_em  TEXT    NOT NULL DEFAULT (datetime('now', 'localtime')),
    UNIQUE (nome, cidade)
);

-- Cupons: percentual (10 = 10%), valor (R$) ou frete (entrega grátis).
CREATE TABLE IF NOT EXISTS cupons (
    id                 INTEGER PRIMARY KEY AUTOINCREMENT,
    codigo             TEXT    NOT NULL UNIQUE COLLATE NOCASE CHECK (length(codigo) BETWEEN 3 AND 20),
    descricao          TEXT,
    tipo               TEXT    NOT NULL DEFAULT 'percentual' CHECK (tipo IN ('percentual', 'valor', 'frete')),
    valor              REAL    NOT NULL DEFAULT 0 CHECK (valor >= 0),
    pedido_minimo      REAL    NOT NULL DEFAULT 0 CHECK (pedido_minimo >= 0),
    inicio             TEXT,
    fim                TEXT,
    limite_usos        INTEGER CHECK (limite_usos IS NULL OR limite_usos > 0),
    limite_por_cliente INTEGER NOT NULL DEFAULT 1 CHECK (limite_por_cliente > 0),
    primeira_compra    INTEGER NOT NULL DEFAULT 0 CHECK (primeira_compra IN (0, 1)),
    ativo              INTEGER NOT NULL DEFAULT 1 CHECK (ativo IN (0, 1)),
    criado_em          TEXT    NOT NULL DEFAULT (datetime('now', 'localtime')),
    CHECK (tipo <> 'percentual' OR valor <= 100)
);

-- A conta do cliente (não é a tabela usuarios: nunca abre o painel).
-- objetivo, meta_kcal e restricoes personalizam o cardápio ("cabe na sua meta").
CREATE TABLE IF NOT EXISTS loja_contas (
    id               INTEGER PRIMARY KEY AUTOINCREMENT,
    email            TEXT    NOT NULL UNIQUE COLLATE NOCASE,
    nome             TEXT    NOT NULL,
    telefone         TEXT    NOT NULL,
    cpf              TEXT    CHECK (cpf IS NULL OR (length(cpf) = 11 AND cpf NOT GLOB '*[^0-9]*')),
    senha_hash       TEXT    NOT NULL,
    cliente_id       INTEGER REFERENCES clientes (id) ON DELETE SET NULL,
    objetivo         TEXT    CHECK (objetivo IS NULL OR objetivo IN ('emagrecer', 'ganhar_massa', 'manter', 'saude')),
    meta_kcal        INTEGER CHECK (meta_kcal IS NULL OR meta_kcal BETWEEN 800 AND 6000),
    restricoes       TEXT,
    aceita_novidades INTEGER NOT NULL DEFAULT 0 CHECK (aceita_novidades IN (0, 1)),
    ativo            INTEGER NOT NULL DEFAULT 1 CHECK (ativo IN (0, 1)),
    criado_em        TEXT    NOT NULL DEFAULT (datetime('now', 'localtime')),
    ultimo_acesso    TEXT
);

-- Endereços guardados na conta (o pedido COPIA o endereço).
CREATE TABLE IF NOT EXISTS loja_enderecos (
    id           INTEGER PRIMARY KEY AUTOINCREMENT,
    conta_id     INTEGER NOT NULL REFERENCES loja_contas (id) ON DELETE CASCADE,
    apelido      TEXT,
    destinatario TEXT    NOT NULL,
    cep          TEXT    CHECK (cep IS NULL OR (length(cep) = 8 AND cep NOT GLOB '*[^0-9]*')),
    logradouro   TEXT    NOT NULL,
    numero       TEXT    NOT NULL,
    complemento  TEXT,
    referencia   TEXT,
    bairro_id    INTEGER REFERENCES loja_bairros (id) ON DELETE SET NULL,
    bairro       TEXT    NOT NULL,
    cidade       TEXT    NOT NULL,
    uf           TEXT    NOT NULL DEFAULT 'SC' CHECK (uf IN ('AC', 'AL', 'AP', 'AM', 'BA', 'CE', 'DF', 'ES', 'GO', 'MA',
                                                 'MT', 'MS', 'MG', 'PA', 'PB', 'PR', 'PE', 'PI', 'RJ', 'RN', 'RS', 'RO', 'RR',
                                                 'SC', 'SP', 'SE', 'TO')),
    criado_em    TEXT    NOT NULL DEFAULT (datetime('now', 'localtime'))
);

CREATE INDEX IF NOT EXISTS idx_loja_enderecos_conta ON loja_enderecos (conta_id);

CREATE TABLE IF NOT EXISTS favoritos (
    conta_id  INTEGER NOT NULL REFERENCES loja_contas (id) ON DELETE CASCADE,
    prato_id  INTEGER NOT NULL REFERENCES pratos (id) ON DELETE CASCADE,
    criado_em TEXT    NOT NULL DEFAULT (datetime('now', 'localtime')),
    PRIMARY KEY (conta_id, prato_id)
);

-- ------------------------------------------------------------
-- ENCOMENDAS  (o pedido do cliente da loja online)
-- ------------------------------------------------------------
-- Pix: aguardando_pagamento -> (a loja confere o Pix) -> confirmado
-- Na entrega: aguardando_aceite -> (a loja aceita) -> confirmado
-- Depois: em_preparo -> pronto -> saiu_entrega -> entregue
--         (retirada: pronto -> entregue). cancelada sai de qualquer ponto
-- antes de entregue. venda_id = a venda criada no "confirmado".
CREATE TABLE IF NOT EXISTS encomendas (
    id                   INTEGER PRIMARY KEY AUTOINCREMENT,
    numero               TEXT    UNIQUE,          -- GF-2026-0001
    conta_id             INTEGER NOT NULL REFERENCES loja_contas (id),
    status               TEXT    NOT NULL DEFAULT 'aguardando_aceite'
                         CHECK (status IN ('aguardando_pagamento', 'aguardando_aceite', 'confirmado', 'em_preparo',
                                           'pronto', 'saiu_entrega', 'entregue', 'cancelada')),
    tipo_entrega         TEXT    NOT NULL DEFAULT 'entrega' CHECK (tipo_entrega IN ('entrega', 'retirada')),
    pagamento            TEXT    NOT NULL DEFAULT 'pix'
                         CHECK (pagamento IN ('pix', 'cartao_entrega', 'dinheiro_entrega', 'vr_entrega')),
    troco_para           REAL    CHECK (troco_para IS NULL OR troco_para > 0),
    valor_produtos       REAL    NOT NULL DEFAULT 0,
    desconto             REAL    NOT NULL DEFAULT 0,
    cashback_usado       REAL    NOT NULL DEFAULT 0,
    taxa_entrega         REAL    NOT NULL DEFAULT 0,
    valor_total          REAL    NOT NULL DEFAULT 0,
    cupom_id             INTEGER REFERENCES cupons (id) ON DELETE SET NULL,
    cupom_codigo         TEXT,
    bairro_id            INTEGER REFERENCES loja_bairros (id) ON DELETE SET NULL,
    entrega_destinatario TEXT,
    entrega_cep          TEXT,
    entrega_logradouro   TEXT,
    entrega_numero       TEXT,
    entrega_complemento  TEXT,
    entrega_referencia   TEXT,
    entrega_bairro       TEXT,
    entrega_cidade       TEXT,
    entrega_uf           TEXT,
    entrega_telefone     TEXT,
    observacoes          TEXT,
    agendado_para        TEXT,                    -- AAAA-MM-DD HH:MM; NULL = o quanto antes
    pagar_ate            TEXT,                    -- só no Pix: depois disso a reserva cai
    previsao             TEXT,                    -- hora prevista de entrega/retirada
    venda_id             INTEGER REFERENCES vendas (id) ON DELETE SET NULL,
    motivo_cancelamento  TEXT,
    avaliacao_nota       INTEGER CHECK (avaliacao_nota IS NULL OR avaliacao_nota BETWEEN 1 AND 5),
    avaliacao_comentario TEXT,
    avaliado_em          TEXT,
    cashback_gerado      REAL    NOT NULL DEFAULT 0,
    criado_em            TEXT    NOT NULL DEFAULT (datetime('now', 'localtime')),
    atualizado_em        TEXT    NOT NULL DEFAULT (datetime('now', 'localtime')),
    CHECK (tipo_entrega = 'retirada' OR (entrega_logradouro IS NOT NULL AND entrega_bairro IS NOT NULL))
);

CREATE INDEX IF NOT EXISTS idx_encomendas_conta  ON encomendas (conta_id, criado_em);
CREATE INDEX IF NOT EXISTS idx_encomendas_status ON encomendas (status, pagar_ate);
CREATE INDEX IF NOT EXISTS idx_encomendas_venda  ON encomendas (venda_id);
CREATE INDEX IF NOT EXISTS idx_encomendas_cupom  ON encomendas (cupom_id);

-- O prato com o preço JÁ somado aos adicionais (valor_unitario), a
-- observação do cliente ("sem cebola") e a nutrição congelada no pedido.
CREATE TABLE IF NOT EXISTS encomenda_itens (
    id             INTEGER PRIMARY KEY AUTOINCREMENT,
    encomenda_id   INTEGER NOT NULL REFERENCES encomendas (id) ON DELETE CASCADE,
    prato_id       INTEGER NOT NULL REFERENCES pratos (id),
    descricao      TEXT    NOT NULL,
    quantidade     INTEGER NOT NULL CHECK (quantidade > 0),
    valor_unitario REAL    NOT NULL CHECK (valor_unitario >= 0),
    subtotal       REAL    NOT NULL,
    observacao     TEXT,
    kcal           INTEGER,
    proteinas      REAL,
    carboidratos   REAL,
    gorduras       REAL
);

CREATE INDEX IF NOT EXISTS idx_encomenda_itens_encomenda ON encomenda_itens (encomenda_id);
CREATE INDEX IF NOT EXISTS idx_encomenda_itens_prato     ON encomenda_itens (prato_id);

CREATE TABLE IF NOT EXISTS encomenda_item_adicionais (
    id           INTEGER PRIMARY KEY AUTOINCREMENT,
    item_id      INTEGER NOT NULL REFERENCES encomenda_itens (id) ON DELETE CASCADE,
    adicional_id INTEGER REFERENCES adicionais (id) ON DELETE SET NULL,
    grupo        TEXT,
    nome         TEXT    NOT NULL,
    preco        REAL    NOT NULL DEFAULT 0,
    quantidade   INTEGER NOT NULL DEFAULT 1 CHECK (quantidade > 0)
);

CREATE INDEX IF NOT EXISTS idx_enc_item_adic ON encomenda_item_adicionais (item_id);

-- O acompanhamento que o cliente vê: um evento por passo.
CREATE TABLE IF NOT EXISTS encomenda_eventos (
    id           INTEGER PRIMARY KEY AUTOINCREMENT,
    encomenda_id INTEGER NOT NULL REFERENCES encomendas (id) ON DELETE CASCADE,
    status       TEXT    NOT NULL,
    momento      TEXT    NOT NULL DEFAULT (datetime('now', 'localtime')),
    observacao   TEXT,
    usuario_id   INTEGER REFERENCES usuarios (id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_encomenda_eventos ON encomenda_eventos (encomenda_id, id);

-- Fidelidade: crédito de X% de cada pedido entregue, usado como desconto
-- no próximo. Saldo = créditos + estornos - usos.
CREATE TABLE IF NOT EXISTS cashback (
    id           INTEGER PRIMARY KEY AUTOINCREMENT,
    conta_id     INTEGER NOT NULL REFERENCES loja_contas (id) ON DELETE CASCADE,
    encomenda_id INTEGER REFERENCES encomendas (id) ON DELETE SET NULL,
    tipo         TEXT    NOT NULL CHECK (tipo IN ('credito', 'uso', 'estorno')),
    valor        REAL    NOT NULL CHECK (valor > 0),
    descricao    TEXT,
    criado_em    TEXT    NOT NULL DEFAULT (datetime('now', 'localtime'))
);

CREATE INDEX IF NOT EXISTS idx_cashback_conta ON cashback (conta_id, criado_em);

-- ============================================================
--  VIEWS
-- ============================================================
-- O aplicar-estrutura.php apaga e recria as views a cada migração,
-- nesta ordem (uma view pode ler a de cima).

-- As SAÍDAS de estoque: venda concluída e produção concluída. A regra de
-- quando um documento consome o lote mora AQUI e só aqui.
CREATE VIEW vw_saidas_estoque AS
SELECT vi.entrada_id, 'venda' AS origem, vi.quantidade, v.data_venda AS data,
       v.id AS venda_id, NULL AS producao_id, vi.valor_unitario
  FROM venda_itens vi
  JOIN vendas v ON v.id = vi.venda_id AND v.status = 'concluida'
 WHERE vi.entrada_id IS NOT NULL
UNION ALL
SELECT pi.entrada_id, 'producao', pi.quantidade, COALESCE(p.concluida_em, p.data_producao), NULL, p.id, pi.custo_unitario
  FROM producao_itens pi
  JOIN producoes p ON p.id = pi.producao_id AND p.status = 'concluida';

-- Saldo de cada lote: entrou - vendido - consumido na produção
-- + movimentações de entrada - movimentações de saída.
CREATE VIEW vw_entradas_saldo AS
SELECT e.id                    AS entrada_id,
       e.quantidade            AS quantidade,
       COALESCE(s.vendido, 0)  AS vendido,
       COALESCE(s.produzido, 0) AS usado_producao,
       COALESCE(m.entrou, 0)   AS mov_entrada,
       COALESCE(m.saiu, 0)     AS mov_saida,
       e.quantidade - COALESCE(s.vendido, 0) - COALESCE(s.produzido, 0)
                    + COALESCE(m.entrou, 0) - COALESCE(m.saiu, 0) AS saldo
  FROM entradas e
  LEFT JOIN (SELECT entrada_id,
                    SUM(CASE WHEN origem = 'venda'    THEN quantidade ELSE 0 END) AS vendido,
                    SUM(CASE WHEN origem = 'producao' THEN quantidade ELSE 0 END) AS produzido
               FROM vw_saidas_estoque
              GROUP BY entrada_id) s ON s.entrada_id = e.id
  LEFT JOIN (SELECT entrada_id,
                    SUM(CASE WHEN tipo = 'entrada' THEN quantidade ELSE 0 END) AS entrou,
                    SUM(CASE WHEN tipo = 'saida'   THEN quantidade ELSE 0 END) AS saiu
               FROM movimentacoes
              GROUP BY entrada_id) m ON m.entrada_id = e.id;

-- O lote com o nome do item, a unidade, o custo por unidade, o saldo e
-- quantos dias faltam para vencer (negativo = vencido).
CREATE VIEW vw_entradas AS
SELECT e.id,
       e.tipo,
       COALESCE(i.nome, p.nome)                         AS item,
       e.insumo_id, e.prato_id,
       CASE e.tipo WHEN 'insumo' THEN i.unidade ELSE 'un' END AS unidade,
       CASE e.tipo WHEN 'insumo' THEN i.categoria ELSE c.nome END AS categoria,
       e.fornecedor_id,
       f.nome                                           AS fornecedor,
       e.producao_id,
       pr.numero                                        AS producao_numero,
       e.descricao,
       e.quantidade,
       COALESCE(s.saldo, e.quantidade)                  AS saldo,
       e.custo_total,
       CASE WHEN e.quantidade > 0 THEN e.custo_total / e.quantidade ELSE 0 END AS custo_unitario,
       e.lote,
       e.validade,
       CASE WHEN e.validade IS NULL THEN NULL
            ELSE CAST(julianday(e.validade) - julianday(date('now', 'localtime')) AS INTEGER) END AS dias_validade,
       e.nota_fiscal, e.observacoes,
       e.data_entrada
  FROM entradas e
  LEFT JOIN insumos      i  ON i.id  = e.insumo_id
  LEFT JOIN pratos       p  ON p.id  = e.prato_id
  LEFT JOIN categorias   c  ON c.id  = p.categoria_id
  LEFT JOIN fornecedores f  ON f.id  = e.fornecedor_id
  LEFT JOIN producoes    pr ON pr.id = e.producao_id
  LEFT JOIN vw_entradas_saldo s ON s.entrada_id = e.id;

-- O estoque de cada prato: porções em lotes dentro da validade (o que dá
-- para vender), vencendo em até 2 dias e já vencidas (não vendem).
CREATE VIEW vw_estoque_pratos AS
SELECT p.id AS prato_id,
       COALESCE(SUM(CASE WHEN e.saldo > 0 AND (e.dias_validade IS NULL OR e.dias_validade >= 0) THEN e.saldo END), 0) AS disponivel,
       COALESCE(SUM(CASE WHEN e.saldo > 0 AND e.dias_validade BETWEEN 0 AND 2 THEN e.saldo END), 0) AS vencendo,
       COALESCE(SUM(CASE WHEN e.saldo > 0 AND e.dias_validade < 0 THEN e.saldo END), 0) AS vencido,
       MIN(CASE WHEN e.saldo > 0 AND (e.dias_validade IS NULL OR e.dias_validade >= 0) THEN e.validade END) AS proxima_validade
  FROM pratos p
  LEFT JOIN vw_entradas e ON e.prato_id = p.id
 GROUP BY p.id;

-- O estoque de cada insumo (na unidade base) e o custo médio dos lotes
-- com saldo (sem saldo: o do último lote comprado).
CREATE VIEW vw_estoque_insumos AS
SELECT i.id AS insumo_id,
       COALESCE(SUM(CASE WHEN e.saldo > 0 AND (e.dias_validade IS NULL OR e.dias_validade >= 0) THEN e.saldo END), 0) AS disponivel,
       COALESCE(SUM(CASE WHEN e.saldo > 0 AND e.dias_validade < 0 THEN e.saldo END), 0) AS vencido,
       COALESCE(SUM(CASE WHEN e.saldo > 0 THEN e.saldo * e.custo_unitario END), 0) AS valor_parado,
       COALESCE(SUM(CASE WHEN e.saldo > 0 THEN e.saldo * e.custo_unitario END)
                / NULLIF(SUM(CASE WHEN e.saldo > 0 THEN e.saldo END), 0),
                (SELECT e2.custo_total / e2.quantidade FROM entradas e2
                  WHERE e2.insumo_id = i.id ORDER BY e2.data_entrada DESC, e2.id DESC LIMIT 1), 0) AS custo_medio
  FROM insumos i
  LEFT JOIN vw_entradas e ON e.insumo_id = i.id
 GROUP BY i.id;

-- Custo teórico de UMA porção pela ficha técnica (custo médio dos insumos).
CREATE VIEW vw_custo_pratos AS
SELECT p.id AS prato_id,
       ROUND(COALESCE(SUM(ft.quantidade * ei.custo_medio), 0), 4) AS custo_porcao,
       COUNT(ft.insumo_id) AS insumos
  FROM pratos p
  LEFT JOIN ficha_tecnica ft ON ft.prato_id = p.id
  LEFT JOIN vw_estoque_insumos ei ON ei.insumo_id = ft.insumo_id
 GROUP BY p.id;

-- Histórico de vendas com cliente, itens, lucro, forma e a origem.
CREATE VIEW vw_vendas AS
SELECT v.id,
       v.numero,
       v.cliente_id,
       COALESCE(c.nome, 'Consumidor')       AS cliente,
       u.nome                               AS vendedor,
       v.valor_bruto, v.desconto, v.valor_total, v.custo_total,
       ROUND(v.valor_total - v.custo_total, 2) AS lucro,
       v.forma_pagamento_id,
       COALESCE(fp.nome, v.forma_pagamento) AS forma_pagamento,
       v.parcelas, v.status,
       v.data_venda, v.observacoes, v.atualizado_em,
       (SELECT en.numero FROM encomendas en WHERE en.venda_id = v.id LIMIT 1) AS encomenda_numero,
       (SELECT COUNT(*)           FROM venda_itens vi WHERE vi.venda_id = v.id) AS itens,
       (SELECT SUM(vi.quantidade) FROM venda_itens vi WHERE vi.venda_id = v.id) AS unidades,
       (SELECT GROUP_CONCAT(vi.descricao, ' | ')
          FROM venda_itens vi WHERE vi.venda_id = v.id) AS itens_texto
  FROM vendas v
  LEFT JOIN clientes c ON c.id = v.cliente_id
  LEFT JOIN usuarios u ON u.id = v.usuario_id
  LEFT JOIN formas_pagamento fp ON fp.id = v.forma_pagamento_id;

-- O que é FATURAMENTO e de onde veio: toda venda concluída, com a origem
-- 'loja' quando uma encomenda aponta para ela, senão 'balcao'.
CREATE VIEW vw_faturamentos AS
SELECT v.id AS venda_id,
       CASE WHEN EXISTS (SELECT 1 FROM encomendas en WHERE en.venda_id = v.id) THEN 'loja' ELSE 'balcao' END AS origem,
       substr(v.data_venda, 1, 10) AS dia
  FROM vendas v
 WHERE v.status = 'concluida';

-- Receita e custo de cada faturamento, com a forma de pagamento.
-- /financeiro e /relatorios leem SÓ daqui.
CREATE VIEW vw_receitas AS
SELECT f.dia, f.origem,
       v.valor_total AS receita,
       v.custo_total AS custo,
       1 AS quantidade,
       v.forma_pagamento_id,
       COALESCE(fp.nome, v.forma_pagamento, 'Não informado') AS forma,
       f.venda_id
  FROM vw_faturamentos f
  JOIN vendas v ON v.id = f.venda_id
  LEFT JOIN formas_pagamento fp ON fp.id = v.forma_pagamento_id;

-- Os itens faturados (o ranking "o que mais vendeu"). A receita do item é
-- a que ENTROU: o desconto da venda é repartido na proporção do subtotal.
-- O prato aparece pelo nome do cardápio (as duas linhas de lotes
-- diferentes somam no mesmo prato); taxa e avulso, pela descrição.
CREATE VIEW vw_itens_faturados AS
SELECT f.dia,
       COALESCE(p.nome, vi.descricao) AS descricao,
       CASE WHEN vi.prato_id IS NOT NULL THEN 'prato'
            WHEN e.tipo IS NOT NULL THEN e.tipo
            ELSE 'avulso' END AS tipo,
       f.origem,
       vi.quantidade AS unidades,
       CASE WHEN v.valor_bruto > 0 AND v.valor_total < v.valor_bruto
            THEN ROUND(vi.subtotal * v.valor_total / v.valor_bruto, 2)
            ELSE vi.subtotal END AS receita,
       vi.custo_unitario * vi.quantidade AS custo,
       vi.prato_id
  FROM vw_faturamentos f
  JOIN vendas v ON v.id = f.venda_id
  JOIN venda_itens vi ON vi.venda_id = f.venda_id
  LEFT JOIN entradas e ON e.id = vi.entrada_id
  LEFT JOIN pratos p ON p.id = vi.prato_id;

-- @@SEMENTES@@
-- ============================================================
--  SEMENTES  (só no banco NOVO)
-- ============================================================
-- Cada bloco "@@SEMENTE <tabela>" roda uma vez, quando o banco nasce.
-- O usuário admin NÃO está aqui: o aplicar-estrutura.php o cria.

-- @@SEMENTE formas_pagamento
INSERT OR IGNORE INTO formas_pagamento (nome, tipo, parcelas_padrao, ordem, padrao)
SELECT nome, tipo, parcelas, ordem, padrao FROM (
          SELECT 'Dinheiro' AS nome, 'vista' AS tipo, 1 AS parcelas, 10 AS ordem, 1 AS padrao
    UNION ALL SELECT 'Pix',                       'vista',  1, 20, 0
    UNION ALL SELECT 'Cartão de débito',          'vista',  1, 30, 0
    UNION ALL SELECT 'Cartão de crédito',         'cartao', 1, 40, 0
    UNION ALL SELECT 'Cartão na entrega',         'cartao', 1, 50, 0
    UNION ALL SELECT 'Vale-refeição',             'cartao', 1, 60, 0
    UNION ALL SELECT 'Transferência',             'vista',  1, 70, 0
    UNION ALL SELECT 'Fiado',                     'prazo',  1, 80, 0
) novas
WHERE NOT EXISTS (SELECT 1 FROM formas_pagamento f WHERE minusculas(f.nome) = minusculas(novas.nome));

-- @@SEMENTE categorias
INSERT OR IGNORE INTO categorias (nome, descricao, ordem) VALUES
    ('Marmitas fit',       'Refeições completas, prontas para aquecer', 10),
    ('Bowls e saladas',    'Montados na hora, com molho à parte',       20),
    ('Low carb',           'Pouco carboidrato, muita proteína',         30),
    ('Veggie',             'Vegetarianos e veganos',                    40),
    ('Sopas e caldos',     'Leves e nutritivos',                        50),
    ('Sucos e detox',      'Naturais, sem açúcar',                      60),
    ('Snacks',             'Para o lanche da tarde e o pré-treino',     70),
    ('Sobremesas fit',     'O doce sem culpa',                          80),
    ('Kits da semana',     'Para planejar a semana inteira',            90);

-- @@SEMENTE empresas
INSERT INTO empresas (nome)
SELECT 'Green Fit' WHERE NOT EXISTS (SELECT 1 FROM empresas);

-- @@SEMENTE opcoes_lista
INSERT OR IGNORE INTO opcoes_lista (lista, valor)
SELECT lista, valor FROM (
          SELECT 'categorias_lancamento' AS lista, 'Aluguel' AS valor
    UNION ALL SELECT 'categorias_lancamento', 'Energia'
    UNION ALL SELECT 'categorias_lancamento', 'Água'
    UNION ALL SELECT 'categorias_lancamento', 'Gás'
    UNION ALL SELECT 'categorias_lancamento', 'Internet'
    UNION ALL SELECT 'categorias_lancamento', 'Embalagens'
    UNION ALL SELECT 'categorias_lancamento', 'Entregador'
    UNION ALL SELECT 'categorias_lancamento', 'Marketing'
    UNION ALL SELECT 'categorias_lancamento', 'Taxas de cartão'
    UNION ALL SELECT 'categorias_lancamento', 'Fornecedor'
    UNION ALL SELECT 'categorias_lancamento', 'Imposto'
    UNION ALL SELECT 'categorias_lancamento', 'Salário'
    UNION ALL SELECT 'categorias_lancamento', 'Outros'
) iniciais;

-- @@SEMENTE cfops
-- Os CFOPs de uma cozinha que compra insumos, produz e vende (e revende).
INSERT OR IGNORE INTO cfops (codigo, descricao, oficial) VALUES
    ('1101', 'Compra para industrialização ou produção rural', 1),
    ('1102', 'Compra para comercialização', 1),
    ('1202', 'Devolução de venda de mercadoria adquirida ou recebida de terceiros', 1),
    ('1403', 'Compra para comercialização em operação com mercadoria sujeita ao regime de substituição tributária', 1),
    ('1556', 'Compra de material para uso ou consumo', 1),
    ('1910', 'Entrada de bonificação, doação ou brinde', 1),
    ('1949', 'Outra entrada de mercadoria ou prestação de serviço não especificada', 1),
    ('2101', 'Compra para industrialização ou produção rural', 1),
    ('2102', 'Compra para comercialização', 1),
    ('2202', 'Devolução de venda de mercadoria adquirida ou recebida de terceiros', 1),
    ('2403', 'Compra para comercialização em operação com mercadoria sujeita ao regime de substituição tributária', 1),
    ('2556', 'Compra de material para uso ou consumo', 1),
    ('2910', 'Entrada de bonificação, doação ou brinde', 1),
    ('2949', 'Outra entrada de mercadoria ou prestação de serviço não especificada', 1),
    ('5101', 'Venda de produção do estabelecimento', 1),
    ('5102', 'Venda de mercadoria adquirida ou recebida de terceiros', 1),
    ('5202', 'Devolução de compra para comercialização', 1),
    ('5405', 'Venda de mercadoria adquirida ou recebida de terceiros em operação com mercadoria sujeita ao regime de substituição tributária, na condição de contribuinte substituído', 1),
    ('5910', 'Remessa em bonificação, doação ou brinde', 1),
    ('5927', 'Lançamento efetuado a título de baixa de estoque decorrente de perda, roubo ou deterioração', 1),
    ('5949', 'Outra saída de mercadoria ou prestação de serviço não especificado', 1),
    ('6101', 'Venda de produção do estabelecimento', 1),
    ('6102', 'Venda de mercadoria adquirida ou recebida de terceiros', 1),
    ('6202', 'Devolução de compra para comercialização', 1),
    ('6949', 'Outra saída de mercadoria ou prestação de serviço não especificado', 1);

-- @@SEMENTE naturezas_operacao
INSERT OR IGNORE INTO naturezas_operacao (codigo, descricao, sentido, finalidade, cfop_interno, cfop_interestadual,
                                         movimenta_estoque, gera_financeiro, exige_fornecedor, ativa) VALUES
    ('COMPRA_INSUMO', 'Compra de insumos para a produção', 'entrada', 'normal', '1101', '2101', 'entra', 'pagar', 1, 1),
    ('COMPRA_REVENDA', 'Compra para revenda', 'entrada', 'normal', '1102', '2102', 'entra', 'pagar', 1, 1),
    ('COMPRA_REVENDA_ST', 'Compra para revenda com substituição tributária', 'entrada', 'normal', '1403', '2403', 'entra', 'pagar', 1, 1),
    ('BONIFICACAO', 'Bonificação, doação ou brinde recebido', 'entrada', 'normal', '1910', '2910', 'entra', 'nao', 1, 1),
    ('USO_CONSUMO', 'Compra de material de uso e consumo (limpeza, escritório)', 'entrada', 'normal', '1556', '2556', 'nao', 'pagar', 1, 1),
    ('ENTRADA_AJUSTE', 'Outra entrada (ajuste ou regularização)', 'entrada', 'ajuste', '1949', '2949', 'entra', 'nao', 0, 1),
    ('DEVOLUCAO_CLIENTE', 'Devolução de venda (cliente devolve)', 'entrada', 'devolucao', '1202', '2202', 'entra', 'nao', 0, 0),
    ('VENDA_PRODUCAO', 'Venda de produção própria', 'saida', 'normal', '5101', '6101', 'sai', 'receber', 0, 0),
    ('VENDA_REVENDA', 'Venda de mercadoria de revenda', 'saida', 'normal', '5102', '6102', 'sai', 'receber', 0, 0),
    ('PERDA', 'Baixa por perda ou deterioração', 'saida', 'ajuste', '5927', NULL, 'sai', 'nao', 0, 0),
    ('DEVOLUCAO_FORNECEDOR', 'Devolução de compra ao fornecedor', 'saida', 'devolucao', '5202', '6202', 'sai', 'nao', 1, 0);

-- @@SEMENTE loja_ajustes
-- A loja online nasce FECHADA: o administrador abre em Loja online > Ajustes.
INSERT OR IGNORE INTO loja_ajustes (id, nome_vitrine, slogan) VALUES (1, 'Green Fit', 'Comida de verdade, do jeito que o seu corpo pede');

-- @@SEMENTE loja_horarios
-- Segunda a sexta 11h-21h, sábado 11h-15h, domingo fechado (a loja ajusta).
INSERT OR IGNORE INTO loja_horarios (dia, aberto, abre, fecha) VALUES
    (0, 0, '11:00', '15:00'),
    (1, 1, '11:00', '21:00'),
    (2, 1, '11:00', '21:00'),
    (3, 1, '11:00', '21:00'),
    (4, 1, '11:00', '21:00'),
    (5, 1, '11:00', '21:00'),
    (6, 1, '11:00', '15:00');

-- @@SEMENTE loja_bairros
-- A região da loja (Norte da Ilha). Taxas de exemplo: confira antes de abrir.
INSERT OR IGNORE INTO loja_bairros (nome, cidade, taxa, tempo_min) VALUES
    ('São João do Rio Vermelho', 'Florianópolis', 5.00, 10),
    ('Ingleses',                 'Florianópolis', 6.00, 15),
    ('Santinho',                 'Florianópolis', 7.00, 20),
    ('Vargem Grande',            'Florianópolis', 8.00, 20),
    ('Canasvieiras',             'Florianópolis', 9.00, 25);
