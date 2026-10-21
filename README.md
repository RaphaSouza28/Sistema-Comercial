# Sistema Comercial

Sistema comercial desktop para Windows (PDV, estoque, financeiro e gestão) para pequenas e médias empresas.
Funciona offline, em um único computador, com os dados em um banco SQLite local.

**Versão 1.0.0 — as 9 fases estão concluídas.** Login e permissões, dashboard, produtos (variações, precificação
inteligente, histórico de preços, CSV), categorias e fornecedores, estoque (entradas, saídas, ajustes, inventário),
PDV (vendas, pagamentos, crediário, cancelamento, devoluções, comprovante), caixa (suprimento, sangria, fechamento
com conferência), clientes (LGPD), pedidos, orçamentos, serviços, catálogo, contas a pagar e a receber, fluxo de
caixa, relatórios com exportação (PDF, Excel, CSV), impressoras/gaveta/etiquetas/leitor, notas fiscais preparadas
para provedor homologado, conciliação de cartões/PIX e estrutura TEF, backup e restauração.

- **Manual do usuário:** [docs/MANUAL.md](docs/MANUAL.md) (instalação, rotina do dia, backup, solução de problemas).
- **Histórico de versões:** [CHANGELOG.md](CHANGELOG.md).

## Requisitos

- Windows 10 ou 11 (x64)
- Node.js 22 ou superior (testado com 24.22) e npm 10+ — apenas para desenvolvimento
- Não é necessário Visual Studio Build Tools: nenhuma dependência é compilada localmente

## Comandos

```bash
npm install            # instala dependências e gera o Prisma Client
npm run dev            # abre o aplicativo em modo desenvolvimento (com recarga automática)
npm test               # testes unitários e de integração (Vitest, banco SQLite real)
npm run build          # verificação de tipos + build de produção em out/
npm run test:e2e       # testes de ponta a ponta no aplicativo Electron (rode `npm run build` antes)
npm run dist           # gera o instalador em release/Sistema-Comercial-Setup-<versão>.exe
npm run dist:dir       # gera apenas a pasta release/win-unpacked (mais rápido)
```

Testar a versão empacotada com os testes E2E:

```bash
# O executável final desliga o depurador (Electron Fuses), que o Playwright usa para controlar o app.
# Para os testes, gere o pacote com apenas esse fuse ligado:
npx electron-builder --dir -c.electronFuses.enableNodeCliInspectArguments=true
E2E_EXECUTABLE="release/win-unpacked/Sistema Comercial.exe" npm run test:e2e
# Depois gere o instalador final (com todos os fuses): npm run dist
```

> **Atenção:** se a variável de ambiente `ELECTRON_RUN_AS_NODE` estiver definida no terminal (algumas
> extensões/ferramentas a definem), o Electron roda como Node puro e a janela não abre. Remova-a antes de
> `npm run dev` (`Remove-Item Env:ELECTRON_RUN_AS_NODE` no PowerShell). O instalador não é afetado.

## Onde ficam os dados

