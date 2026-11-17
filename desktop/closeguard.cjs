'use strict';
// Segurança contra fechamento sem querer: o programa pergunta antes de fechar (X, Alt+F4, Sair do sistema…).
// O botão que já vem selecionado (Enter) e o Esc ficam em "Continuar operando"; só fecha quem escolhe fechar de propósito.
// A pergunta é assíncrona para não congelar o serviço local (e a transmissão) enquanto a janela de pergunta está aberta.
function createCloseGuard({ dialog, app, getWindow, isOnAir = async () => false, disabled = false }) {
  let confirmed = false, asking = false;

  async function ask() {
    const win = getWindow();
    if (!win || win.isDestroyed()) return true;
    if (win.isMinimized()) win.restore();
    win.show(); win.focus();
    if (asking) return false; // já tem uma pergunta aberta: só traz a janela para a frente
    asking = true;
    try {
      let onAir = false;
      try { onAir = !!(await Promise.race([isOnAir(), new Promise(resolve => setTimeout(() => resolve(false), 800))])); } catch { /* sem resposta da mesa */ }
      const result = await dialog.showMessageBox(win, onAir
        ? { type: 'warning', buttons: ['Continuar no ar', 'Encerrar e fechar'], defaultId: 0, cancelId: 0, noLink: true,
            title: 'Fechar o Andrômeda Live?', message: 'Você está no ar. Fechar o programa agora?',
            detail: 'Fechar interrompe a transmissão em todas as plataformas e finaliza a gravação.' }
        : { type: 'question', buttons: ['Continuar operando', 'Fechar o programa'], defaultId: 0, cancelId: 0, noLink: true,
            title: 'Fechar o Andrômeda Live?', message: 'Deseja mesmo fechar o Andrômeda Live?',
            detail: 'A mesa, as câmeras conectadas e o serviço local serão encerrados. Seus layouts e ajustes continuam salvos.' });
      if (result.response === 1) { confirmed = true; return true; }
      return false;
    } finally { asking = false; }
  }

  return {
    get confirmed() { return confirmed; },
    // Para o que o próprio programa decide encerrar (falha grave, usuário escolheu fechar na janela de erro).
    confirmNow() { confirmed = true; },
    // Evento 'close' da janela principal.
    handleClose(event) {
      if (disabled || confirmed) return;
      event.preventDefault();
      ask().then(ok => { if (ok) getWindow()?.close(); });
    },
    // Evento 'before-quit' do app (Cmd+Q, app.quit() de qualquer ponto): também passa pela pergunta.
    handleBeforeQuit(event) {
      if (disabled || confirmed || !getWindow()) return;
      event.preventDefault();
      ask().then(ok => { if (ok) app.quit(); });
    },
  };
}

module.exports = { createCloseGuard };
