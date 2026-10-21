# Histórico de versões

## 1.0.0 — 20/10/2026

Primeira versão completa (fases 1 a 9 do plano de desenvolvimento).

- **Base:** aplicativo desktop Electron com banco SQLite local, migrations automáticas com backup prévio,
  login, perfis e permissões, auditoria, tema claro/escuro, dashboard.
- **Produtos:** variações, precificação inteligente, histórico de preços, importação/exportação CSV, imagens,
  serviços sem estoque, dados fiscais (NCM, CEST, CFOP, origem, CST/CSOSN).
- **Estoque:** entradas, saídas, ajustes, inventário em etapas, histórico e alertas.
- **PDV e caixa:** vendas com leitor de código de barras, descontos com autorização, múltiplas formas de
  pagamento, crediário, vale-troca, cancelamento, devoluções, comprovante não fiscal, abertura/sangria/
  suprimento/fechamento com conferência.
- **Comercial:** clientes (LGPD), pedidos, orçamentos e catálogo digital.
- **Financeiro e relatórios:** contas a pagar (recorrência, comprovante) e a receber (parciais, juros,
  estorno), fluxo de caixa e 13 relatórios com exportação PDF/Excel/CSV.
- **Integrações:** impressoras do Windows (térmica, A4, etiquetas), gaveta ESC/POS, etiquetas com código de
  barras, teste do leitor, notas fiscais preparadas para provedor homologado, conciliação de cartões/PIX e
  contrato TEF (sem provedores integrados).
- **Finalização:** backup manual e automático (pasta/pendrive, retenção, criptografia AES-256-GCM, verificação
  SHA-256), restauração confirmada com reinício seguro, bloqueio por inatividade, executável endurecido
  (Electron Fuses), alertas de backup no dashboard, manual do usuário.

### Correções nesta versão (encontradas na revisão final)

- O cancelamento de venda em dinheiro podia deixar a gaveta de quem cancela negativa; agora exige saldo.
- Verificações de backup feitas por conexão separada deixavam arquivos presos (impedindo apagar temporários e
  remover o pendrive com segurança); passaram a usar a própria conexão do sistema (ATTACH/DETACH).
- A troca do banco na restauração usava renomeação de um arquivo ainda aberto; passou a copiar com limpeza segura.
- Bloqueio por inatividade: além do servidor, a própria tela volta ao login após o tempo sem uso (antes, os dados
  continuavam visíveis até a próxima ação).
- A conferência de um backup do histórico consultava o registro antes de verificar a permissão.
- Arquivos Excel exportados agora gravam data/hora válidas dentro do ZIP; estrutura validada com o leitor Open XML do .NET.
