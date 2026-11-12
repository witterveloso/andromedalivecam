# Andrômeda Live 0.14.1 — monitores no tamanho que você escolher, layouts salvos e escolha entre transmitir e gravar

## Monitores (correção)

- **Bug corrigido:** Preview e PGM encolhiam sozinhos durante a operação até ficarem minúsculos.
  - Causa: a cada novo cálculo de tamanho (uma câmera entrando, a janela mudando), a área de áudio do PGM ocupava o espaço livre, e o cálculo seguinte diminuía a imagem um pouco mais.
  - Agora a imagem ocupa o espaço que o painel dá, sempre inteira em 16:9, sem cálculo repetido. Medido em navegador: 30 recálculos seguidos e o tamanho não muda.
- **Tamanho programado pelo operador:** em **Personalizar**, cada monitor mostra **− 100% +** no título.
  - Vai de 25% a 100%, de 5 em 5.
  - Também pode ser ajustado em Configurações → Personalizar a mesa, na coluna "Ordem · imagem".
  - O ajuste fica salvo.
- Aumentar ou diminuir o painel pelo canto muda a imagem junto.
- Preview e PGM lado a lado, com a mesma altura, ficam do mesmo tamanho.

## Gravar a personalização da Operação

- Em **Personalizar**, escreva um nome (por exemplo "Culto domingo" ou "Entrevista") e toque em **Salvar layout**.
- O layout aparece em **Modelo → Meus layouts**, junto com os modelos prontos. Escolher um volta a mesa exatamente para aquela arrumação: posições, tamanhos, página de cada painel e tamanho das imagens.
- Salvar com o mesmo nome atualiza o layout. **Excluir** apaga o layout escolhido.
- Qualquer ajuste depois disso aparece como "Personalizado (não salvo)".
- Cabem até 20 layouts neste computador. Para levar a outro computador, use Exportar/Importar layout.
- O mesmo vale em Configurações → Personalizar a mesa.

## Transmitir e gravar, só transmitir ou só gravar

Ao lado do botão principal, na página **Transmissão**, escolha o modo. O botão muda conforme a escolha.

| Modo | Botão | O que acontece |
| --- | --- | --- |
| **Transmitir e gravar** | ▶ TRANSMITIR + GRAVAR | O mesmo PROGRAM vai para os destinos e para o arquivo MP4. |
| **Só transmitir** | ▶ TRANSMITIR | Vai só para os destinos; nada é gravado. |
| **Só gravar** | ● GRAVAR | Grava o MP4 neste computador; nenhuma plataforma recebe nada. |

- **Bug corrigido:** com destinos ligados mas sem chave (por exemplo YouTube e Instagram ainda não configurados), a gravação sem transmitir era recusada com "falta servidor ou chave". Agora **Só gravar** ignora os destinos, completos ou não.
- Ensaio no navegador nessa mesma situação: arquivo MP4 de 5 MB gravado e finalizado.
- Os modos que transmitem continuam exigindo pelo menos um destino pronto.

---

# Andrômeda Live 0.14 — mesa na nuvem: retorno do PGM e controle remoto

Agora dá para ver o PGM e operar a mesa de outro lugar, pelo celular ou por outro computador, em Wi-Fi, 4G ou 5G. Não é preciso instalar nada nem usar Tailscale: a mesa gera um link e você envia.

Abra em **Configurações → Mesa na nuvem**.

## Retorno do PGM (só assistir)

1. Em **Retorno do PGM**, toque em **Gerar link**.
2. Envie o link (Copiar, Compartilhar ou QR code) para quem vai assistir: diretor, cliente, apresentador, operador de câmera.
3. Quem abrir o link vê o PGM com o mesmo conteúdo que vai ao ar: GC, logotipo, PiP e mosaico.
   - O atraso fica abaixo de 1 segundo.
   - Não precisa estar transmitindo.
   - O selo muda para **PGM · NO AR** quando a transmissão está ativa.
4. **Ativar som** liga o áudio do PGM. Para isso, "Ativar áudio" precisa estar ligado na mesa antes da conexão, e "Enviar o som do PGM" marcado. **Tela cheia** deixa só a imagem.

Até 6 aparelhos ao mesmo tempo. Quem assiste não opera nada.

## Controle remoto (operar a mesa)

