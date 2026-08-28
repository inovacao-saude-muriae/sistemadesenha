"use client";

import { use, useEffect, useRef, useState, useSyncExternalStore, memo } from "react";
import Image from "next/image";
import { Clock3, Volume2 } from "lucide-react";
import {
  getQueueSnapshot,
  saveQueueState,
  SECTORS,
  subscribeQueue,
} from "../../../lib/queue";
import { isSupabaseConfigured, supabase } from "../../../lib/supabase";
import {
  announceQueueCall,
  registerMonitorSpeaker,
  speakText,
  unlockSpeech,
  isMonitorSpeakerActive,
} from "../../../lib/speech";
import styles from "./Monitor.module.css";

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

// Formatação do número da senha sem letras no Monitor
function formatMonitorNumber(number) {
  const numInt = Number(number) || 0;
  if (numInt === 1000) return "1000";
  return String(numInt).padStart(3, "0");
}

function cleanHistory(history = []) {
  if (!Array.isArray(history)) return [];
  const result = [];
  const seenKeys = new Set();

  for (const item of history) {
    if (!item || !item.number) continue;
    const key = `${item.id || item.number}-${item.type}`;
    if (!seenKeys.has(key)) {
      seenKeys.add(key);
      result.push(item);
    }
  }
  return result;
}

// COMPONENTE ISOLADO DO SLIDE (Impede a re-renderização da voz ao passar imagens)
const NewsCarousel = memo(function NewsCarousel() {
  const news = useSyncExternalStore(
    subscribeNews,
    getNewsSnapshot,
    () => serverNewsSnapshot
  );
  const [newsIndex, setNewsIndex] = useState(0);

  useEffect(() => {
    fetch("/api/news")
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => {
        if (!data?.news || !data.news.length) return;
        newsSnapshot = data.news;
        window.dispatchEvent(new Event("news-updated"));
      })
      .catch(() => undefined);
  }, []);

  useEffect(() => {
    if (!news || news.length === 0) return;

    const newsTimer = setInterval(() => {
      setNewsIndex((prevIndex) => (prevIndex + 1) % news.length);
    }, 5000);

    return () => clearInterval(newsTimer);
  }, [news]);

  if (!news || news.length === 0) {
    return (
      <div className={styles.emptyNews}>
        <strong>INFORMAÇÕES DA UNIDADE</strong>
      </div>
    );
  }

  return (
    <>
      {news[newsIndex]?.image && (
        <Image
          src={news[newsIndex].image}
          alt=""
          fill
          unoptimized
          sizes="(max-width: 900px) 100vw, 60vw"
        />
      )}
      <div className={styles.newsCaption}>
        <div className={styles.dots}>
          {news.map((item, index) => (
            <i
              className={index === newsIndex ? styles.activeDot : ""}
              key={(item.title || index) + index}
            />
          ))}
        </div>
      </div>
    </>
  );
});

