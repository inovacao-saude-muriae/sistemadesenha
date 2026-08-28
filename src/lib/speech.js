const CHANNEL_NAME = "saude-tts";
const MONITOR_HEARTBEAT_MS = 2000;

// ─── Estado do módulo ──────────────────────────────────────────────────────────
let speakGeneration = 0;
let speakTimer = 0;
let resumeTimer = 0;
let voicesReady = false;
let channel = null;
let monitorHeartbeatAt = 0;
let isMonitorSpeaker = false;

// Deduplicação por chave + timestamp — janela de 10s para cobrir qualquer atraso
let lastSpokenKey = "";
let lastSpokenAt = 0;
const DEDUP_WINDOW_MS = 10000;

// ─── BroadcastChannel ─────────────────────────────────────────────────────────
// O canal é usado APENAS para o dashboard avisar que não há monitor aberto
// e a fala deve sair do próprio dashboard. Quando o monitor está aberto,
// ele responde com heartbeat e o dashboard silencia.
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
      // O monitor NÃO ouve mensagens "announce" pelo BroadcastChannel.
      // Ele fala direto via Supabase Realtime para evitar duplicação.
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
  if (resumeTimer) {
    window.clearInterval(resumeTimer);
    resumeTimer = 0;
  }
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
      resolve();
      return;
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
        osc.start(t0);
        osc.stop(t1);
        lastEnd = t1;
      }
      window.setTimeout(resolve, (lastEnd - ctx.currentTime) * 1000 + 100);
    } catch {
      resolve();
    }
  });
}

// ─── Núcleo de fala simples (sem alerta) ─────────────────────────────────────
// Usado para mensagens de sistema como "Som ativado."
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
    const utterance = new SpeechSynthesisUtterance(text);
    utterance.lang   = "pt-BR";
    utterance.rate   = 0.88;
    utterance.pitch  = 1;
    utterance.volume = 1;
    const voice = pickVoice();
    if (voice) utterance.voice = voice;

    utterance.onend = () => { if (generation === speakGeneration) stopResumeWatch(); };
    utterance.onerror = (event) => {
      if (event.error === "interrupted" || event.error === "canceled") return;
      if (generation !== speakGeneration) return;
      window.setTimeout(() => {
        if (generation !== speakGeneration) return;
        const retry = new SpeechSynthesisUtterance(text);
        retry.lang = "pt-BR"; retry.rate = 0.88; retry.pitch = 1; retry.volume = 1;
        const v = pickVoice(); if (v) retry.voice = v;
        retry.onend = () => { if (generation === speakGeneration) stopResumeWatch(); };
        synth.resume();
        synth.speak(retry);
        startResumeWatch();
      }, 300);
    };

    synth.speak(utterance);
    startResumeWatch();
  }, 300);
}

// ─── Sequência: alerta → pausa → fala ────────────────────────────────────────
// Fala com deduplicação. Se force=true ignora a janela de dedup (para "chamar novamente").
async function speakWithAlert(text, key = "", force = false) {
  if (typeof window === "undefined" || !("speechSynthesis" in window)) return;

  if (!force && key && key === lastSpokenKey && Date.now() - lastSpokenAt < DEDUP_WINDOW_MS) {
    return;
  }
  if (key) {
    lastSpokenKey = key;
    lastSpokenAt  = Date.now();
  }

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

  const utterance = new SpeechSynthesisUtterance(text);
  utterance.lang   = "pt-BR";
  utterance.rate   = 0.88;
  utterance.pitch  = 1;
  utterance.volume = 1;
  const voice = pickVoice();
  if (voice) utterance.voice = voice;

  utterance.onend = () => { if (generation === speakGeneration) stopResumeWatch(); };
  utterance.onerror = (event) => {
    if (event.error === "interrupted" || event.error === "canceled") return;
    if (generation !== speakGeneration) return;
    window.setTimeout(() => {
      if (generation !== speakGeneration) return;
      const retry = new SpeechSynthesisUtterance(text);
      retry.lang = "pt-BR"; retry.rate = 0.88; retry.pitch = 1; retry.volume = 1;
      const v = pickVoice(); if (v) retry.voice = v;
      retry.onend = () => { if (generation === speakGeneration) stopResumeWatch(); };
      synth.resume();
      synth.speak(retry);
      startResumeWatch();
    }, 300);
  };

  synth.speak(utterance);
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
  const unlock = new SpeechSynthesisUtterance(" ");
  unlock.volume = 0;
  unlock.rate   = 2;
  window.speechSynthesis.speak(unlock);
}

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

function monitorIsActive() {
  return Date.now() - monitorHeartbeatAt < MONITOR_HEARTBEAT_MS * 2;
}

export function isMonitorSpeakerActive() {
  return isMonitorSpeaker;
}

// ─── announceQueueCall ────────────────────────────────────────────────────────
// Chamado pelo dashboard após chamar uma senha.
// Regra simples:
//   - Se o monitor está aberto e ativo → ele já vai falar via Realtime, silencia aqui.
//   - Se não há monitor → o dashboard fala.
export function announceQueueCall(number, type) {
  // Se esta aba É o monitor, não faz nada — a fala vem do Realtime (monitorSpeak)
  if (isMonitorSpeaker) return;

  // Se há um monitor ativo em outra aba → ele vai falar via Realtime, silencia
  if (monitorIsActive()) return;

  // Sem monitor — o dashboard assume a fala
  const text = buildSpeechText(number, type);
  const key  = `${Number(number)}-${type}`;
  speakWithAlert(text, key);
}

// ─── monitorSpeak ─────────────────────────────────────────────────────────────
// Chamado EXCLUSIVAMENTE pelo monitor quando recebe um evento do Supabase Realtime.
// É o único ponto que gera fala quando o monitor está aberto.
export function monitorSpeak(number, type) {
  if (!isMonitorSpeaker) return;
  const text = buildSpeechText(number, type);
  const key  = `${Number(number)}-${type}`;
  speakWithAlert(text, key);
}

// ─── forceAnnounce ────────────────────────────────────────────────────────────
// Para "chamar novamente" — ignora deduplicação.
export function forceAnnounce(number, type) {
  const text = buildSpeechText(number, type);
  const key  = `${Number(number)}-${type}`;
  // Reseta dedup para esta chave
  if (lastSpokenKey === key) { lastSpokenKey = ""; lastSpokenAt = 0; }

  if (isMonitorSpeaker) {
    speakWithAlert(text, key, true);
    return;
  }
  if (monitorIsActive()) return; // monitor vai falar via Realtime
  speakWithAlert(text, key, true);
}

// Fala simples sem alerta (mensagens de sistema)
export function speakText(text) {
  speakNow(text);
}