1. Em **Controle remoto**, toque em **Gerar link** e envie para quem vai operar.
2. A pessoa abre o link, escreve o nome e toca em **Pedir acesso à mesa**.
3. Na mesa aparece, em qualquer página: *"Controle remoto: Fulano quer operar a mesa"*. Toque em **Permitir** ou **Recusar**.
4. Aprovado, o aparelho mostra **Preview e PGM** e os botões:
   - fontes do Preview (CAM 1 a 10, BLK e MOSAICO);
   - CUT e AUTO;
   - tipo de transição (MIX, DIP, WIPE, STNG);
   - GC, logotipo, PiP e "Retirar todas".
   - **Corte direto no PGM** fica recolhido, para evitar toque acidental.
5. No computador, o teclado também funciona: Espaço = CUT, Enter = AUTO, 1–9 = Preview.

Segurança e limites:

- Cada aparelho novo precisa de aprovação na mesa. Um aparelho aprovado volta sem pedir de novo enquanto o link for o mesmo. "Esquecer aparelhos aprovados" ou "Novo link" exigem aprovação outra vez.
- **Desconectar** (na lista do painel) derruba o aparelho na hora. **Novo link** invalida o link antigo para todos. **Desligar** fecha o link.
- Até 2 aparelhos operando ao mesmo tempo.
- Os comandos remotos apertam os mesmos botões da mesa, com as mesmas travas: transição em andamento, mosaico vazio etc.
- Um GC sem texto ou um logotipo não carregado é recusado com aviso no aparelho, e a tela do operador não muda.
- Só os comandos acima são aceitos; qualquer outro é ignorado. Há no máximo 20 comandos por segundo.
- Tudo fica na auditoria (página Diagnóstico):
  - pedidos, aprovações e recusas;
  - conexões e desconexões;
  - cada comando, com o nome de quem operou.

## Como funciona

- O link tem uma chave de 192 bits. Pelo ponto de encontro do modo Internet passam só as mensagens de combinação, cifradas com AES-256-GCM e com tópico próprio de cada link.
- Imagem, som e comandos vão **direto** da mesa para o aparelho por WebRTC, criptografado com DTLS. Não há servidor intermediário vendo a imagem.
- Upload usado pela mesa:
  - cerca de 2,5 Mbps por aparelho no retorno;
  - cerca de 2,7 Mbps por aparelho no controle (PGM + Preview).

  Cinco pessoas assistindo usam cerca de 12 Mbps do upload. Some isso ao da transmissão.
- A página remota fica no GitHub Pages: `https://witterveloso.github.io/andromedalivecam/remoto.html`.

## Limites, ditos com clareza

- **Sem servidor TURN.** Como nas câmeras do modo Internet, algumas redes 4G/5G e corporativas bloqueiam a conexão direta. Nesses casos a página mostra "A imagem não chegou" e tenta de novo. Outra rede costuma resolver.
- Para dezenas de espectadores, use a transmissão (YouTube etc.): o retorno é feito para poucas pessoas.
- O computador da mesa precisa de internet. Na rede local sem internet, o retorno e o controle remoto não funcionam (as câmeras em modo Rede local continuam funcionando).

## Também nesta versão

- A página de versões passa a usar as notas da própria versão (a 0.13.0 saiu com o texto da 0.12 por engano; o conteúdo da 0.13 está em [ATUALIZACAO_013.md](ATUALIZACAO_013.md)).

## O que foi testado

- Testes automáticos:
  - comandos remotos aplicados pelos botões da mesa;
  - comandos fora da lista e índices inválidos recusados;
  - página remota com CSP estrita, sem script embutido e só com chaves completas.
- Ensaio de ponta a ponta em navegador (Chromium), com o ponto de encontro local:
  - retorno no celular com o PGM em 960×540 e imagem em movimento;
  - controle num notebook: pedido, aprovação na mesa, Preview e PGM, PRV CAM 3, DIP, CUT, GC no ar e GC vazio recusado;
  - desconectar pela mesa e reconectar sem nova aprovação;
  - "Novo link" derruba o link antigo, e um link adulterado não conecta;
  - auditoria com cada comando.
- **Ainda não testado:**
  - celulares reais;
  - redes 4G/5G reais;
  - os pontos de encontro públicos a partir deste ambiente.
