# Andromeda Cam — projeto nativo experimental

Código-fonte Flutter + flutter_webrtc 1.6.3, com canais nativos Swift/Kotlin. Não é um APK/IPA compilado. Leia também ../ATUALIZACAO_06.md para infraestrutura, limites e pareamento.

## Android

Instale Flutter SDK estável compatível com Dart >=3.5, Android Studio/SDK, JDK compatível e Python 3. Execute flutter doctor e resolva as dependências. Na pasta deste projeto, execute PREPARAR_ANDROID.bat. Ele gera os projetos de plataforma, aplica permissões/canais nativos, instala dependências, analisa o código e tenta criar um APK debug. A compilação ainda não foi validada nesta entrega: possíveis incompatibilidades precisam ser corrigidas no ambiente de desenvolvimento. O pacote gerado, se a compilação terminar, estará em build/app/outputs/flutter-apk/app-debug.apk.

Revise requisitos Android minSdk/Gradle do flutter_webrtc utilizado, sem baixar os níveis exigidos pelo plugin. Conecte um telefone via USB com depuração habilitada e use flutter run. Para distribuição comercial configure assinatura de produção e revisão de permissões; não distribua credenciais privadas no binário.

## iOS

Precisa de Mac, Xcode, ferramentas de desenvolvimento Flutter/iOS e assinatura Apple. Execute sh preparar_ios.sh. Abra ios/Runner.xcworkspace, ajuste o deployment target exigido pelo plugin, selecione a equipe Apple e o aparelho. Compilar sem assinatura não instala o app. TestFlight/App Store exigem as etapas próprias da Apple.

## Uso

Configure o gateway da mesa e gere um convite. Cole o link HTTPS completo, conecte fones, escolha qualidade e toque Conectar. O tally vem da mesa. Segure FALAR DTV para intercom; o microfone do programa fica silenciado enquanto fala. Deixe o aplicativo em primeiro plano.

Seleção de lente física é restritiva: se o plugin não expuser a lente indicada pelo hardware, ela não é oferecida. Não há zoom digital de fallback. Controles ISO/WB Android e controle manual de estabilização ficam indisponíveis. A versão iOS dos controles manuais exige teste físico. O medidor e a qualidade dependem das estatísticas retornadas pelo capturador. Temperatura Android refere-se à bateria, quando exposta.

Não foram feitos flutter analyze completo, build Android/iOS, testes instrumentados, teste físico de áudio/retorno nem ensaio em 5G. Estes são itens obrigatórios de homologação, não recursos já certificados. Consulte o relatório de validação da mesa para separar os testes realmente executados.