| Item | Local |
| --- | --- |
| Banco de dados | `%APPDATA%\Sistema Comercial\data\sistema-comercial.db` |
| Backups (pasta padrão; pode ser trocada por pendrive/HD externo) | `%APPDATA%\Sistema Comercial\backups\` |
| Logs | `%APPDATA%\Sistema Comercial\logs\main.log` |
| Imagens de produtos | `%APPDATA%\Sistema Comercial\media\products\` |
| Comprovantes das contas a pagar | `%APPDATA%\Sistema Comercial\anexos\contas-a-pagar\` |
| XML/DANFE devolvidos pelo provedor fiscal | `%APPDATA%\Sistema Comercial\fiscal\` |
| Segredos (senha do backup), protegidos pelo Windows | `%APPDATA%\Sistema Comercial\segredos\` |

O banco **nunca** fica na pasta de instalação: os dados são preservados em atualizações e na desinstalação.
A tela *Configurações → Sobre o sistema* mostra os caminhos exatos.

## Dependências

Versões fixadas (exatas) no `package.json`, verificadas quanto à compatibilidade em 20/10/2026.

| Pacote | Versão | Uso |
| --- | --- | --- |
| electron | 43.8.1 | Aplicativo desktop (Chromium + Node.js 24) |
| electron-vite / vite | 6.0.0 / 8.3.4 | Build do processo principal, preload e interface |
| electron-builder | 26.15.3 | Instalador Windows (NSIS) |
| react / react-dom | 19.3.1 | Interface |
| react-router-dom | 7.18.4 | Navegação (HashRouter) |
| tailwindcss / @tailwindcss/vite | 4.3.3 | Estilos e temas claro/escuro |
| lucide-react | 1.60.0 | Ícones |
| recharts | 3.10.1 | Gráficos |
| zod | 4.6.7 | Validação (mesmos schemas na interface e nos serviços) |
| prisma / @prisma/client | 7.10.1 | ORM, migrations e client tipado |
| @prisma/adapter-libsql / @libsql/client | 7.10.1 / 0.17.0 | Driver SQLite (binário N-API pré-compilado) |
| typescript | 5.9.3 | Tipagem |
| vitest / @playwright/test | 5.0.5 / 1.64.1 | Testes de integração e E2E |

**Por que libSQL e não better-sqlite3:** o better-sqlite3 precisa ser recompilado para a versão do Electron
(exige Visual Studio Build Tools). O libSQL usa N-API (ABI estável) e funciona igual no Node e no Electron.
**Por que Prisma 7.10.1 e não 8.x:** no momento da instalação o "latest" do npm era um release candidate (8.0.0-rc).

## Arquitetura

```
electron/
  main/          processo principal: janela, segurança, caminhos, registro do IPC
    ipc/         roteador IPC (valida remetente, carrega sessão, trata erros) e handlers
  preload/       expõe somente window.api (contextBridge), sem acesso ao Node
  services/      regras de negócio + verificação de permissões (um serviço por módulo)
  repositories/  acesso ao banco via Prisma (auditoria, configurações, consultas compartilhadas)
  database/      conexão, migrador, backup (VACUUM INTO), criptografia de backup, restauração na inicialização
  integrations/  adaptadores de dispositivos (ESC/POS, códigos de barras) e contratos fiscal/TEF
  utils/         hash de senha, erros, datas, CSV, logger
