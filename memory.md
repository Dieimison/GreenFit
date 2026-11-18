# memory.md — como o Green Fit funciona por dentro

Memória técnica do **Green Fit**: cozinha, PDV e loja online de comida
saudável, rodando no navegador sobre PHP 8.3 + SQLite, sem framework e sem
build. Nasceu da Master (Index Celulares, assistência técnica, v8): a base é
a mesma (cadastro / movimento / financeiro, saldo calculado, transação em
tudo, mensagens que dizem o que fazer), e o domínio foi trocado:

| Master (celulares) | Green Fit (comida) |
|---|---|
| celular, peça, produto | **insumo** (g/ml/un) e **prato** (porções) |
| entrada de celular/peça | **lote** com custo total e **validade** |
| ordem de serviço | **ordem de produção** (consome insumos, gera o lote do prato) |
| anúncio (aponta UMA entrada) | **prato publicado** (vende de qualquer lote, FIFO por validade) |
| encomenda + rastreio de transportadora | **pedido online** (aceite, preparo, entrega/retirada) |
| perfis técnico/balcão | **cozinha/atendimento** |

> **Manutenção:** regra nova que muda um fluxo entra aqui, na seção dela,
> com o motivo. Regra substituída vira uma linha em *Decisões* — nunca some.

Última revisão: 11/11/2026 (versão 1 do banco).

---

## 1. Onde roda