export default function MonitorPage({ params }) {
  const resolvedParams = params ? (params.then ? use(params) : params) : {};
  const sector = resolvedParams?.sector || "farmacia";

  const state = useSyncExternalStore(
    subscribeQueue,
    getQueueSnapshot,
    () => monitorServerSnapshot
  );

  const [time, setTime] = useState("");
  const [audioEnabled, setAudioEnabled] = useState(false);
  const audioEnabledRef = useRef(false);
  audioEnabledRef.current = audioEnabled;

  useEffect(() => {
    if (!audioEnabled) return undefined;
    unlockSpeech();
    return registerMonitorSpeaker();
  }, [audioEnabled]);

  const enableAudio = () => {
    unlockSpeech();
    speakText("Som ativado.");
    setAudioEnabled(true);
  };

  useEffect(() => {
    const clockTimer = setInterval(() => {
      setTime(
        new Intl.DateTimeFormat("pt-BR", {
          hour: "2-digit",
          minute: "2-digit",
          second: "2-digit",
        }).format(new Date())
      );
    }, 1000);

    return () => clearInterval(clockTimer);
  }, []);

  useEffect(() => {
    if (!isSupabaseConfigured || !supabase || !sector) return;

    async function fetchInitialHistory() {
      try {
        const { data, error } = await supabase
          .from("queue_calls")
          .select("*")
          .eq("sector_id", sector)
          .order("id", { ascending: false })
          .limit(30);

        if (error || !data || data.length === 0) return;

        const formattedHistory = data.map((item) => ({
          id: item.id,
          number: item.number_int,
          type:
            item.type === "preferential" || item.type === "preferencial"
              ? "preferencial"
              : "normal",
          time: new Intl.DateTimeFormat("pt-BR", {
            hour: "2-digit",
            minute: "2-digit",
          }).format(new Date(item.created_at || Date.now())),
        }));

        const clean = cleanHistory(formattedHistory);
        const previous = getQueueSnapshot() || monitorServerSnapshot;
        const queue = previous[sector] || {};

        saveQueueState({
          ...previous,
          [sector]: {
            ...queue,
            history: clean,
          },
        });
      } catch (err) {
        console.error("Erro ao carregar histórico inicial:", err);
      }
    }

    fetchInitialHistory();

    const channel = supabase
      .channel(`realtime-monitor-${sector}`)
      .on(
        "postgres_changes",
        {
          event: "INSERT",
          schema: "public",
          table: "queue_calls",
          filter: `sector_id=eq.${sector}`,
        },
        (payload) => {
          const call = payload.new;
          if (!call || !call.number_int) return;

          // Impede re-execução da mesma chamada pelo ID
          const callKey = `${call.id || call.number_int}-${call.type}`;
          if (lastSpokenCallId === callKey) return;
          lastSpokenCallId = callKey;

          const previous = getQueueSnapshot() || monitorServerSnapshot;
          const queue = previous[sector] || {};
          const callTypeFormatted =
            call.type === "preferential" || call.type === "preferencial"
              ? "preferencial"
              : "normal";
          const field =
            callTypeFormatted === "preferencial" ? "priorityCurrent" : "normalCurrent";

          const currentHistory = queue.history || [];

          const timeStr = new Intl.DateTimeFormat("pt-BR", {
            hour: "2-digit",
            minute: "2-digit",
          }).format(new Date(call.created_at || Date.now()));

          const newCallObj = {
            id: call.id,
            number: call.number_int,
            type: callTypeFormatted,
            time: timeStr,
          };

          const nextHistory = cleanHistory([newCallObj, ...currentHistory]).slice(0, 30);

          saveQueueState({
            ...previous,
            [sector]: {
              ...queue,
              [field]: call.number_int,
              history: nextHistory,
            },
          });

          // O BroadcastChannel já entrega a fala para o monitor quando ele
          // está registrado como speaker. Chamar announceQueueCall aqui também
          // causaria dupla fala. Só anunciamos via Realtime se o monitor
          // ainda NÃO está registrado como speaker (ex: aba recém aberta).
          if (audioEnabledRef.current && !isMonitorSpeakerActive()) {
            announceQueueCall(call.number_int, callTypeFormatted);
          }
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [sector]);

  const info = SECTORS[sector] || SECTORS.farmacia;
  const current = state[sector] || state.farmacia || { normalCurrent: 0, history: [] };

  const validHistory = cleanHistory(current.history || []);

  const latest = validHistory[0] || {
    number: current.normalCurrent || 0,
    type: "normal",
  };

  const recentCalls = validHistory.slice(1, 5);

  return (
    <main className={styles.monitor}>
      {!audioEnabled && (
        <button
          onClick={enableAudio}
          style={{
            position: "fixed",
            top: 16,
            right: 16,
            zIndex: 9999,
            padding: "12px 20px",
            backgroundColor: "#22c55e",
            color: "#ffffff",
            border: "none",
            borderRadius: "8px",
            cursor: "pointer",
            fontWeight: "bold",
            display: "flex",
            alignItems: "center",
            gap: "8px",
            boxShadow: "0 4px 12px rgba(0, 0, 0, 0.2)",
          }}
        >
          <Volume2 size={20} /> Clique para Ativar Áudio das Chamadas
        </button>
      )}

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
              weekday: "long",
              day: "2-digit",
              month: "long",
              year: "numeric",
            })
              .format(new Date())
              .toUpperCase()}
          </div>
        </div>
      </header>

      <div className={styles.content}>
        <section className={styles.leftColumn}>
          <section
            className={`${styles.featured} ${
              latest.type === "preferencial" ? styles.featuredPriority : ""
            }`}
          >
            <p>SENHA</p>
            <strong>{formatMonitorNumber(latest.number)}</strong>

            {latest.type === "preferencial" ? (
              <span className={styles.priorityTag}>
                ATENDIMENTO PREFERENCIAL
              </span>
            ) : (
              <span>ATENDIMENTO</span>
            )}

            <small>Dirija-se ao balcão de atendimento</small>
          </section>

          <section className={styles.recent}>
            <p className={styles.kicker}>ÚLTIMAS SENHAS</p>
            {recentCalls.length > 0 ? (
              recentCalls.map((item, index) => (
                <div
                  className={styles.historyItem}
                  key={`${item.id || item.number}-${item.type}-${index}`}
                >
                  <strong
                    className={
                      item.type === "preferencial"
                        ? styles.priorityNumber
                        : styles.normalNumber
                    }
                  >
                    {formatMonitorNumber(item.number)}
                  </strong>

                  {item.type === "preferencial" ? (
                    <span className={styles.priorityTagSmall}>
                      PREFERENCIAL
                    </span>
                  ) : (
                    <span className={styles.normal}>ATENDIMENTO</span>
                  )}

                  <time>{item.time}</time>
                </div>
              ))
            ) : (
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