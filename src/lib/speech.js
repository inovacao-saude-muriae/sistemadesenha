const CHANNEL_NAME      = "saude-tts";
const MONITOR_HEARTBEAT_MS = 2000;
const DEDUP_WINDOW_MS   = 10000;

// ─── Estado do módulo ──────────────────────────────────────────────────────────
// Dois contadores de geração SEPARADOS para evitar que speakNow e speakWithAlert
// se cancelem mutuamente (principal causa de silêncio após "Som ativado.").
let simpleGeneration = 0;   // usado por speakNow  (mensagens de sistema)
let alertGeneration  = 0;   // usado por speakWithAlert (chamadas de senha)

let simpleTimer = 0;
let alertTimer  = 0;
let resumeTimer = 0;
let voicesReady = false;
let channel     = null;
let monitorHeartbeatAt = 0;
let isMonitorSpeaker   = false;

let lastSpokenKey = "";
let lastSpokenAt  = 0;

// ─── BroadcastChannel (heartbeat apenas) ─────────────────────────────────────
function getChannel() {
  if (typeof window === "undefined" || typeof BroadcastChannel === "undefined") return null;
  if (!channel) {
    channel = new BroadcastChannel(CHANNEL_NAME);
    channel.onmessage = (event) => {
      if ((event.data || {}).type === "monitor-here") monitorHeartbeatAt = Date.now();
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
  return (type === "preferencial" || type === "preferential")
    ? `Senha preferencial. ${spoken}.`
    : `Senha. ${spoken}.`;
}

// ─── Voz pt-BR ────────────────────────────────────────────────────────────────
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
  if (typeof window === "undefined" || !("speechSynthesis" in window)) return Promise.resolve();
  const voices = window.speechSynthesis.getVoices();
  if (voices.length || voicesReady) { voicesReady = true; return Promise.resolve(); }
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

// ─── Cria e fala um utterance ─────────────────────────────────────────────────
function doSpeak(synth, text, onEnd) {
  const u = new SpeechSynthesisUtterance(text);
  u.lang = "pt-BR"; u.rate = 0.88; u.pitch = 1; u.volume = 1;
  const voice = pickVoice(); if (voice) u.voice = voice;
  u.onend   = onEnd;
  u.onerror = (e) => {
    if (e.error === "interrupted" || e.error === "canceled") return;
    // Retry com novo utterance
    window.setTimeout(() => {
      const r = new SpeechSynthesisUtterance(text);
      r.lang = "pt-BR"; r.rate = 0.88; r.pitch = 1; r.volume = 1;
      const v = pickVoice(); if (v) r.voice = v;
      r.onend = onEnd;
      synth.resume(); synth.speak(r);
    }, 400);
  };
  synth.speak(u);
}

// ─── Sinal de alerta via AudioContext ─────────────────────────────────────────
function playAlertBeep() {
  return new Promise((resolve) => {
    if (typeof window === "undefined" || (!window.AudioContext && !window.webkitAudioContext)) {
      resolve(); return;
    }
    try {
      const ctx   = new (window.AudioContext || window.webkitAudioContext)();
      const beeps = [
        { freq: 880,  start: 0,    dur: 0.18 },
        { freq: 1100, start: 0.24, dur: 0.18 },
      ];
      let lastEnd = 0;
      for (const b of beeps) {
        const osc  = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.connect(gain); gain.connect(ctx.destination);
        osc.type = "sine"; osc.frequency.value = b.freq;
        const t0 = ctx.currentTime + b.start;
        const t1 = t0 + b.dur;
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

// ─── speakNow — mensagens simples ("Som ativado." etc.) ──────────────────────
// Usa simpleGeneration — NÃO interfere com speakWithAlert.
function speakNow(text) {
  if (typeof window === "undefined" || !("speechSynthesis" in window)) return;

  const gen   = ++simpleGeneration;
  const synth = window.speechSynthesis;

  window.clearTimeout(simpleTimer);

  simpleTimer = window.setTimeout(async () => {
    if (gen !== simpleGeneration) return;
    await waitForVoices();
    if (gen !== simpleGeneration) return;

    // Não cancela a síntese de alertGeneration — apenas fala por cima se necessário
    synth.resume();
    doSpeak(synth, text, () => {/* nada */});
  }, 100);
}

// ─── speakWithAlert — chamadas de senha (beep → pausa → fala) ────────────────
// Usa alertGeneration — NÃO interfere com speakNow.
async function speakWithAlert(text, key = "", force = false) {
  if (typeof window === "undefined" || !("speechSynthesis" in window)) return;

  if (!force && key && key === lastSpokenKey && Date.now() - lastSpokenAt < DEDUP_WINDOW_MS) return;
  if (key) { lastSpokenKey = key; lastSpokenAt = Date.now(); }

  const gen   = ++alertGeneration;
  const synth = window.speechSynthesis;

  window.clearTimeout(alertTimer);
  stopResumeWatch();

  // Cancela qualquer fala anterior de senha (não cancela mensagens simples)
  synth.resume();
  if (synth.speaking || synth.pending) synth.cancel();

  // 1. Beep de alerta
  await playAlertBeep();
  if (gen !== alertGeneration) return;

  // 2. Vozes carregadas?
  await waitForVoices();
  if (gen !== alertGeneration) return;

  // 3. Pausa antes de falar
  await new Promise((r) => window.setTimeout(r, 250));
  if (gen !== alertGeneration) return;

  synth.resume();
  doSpeak(synth, text, () => { if (gen === alertGeneration) stopResumeWatch(); });
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

export function registerMonitorSpeaker() {
  isMonitorSpeaker = true;
  const ch = getChannel();
  const ping = () => ch?.postMessage({ type: "monitor-here" });
  ping();
  const timer = window.setInterval(ping, MONITOR_HEARTBEAT_MS);
  return () => { isMonitorSpeaker = false; window.clearInterval(timer); };
}

export function isMonitorSpeakerActive() { return isMonitorSpeaker; }

// Chamado pelo monitor via Supabase Realtime — único ponto de fala de senhas
export function monitorSpeak(number, type) {
  const text = buildSpeechText(number, type);
  const key  = `${Number(number)}-${type}`;
  speakWithAlert(text, key);
}

// No-op — dashboard não fala; monitor fala via Realtime
export function announceQueueCall(_number, _type) {}

// "Chamar novamente" — força repetição ignorando dedup
export function forceAnnounce(number, type) {
  const text = buildSpeechText(number, type);
  const key  = `${Number(number)}-${type}`;
  if (lastSpokenKey === key) { lastSpokenKey = ""; lastSpokenAt = 0; }
  speakWithAlert(text, key, true);
}

// Fala simples sem beep (mensagens de sistema)
export function speakText(text) { speakNow(text); }
