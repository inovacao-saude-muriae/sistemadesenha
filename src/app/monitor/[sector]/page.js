"use client";

import {
  use,
  useCallback,
  useEffect,
  useRef,
  useState,
  useSyncExternalStore,
  memo,
} from "react";
import { Clock3, RotateCcw, Volume2, VolumeX } from "lucide-react";
import {
  formatQueueNumber,
  getQueueSnapshot,
  nextQueueNumber,
  normalizeQueue,
  readQueueState,
  saveQueueState,
  SECTORS,
  subscribeQueue,
  withQueueLock,
} from "../../../lib/queue";
import { isSupabaseConfigured, getRealtimeClient, supabase } from "../../../lib/supabase";
import {
  forceAnnounce,
  monitorSpeak,
  registerMonitorSpeaker,
  speakText,
  unlockSpeech,
} from "../../../lib/speech";
import styles from "./Monitor.module.css";

/* ─── estado de notícias isolado ─── */
let newsSnapshot = [];
const serverNewsSnapshot = [];
const monitorServerSnapshot = {
  farmacia: { normalCurrent: 0, priorityCurrent: 0, history: [] },
  recepcao: { normalCurrent: 0, priorityCurrent: 0, history: [] },
};

let lastSpokenCallId = null;

function getNewsSnapshot() {
  if (typeof window === "undefined") return serverNewsSnapshot;
  return newsSnapshot;
}

function subscribeNews(callback) {
  window.addEventListener("storage", callback);
  window.addEventListener("news-updated", callback);
  return () => {
    window.removeEventListener("storage", callback);
    window.removeEventListener("news-updated", callback);
  };
}

/* número apenas com dígitos, sem prefixo de letra */
function formatMonitorNumber(number) {
  const n = Number(number) || 0;
  if (n === 1000) return "1000";
  return String(n).padStart(3, "0");
}

