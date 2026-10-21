# Manual do Sistema Comercial

Guia para quem usa o sistema no dia a dia: dono da loja, gerente e operadores de caixa.

## 1. Instalação

1. Execute `Sistema-Comercial-Setup-1.0.0.exe`.
2. Se aparecer "O Windows protegeu o computador", clique em **Mais informações → Executar assim mesmo**
   (o aviso aparece porque o instalador ainda não tem assinatura digital).
3. Escolha a pasta (ou mantenha a sugerida) e conclua. São criados atalhos na Área de Trabalho e no Menu Iniciar.

Requisitos: Windows 10 ou 11 de 64 bits. Não precisa de internet.

## 2. Primeiro acesso

Na primeira abertura, o assistente pede:

1. **Dados da empresa** (razão social, CNPJ/CPF, endereço). Aparecem nos comprovantes, orçamentos e catálogo.
2. **Administrador**: nome, usuário e senha (mínimo de 8 caracteres, com letras e números). **Guarde essa senha**:
   não existe senha padrão.
3. Preferências de estoque.

Depois, em **Usuários**, cadastre cada funcionário com o perfil certo:

| Perfil | Pode |
| --- | --- |
| Administrador | Tudo, inclusive usuários, permissões, backup e configurações |
| Gerente | Vendas, descontos, cancelamentos, estoque, pedidos, orçamentos, financeiro e relatórios |
| Operador de caixa | Abrir/fechar o próprio caixa, vender, consultar produtos e clientes |

As permissões de cada perfil podem ser ajustadas em **Usuários → Perfis e permissões**. Cada pessoa deve usar o próprio
usuário: tudo o que é importante fica registrado na auditoria com o nome de quem fez.

## 3. Cadastros iniciais

- **Produtos** → *Novo produto*: nome, código de barras, categoria, custo e preço. A calculadora sugere o preço a
  partir do custo, despesas e margem desejada. Produtos com tamanho/cor: marque *possui variações*.
  Para muitos produtos, use **Importar** (modelo CSV) ou **Cadastro rápido**.
- **Serviços** (mão de obra, instalação, frete): no cadastro do produto, marque *É um serviço* — não controla estoque.
- **Fornecedores** e **Clientes**. Para vender no **crediário**, o gerente define o *limite de crediário* no
  cadastro do cliente.
- **Etiquetas**: em Produtos → *Etiquetas*, escolha os produtos e a quantidade; imprime com código de barras e preço.

## 4. Rotina do dia

### Abrir o caixa
No **PDV**, informe o dinheiro que está na gaveta e clique em *Abrir caixa*.

### Vender
1. Leia o código de barras (ou digite o nome/código). Para várias unidades: `3*código` + Enter.
2. Opcional: *Identificar cliente*, *Desconto* (acima do seu limite, um gerente autoriza com usuário e senha).
3. **F8** abre o pagamento: escolha a forma (dinheiro, PIX, cartões, crediário, vale-troca), informe o valor e
   *Adicionar pagamento*. Pode combinar formas. Troco só em dinheiro.
4. **F9** finaliza. Imprima ou salve o comprovante (não fiscal).

Cartão e PIX são registrados manualmente: **confirme na maquininha/no banco antes de finalizar**. Se quiser,
anote o NSU e a autorização do comprovante — ajudam na conferência.

### Pedidos e orçamentos
- **Orçamentos**: monte com produtos (ou itens de texto livre), validade e envie em PDF. Aprovado, vire pedido ou
  venda com *Vender no PDV* — os preços combinados são mantidos.
- **Pedidos**: acompanhe a situação até *Entregue* e venda no PDV quando o cliente pagar.

### Cancelar ou devolver
Em **PDV → Vendas realizadas**, abra a venda:
- *Cancelar venda* (exige autorização se você não tiver permissão). O dinheiro sai da sua gaveta.
- *Devolução / troca* de alguns itens: reembolso em dinheiro, PIX, cartão, **vale-troca** ou abatido do crediário.

### Sangria e suprimento
Em **Caixa**, registre retiradas (sangria) e reforços de troco (suprimento) com uma descrição.

### Fechar o caixa
Em **Caixa → Fechar caixa**, conte o dinheiro (há um contador de cédulas e moedas) e, se quiser, confira PIX e
cartões pelo relatório da maquininha. Diferenças precisam de justificativa. Imprima o relatório de fechamento.

## 5. Financeiro

- **Contas a pagar**: cadastre as despesas com vencimento (podem se repetir todo mês). Ao pagar, informe o valor
  (com juros/desconto) e, se saiu dinheiro da gaveta, marque a opção — o caixa é atualizado. Anexe o comprovante.
- **Contas a receber**: as parcelas do crediário aparecem sozinhas. Para receber, clique em *Receber* (aceita
  pagamento parcial, juros e desconto) e imprima o recibo.
- Os cartões no topo mostram o que está **atrasado**, vence **hoje** e nos **próximos 7 dias**.
- **TEF → Conciliação**: confira os pagamentos de cartão/PIX com o extrato e marque como conferidos.