| | |
|---|---|
| Motor | PHP 8.3 (`C:\php`), servidor embutido (`servidor.php`) |
| Banco | SQLite, um arquivo: `dados\index.sqlite` (ou `GREENFIT_DB`) |
| Front | HTML + CSS + JS clássico (IIFE), sem framework, sem CDN de JS |
| Portas | loja 5700 (`iniciar-servidor.bat`), demonstração 5705 |
| Variáveis | `GREENFIT_DB`, `GREENFIT_BACKUPS`, `GREENFIT_LOG`, `GREENFIT_SENHA_INICIAL`, `GREENFIT_SAIDA_TESTES` |
| Pastas | uma só por projeto (12/11/2026): cópias em `dados\backups\`, saída dos testes em `testes\saida\`, as duas no `.gitignore`; nada é gravado fora de `GreenFit\` |
| Homologação | `php dados\homologacao.php <cópia>`: p / p admin, regra `sistema.banco_de_teste`, fiscal em homologação, pelas rotas e no histórico; a demonstração chama a mesma `colocarEmHomologacao()`. Só com a regra ligada o login deixa senha fraca entrar sem trocar |

Tudo que a Master dizia sobre segurança continua: PBKDF2, bloqueio por
login, sessão (aqui 12 h, o turno), JSON + Origin em toda escrita, cookie
HttpOnly/SameSite=Strict, `servidor.php` só entrega `Login/ Dashboard/ Img/
Loja/`. A sessão do cliente da loja é OUTRA (cookie `GREENFITLOJA`, path
`/api/loja`, 30 dias) e nunca abre o painel.

---

## 2. O banco (dados\estrutura.sql, versão 1)

- **Cadastro:** `clientes` (objetivo, restrições), `fornecedores`,
  `formas_pagamento`, `insumos` (unidade base g/ml/un, estoque mínimo),
  `categorias`, `pratos` (nutrição por porção, selos em `tags`, conservação,
  validade_dias, preço e promocional, publicado/destaque/ativo,
  `tipo` produção/revenda, `feito_na_hora`), `prato_fotos` (BLOB),
  `ficha_tecnica` (insumo × quantidade por porção), `grupos_adicionais` +
  `adicionais` (preço, kcal, proteína) + `prato_grupos`.
- **Movimento:** `entradas` (o LOTE: tipo insumo|prato, quantidade inteira,
  `custo_total`, lote, validade, `producao_id`), `producoes` +
  `producao_itens` (o que saiu de cada lote de insumo), `vendas` +
  `venda_itens` (uma linha por lote; `prato_id`, `adicionais`),
  `movimentacoes`.
- **Financeiro:** `lancamentos` (origem manual|venda|entrada; `pedido_id`
  na compra por nota), `lancamentos_log`.
- **Loja:** `loja_ajustes` (1 linha), `loja_horarios`, `loja_bairros`,
  `cupons`, `loja_contas`, `loja_enderecos` (bairro_id atendido),
  `favoritos`, `encomendas` (+ `encomenda_itens`, `encomenda_item_adicionais`,
  `encomenda_eventos`), `cashback` (crédito/uso/estorno).
- **Fiscal e regras:** iguais à Master (empresa, regime, CFOP com os de
  comida — 1101 insumo para produção, 5101 produção própria, 5927 perda —,
  naturezas, chaves geral/empresa).

### Views (a conta mora num lugar só)

| View | Entrega |
|---|---|
| `vw_saidas_estoque` | o que saiu por venda concluída e por produção concluída |
| `vw_entradas_saldo` | saldo de cada lote |
| `vw_entradas` | o lote com nome, unidade, `custo_unitario = custo_total/quantidade`, saldo, `dias_validade` |
| `vw_estoque_pratos` | por prato: disponível (dentro da validade), vencendo (≤ 2 dias), vencido, próxima validade |
| `vw_estoque_insumos` | por insumo: disponível, vencido, valor parado, custo médio dos lotes com saldo |
| `vw_custo_pratos` | custo teórico de UMA porção pela ficha técnica |
| `vw_vendas` | venda com cliente, lucro, forma e `encomenda_numero` |
| `vw_faturamentos` / `vw_receitas` / `vw_itens_faturados` | faturamento com origem **balcao** ou **loja** (a venda que uma encomenda aponta) |

Consulta nova de receita ou de saída **lê a view**.

---

## 3. Estoque: lote, validade, FIFO

**O saldo é calculado, nunca gravado** (herança da Master, não reverter).

- Insumo em **inteiros na unidade base**: 2,5 kg = 2500 g. A nota do
  fornecedor vem em KG/L com decimais: o pedido de entrada guarda a
  quantidade da nota e o **fator** (1 KG = 1000 g); o lote entra com
  quantidade × fator (tem de dar inteiro). O fator é aprendido por
  fornecedor + código do produto (`vinculos_fornecedor`).
- O lote guarda o **custo total** (dinheiro de verdade, 2 casas); o custo
  por grama é a divisão na view. Guardar custo unitário com 2 casas daria
  R$ 0,03/g e perderia 7% do frango.
- **Saída por lote, o que vence primeiro sai primeiro** (`lotesDisponiveis`
  + `alocarLotes` em `api/rotas/estoque.php`): venda e produção. Lote com
  `dias_validade < 0` **nunca sai** por venda ou produção — só por
  movimentação `vencimento` (ou "Baixar vencidos", que baixa todos de uma vez).
- Venda de 3 porções que pega 2 de um lote e 1 de outro vira **duas linhas**
  em `venda_itens`, cada uma com o custo do seu lote.
- `conferirSaldos()` depois de gravar, dentro da transação, continua sendo
  a última barreira.
- Perdas (`vencimento`, `perda`, `degustacao`, `consumo_interno`) gravam em
  `movimentacoes.valor` o custo que se foi (saldo × custo unitário) e entram
  como despesa no resultado (categoria "Perdas e cortesias").

### Uma ferramenta só: a Entrada é o documento  *(v2 da tela, 12/11/2026)*

Havia duas portas: **Compras** (o pedido de entrada, com natureza, CFOP e
parcelas) e o "+ Entrada de insumo / + Prato pronto" do Estoque, que
gravava o lote direto. Ficou **uma**:

- **Entradas** (menu Cozinha; seção `#pedidos`, `telas/pedidos.js`) é o
  único lugar onde mercadoria entra: XML da NF-e ou compra digitada
  ("+ Nova entrada" já abre com uma linha). Os atalhos "Dar entrada" do
  Cadastros (insumos) e "Entrada" do Cardápio (prato) chamam
  `Telas.pedidos.novaEntrada({tipo_item, insumo_id|prato_id})`, que abre a
  entrada nova com a linha escolhida (unidade da nota e fator sugeridos;
  prato com a validade do cadastro).
- **Estoque** (seção `#entradas`, `telas/entradas.js`) consulta, movimenta
  e corrige o que não é conta. A origem do lote é "Entrada PE-..." (link,
  `Telas.pedidos.abrirEntrada(id)`), "Produção OP-..." ou "Lançamento
  avulso" (só o que existir de antes). Lote de documento: sem Excluir.
- Abrir a tela Entradas a partir de outra tela passa por `pendente`: o
  `carregar()` que o `mostrarSecao` dispara é quem abre — abrir direto
  corria com ele e a lista vencia.
