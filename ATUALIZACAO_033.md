# Andrômeda Live 0.33 — auditoria e versão para venda por assinatura

## 0.33.1 — proteção da grade de 30 fps
- **O problema:** no Windows, quando o codificador da mesa atrasava, dois quadros podiam cair no mesmo ponto da grade de 1/30 s da gravação. Foi visto no CI: o teste exige que o tempo de cada quadro seja sempre maior que o do anterior, e falhou.
- **A correção:** o segundo quadro vai para o próximo ponto da grade. A gravação e o SRT continuam em múltiplos exatos de 1/30 s, com tempo sempre crescente.
- **Teste novo:** quadros tremidos na entrada.

## Transmissão: 30 fps cravados, medidos quadro a quadro
Medição de 61 s de live na mesa real, com destino RTMP, SRT e gravação ao mesmo tempo:

| Saída | Quadros | Taxa | Intervalo entre quadros | Buracos |
|---|---|---|---|---|
| Destino RTMP/RTMPS | 1838 | 30,000 fps | 33 ou 34 ms (o RTMP marca o tempo em milissegundos; média 33,333 ms) | nenhum |
| SRT | 1777 | 30,000 fps | 33,333 ms em todos os quadros | nenhum |
| Gravação MP4 | 1838 | 30,000 fps | 33,333 ms em todos os quadros | nenhum |

Quadro-chave a cada 2,0 s nas três saídas.

- **Novo: SRT e gravação MP4 com o tempo exato de cada quadro.**
  - O tempo interno guardado em milissegundos fazia os quadros saírem a 33 e 34 ms.
  - Agora cada quadro volta para a grade exata de 1/30 s (relógio de 90 kHz), sem recodificar.
  - Programas de edição (Premiere, DaVinci, Final Cut) leem a gravação como 30 fps constantes, sem aviso de "taxa variável".
- **O RTMP continua em 33/34 ms.** É o limite do próprio protocolo, igual em qualquer programa de transmissão; a plataforma recebe 30 quadros por segundo, sem falhas.

## Falha corrigida
- **Destino em espera corrigido antes de entrar no ar.** Se o operador trocava a chave (ou o servidor) de um destino em espera e depois apertava "Entrar no ar", o serviço usava a chave antiga. Agora vale a configuração que está na tela. Há teste automático cobrindo o caso.

## Venda por assinatura
- **Emissor de Licenças** (`tools/emissor-licencas.html`): página para o vendedor que funciona sem internet. Abre com duplo clique no Chrome ou no Edge.
  - **Criar as chaves** (uma vez só).
    - A chave privada é salva no seu computador e nunca sai dele: a página é proibida de se conectar a qualquer lugar.
    - A chave pública é a que vai dentro do programa.
  - **Emitir uma licença** para um cliente: nome, plano (Teste 14 dias, Mensal 31, Anual 366) e o código do computador dele.
  - A licença é aceita pelo programa só naquele computador; em outro, é recusada.
- **Cliente sem licença.** Ao apertar Transmitir, a mesa leva direto para Diagnóstico → Licença, com o código do computador e o campo para colar a licença.

## O que fica com você antes de vender
1. **Ligar o licenciamento.**
   - Abra o Emissor de Licenças, crie as chaves e guarde `licenca-privada.pem` com cópia de segurança.
   - Envie só a chave pública (o texto que começa com `-----BEGIN PUBLIC KEY-----`) para ela entrar no programa.
   - A partir da versão seguinte, todo instalador exige licença.
2. **Assinatura de código** (certificado de assinatura de código para Windows). Sem ela, o Windows mostra "O Windows protegeu o computador" na primeira instalação, e o cliente precisa clicar em "Mais informações → Executar assim mesmo". O CI já assina sozinho quando o certificado for configurado.
3. **Servidor da Rede Andrômeda** (VPS + domínio).
   - Hoje, câmera e mesa se encontram por servidores públicos de mensagens, com tudo cifrado de ponta a ponta. Eles funcionam, mas não têm garantia de funcionamento (SLA).
   - Para um produto pago, o servidor próprio da Rede Andrômeda substitui esses servidores e também garante 4G/5G com a mesa atrás de CGNAT.
