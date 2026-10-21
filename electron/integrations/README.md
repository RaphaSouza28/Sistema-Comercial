# Integrações externas

Adaptadores para equipamentos e provedores. As regras de negócio ficam em `electron/services`; aqui ficam
apenas os contratos e a comunicação, para trocar de fornecedor/equipamento sem mexer nas regras.

| Pasta | Conteúdo |
| --- | --- |
| `devices/escpos.ts` | Comandos ESC/POS (pulso da gaveta) e envio "cru" para impressora compartilhada (`\\pc\nome`) ou porta serial (`COMn`). |
| `devices/barcode.ts` | Códigos de barras sem dependências: EAN-13 e Code 128-B, desenhados em SVG para as etiquetas. |
| `fiscal/provider.ts` | Contrato `FiscalProvider` (emitir, consultar, cancelar). **Nenhum provedor integrado.** |
| `tef/provider.ts` | Contrato `TefProvider` (iniciar, consultar status, cancelar). **Nenhum provedor integrado.** |

A impressão em impressoras do Windows (térmica, convencional, etiquetas) usa o próprio Electron em
`electron/main/printing.ts`, com a configuração de Configurações → Impressoras e dispositivos.

## Regras que qualquer integração deve seguir

- O status `AUTHORIZED` (nota fiscal) e `APPROVED` (TEF) só podem ser gravados com a resposta real do
  provedor homologado. Nada de simulação.
- Nunca armazenar o número completo do cartão; no máximo NSU, autorização, bandeira e os 4 últimos dígitos.
- Credenciais do provedor ficam no cofre local (`electron/main/secrets.ts`, protegido pelo Windows), nunca no
  banco, nos backups ou nos logs.
- Homologar no ambiente de testes do provedor/SEFAZ antes de usar em produção.

## Como integrar um provedor fiscal

1. Crie `fiscal/<provedor>.ts` implementando `FiscalProvider` com as chamadas HTTP do provedor.
2. Registre a chave em `FISCAL_PROVIDERS` (`shared/integrationSchemas.ts`) e a instância em
   `createFiscalProviders()`.
3. Teste o ciclo completo em homologação: transmitir, consultar, cancelar, XML e DANFE.
   O teste `tests/integration/integrations.test.ts` mostra o fluxo esperado com um dublê de provedor.
