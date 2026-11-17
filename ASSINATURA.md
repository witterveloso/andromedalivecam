# Instalador confiável: assinatura de código

O Windows (SmartScreen e Defender) e o macOS (Gatekeeper) só tratam um instalador como "programa comum" quando ele está **assinado por um certificado emitido por uma autoridade reconhecida**. Sem isso aparece "Editor desconhecido" ou "O Windows protegeu o seu computador". Nenhum ajuste no código do programa substitui o certificado, e um certificado criado por nós mesmos não adianta: o Windows não o reconhece.

O que o programa **já faz** a partir da 0.21.3:
- O CI está pronto para **assinar o instalador, o desinstalador e o programa** assim que houver credenciais (abaixo), confere se a assinatura ficou válida e **falha a publicação** se não ficou. Sem credenciais, continua gerando o instalador sem assinatura, com um aviso no log.
- Cada versão publicada traz o arquivo **`SHA256SUMS.txt`**, para quem baixa conferir que o arquivo é o original: `certutil -hashfile Andromeda-Live-Setup-X.Y.Z.exe SHA256`.

## O que só você pode fazer (identidade e pagamento)

### Windows

A autoridade precisa validar **quem é o editor** (empresa ou pessoa), com documentos. Duas rotas:

**A) Azure Artifact Signing** (antigo *Trusted Signing*, serviço da Microsoft, cerca de US$ 9,99 por mês, o certificado é da Microsoft e a assinatura é feita na nuvem).
- Pelas respostas oficiais da Microsoft em 2026, **organizações** nos EUA, Canadá, União Europeia e Reino Unido podem usar; **pessoas físicas** só nos EUA e Canadá. O Brasil **não aparece** na lista conhecida: confirme com a Microsoft antes de contar com esta rota.
- Se for elegível: crie a conta de assinatura e o perfil de certificado no Azure, crie uma aplicação (service principal) com permissão de assinar e cadastre estes **segredos** no GitHub (Settings → Secrets and variables → Actions): `AZURE_TENANT_ID`, `AZURE_CLIENT_ID`, `AZURE_CLIENT_SECRET`, `AZURE_SIGN_ENDPOINT`, `AZURE_SIGN_ACCOUNT`, `AZURE_SIGN_PROFILE` e, se quiser, `WIN_PUBLISHER_NAME` (nome do editor exatamente como no certificado). O CI usa sozinho.

**B) Certificado de assinatura de código (OV) de uma autoridade** (por exemplo SSL.com, Sectigo, DigiCert; costuma custar algumas centenas de dólares por ano).
- Desde 2023 a chave privada dos certificados novos **fica em hardware** (token ou HSM na nuvem): em geral não existe mais arquivo `.pfx` para guardar no GitHub. Por isso, escolha uma oferta com **assinatura na nuvem para CI** e me diga qual: o passo de assinatura do CI é adaptado ao serviço escolhido.
- Se a autoridade entregar um `.pfx` exportável, cadastre `WIN_CSC_LINK` (o arquivo em Base64) e `WIN_CSC_KEY_PASSWORD`; o CI já aceita.

**Importante sobre o SmartScreen:** mesmo com assinatura, o aviso pode aparecer nos **primeiros downloads**, até o arquivo ganhar reputação com o uso. A documentação da Microsoft diz que o certificado EV **não** dá mais confiança imediata: OV e EV constroem reputação do mesmo jeito. A assinatura troca "Editor desconhecido" pelo seu nome e é o que faz a reputação se acumular.

### Enquanto não há certificado
- No aviso do SmartScreen: **Mais informações → Executar assim mesmo**.
- Conferir o arquivo com o `SHA256SUMS.txt` da versão.
- **Enviar o instalador à Microsoft** para análise como falso positivo (https://www.microsoft.com/wdsi/filesubmission, opção de desenvolvedor de software). Ajuda quando o Defender bloqueia ou apaga o arquivo.

### macOS
Exige o **Apple Developer Program** (cerca de US$ 99 por ano), um certificado *Developer ID Application* e a **notarização** da Apple. Hoje o Andrômeda Live só tem versão para **Windows**: criar a versão para Mac é trabalho à parte (construir em um Mac, testar câmeras, áudio e codificação nele). Se quiser o Mac, é uma decisão a tomar antes.
