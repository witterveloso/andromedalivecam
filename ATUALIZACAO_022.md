# Andrômeda Live 0.22 — SLIDES: apresentações no ar

## 0.22.0
- **Novo painel e fonte SLIDES.** Carregue a apresentação na mesa (arraste o arquivo para o painel **Slides · Apresentação** ou use **+ Abrir apresentação**) e leve ao ar como qualquer outra fonte: **SLIDES → PREVIEW**, depois **CUT** ou **AUTO**. O monitor do PREVIEW e o do PGM mostram o slide inteiro (ou preenchendo a tela, à sua escolha), com troca em **corte seco** ou **fusão suave**.
- **Reconhece os formatos pelo conteúdo, não só pela extensão:**
  - **PDF**: aberto na própria mesa, sem internet e sem programa extra.
  - **PowerPoint** (PPTX, PPT, PPSX, PPS, POTX…), **OpenDocument** (ODP), **Keynote** (KEY), **Word**, **Excel**, TIFF e outros: o serviço local converte para PDF pelo **Microsoft PowerPoint** (se estiver instalado) ou pelo **LibreOffice** (gratuito). A conversão é fiel ao original.
  - **Imagens** (PNG, JPG, WEBP, GIF, BMP, SVG, AVIF…): cada imagem é um slide; várias imagens soltas juntas viram uma apresentação só, em ordem natural (img2 antes de img10).
  - Sem PowerPoint nem LibreOffice no computador, o **PPTX** ainda abre por um **leitor simplificado** embutido (textos, imagens, formas e tabelas; fontes e efeitos podem sair diferentes, e a mesa avisa). Outros formatos pedem para instalar o LibreOffice ou exportar em PDF.
  - As animações do PowerPoint não são reproduzidas: cada slide aparece pronto.
- **Passar os slides, de todo jeito:**
  - **Teclado:** **PageDown** (próximo) e **PageUp** (anterior), as teclas que os controles de apresentação e canetas enviam; **F12** leva os slides ao PREVIEW. Primeiro e último slide ficam livres para você escolher uma tecla em *Personalizar → Atalhos do teclado*; todas podem ser trocadas.
  - **Comandos:** novos botões **SLIDES**, **SLIDE ANTERIOR** e **PRÓXIMO SLIDE** (personalizáveis como os demais).
  - **No painel:** **ANTERIOR / PRÓXIMO**, **miniaturas** (clique para ir a qualquer slide), **Ir para o slide nº**, pré-visualização do **slide atual e do próximo**.
  - **Celular:** no **controle remoto** da mesa na nuvem aparece a linha **SLIDES** (anterior, próximo, nº do slide e **Slides → PRV**); PageDown/PageUp também funcionam no navegador do computador remoto.
  - **Avançar sozinho** (a cada 5, 10, 15, 30 ou 60 s) enquanto os slides estão no AR, com **repetir ao chegar no fim**: bom para quadro de avisos e telão de espera.
- Vários arquivos podem ficar abertos ao mesmo tempo (um botão por apresentação, com **×** para fechar). Os arquivos ficam carregados enquanto a mesa estiver aberta.
- O painel entra no fim da Operação; quem já tem layout salvo mantém o layout e encontra o painel **Slides** no fim (ou em *Personalizar*). Em instalações com Comandos já arrumados, os novos botões entram ao lado do MOSAICO.
- Requisito do leitor de PDF: arquivos do leitor (pdf.js, licença Apache 2.0) vão dentro do programa; nada é baixado.