function cleanHistory(history = []) {
  if (!Array.isArray(history)) return [];
  const seen = new Set();
  return history.filter((item) => {
    if (!item?.number) return false;
    const key = `${item.id || item.number}-${item.type}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

/* ─── Carrossel de notícias — memo para não causar re-render na fala ─── */
const NewsCarousel = memo(function NewsCarousel() {
  const news = useSyncExternalStore(subscribeNews, getNewsSnapshot, () => serverNewsSnapshot);
  const [newsIndex, setNewsIndex] = useState(0);

  useEffect(() => {
    fetch("/api/news")
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => {
        if (!data?.news?.length) return;
        newsSnapshot = data.news;
        window.dispatchEvent(new Event("news-updated"));
      })
      .catch(() => {});
  }, []);

  useEffect(() => {
    if (!news?.length) return;
    const t = setInterval(() => setNewsIndex((p) => (p + 1) % news.length), 5000);
    return () => clearInterval(t);
  }, [news]);

  if (!news?.length) {
    return (
      <div className={styles.emptyNews}>
        <strong>INFORMAÇÕES DA UNIDADE</strong>
      </div>
    );
  }

  const item = news[newsIndex];
  return (
    <>
      {item?.image && (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={item.image}
          alt={item.title || ""}
          style={{ position: "absolute", inset: 0, width: "100%", height: "100%", objectFit: "cover" }}
        />
      )}
      <div className={styles.newsCaption}>
        <div className={styles.dots}>
          {news.map((_, i) => (
            <i key={i} className={i === newsIndex ? styles.activeDot : ""} />
          ))}
        </div>
      </div>
    </>
  );
});

/* ══════════════════════════════════════════════════════════
   PÁGINA PRINCIPAL DO MONITOR
══════════════════════════════════════════════════════════ */
export default function MonitorPage({ params }) {
  const resolvedParams = params ? (params.then ? use(params) : params) : {};
  const sector = resolvedParams?.sector || "farmacia";

  const state = useSyncExternalStore(subscribeQueue, getQueueSnapshot, () => monitorServerSnapshot);

  const [time, setTime] = useState("");
  const [audioEnabled, setAudioEnabled] = useState(false);
  const [calling, setCalling] = useState(false);
  const [callStatus, setCallStatus] = useState("");
  const [panelVisible, setPanelVisible] = useState(false);

  const audioEnabledRef = useRef(false);
  const hideTimerRef = useRef(null);

  audioEnabledRef.current = audioEnabled;

  /* ─── lógica de mostrar/ocultar o painel ─── */
  const showPanel = useCallback(() => {
    setPanelVisible(true);
    if (hideTimerRef.current) clearTimeout(hideTimerRef.current);
    hideTimerRef.current = setTimeout(() => setPanelVisible(false), 4000);
  }, []);

  const keepPanel = useCallback(() => {
    if (hideTimerRef.current) clearTimeout(hideTimerRef.current);
    hideTimerRef.current = setTimeout(() => setPanelVisible(false), 4000);
  }, []);

  /* mouse perto da borda inferior (80px) */
  useEffect(() => {
    function onMouseMove(e) {
      if (window.innerHeight - e.clientY < 80) showPanel();
    }
    window.addEventListener("mousemove", onMouseMove);
    return () => window.removeEventListener("mousemove", onMouseMove);
  }, [showPanel]);

  /* toque na parte inferior (touch devices) */
  useEffect(() => {
    function onTouchStart(e) {
      const touch = e.touches[0];
      if (touch && window.innerHeight - touch.clientY < 80) showPanel();
    }
    window.addEventListener("touchstart", onTouchStart);
    return () => window.removeEventListener("touchstart", onTouchStart);
  }, [showPanel]);

  /* limpa o timer ao desmontar */
  useEffect(() => {
    return () => { if (hideTimerRef.current) clearTimeout(hideTimerRef.current); };
  }, []);

  /* relógio */
  useEffect(() => {
    const t = setInterval(() => {
      setTime(new Intl.DateTimeFormat("pt-BR", {
        hour: "2-digit", minute: "2-digit", second: "2-digit",
      }).format(new Date()));
    }, 1000);
    return () => clearInterval(t);
  }, []);

  /* ativa fala do monitor após unlock */
  useEffect(() => {
    if (!audioEnabled) return;
    unlockSpeech();
    return registerMonitorSpeaker();
  }, [audioEnabled]);

  /* ativa áudio no primeiro clique */
  const enableAudio = () => {
    unlockSpeech();
    speakText("Som ativado.");
    setAudioEnabled(true);
  };

  /* ─── Supabase Realtime ─── */
  useEffect(() => {
    if (!isSupabaseConfigured || !sector) return;
    const db = getRealtimeClient();
    if (!db) return;

    async function fetchInitialHistory() {
      try {
        const { data, error } = await db
          .from("queue_calls")
          .select("*")
          .eq("sector_id", sector)
          .order("id", { ascending: false })
          .limit(30);
        if (error || !data?.length) return;
        const formatted = data.map((item) => ({
          id: item.id,
          number: item.number_int,
          type: item.type === "preferential" || item.type === "preferencial" ? "preferencial" : "normal",
          time: new Intl.DateTimeFormat("pt-BR", { hour: "2-digit", minute: "2-digit" })
            .format(new Date(item.created_at || Date.now())),
        }));
        const prev = getQueueSnapshot() || monitorServerSnapshot;
        saveQueueState({ ...prev, [sector]: { ...(prev[sector] || {}), history: cleanHistory(formatted) } });
      } catch (err) {
        console.error("Erro ao carregar histórico:", err);
      }
    }

    fetchInitialHistory();

    const channel = db
      .channel(`realtime-monitor-${sector}`)
      .on("postgres_changes", {
        event: "INSERT", schema: "public", table: "queue_calls",
        filter: `sector_id=eq.${sector}`,
      }, (payload) => {
        const call = payload.new;
        if (!call?.number_int) return;

        const callKey = `${call.id || call.number_int}-${call.type}`;
        if (lastSpokenCallId === callKey) return;
        lastSpokenCallId = callKey;

        const prev = getQueueSnapshot() || monitorServerSnapshot;
        const queue = prev[sector] || {};
        const callType = call.type === "preferential" || call.type === "preferencial"
          ? "preferencial" : "normal";
        const field = callType === "preferencial" ? "priorityCurrent" : "normalCurrent";
        const timeStr = new Intl.DateTimeFormat("pt-BR", { hour: "2-digit", minute: "2-digit" })
          .format(new Date(call.created_at || Date.now()));

        saveQueueState({
          ...prev,
          [sector]: {
            ...queue,
            [field]: call.number_int,
            history: cleanHistory([
              { id: call.id, number: call.number_int, type: callType, time: timeStr },
              ...(queue.history || []),
            ]).slice(0, 30),
          },
        });

        if (audioEnabledRef.current) {
          monitorSpeak(call.number_int, callType);
        }
      })
      .subscribe();

    return () => { db.removeChannel(channel); };
  }, [sector]);

  /* ─── Chamar próxima senha ─── */
  const callNext = useCallback(async (type) => {
    if (calling) return;
    setCalling(true);
    setCallStatus("Chamando…");

    await withQueueLock(async () => {
      let next = null;
      try {
        const res = await fetch("/api/queue/call", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ sector, type, attendantId: null }),
        });
        const data = await res.json();
        if (!res.ok) {
          if (data.useLocal) {
            const ls = normalizeQueue(readQueueState()[sector]);
            next = type === "preferencial"
              ? nextQueueNumber(ls.priorityCurrent)
              : nextQueueNumber(ls.normalCurrent);
          } else {
            setCallStatus(data.error || "Erro ao chamar senha.");
            setCalling(false);
            return;
          }
        } else {
          next = Number(data.number);
        }
      } catch {
        const ls = normalizeQueue(readQueueState()[sector]);
        next = type === "preferencial"
          ? nextQueueNumber(ls.priorityCurrent)
          : nextQueueNumber(ls.normalCurrent);
      }

      next = Number(next);
      if (!Number.isInteger(next) || next < 1 || next > 1000) {
        setCallStatus("Não foi possível obter o número.");
        setCalling(false);
        return;
      }

      const latest = readQueueState();
      const q = normalizeQueue(latest[sector]);
      const field = type === "preferencial" ? "priorityCurrent" : "normalCurrent";
      const timeStr = new Intl.DateTimeFormat("pt-BR", { hour: "2-digit", minute: "2-digit" })
        .format(new Date());

      saveQueueState({
        ...latest,
        [sector]: {
          ...q,
          [field]: next,
          history: [
            { number: next, type, time: timeStr },
            ...q.history,
          ].slice(0, 10),
        },
      });

      const label = type === "preferencial" ? "Preferencial" : "Normal";
      setCallStatus(`${label} ${formatQueueNumber(next, type)} chamada`);

      if (audioEnabledRef.current) {
        forceAnnounce(next, type);
      }
    });

    setCalling(false);
  }, [calling, sector]);

  /* ─── Repetir última senha ─── */
  const reCall = useCallback(() => {
    const q = normalizeQueue((getQueueSnapshot() || monitorServerSnapshot)[sector]);
    const last = q.history[0];
    if (!last) { setCallStatus("Nenhuma senha para repetir."); return; }
    setCallStatus(`Repetindo: ${formatQueueNumber(last.number, last.type)}`);
    if (audioEnabledRef.current) forceAnnounce(last.number, last.type);
  }, [sector]);

  /* ─── Atalhos de teclado ─── */
  useEffect(() => {
    function onKey(e) {
      if (["INPUT", "TEXTAREA", "SELECT", "BUTTON"].includes(e.target.tagName)) return;
      const k = e.key.toLowerCase();
      if (["arrowright", "pagedown", " "].includes(k)) { e.preventDefault(); callNext("normal"); }
      else if (["arrowleft", "pageup"].includes(k)) { e.preventDefault(); callNext("preferencial"); }
      else if (["b", ".", "f5", "escape"].includes(k)) { e.preventDefault(); reCall(); }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [callNext, reCall]);

  /* ─── Dados para render ─── */
  const info = SECTORS[sector] || SECTORS.farmacia;
  const current = state[sector] || monitorServerSnapshot[sector];
  const validHistory = cleanHistory(current.history || []);
  const latest = validHistory[0] || { number: current.normalCurrent || 0, type: "normal" };
  const recentCalls = validHistory.slice(1, 5);
  const isPriority = latest.type === "preferencial";

  return (
    <main className={styles.monitor}>

      {/* ── Cabeçalho ── */}
      <header className={styles.header}>
        <div className={styles.sectorTitle}>{info.name.toUpperCase()}</div>
        <div className={styles.heading}>
          <strong>CENTRAL DE ATENDIMENTO</strong>
        </div>
        <div className={styles.headerMeta}>
          <div className={styles.clock}>
            <Clock3 size={18} />
            {time}
          </div>
          <div className={styles.date}>
            {new Intl.DateTimeFormat("pt-BR", {
              weekday: "long", day: "2-digit", month: "long", year: "numeric",
            }).format(new Date()).toUpperCase()}
          </div>
        </div>
      </header>

      {/* ── Conteúdo ── */}
      <div className={styles.content}>

        {/* Coluna esquerda: senha + histórico */}
        <section className={styles.leftColumn}>

          {/* Senha em destaque */}
          <section className={`${styles.featured} ${isPriority ? styles.featuredPriority : ""}`}>
            <p>SENHA</p>
            <strong>{formatMonitorNumber(latest.number)}</strong>
            {isPriority
              ? <span className={styles.priorityTag}>ATENDIMENTO PREFERENCIAL</span>
              : <span>ATENDIMENTO</span>}
            <small>Dirija-se ao balcão de atendimento</small>
          </section>

          {/* Últimas senhas */}
          <section className={styles.recent}>
            <p className={styles.kicker}>ÚLTIMAS SENHAS</p>
            {recentCalls.length > 0 ? recentCalls.map((item, i) => (
              <div className={styles.historyItem} key={`${item.id || item.number}-${item.type}-${i}`}>
                <strong className={item.type === "preferencial" ? styles.priorityNumber : styles.normalNumber}>
                  {formatMonitorNumber(item.number)}
                </strong>
                {item.type === "preferencial"
                  ? <span className={styles.priorityTagSmall}>PREFERENCIAL</span>
                  : <span className={styles.normal}>ATENDIMENTO</span>}
                <time>{item.time}</time>
              </div>
            )) : (
              <p className={styles.emptyHistory}>Aguardando chamadas…</p>
            )}
          </section>
        </section>

        {/* Coluna direita: notícias */}
        <section className={styles.news}>
          <NewsCarousel />
        </section>
      </div>

      {/* ═══════════════════════════════════════════════
          PAINEL DE CONTROLE — passa senhas
          Oculto por padrão, aparece ao mover mouse
          para a borda inferior da tela (ou tocar)
      ═══════════════════════════════════════════════ */}

      {/* Zona de gatilho invisível na borda */}
      <div className={styles.callerTrigger} onMouseEnter={showPanel} />

      <div
        className={`${styles.callerPanel} ${panelVisible ? styles.callerPanelVisible : ""}`}
        onMouseEnter={keepPanel}
        onMouseLeave={() => {
          if (hideTimerRef.current) clearTimeout(hideTimerRef.current);
          hideTimerRef.current = setTimeout(() => setPanelVisible(false), 1200);
        }}
      >

        {/* Status da última chamada */}
        {callStatus && (
          <span className={styles.callerStatus}>{callStatus}</span>
        )}

        {/* Botão Repetir */}
        <button
          className={`${styles.callerBtn} ${styles.callerRepeat}`}
          onClick={reCall}
          disabled={calling || !validHistory.length}
          aria-label="Repetir última senha"
          title="Repetir (Esc)"
        >
          <RotateCcw size={18} />
          <span>REPETIR</span>
        </button>

        {/* Botão Preferencial */}
        <button
          className={`${styles.callerBtn} ${styles.callerPriority}`}
          onClick={() => callNext("preferencial")}
          disabled={calling}
          aria-label="Chamar preferencial"
          title="Preferencial (←)"
        >
          <span className={styles.callerBtnIcon}>⭐</span>
          <span>PREFERENCIAL</span>
        </button>

        {/* Botão Próxima — o maior, mais chamativo */}
        <button
          className={`${styles.callerBtn} ${styles.callerNext}`}
          onClick={() => callNext("normal")}
          disabled={calling}
          aria-label="Próxima senha"
          title="Próxima (→)"
        >
          <span className={styles.callerBtnIcon}>▶</span>
          <span>PRÓXIMA SENHA</span>
        </button>

        {/* Botão de áudio */}
        <button
          className={`${styles.callerBtn} ${audioEnabled ? styles.callerAudioOn : styles.callerAudioOff}`}
          onClick={enableAudio}
          disabled={audioEnabled}
          aria-label={audioEnabled ? "Áudio ativo" : "Ativar áudio"}
          title="Ativar áudio"
        >
          {audioEnabled ? <Volume2 size={18} /> : <VolumeX size={18} />}
          <span>{audioEnabled ? "ÁUDIO ON" : "ÁUDIO OFF"}</span>
        </button>

      </div>
    </main>
  );
}
