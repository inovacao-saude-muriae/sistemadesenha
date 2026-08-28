const CHANNEL_NAME = "saude-tts";
const MONITOR_HEARTBEAT_MS = 2000;

// ─── Estado do módulo ──────────────────────────────────────────────────────────
let speakGeneration = 0;
let speakTimer      = 0;
let resumeTimer     = 0;
let voicesReady     = false;
let channel         = null;
let monitorHeartbeatAt = 0;
let isMonitorSpeaker   = false;

// Deduplicação — janela de 10 s para absorver qualquer atraso de rede
let lastSpokenKey = "";
let lastSpokenAt  = 0;
const DEDUP_WINDOW_MS = 10000;

// ─── BroadcastChannel ─────────────────────────────────────────────────────────
// Usado apenas para heartbeat: o monitor avisa "estou aberto nesta máquina".
// O dashboard usa isso para saber se deve falar localmente ou não.
// NÃO funciona entre máquinas diferentes — por isso o dashboard sempre fala
// como fallback quando não detecta monitor na mesma máquina.
function getChannel() {
  if (typeof window === "undefined" || typeof BroadcastChannel === "undefined") {
    return null;
  }
  if (!channel) {
    channel = new BroadcastChannel(CHANNEL_NAME);
    channel.onmessage = (event) => {
      const data = event.data || {};
      if (data.type === "monitor-here") {
        monitorHeartbeatAt = Date.now();
      }
    };
  }
  return channel;
}

// ─── Conversão numérica pt-BR ─────────────────────────────────────────────────
function numberToPt(value) {
  const n = Math.max(0, Math.min(1000, Number(value) || 0));
  if (n === 0) return "zero";
  if (n === 1000) return "mil";

  const units    = ["","um","dois","três","quatro","cinco","seis","sete","oito","nove"];
  const teens    = ["dez","onze","doze","treze","quatorze","quinze","dezesseis","dezessete","dezoito","dezenove"];
  const tens     = ["","","vinte","trinta","quarenta","cinquenta","sessenta","setenta","oitenta","noventa"];
  const hundreds = ["","cento","duzentos","trezentos","quatrocentos","quinhentos","seiscentos","setecentos","oitocentos","novecentos"];

  function underHundred(num) {
    if (num < 10) return units[num];
    if (num < 20) return teens[num - 10];
    const ten  = Math.floor(num / 10);
    const unit = num % 10;
    return unit ? `${tens[ten]} e ${units[unit]}` : tens[ten];
  }

  if (n < 100) return underHundred(n);
  if (n === 100) return "cem";
  const hundred = Math.floor(n / 100);
  const rest    = n % 100;
  return rest ? `${hundreds[hundred]} e ${underHundred(rest)}` : hundreds[hundred];
}

// ─── Texto de fala ─────────────────────────────────────────────────────────────
export function buildSpeechText(number, type) {
  const n      = Number(number) || 0;
  const spoken = numberToPt(n);
  if (type === "preferencial" || type === "preferential") {
    return `Senha preferencial. ${spoken}.`;
  }
  return `Senha. ${spoken}.`;
}

// ─── Seleção de voz ───────────────────────────────────────────────────────────
function pickVoice() {
  const voices = window.speechSynthesis.getVoices() || [];
  return (
    voices.find((v) => /pt-BR|pt_BR/i.test(v.lang)) ||
    voices.find((v) => /maria|francisca|google.*portugu/i.test(v.name)) ||
    voices.find((v) => v.lang?.toLowerCase().startsWith("pt")) ||
    null
  );
}

// ─── Inicialização de vozes ───────────────────────────────────────────────────
function waitForVoices() {
  if (typeof window === "undefined" || !("speechSynthesis" in window)) {
    return Promise.resolve();
  }
  const voices = window.speechSynthesis.getVoices();
  if (voices.length || voicesReady) {
    voicesReady = true;
    return Promise.resolve();
  }
  return new Promise((resolve) => {
    const done = () => { voicesReady = true; resolve(); };
    window.speechSynthesis.addEventListener("voiceschanged", done, { once: true });
    window.setTimeout(done, 1500);
  });
}

// ─── Watchdog anti-pausa do Chrome ────────────────────────────────────────────
function stopResumeWatch() {
  if (resumeTimer) { window.clearInterval(resumeTimer); resumeTimer = 0; }
}

