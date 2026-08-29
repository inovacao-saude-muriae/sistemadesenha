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
import { Clock3 } from "lucide-react";
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
import { isSupabaseConfigured, getRealtimeClient } from "../../../lib/supabase";
import {
  forceAnnounce,
  monitorSpeak,
  registerMonitorSpeaker,
  speakText,
  unlockSpeech,
} from "../../../lib/speech";
import styles from "./Monitor.module.css";

/* ─── notícias ─── */
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
function subscribeNews(cb) {
  window.addEventListener("storage", cb);
  window.addEventListener("news-updated", cb);
  return () => {
    window.removeEventListener("storage", cb);
    window.removeEventListener("news-updated", cb);
  };
}

function formatMonitorNumber(number) {
  const n = Number(number) || 0;
  return n === 1000 ? "1000" : String(n).padStart(3, "0");
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

/* ─── carrossel de notícias isolado (evita re-render da voz) ─── */
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

/* ══════════════════════════════════════════════
   MONITOR — tela pública de senhas
   Controle via atalhos de teclado / passador
══════════════════════════════════════════════ */
export default function MonitorPage({ params }) {
  const resolvedParams = params ? (params.then ? use(params) : params) : {};
  const sector = resolvedParams?.sector || "farmacia";

  const state = useSyncExternalStore(subscribeQueue, getQueueSnapshot, () => monitorServerSnapshot);

  const [time, setTime] = useState("");
  const [audioEnabled, setAudioEnabled] = useState(false);
  const [calling, setCalling] = useState(false);

  const audioEnabledRef = useRef(false);
  audioEnabledRef.current = audioEnabled;

  /* relógio */
  useEffect(() => {
    const t = setInterval(() => {
      setTime(
        new Intl.DateTimeFormat("pt-BR", {
          hour: "2-digit", minute: "2-digit", second: "2-digit",
        }).format(new Date())
      );
    }, 1000);
    return () => clearInterval(t);
  }, []);

  /* desbloqueia áudio no primeiro clique/tecla */
  useEffect(() => {
    const unlock = () => {
      unlockSpeech();
      speakText("Som ativado.");
      setAudioEnabled(true);
      window.removeEventListener("pointerdown", unlock);
      window.removeEventListener("keydown", unlock);
    };
    window.addEventListener("pointerdown", unlock, { once: true });
    window.addEventListener("keydown", unlock, { once: true });
    return () => {
      window.removeEventListener("pointerdown", unlock);
      window.removeEventListener("keydown", unlock);
    };
  }, []);

  /* registra esta aba como alto-falante após áudio desbloqueado */
  useEffect(() => {
    if (!audioEnabled) return;
    return registerMonitorSpeaker();
  }, [audioEnabled]);

  /* Supabase Realtime */
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

  /* ─── chamar próxima senha (via teclado / passador) ─── */
  const callNext = useCallback(async (type) => {
    if (calling) return;
    setCalling(true);

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
          history: [{ number: next, type, time: timeStr }, ...q.history].slice(0, 10),
        },
      });

      if (audioEnabledRef.current) forceAnnounce(next, type);
    });

    setCalling(false);
  }, [calling, sector]);

  /* ─── repetir última senha ─── */
  const reCall = useCallback(() => {
    const q = normalizeQueue((getQueueSnapshot() || monitorServerSnapshot)[sector]);
    const last = q.history[0];
    if (!last) return;
    if (audioEnabledRef.current) forceAnnounce(last.number, last.type);
  }, [sector]);

  /* ─── atalhos de teclado ─── */
  useEffect(() => {
    function onKey(e) {
      if (["INPUT", "TEXTAREA", "SELECT", "BUTTON"].includes(e.target.tagName)) return;
      const k = e.key;
      if (k === "ArrowRight")  { e.preventDefault(); callNext("normal"); }
      else if (k === "ArrowLeft")  { e.preventDefault(); callNext("preferencial"); }
      else if (k === "ArrowUp")    { e.preventDefault(); reCall(); }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [callNext, reCall]);

  /* ─── atalhos de mouse ─── */
  useEffect(() => {
    function onMouseDown(e) {
      // ignora cliques em botões/links
      if (e.target.closest("a, button, input, select, textarea")) return;
      if (e.button === 0) { e.preventDefault(); callNext("normal"); }
      else if (e.button === 2) { e.preventDefault(); callNext("preferencial"); }
    }
    function onWheel(e) {
      if (e.target.closest("a, button, input, select, textarea")) return;
      e.preventDefault();
      reCall();
    }
    function onContextMenu(e) {
      // bloqueia o menu de contexto para o botão direito funcionar
      if (!e.target.closest("a, button, input, select, textarea")) {
        e.preventDefault();
      }
    }
    window.addEventListener("mousedown", onMouseDown);
    window.addEventListener("wheel", onWheel, { passive: false });
    window.addEventListener("contextmenu", onContextMenu);
    return () => {
      window.removeEventListener("mousedown", onMouseDown);
      window.removeEventListener("wheel", onWheel);
      window.removeEventListener("contextmenu", onContextMenu);
    };
  }, [callNext, reCall]);

  /* ─── render ─── */
  const info = SECTORS[sector] || SECTORS.farmacia;
  const current = state[sector] || monitorServerSnapshot[sector];
  const validHistory = cleanHistory(current.history || []);
  const latest = validHistory[0] || { number: current.normalCurrent || 0, type: "normal" };
  const recentCalls = validHistory.slice(1, 5);
  const isPriority = latest.type === "preferencial";

  return (
    <main className={styles.monitor}>
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

      <div className={styles.content}>
        <section className={styles.leftColumn}>

          <section className={`${styles.featured} ${isPriority ? styles.featuredPriority : ""}`}>
            <p>SENHA</p>
            <strong>{formatMonitorNumber(latest.number)}</strong>
            {isPriority
              ? <span className={styles.priorityTag}>ATENDIMENTO PREFERENCIAL</span>
              : <span>ATENDIMENTO</span>}
            <small>Dirija-se ao balcão de atendimento</small>
          </section>

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
              <p style={{ fontSize: "14px", color: "#888", marginTop: "12px" }}>
                Aguardando chamadas anteriores...
              </p>
            )}
          </section>
        </section>

        <section className={styles.news}>
          <NewsCarousel />
        </section>
      </div>
    </main>
  );
}