## 6. Relatórios

Em **Relatórios**, escolha o relatório, o período e (quando houver) a categoria ou o produto. Exporte em **PDF**,
**Excel** ou **CSV**, ou imprima. Destaques: vendas por dia/mês com lucro e margem, formas de pagamento, produtos
mais e menos vendidos, posição de estoque, fluxo de caixa, contas a pagar e a receber, desempenho dos operadores.

## 7. Backup — faça sempre

Os dados ficam só neste computador. **Se o computador estragar ou for roubado sem backup, os dados se perdem.**

- Em **Configurações → Backup e restauração**:
  - O **backup automático** já vem ligado (diário). Ajuste a frequência e quantos guardar.
  - Clique em **Escolher pasta** e selecione um **pendrive ou HD externo** para ter uma cópia fora do computador.
    Deixe o dispositivo conectado no horário do backup — se ele estiver desconectado, aparece um aviso.
  - Recomendado: **defina a senha do backup** e marque **Criptografar**. Anote a senha em local seguro: sem ela não
    é possível restaurar o backup em outro computador.
  - *Fazer backup agora* antes de qualquer mudança grande (importação de produtos, troca de computador).
- O **Dashboard** avisa quando o último backup falhou ou tem mais de 2 dias.

### Restaurar
1. **Configurações → Backup e restauração** → no histórico, clique no ícone de restaurar (ou *Restaurar de um
   arquivo…* para usar um backup do pendrive).
2. Confira o conteúdo mostrado (empresa, quantidade de produtos e vendas, data da última venda).
3. Digite **sua senha** e a palavra **RESTAURAR**.
4. O sistema guarda uma cópia dos dados atuais e reinicia já com os dados do backup.

Para **trocar de computador**: faça um backup no pendrive, instale o sistema no computador novo, conclua o
assistente com qualquer usuário temporário e restaure o backup (os usuários e senhas voltam a ser os do backup).

## 8. Impressoras e equipamentos

Em **Configurações → Impressoras e dispositivos**:

- Escolha a impressora de **comprovantes** (térmica, bobina 58 ou 80 mm), de **documentos A4** e de **etiquetas**.
  Instale antes o driver do fabricante no Windows. Use *Imprimir página de teste*.
- *Imprimir direto* evita a janela de impressão. *Imprimir automaticamente ao concluir cada venda* imprime o
  comprovante sozinho.
- **Gaveta de dinheiro** ligada à impressora térmica: compartilhe a impressora no Windows (Propriedades →
  Compartilhamento, ex.: nome *Termica*) e informe `\\localhost\Termica`; ou informe a porta serial (ex.: `COM3`).
  Use *Testar abertura da gaveta*. Toda abertura fica registrada.
- **Leitor de código de barras USB**: não precisa configurar. Teste no campo *Teste do leitor*.

## 9. Notas fiscais

O sistema confere os dados fiscais (empresa e produtos: NCM, CFOP, origem, CST/CSOSN) e prepara a nota a partir
da venda, mas **não emite notas sozinho**: a emissão exige contratar um provedor fiscal homologado, o certificado
digital da empresa e a orientação do seu contador. Enquanto isso, *Notas Fiscais → Pendências de cadastro* ajuda a
deixar os cadastros prontos.

## 10. Segurança

- Cada um com o próprio usuário e senha. Troque a senha pelo menu do seu nome (canto superior direito).
- Após 5 senhas erradas, o usuário é bloqueado por 5 minutos.
- A sessão é encerrada após 1 hora sem uso (ajuste em *Configurações → Segurança*).
- Usuários que saíram da empresa: **desative** em Usuários (o histórico é mantido).

## 11. Solução de problemas

| Situação | O que fazer |
| --- | --- |
| "Abra o caixa antes de registrar vendas" | No PDV, abra o caixa com o valor inicial. |
| Venda bloqueada por estoque | Dê entrada no estoque (Estoque → Entrada) ou permita estoque negativo no produto. |
| "Dinheiro insuficiente na gaveta" | O valor a devolver/pagar é maior que o dinheiro do seu caixa; faça um suprimento ou use outra forma. |
| Esqueci a senha do administrador | Outro administrador pode redefinir em Usuários. Se não houver outro, restaure um backup em que você saiba a senha. |
| Backup falhou | Veja a mensagem em Configurações → Backup: pendrive desconectado, sem espaço ou pasta sem permissão. |
| A gaveta não abre | Teste em Configurações; confira o compartilhamento/porta e o pino (2 ou 5). A venda é registrada mesmo assim. |
| O programa não abre | Veja `%APPDATA%\Sistema Comercial\logs\main.log`. Nenhum dado é apagado em caso de erro. |

Os dados ficam em `%APPDATA%\Sistema Comercial` (cole esse endereço na barra do Explorador de Arquivos).
O caminho exato aparece em *Configurações → Sobre o sistema*.