function startResumeWatch() {
  stopResumeWatch();
  resumeTimer = window.setInterval(() => {
    if (!window.speechSynthesis.speaking) { stopResumeWatch(); return; }
    window.speechSynthesis.resume();
  }, 3000);
}

// ─── Sinal de alerta via AudioContext ─────────────────────────────────────────
function playAlertBeep() {
  return new Promise((resolve) => {
    if (typeof window === "undefined" || (!window.AudioContext && !window.webkitAudioContext)) {
      resolve(); return;
    }
    try {
      const AudioCtx = window.AudioContext || window.webkitAudioContext;
      const ctx      = new AudioCtx();
      const beeps    = [
        { freq: 880,  start: 0,    duration: 0.18 },
        { freq: 1100, start: 0.24, duration: 0.18 },
      ];
      let lastEnd = 0;
      for (const beep of beeps) {
        const osc  = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.connect(gain);
        gain.connect(ctx.destination);
        osc.type            = "sine";
        osc.frequency.value = beep.freq;
        const t0 = ctx.currentTime + beep.start;
        const t1 = t0 + beep.duration;
        gain.gain.setValueAtTime(0, t0);
        gain.gain.linearRampToValueAtTime(0.6, t0 + 0.02);
        gain.gain.setValueAtTime(0.6, t1 - 0.04);
        gain.gain.linearRampToValueAtTime(0, t1);
        osc.start(t0); osc.stop(t1);
        lastEnd = t1;
      }
      window.setTimeout(resolve, (lastEnd - ctx.currentTime) * 1000 + 100);
    } catch { resolve(); }
  });
}

// ─── Fala simples (sem alerta) ────────────────────────────────────────────────
function speakNow(text) {
  if (typeof window === "undefined" || !("speechSynthesis" in window)) return;

  const generation = ++speakGeneration;
  const synth      = window.speechSynthesis;

  window.clearTimeout(speakTimer);
  stopResumeWatch();
  synth.resume();
  if (synth.speaking || synth.pending) synth.cancel();

  speakTimer = window.setTimeout(async () => {
    if (generation !== speakGeneration) return;
    await waitForVoices();
    if (generation !== speakGeneration) return;

    synth.resume();
    const u = new SpeechSynthesisUtterance(text);
    u.lang = "pt-BR"; u.rate = 0.88; u.pitch = 1; u.volume = 1;
    const voice = pickVoice(); if (voice) u.voice = voice;

    u.onend  = () => { if (generation === speakGeneration) stopResumeWatch(); };
    u.onerror = (e) => {
      if (e.error === "interrupted" || e.error === "canceled") return;
      if (generation !== speakGeneration) return;
      window.setTimeout(() => {
        if (generation !== speakGeneration) return;
        const r = new SpeechSynthesisUtterance(text);
        r.lang = "pt-BR"; r.rate = 0.88; r.pitch = 1; r.volume = 1;
        const v = pickVoice(); if (v) r.voice = v;
        r.onend = () => { if (generation === speakGeneration) stopResumeWatch(); };
        synth.resume(); synth.speak(r); startResumeWatch();
      }, 300);
    };

    synth.speak(u);
    startResumeWatch();
  }, 300);
}

// ─── Fala com alerta (beep → pausa → número) ──────────────────────────────────
async function speakWithAlert(text, key = "", force = false) {
  if (typeof window === "undefined" || !("speechSynthesis" in window)) return;

  // Deduplicação: descarta chamadas duplicadas dentro da janela
  if (!force && key && key === lastSpokenKey && Date.now() - lastSpokenAt < DEDUP_WINDOW_MS) return;
  if (key) { lastSpokenKey = key; lastSpokenAt = Date.now(); }

  const generation = ++speakGeneration;
  window.clearTimeout(speakTimer);
  stopResumeWatch();

  const synth = window.speechSynthesis;
  synth.resume();
  if (synth.speaking || synth.pending) synth.cancel();

  await playAlertBeep();
  if (generation !== speakGeneration) return;

  await waitForVoices();
  if (generation !== speakGeneration) return;

  await new Promise((r) => window.setTimeout(r, 300));
  if (generation !== speakGeneration) return;

  synth.resume();

  const u = new SpeechSynthesisUtterance(text);
  u.lang = "pt-BR"; u.rate = 0.88; u.pitch = 1; u.volume = 1;
  const voice = pickVoice(); if (voice) u.voice = voice;

  u.onend  = () => { if (generation === speakGeneration) stopResumeWatch(); };
  u.onerror = (e) => {
    if (e.error === "interrupted" || e.error === "canceled") return;
    if (generation !== speakGeneration) return;
    window.setTimeout(() => {
      if (generation !== speakGeneration) return;
      const r = new SpeechSynthesisUtterance(text);
      r.lang = "pt-BR"; r.rate = 0.88; r.pitch = 1; r.volume = 1;
      const v = pickVoice(); if (v) r.voice = v;
      r.onend = () => { if (generation === speakGeneration) stopResumeWatch(); };
      synth.resume(); synth.speak(r); startResumeWatch();
    }, 300);
  };

  synth.speak(u);
  startResumeWatch();
}