- `GET /api/entradas` traz `pedido_id` e `pedido` (`documentosDosLotes()`).
- **"Já paguei"**: `POST /api/pedidos/{id}/confirmar` com `{"pago": 1}` cria
  as contas já pagas. A tela pergunta ao confirmar; sem escolha, nota
  importada/com parcelas fica a pagar e a digitada nasce paga. Não há
  coluna: a escolha só muda as contas.
- Compra exige fornecedor (natureza `COMPRA_INSUMO`): a feira e o mercado
  viram fornecedores. Confirma o admin, ou a equipe com
  `pedido.confirmar_equipe`.
- `POST /api/entradas` continua na API (fluxos, demo e integridade usam);
  nenhuma tela chama. Fechar é o passo "entrada como transação fiscal".

---

## 4. Cardápio

- Nutrição é **por porção**; o adicional soma kcal/proteína no pedido.
- `tags` é texto separado por vírgula com valores do domínio `tags_prato`
  (a API confere; a tela recebe lista).
- **Preço só o admin define** (403 para os outros, mesmo reenviando o form).
- Prato **feito na hora**: sem lote (a entrada e a produção recusam), vende
  sem limite enquanto ativo; custo da venda = `vw_custo_pratos`.
- Prato de **revenda**: entra pela tela Entradas (o botão "Entrada" do
  cardápio abre a entrada nova com ele; sem prato escolhido, a confirmação
  cria o prato fora da loja).
- Publicado na loja exige preço > 0. Prato com histórico não se exclui:
  desativa ou tira da loja.
- Fotos: até 4, ≤ 1 MB, conferidas pelo conteúdo; a tela reduz antes.

---

## 5. Produção

`planejada` → `concluida` | `cancelada`. Concluir (numa transação):
cada insumo da ficha × porções sai dos lotes (FIFO, sem vencido) em
`producao_itens` com o custo congelado; nasce o lote do prato com custo =
soma e validade = hoje + `validade_dias` (ou a informada). Rendeu diferente:
`quantidade` no concluir. Sem ficha técnica produz com custo zero e avisa.
Cancelar concluída: só admin e só com o lote intacto (o lote é apagado; a
view ignora `producao_itens` de produção cancelada, então os insumos voltam).

---

## 6. Vendas (PDV)

A tela manda **prato + quantidade** (e `valor_unitario`, `adicionais` texto,
`acrescimo_adicionais`); o servidor escolhe os lotes (`prepararItensDeSaida`
em `vendas.php`), soma as linhas do mesmo prato antes de conferir, respeita
a **reserva** dos pedidos online e dá a mensagem certa (inclusive "há X em
lote vencido"). Linha sem prato = avulso (taxa de entrega, item digitado —
só admin, ou com a regra `venda.alterar_preco_equipe`). À vista nasce
recebida; parcelada fica a receber. O resto das regras de venda (cancelada
é final, venda paga que muda de valor gera diferença ou devolução) é o da
Master. Venda da loja só muda pelo pedido.

---

## 7. Loja online

### Pedido

1. `POST /api/loja/carrinho` calcula tudo no servidor (preço + adicionais,
   grupos mín/máx, estoque menos reservas, taxa do bairro, entrega grátis,
   cupom, cashback até 50% dos pratos, kcal). A tela só mostra.
2. `POST /api/loja/encomendas` refaz a mesma conta (`calcularPedido`) e grava:
   Pix → `aguardando_pagamento` com `pagar_ate`; na entrega → `aguardando_aceite`.
   Confere a reserva DEPOIS de gravar (dois clientes, última porção).
3. Painel `confirmar` → status `confirmado` (a reserva sai) → venda pela
   `gravarVenda` com a taxa como linha avulsa e desconto = cupom + cashback;
   lançamento pago (Pix) ou pendente (na entrega).
4. `avancar` anda UM passo da trilha (`TRILHA_ENTREGA` / `TRILHA_RETIRADA`),
   com `para` para pegar clique duplo (409). `entregue`: baixa o pendente da
   entrega e credita o cashback.
5. `cancelar`: com venda → cancela a venda (estorno só admin se já recebeu);
   devolve o cashback usado.

Pix vencido cancela sozinho na próxima leitura (`expirarEncomendas`, sem
tarefa agendada). Fora do horário só entra pedido **agendado** (se a loja
aceita). Cupom de entrega grátis grava `desconto = taxa` para o relatório
saber quanto custou.

### Horário

