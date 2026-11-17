'use strict';
/*
 * Sincronismo de som e imagem (lip sync) da transmissão.
 *
 * Calibração automática: a mesa passa pela cadeia real de envio (PROGRAM → gravador do navegador → codificador) um sinal
 * de teste, tela preta com clarões brancos e, no mesmo instante, um bipe de 1 kHz. O serviço grava, mede a diferença entre
 * o clarão e o bipe no arquivo (public: avsync.cjs), apaga o arquivo e devolve o resultado. A mesa guarda a compensação
 * (positivo atrasa o som; negativo atrasa a imagem) e o codificador a aplica em toda transmissão e gravação.
 *
 * O teste mede o caminho do programa (mixer e imagem). A latência do microfone e da placa de áudio do próprio operador não
 * entra no teste: para isso existe o ajuste fino, que soma à compensação medida.
 */
(() => {
  const B = window.andromedaBroadcast; if (!B || typeof transportPanel === 'undefined') return;
  const { model } = B;
  const make = (tag, className, text) => { const el = document.createElement(tag); if (className) el.className = className; if (text !== undefined) el.textContent = text; return el; };
  const clamp = ms => Math.max(-500, Math.min(500, Math.round(Number(ms) || 0)));
  const key = () => (model.engineUsed === 'native' ? 'avSyncNativeMs' : 'avSyncMs'); // o valor é guardado por motor de envio
  const FLASHES = 8, FIRST = 1500, GAP = 1200;
  const cal = { running: false, last: null, onResult: null };

  /* ---------- sinal de teste desenhado no PROGRAM ---------- */
  const baseDraw = drawFx;
  drawFx = function (ctx, canvas) {
    baseDraw.apply(this, arguments);
    const probe = window.__syncProbe; if (canvas !== programOutput || !probe) return;
    const now = performance.now(); let on = false;
    for (const f of probe.flashes) if (now >= f.at && now < f.at + 100) on = true;
    ctx.fillStyle = on ? '#fff' : '#000'; ctx.fillRect(0, 0, canvas.width, canvas.height);
  };
  function scheduleSignal() {
    const ac = audioMixer.context, probe = { flashes: [] }; window.__syncProbe = probe;
    for (let i = 0; i < FLASHES; i++) {
      const at = performance.now() + FIRST + i * GAP; probe.flashes.push({ at });
      // O bipe é agendado no relógio do áudio para o mesmo instante do clarão.
      const t = ac.currentTime + (at - performance.now()) / 1000, osc = ac.createOscillator(), gain = ac.createGain();
      osc.frequency.value = 1000; gain.gain.setValueAtTime(0, t); gain.gain.linearRampToValueAtTime(.5, t + .002); gain.gain.setValueAtTime(.5, t + .098); gain.gain.linearRampToValueAtTime(0, t + .1);
      osc.connect(gain).connect(audioMixer.master); osc.start(t); osc.stop(t + .12);
    }
    return FIRST + (FLASHES - 1) * GAP + 1200;
  }

  /* ---------- painel (dentro do Codificador) ---------- */
  const card = make('section', 'sync-card'); card.setAttribute('aria-label', 'Sincronismo de som e imagem');
  card.innerHTML = '<h4>Sincronismo de som e imagem</h4>' +
    '<p class="sync-help">Corrige o "lip sync" medindo o caminho real do programa. A compensação vale para toda transmissão e gravação a partir da próxima.</p>' +
    '<div class="sync-row"><button type="button" id="syncCalibrate">Calibrar automaticamente</button><span id="syncState" class="sync-state"></span></div>' +
    '<label class="sync-fine">Ajuste fino <input id="syncSlider" type="range" min="-300" max="300" step="5" aria-label="Compensação de sincronismo em milissegundos"><output id="syncOut"></output></label>' +
    '<div class="sync-row"><button type="button" id="syncZero">Zerar</button><small id="syncNote" role="status"></small></div>';
  transportPanel.append(card);
  const q = s => card.querySelector(s);
  const describe = ms => ms === 0 ? '0 ms (sem compensação)' : (ms > 0 ? '+' : '−') + Math.abs(ms) + ' ms · ' + (ms > 0 ? 'som atrasado para alinhar' : 'imagem atrasada para alinhar');
  function paint() {
    const ms = clamp(model[key()]), busy = typeof busyTx === 'function' && busyTx();
    q('#syncSlider').value = String(ms); q('#syncOut').textContent = (ms > 0 ? '+' : ms < 0 ? '−' : '') + Math.abs(ms) + ' ms';
    q('#syncState').textContent = 'Compensação: ' + describe(ms);
    for (const id of ['#syncCalibrate', '#syncSlider', '#syncZero']) q(id).disabled = busy || cal.running;
    q('#syncCalibrate').textContent = cal.running ? 'Calibrando…' : 'Calibrar automaticamente';
  }
  const note = text => { q('#syncNote').textContent = text; };
  q('#syncSlider').oninput = () => { model[key()] = clamp(q('#syncSlider').value); B.save(); paint(); note('Vale a partir da próxima transmissão ou gravação.'); };
  q('#syncZero').onclick = () => { model[key()] = 0; B.save(); paint(); note('Compensação zerada.'); };
  setInterval(paint, 700);

  /* ---------- calibração ---------- */
  async function calibrate() {
    if (cal.running) return;
    if (typeof busyTx === 'function' && busyTx()) { note('Pare a transmissão antes de calibrar.'); return; }
    cal.running = true; paint();
    note('Calibrando: durante cerca de 12 segundos a saída do AR mostra clarões e bipes. Faça isto antes de entrar no ar.');
    const keep = { mode: model.mode, record: model.record, dir: model.dir, recordFormats: model.recordFormats, resolution: model.resolution, bitrate: model.bitrate };
    let wait = null;
    const result = new Promise(resolve => { wait = resolve; });
    cal.onResult = r => wait(r);
    try {
      // Gravação de teste curta, só neste computador: sem destinos, sem plataformas.
      Object.assign(model, { mode: 'record', record: true, recordFormats: '16:9', resolution: '720p', bitrate: 3, dir: B.live.storage?.defaultDir || model.dir });
      liveTx.calibrating = true;
      await window.startBroadcast();
      const t0 = Date.now(); while (liveTx.phase !== 'sending' && Date.now() - t0 < 25000 && liveTx.calibrating) await new Promise(r => setTimeout(r, 100));
      if (liveTx.phase !== 'sending') throw Error(document.querySelector('#txStatus')?.textContent || 'O codificador não iniciou o teste.');
      await new Promise(r => setTimeout(r, 1200));
      const total = scheduleSignal(); await new Promise(r => setTimeout(r, total));
      window.__syncProbe = null; stopTransport();
      const answer = await Promise.race([result, new Promise(r => setTimeout(() => r({ error: 'O serviço não respondeu a tempo.' }), 40000))]);
      finish(answer);
    } catch (e) { finish({ error: e.message }); }
    finally {
      window.__syncProbe = null; liveTx.calibrating = false; Object.assign(model, keep); B.save(); cal.running = false; cal.onResult = null;
      paint();
    }
  }
  function finish(r) {
    cal.last = r;
    if (!r || r.error) { note('Não foi possível medir: ' + (r?.error || 'sem resposta') + ' Nada foi alterado.'); return; }
    if (!r.reliable) { note('A medição ficou instável (' + r.pairs + ' pares, dispersão de ' + r.spreadMs + ' ms). Tente de novo, com o computador menos ocupado. Nada foi alterado.'); return; }
    // A imagem só tem resolução de um quadro (cerca de 33 ms): abaixo de 40 ms a diferença é ruído de medição e também está abaixo do que o olho percebe (ITU-R BT.1359: 45 ms com o som adiantado).
    const compensation = Math.abs(r.offsetMs) < 40 ? 0 : clamp(-r.offsetMs);
    model[key()] = compensation; B.save();
    const how = r.offsetMs > 0 ? 'o som chegava ' + r.offsetMs + ' ms depois da imagem' : r.offsetMs < 0 ? 'o som chegava ' + Math.abs(r.offsetMs) + ' ms antes da imagem' : 'som e imagem alinhados';
    note(compensation === 0 ? 'Medido: ' + how + '. Dentro da margem de um quadro: nenhuma compensação necessária.' : 'Medido: ' + how + '. Compensação aplicada: ' + describe(compensation) + '. Precisão de cerca de ±17 ms.');
    try { window.andromedaAudit?.('info', 'sincronismo-calibrado', 'Sincronismo calibrado', { medidoMs: r.offsetMs, compensacaoMs: compensation, pares: r.pairs }); } catch { /* auditoria opcional */ }
    log('Sincronismo calibrado: compensação ' + describe(compensation));
  }
  q('#syncCalibrate').onclick = calibrate;
  paint();
  window.andromedaSync = { calibrate, onResult: r => cal.onResult?.(r), state: cal, card };
})();