shared/          código usado pelos dois lados: contrato da API, permissões, módulos, schemas Zod, formatação
src/             interface React (pages, components, layouts, contexts, hooks, services, styles, types)
prisma/          schema.prisma e migrations SQL
build/           ícone e recursos do instalador
docs/            manual do usuário
tests/           unit/, integration/ (Vitest, banco SQLite real) e e2e/ (Playwright + Electron)
```

### Testes

| Área | Onde |
| --- | --- |
| Login, bloqueio, troca de senha, sessão por inatividade | `integration/auth`, `unit/session`, `e2e/app`, `e2e/security` |
| Permissões | `integration/permissions` e verificações em cada serviço |
| Produtos e precificação | `unit/pricing`, `integration/products`, `integration/import`, `e2e/products` |
| Entrada e saída de estoque, inventário | `integration/stock`, `e2e/stock` |
| Vendas, cancelamento, devolução, crediário | `integration/sales`, `integration/finance`, `e2e/pdv` |
| Caixa (abertura, movimentos, fechamento) | `integration/cash`, `e2e/cash` |
| Financeiro e relatórios | `integration/finance`, `e2e/finance` |
| Clientes, pedidos, orçamentos, catálogo | `integration/commerce`, `e2e/commerce` |
| Dispositivos, notas fiscais, TEF/conciliação | `unit/barcode`, `integration/integrations`, `e2e/integrations` |
| Backup, criptografia, restauração | `integration/backup`, `e2e/backup` |
| Persistência, migrations, integridade, offline | `integration/database`, `integration/migrator`, `integration/integrity`, `e2e/app`, `e2e/backup` |

Os testes E2E rodam também contra o executável empacotado (`E2E_EXECUTABLE`), não só em desenvolvimento.

### Segurança

- `contextIsolation: true`, `nodeIntegration: false`, `sandbox: true`, DevTools desativado no build final.
- Content Security Policy estrita no build (`script-src 'self'`).
- Navegação para fora do aplicativo, novas janelas, `<webview>` e permissões do navegador são bloqueadas.
- IPC: só canais fixos; cada chamada valida que vem do frame principal da janela do app; o usuário da sessão é
  recarregado do banco a cada chamada (usuário desativado perde acesso imediatamente).
- Argumentos validados com Zod **nos serviços**; permissões verificadas **nos serviços** (não só na interface).
- Senhas com scrypt (N=2^15, sal aleatório), comparação em tempo constante, bloqueio de 5 minutos após
  5 tentativas, mensagem idêntica para usuário inexistente e senha errada. Não há senha fixa no código.
- Log de auditoria das operações críticas: login e falhas, usuários e permissões, descontos autorizados,
  cancelamentos, devoluções, caixa (abertura, sangria, fechamento, gaveta), financeiro, LGPD, notas fiscais,
  conciliação, backup e restauração. Senhas, hashes e dados de cartão nunca são gravados.
- Bloqueio por inatividade (configurável em *Configurações → Segurança*; padrão 1 hora): sem teclado/mouse pelo
  tempo configurado, a tela volta ao login sozinha e o servidor também encerra a sessão.
- Operações críticas pedem confirmação; restaurar backup exige a senha do usuário e digitar RESTAURAR.
- Proteção contra operações duplicadas: chaves de idempotência em vendas, pagamentos, recebimentos,
  movimentos de caixa e estoque (duplo clique ou reenvio não duplicam lançamentos).
- Executável endurecido com Electron Fuses: não roda como Node (`ELECTRON_RUN_AS_NODE`), ignora
  `NODE_OPTIONS`/`--inspect`, só carrega o código do `app.asar` e valida a integridade do asar.
- Dependências de produção sem vulnerabilidades conhecidas (`npm audit --omit=dev` em 20/10/2026).

### Banco de dados

- Valores monetários em **centavos inteiros** (`*Cents`), quantidades em **milésimos** (`*Milli`, aceita kg/m),
  percentuais em **pontos-base** (`*Bps`, 30% = 3000). Sem ponto flutuante em valores financeiros.
- Todas as entidades do sistema já estão modeladas (vendas, caixa, estoque, financeiro, fiscal, TEF, backup),
  com chaves estrangeiras, índices e chaves de idempotência (impedem baixa de estoque/finalização duplicadas).
- Migrations geradas com `npm run prisma:migrate` em desenvolvimento e aplicadas pelo próprio aplicativo na
  inicialização (`electron/database/migrator.ts`), cada uma em transação. Antes de aplicar migrations novas
  em um banco existente, é feito um backup verificado (`VACUUM INTO` + `PRAGMA integrity_check`).
- Modo WAL; uma única conexão serializada pelo adapter (veja `electron/database/connection.ts` sobre a
  correção do vazamento de conexões em transações do `@libsql/client`).

### Criar uma nova migration

```bash
# altere prisma/schema.prisma e depois:
npm run prisma:migrate -- --name descricao_da_mudanca
```

Nunca edite uma migration já distribuída: o aplicativo registra o checksum e avisa no log.

## Produtos e precificação (Fase 2)

- **Cadastro completo** e **cadastro rápido** (nome, categoria, custo, preço, quantidade inicial). Código interno
  automático (000001, 000002...) quando não informado. SKU, código de barras e código interno são únicos entre
  todos os produtos e variações.
- **Estoque inicial** gera movimentação `INITIAL` rastreável (usuário, data, custo). Depois disso o estoque só muda
  por movimentações (módulo Estoque, Fase 3).
- **Variações** (até 3 tipos, ex.: Cor × Tamanho) com SKU, código de barras, custo, preço e estoque próprios.
- **Calculadora:** preço sugerido = custo total ÷ (1 − margem − impostos − cartão − comissão). Exibe lucro bruto,
  margem bruta (sobre o preço), markup (sobre o custo) e resultado após custos variáveis (não é lucro líquido).
- **Preço manual ou automático** (recalculado pela margem quando um usuário autorizado salva o produto),
  promoção com vigência, preço de atacado com quantidade mínima, alerta de margem baixa (Configurações).
- **Precificação por categoria:** prévia dos preços sugeridos; só altera os produtos marcados e confirmados.
- **Histórico de preços** de custo, venda, promoção e atacado, com usuário e motivo.
- **Permissões por campo:** sem `products.cost` o backend não envia custos/margens; alterar preço exige `products.price`.
- **Exclusão lógica:** produtos com estoque não podem ser excluídos (desative-os); ao excluir, SKU e código de barras
  são liberados e o histórico é preservado.
- **Importação/Exportação CSV** no padrão do Excel brasileiro (`;`, vírgula decimal, UTF-8 ou ANSI), com modelo,
  prévia e erros por linha. A exportação neutraliza fórmulas (proteção contra injeção de fórmulas no Excel).

## Estoque (Fase 3)

- **Uma única porta para alterar saldo** (`electron/services/stockCore.ts`): toda movimentação — estoque inicial,
  entrada, saída, ajuste, inventário e, a partir da Fase 4, venda/cancelamento — passa por ela, dentro de uma
  transação. Registra produto, variação, quantidade, tipo, data/hora, usuário, motivo, referência e saldo resultante.
- **Sem baixa duplicada:** cada operação tem chave de idempotência (a tela gera um identificador por envio; repetir o
  envio, por duplo clique ou falha de rede, não lança de novo).
- **Sem estoque negativo não autorizado:** saídas que deixariam saldo negativo são recusadas, exceto se o produto
  permitir ou a configuração geral (assistente inicial) liberar. Em operações com vários itens, nada é lançado se
  um item falhar.
- **Entrada de mercadorias** com vários itens, fornecedor e nº do documento; custo opcional com três modos: manter,
  último custo ou **custo médio ponderado** (registrado no histórico de preços). Preços de venda nunca mudam sozinhos —
  produtos com preço automático geram um aviso para revisão.
- **Saídas** por motivo (perda, avaria, vencimento, uso interno, devolução ao fornecedor, brinde, outro) e **ajuste**
  para a quantidade correta, com motivo obrigatório.
- **Inventário** salvo no banco (pode ser contado em etapas, com leitor de código de barras: cada leitura soma 1).
  Ao aplicar, lança a diferença entre o contado e o estoque **do momento da aplicação** (vendas durante a contagem
  são consideradas). Itens não contados não mudam.
- **Consultas:** posição por produto/variação, custo total do estoque, reposição (baixo/esgotado), negativos,
  sem movimentação há 90 dias, histórico com filtros e exportação CSV. Custos só aparecem com `products.cost`.

## PDV (Fase 4)

- **Caixa aberto obrigatório:** cada venda fica vinculada à sessão de caixa do operador (abertura com valor inicial;
  sangria, suprimento e fechamento na Fase 5).
- **Leitor de código de barras:** o código + Enter adiciona o item; `3*código` informa a quantidade. Busca por nome,
  código interno, SKU ou código de variação. Atalhos: **F2** busca, **F8** pagamento, **F9** finalizar.
- **Preço calculado no servidor** na finalização: promoção vigente, preço próprio da variação e preço de atacado
  quando a quantidade atinge o mínimo. A tela mostra os totais do servidor do carrinho atual.
- **Descontos** por item e na venda (valor ou %), rateados entre os itens. Acima do limite do usuário (operador: 0%)
  exige usuário e senha de um supervisor com limite suficiente — registrado na venda e na auditoria.
- **Pagamentos:** dinheiro, PIX, débito, crédito parcelado, vale-troca, outros e misto. Troco só em dinheiro.
  PIX/cartão são **registros manuais** (status "registrado"), não confirmação bancária — TEF na Fase 8.
- **Finalização atômica e idempotente:** venda, itens, pagamentos, baixa de estoque (núcleo de estoque, chave por
  item), lançamentos no caixa (dinheiro líquido do troco) e auditoria numa única transação. Reenviar a mesma
  finalização devolve a venda existente; estoque insuficiente cancela tudo.
- **Cancelamento** (com autorização para quem não tem `pdv.cancel`): devolve o estoque, estorna os valores no caixa
  aberto de quem cancela, restaura vales usados e marca os pagamentos como estornados.
- **Devolução/troca** por item, limitada ao que ainda não foi devolvido, com valor proporcional exato. Reembolso em
  dinheiro (verifica o dinheiro da gaveta), PIX/cartão (estorno manual registrado), vale-troca (código `VT…`
  aceito como pagamento) ou sem reembolso.
- **Comprovante não fiscal** de venda e de devolução (80 mm) para imprimir ou salvar em PDF, com
  "NÃO É DOCUMENTO FISCAL". O texto é escapado (nomes de produtos/clientes não injetam conteúdo).
- **Consulta de vendas:** operadores veem as próprias vendas; gerentes/administradores veem todas.
- **Dashboard líquido de devoluções:** faturamento e lucro bruto descontam o valor devolvido (inclusive em vale) e
  o custo dos itens que voltaram ao estoque.
- **Crediário** (venda a prazo) será habilitado com o módulo Contas a receber (Fase 7).

## Caixa (Fase 5)

- **Sessões de caixa** por operador (uma aberta por vez), com valor inicial. O PDV só vende com caixa aberto.
- **Movimentações manuais** no próprio caixa: suprimento e sangria (sempre em dinheiro), outras entradas e saídas
  (qualquer forma), com descrição obrigatória. Nenhuma saída em dinheiro pode deixar a gaveta negativa; reenviar a
  mesma movimentação não duplica.
- **Resumo esperado por forma de pagamento:** abertura + vendas − cancelamentos − reembolsos + suprimentos − sangrias
  ± outras movimentações. "Dinheiro na gaveta" = esperado em dinheiro.
- **Fechamento com conferência:** total contado em dinheiro (ou contador de cédulas e moedas) e conferência opcional de
  PIX/cartões pelo relatório da maquininha. Diferenças (sobra/falta) ficam registradas e **exigem justificativa**.
  O resumo é congelado no fechamento — estornos posteriores, feitos em outro caixa, não alteram o histórico.
- **Permissões:** cada operador fecha o próprio caixa; fechar o de outro exige `cash.manage` (registrado na auditoria).
  Operadores consultam apenas os próprios caixas.
- **Histórico de caixas**, **relatório do dia** (vendas, cancelamentos, reembolsos, suprimentos, sangrias, movimento
  líquido por forma e diferenças) e **relatório de fechamento** para imprimir ou salvar em PDF, com campo de assinatura.

## Clientes, pedidos, orçamentos e catálogo (Fase 6)

- **Clientes:** cadastro com CPF/CNPJ validado (único), telefone, e-mail e endereço; busca sem acentos; histórico de
  compras, pedidos e orçamentos; total comprado, última compra e saldo em aberto (o saldo passa a ser alimentado pelo
  Contas a receber da Fase 7). Excluir é lógico: o histórico continua vinculado.
- **LGPD:** registro do consentimento (data), **exportação** dos dados do cliente em JSON (portabilidade) e
  **anonimização** irreversível — nome, documento, contatos e endereço são apagados, inclusive o CPF informado nas
  vendas, e as vendas continuam registradas sem identificar a pessoa. Ambas as ações ficam na auditoria.
- **Pedidos:** itens com o preço vigente no momento do registro (promoção/atacado/variação), desconto por item e geral
  (acima do limite do usuário exige autorização do supervisor), entrega prevista e situação
  (pendente → confirmado → em separação → pronto → entregue; ou cancelado com motivo). Pedidos **não baixam estoque**:
  a baixa acontece na venda. Impressão e PDF em A4.
- **Orçamentos:** validade (vencidos aparecem como "Expirado"), contato avulso quando não há cliente cadastrado, itens
  de **texto livre** (precisam ser trocados por produtos/serviços antes de converter), situação
  (rascunho/enviado/aprovado/recusado), impressão e PDF. Conversão em **pedido** (uma única vez) ou venda direta no PDV.
- **Venda no PDV a partir de pedido/orçamento** ("Vender no PDV"): itens, preços e descontos combinados ficam
  bloqueados para edição; a venda é única por documento. Cancelar a venda libera o pedido/orçamento novamente.
- **Serviços:** produtos marcados como "É um serviço" não têm estoque nem variações e não geram movimentação de
  estoque ao vender, cancelar ou devolver.
- **Catálogo:** produtos ativos agrupados por categoria, com imagem, preço atual e promoção; filtros por categoria,
  estoque e promoção; opção de ocultar preços; impressão e PDF A4 (imagens embutidas no arquivo).

## Financeiro e relatórios (Fase 7)

- **Contas a pagar:** descrição, fornecedor, categoria, nº do documento, valor, vencimento e observações. Alertas de
  contas atrasadas, que vencem hoje e nos próximos 7 dias. O pagamento registra valor pago (com juros ou desconto),
  forma e data — **o sistema não faz pagamentos bancários**, apenas registra que a conta foi paga. Em dinheiro, pode
  sair da gaveta do caixa aberto (gera saída no caixa e respeita o saldo da gaveta). Reenviar o mesmo pagamento não
  paga duas vezes. **Recorrência** semanal, mensal ou anual: ao pagar, a próxima conta é criada uma única vez.
  Estorno do pagamento (com motivo; se saiu da gaveta, o dinheiro volta ao caixa aberto) e cancelamento de contas
  em aberto. **Comprovante** (PDF, JPG ou PNG, até 10 MB) anexado e aberto no programa padrão do Windows.
- **Contas a receber:** parcelas do crediário geradas pelo PDV e lançamentos avulsos (parcela única ou mensal).
  Recebimento total ou **parcial**, com juros/multa e desconto concedido; o valor nunca ultrapassa o saldo e o mesmo
  recebimento não é registrado duas vezes. Dinheiro exige caixa aberto (entra na gaveta); PIX/cartão entram no
  caixa aberto do usuário, se houver. Estorno de recebimento, alteração de vencimento (renegociação, auditada),
  identificação de atrasos (dias em atraso) e recibo de pagamento para impressão.
- **Crediário no PDV:** forma de pagamento "Crediário" para cliente identificado com **limite** definido no cadastro
  (somente quem tem a permissão de Contas a receber altera o limite). O limite disponível considera as parcelas em
  aberto. Parcelas mensais (1 a 12) com o vencimento da primeira escolhido no pagamento; aparecem no comprovante.
  Cancelar a venda cancela as parcelas (se alguma já foi recebida, é preciso estornar antes). Na devolução, o
  reembolso pode ser **abatido das parcelas em aberto**.
- **Relatórios:** vendas por dia e por mês (valor bruto, descontos, faturamento, devoluções, receita líquida, custo,
  lucro bruto, margem e ticket médio), formas de pagamento, descontos, cancelamentos e devoluções, desempenho dos
  operadores, produtos mais e menos vendidos, posição e movimentações de estoque, fluxo de caixa (realizado e
  previsto), contas a pagar e a receber. Filtros por período, categoria e produto (quando se aplicam). Exportação
  em **PDF**, **Excel (.xlsx)** e **CSV** (padrão do Excel brasileiro) e impressão. Todos os valores são calculados a
  partir dos registros gravados; o custo usado é o custo unitário gravado em cada venda.
- **Fluxo de caixa:** entradas = vendas recebidas (dinheiro líquido de troco, PIX, cartões e outros, menos
  cancelamentos e reembolsos) + contas recebidas; saídas = contas pagas. Crediário entra quando a parcela é recebida;
  suprimentos e sangrias são transferências internas e não entram. A previsão usa os vencimentos em aberto.

## Integrações (Fase 8)

- **Impressoras (Configurações → Impressoras e dispositivos):** uma impressora para cada uso — comprovantes
  (térmica, bobina de 58 ou 80 mm), documentos A4 (convencional) e etiquetas — escolhida entre as instaladas no
  Windows, com cópias, impressão direta (sem janela) e página de teste. Comprovantes podem sair automaticamente ao
  concluir a venda. Todos os comprovantes são **não fiscais**.
- **Gaveta de dinheiro:** comando ESC/POS (pulso no pino 2 ou 5) enviado à impressora térmica **compartilhada** no
  Windows (ex.: `\\localhost\Termica`; use o driver do fabricante ou "Generic / Text Only") ou à **porta serial**
  (`COM3`; a velocidade é a do Gerenciador de Dispositivos). Abre nas vendas com dinheiro (opcional) e pelo botão
  "Abrir gaveta" do PDV; toda abertura e falha fica na auditoria. Se a gaveta falhar, a venda continua registrada e
  o operador é avisado.
- **Etiquetas:** em Produtos → Etiquetas, com nome, preço vigente e código de barras gerado pelo próprio sistema
  (EAN-13 quando o código de barras é válido; Code 128 para SKU/código interno). Rolo de etiquetas no tamanho
  configurado ou folha A4 em colunas; impressão ou PDF.
- **Leitor de código de barras USB:** funciona como teclado, sem configuração; há um campo de teste nas configurações.
- **Notas fiscais (NF-e/NFC-e):** conferência dos cadastros (CNPJ, IE, regime tributário/CRT, endereço; NCM, CFOP,
  origem e CST/CSOSN de cada produto — novo campo no cadastro), preparação da nota a partir da venda com as
  pendências encontradas e os códigos de pagamento da SEFAZ (tPag), ciclo de vida (preparada, em processamento,
  autorizada, rejeitada, cancelada, descartada) e cancelamento com justificativa. **Nenhum provedor está integrado
  nesta versão**: sem provedor, nada é transmitido e nenhuma nota é marcada como autorizada. A integração usa o
  contrato `FiscalProvider` (`electron/integrations/fiscal/provider.ts`): implemente emitir/consultar/cancelar com a API
  do provedor contratado, registre-o em `FISCAL_PROVIDERS`/`createFiscalProviders()` e homologue no ambiente de
  homologação. O XML autorizado e o DANFE devolvidos ficam em `%APPDATA%\Sistema Comercial\fiscal\`. Nenhuma regra
  tributária é calculada pelo sistema: os códigos vêm do cadastro e devem ser validados pelo contador. Venda com
  nota autorizada, em processamento ou com situação a confirmar só pode ser cancelada depois de resolver a nota.
- **TEF:** contrato `TefProvider` (`electron/integrations/tef/provider.ts`) para iniciar, consultar e cancelar
  transações com um provedor homologado; nenhum está integrado e o sistema nunca simula aprovações. Enquanto isso,
  **TEF → Conciliação** confere os pagamentos de cartão/PIX registrados no PDV com o extrato da maquininha/banco:
  NSU, autorização e bandeira (informados no pagamento ou depois) e marcação de conferido, com totais por forma.
  NSU limitado a 12 dígitos e autorização a 12 caracteres — um número de cartão não pode ser gravado.

## Assinatura digital (distribuição comercial)

O instalador gerado **não está assinado**. Sem assinatura, o Windows SmartScreen exibirá o aviso
"O Windows protegeu o computador" e alguns antivírus podem bloquear o arquivo. Para distribuir comercialmente:

1. Adquira um certificado de assinatura de código (Code Signing) de uma autoridade certificadora
   (ex.: DigiCert, Sectigo, GlobalSign). Certificados **EV** removem o aviso do SmartScreen imediatamente;
   certificados OV acumulam reputação com o tempo. Desde 2023 os certificados ficam em token físico (HSM) ou
   serviço de assinatura em nuvem (ex.: Azure Trusted Signing).
2. Configure o electron-builder (variáveis `CSC_LINK`/`CSC_KEY_PASSWORD` para arquivo .pfx, ou a seção
   `win.azureSignOptions` para Azure Trusted Signing). Veja https://www.electron.build/code-signing-win
3. Assine **sempre** o instalador e o executável com o mesmo certificado em todas as versões.

## Funcionalidades que dependem de serviços/equipamentos externos

- **NF-e / NFC-e:** dependem de provedor fiscal homologado, certificado digital A1/A3 da empresa e configuração
  tributária validada por contador. O sistema não simula autorização fiscal.
- **TEF:** depende de provedor compatível, credenciais e homologação. O sistema não simula aprovações.
- **PIX/cartão sem TEF:** registrados manualmente pelo operador; isso **não** é confirmação bancária.
- **Impressoras térmicas, etiquetas e gaveta:** usam o driver do fabricante instalado no Windows; a gaveta precisa
  estar ligada a uma impressora ESC/POS compartilhada ou a uma porta serial.

## Backup e restauração (Fase 9)

- **Como a cópia é feita:** `VACUUM INTO` executado na mesma conexão serializada do sistema, ou seja, nunca
  durante uma gravação em andamento e sem parar o uso. A cópia é conferida com `PRAGMA integrity_check`
  (feito via `ATTACH`/`DETACH` na própria conexão, para não deixar o arquivo preso — importante para
  "remover com segurança" um pendrive) e recebe uma assinatura SHA-256 registrada no histórico.
- **Manual** (*Configurações → Backup e restauração → Fazer backup agora*) e **automático** a cada 6, 12, 24 horas
  ou semanal, com **retenção** dos N últimos automáticos (os mais antigos são apagados; só arquivos criados pelo
  próprio sistema). Backups antes de atualizar o banco e antes de restaurar são feitos sempre.
- **Pasta de destino** escolhida pelo usuário, inclusive **pendrive ou HD externo**. Destino indisponível,
  sem espaço ou sem permissão gera falha registrada com o motivo, alerta no dashboard e nova tentativa
  automática após 1 hora (sem encher o histórico).
- **Proteção dos dados:** criptografia opcional **AES-256-GCM** (chave derivada da senha por scrypt; arquivo
  `.scbak`). A senha do backup fica protegida pelo Windows (DPAPI) neste computador; em outro computador ela é
  pedida na restauração. Arquivos criptografados não contêm nenhum dado legível; alteração ou senha errada são
  detectadas. Backups **sem** criptografia são bancos SQLite comuns: guarde-os em local seguro.
- **Verificação** a qualquer momento (assinatura SHA-256 + integridade), **histórico** com situação de cada
  arquivo (inclusive "arquivo não encontrado" quando o pendrive não está conectado) e "Mostrar na pasta".
- **Restauração:** de um backup do histórico ou de um arquivo escolhido. O sistema confere o arquivo (integridade,
  se é um banco do Sistema Comercial, se não é de uma versão mais nova) e mostra o conteúdo (empresa, produtos,
  clientes, vendas, última venda). A confirmação exige **a senha do usuário** e digitar **RESTAURAR**. Antes da
  troca é feito um backup do banco atual; o sistema reinicia e troca o arquivo **antes** de abrir o banco (o
  driver só libera o arquivo ao encerrar o processo). O banco substituído também é preservado em
  `backups\substituido-AAAAMMDD-HHMMSS.db`. Backups de versões anteriores são atualizados pelas migrations.
- Permissão `backup.manage` (perfil Administrador). Toda criação, falha, verificação e restauração fica na auditoria.

## Atualizações e desinstalação

- **Atualizar:** instale a nova versão por cima (mesmo instalador). Os dados ficam em `%APPDATA%` e não são
  tocados pela instalação; na primeira abertura o sistema faz um backup automático e aplica as migrations do
  banco. Atualização automática pela internet não está configurada (`publish: null`); para ativá-la, configure um
  servidor de atualizações no electron-builder (`publish`) e o `electron-updater` — exige instalador assinado.
- **Desinstalar:** pelo "Adicionar ou remover programas" do Windows. Os dados e backups **não** são apagados
  (`deleteAppDataOnUninstall: false`); para remover tudo, apague manualmente `%APPDATA%\Sistema Comercial`
  depois de garantir uma cópia dos backups.

## Limitações conhecidas

- **Instalador não assinado** (ver "Assinatura digital"): o SmartScreen avisa na primeira execução.
- **Notas fiscais e TEF:** apenas a estrutura e o contrato de integração; nenhum provedor está integrado.
- **Impressoras, gaveta e leitor:** implementados com os recursos do Windows (driver do fabricante, ESC/POS cru),
  mas não testados com equipamentos físicos neste desenvolvimento — use os botões de teste nas configurações.
- **Um computador:** o sistema foi projetado para um único computador (banco local, uma instância por vez).
- **Atualização automática** não configurada (ver acima).