`funcionamento()` = loja ligada (Ajustes) **e** dentro do horário do dia;
devolve o texto que o app mostra ("Aberto · fecha às 21:00", "Fechado · abre
amanhã às 11:00 (dá para agendar)").

---

## 8. Painel, relatórios, perfis

- `/resumo` (todos): porções prontas, pratos para repor, lotes vencendo e
  vencidos, insumos abaixo do mínimo, produções do dia, pedidos abertos.
- `/relatorios` (admin): série diária com `receita_balcao/loja`,
  `custo_*`, `despesas` (manuais + perdas), `perdas`; itens por prato;
  pagamentos; despesas por categoria; estoque parado insumo × prato;
  loja (pedidos/dia, ticket, retirada, nota). A tela agrupa e filtra.
- `config.pode_ver_custo` / `pode_operar_loja` dizem à tela o que mostrar;
  quem barra é o servidor.
- **Menu em grupos** *(12/11/2026)*: soltos Início, Pedidos online e PDV;
  grupos **Cozinha** (Produção, Cardápio, Entradas, Estoque), **Gestão**
  (Vendas, Financeiro, Resultados) e **Administrativo** (Cadastros, Fiscal,
  Loja online, Empresa e regras — o antigo "Admin" —, Minha conta). O grupo
  é `<button class="menu-grupo-botao" aria-expanded>` + `<ul class="submenu"
  hidden>`; `marcarGrupos()` no `nucleo.js` abre o grupo da seção aberta e
  fecha os outros. Os ids das seções não mudaram (`#pedidos` = Entradas,
  `#entradas` = Estoque). O mesmo desenho está na Master.

---

## 9. Testes

`testes\rodar.bat` → `testes\rodar.php`: instala 2× (idempotente), sobe
servidor, roda `fluxos.test.php` (o dia da loja pela API, oráculo à mão),
`integridade.php` (24 invariantes: estoque, dinheiro, pedidos, produção,
cashback, cupom, FK), os testes do front e o e2e (Playwright: cada seção do
painel, a loja e o login em 1366 e 390 px; reprova erro de JS, seção vazia
e rolagem lateral). `dados\dados-demonstracao.php` monta 60 dias de
movimento pelas mesmas funções da API e passa nas 24 invariantes.

**Ao mexer:** rode o sistema e olhe a tela (no celular também); mudou
tabela → `estrutura.sql` + passo em `dados\migracoes\NNN-*.php` + suba
`VERSAO_BANCO`; receita e saída se leem das views; efeito visual caro não
entra (memória da Master, seção 13: o redesign 3D revertido).

---

## 10. Decisões

| Decisão | Por quê |
|---|---|
| Novo projeto (GreenFit\) em vez de mexer na Master | a Master é a loja de celulares em produção; domínio diferente, banco diferente |
| Banco começa na versão 1, sem migrações | é uma loja nova: nenhum banco antigo para levar |
| Insumo em inteiros na unidade base | estoque em kg com decimal acumula erro e não fecha |
| Lote guarda custo TOTAL | custo por grama com 2 casas perde dinheiro |
| Saída FIFO por validade feita pelo servidor | a tela não sabe qual lote vence; e lote vencido não pode sair |
| Prato publicado vende de qualquer lote (sem "anúncio") | comida é vendida pelo prato, não pela unidade física |
| Venda nasce no "confirmado" do pedido | antes disso o pedido pode cair (Pix não pago); a reserva segura as porções |
| Pagamento na entrega = conta pendente baixada no "entregue" | o dinheiro só entra quando o entregador volta |
| Cashback paga no máximo 50% dos pratos | pedido de R$ 0 não tem forma de pagamento nem venda que faça sentido |
| Cupom de entrega grátis grava desconto = taxa | o relatório de cupons precisa do quanto custou |
| Perdas viram despesa pelo custo do lote | a compra só vira custo na venda; o perdido nunca vende |
| Tema claro (creme + verde-folha) no painel | marca Green Fit; leitura na cozinha; tokens no lugar das cores fixas |
| Mercadoria entra só pela Entrada (documento); o Estoque só consulta | duas portas para a mesma coisa confundiam, e a avulsa não tinha natureza nem CFOP (o fiscal precisa) |
| Menu em grupos, ids das seções mantidos | menu curto e o administrativo junto; renomear id quebraria atalhos e testes |
| Senha fraca entra sem trocar só no banco de teste (p / p do `homologacao.php`) | acesso rápido nos bancos de homologação; na loja a regra fica desligada e o p não existe |