// ─── API pública ───────────────────────────────────────────────────────────────

export function initSpeechClient() {
  getChannel();
  waitForVoices();
}

export function unlockSpeech() {
  if (typeof window === "undefined" || !("speechSynthesis" in window)) return;
  waitForVoices();
  window.speechSynthesis.resume();
  const u = new SpeechSynthesisUtterance(" ");
  u.volume = 0; u.rate = 2;
  window.speechSynthesis.speak(u);
}

// Registra esta aba como monitor speaker e dispara heartbeat periódico
export function registerMonitorSpeaker() {
  isMonitorSpeaker = true;
  const ch = getChannel();
  const ping = () => ch?.postMessage({ type: "monitor-here" });
  ping();
  const timer = window.setInterval(ping, MONITOR_HEARTBEAT_MS);
  return () => {
    isMonitorSpeaker = false;
    window.clearInterval(timer);
  };
}

export function isMonitorSpeakerActive() {
  return isMonitorSpeaker;
}

// ─── monitorSpeak ──────────────────────────────────────────────────────────────
// Chamado pelo monitor quando recebe um evento do Supabase Realtime.
// Não verifica isMonitorSpeaker — quem decide se chama esta função é o próprio
// monitor (via audioEnabledRef). Isso garante que funcione mesmo em produção
// onde o BroadcastChannel não existe entre máquinas.
export function monitorSpeak(number, type) {
  const text = buildSpeechText(number, type);
  const key  = `${Number(number)}-${type}`;
  speakWithAlert(text, key);
}

// ─── announceQueueCall ─────────────────────────────────────────────────────────
// Chamado pelo dashboard após chamar uma senha.
// Em produção (máquinas separadas): o monitor e o dashboard estão em máquinas
// diferentes — BroadcastChannel NÃO funciona entre elas. O dashboard não pode
// saber se há um monitor aberto em outro computador, então ele NUNCA fala.
// A fala é responsabilidade exclusiva do monitor via Supabase Realtime.
//
// Exceção: se o monitor está na MESMA máquina (mesma aba ou aba irmã),
// o heartbeat via BroadcastChannel chega e podemos silenciar o dashboard.
// Nesse caso o monitor já vai falar via Realtime mesmo assim.
//
// Conclusão: o dashboard nunca precisa falar — sempre silencia.
// Mantemos a função exportada para compatibilidade, mas ela é no-op.
export function announceQueueCall(_number, _type) {
  // No-op intencional.
  // O monitor fala via monitorSpeak() ← Supabase Realtime.
  // Se não houver monitor, o usuário precisa abrir a página /monitor.
}

// ─── forceAnnounce ─────────────────────────────────────────────────────────────
// Para "chamar novamente" no dashboard — força fala no monitor via Realtime
// (o botão "Chamar Novamente" só deve ser usado com o monitor aberto).
// Se o monitor está na mesma máquina, fala diretamente.
export function forceAnnounce(number, type) {
  // Só fala localmente se esta aba for o monitor
  if (!isMonitorSpeaker) return;
  const text = buildSpeechText(number, type);
  const key  = `${Number(number)}-${type}`;
  if (lastSpokenKey === key) { lastSpokenKey = ""; lastSpokenAt = 0; }
  speakWithAlert(text, key, true);
}

// Fala simples sem alerta (mensagens de sistema: "Som ativado." etc.)
export function speakText(text) {
  speakNow(text);
}
