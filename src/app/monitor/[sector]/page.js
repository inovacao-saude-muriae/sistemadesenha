"use client";

import { use, useEffect, useState, useSyncExternalStore } from "react";
import Image from "next/image";
import { Clock3 } from "lucide-react";
import {
  formatQueueNumber,
  getQueueSnapshot,
  playCallAlert,
  saveQueueState,
  SECTORS,
  subscribeQueue,
} from "../../../lib/queue";
import { isSupabaseConfigured, supabase } from "../../../lib/supabase";
import styles from "./Monitor.module.css";

let newsSnapshot = [];
const serverNewsSnapshot = [];
const monitorServerSnapshot = {
  farmacia: { normalCurrent: 0, priorityCurrent: 0, history: [] },
  recepcao: { normalCurrent: 0, priorityCurrent: 0, history: [] },
};

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

// Reprodução automática da voz
function speakText(text) {
  if (typeof window === "undefined" || !("speechSynthesis" in window)) return;

  try {
    try {
      playCallAlert();
    } catch {
      // Ignora erro do bipe para não interromper a voz
    }

    if (window.speechSynthesis.paused) {
      window.speechSynthesis.resume();
    }
    window.speechSynthesis.cancel();

    setTimeout(() => {
      const utterance = new SpeechSynthesisUtterance(text);
      utterance.lang = "pt-BR";
      utterance.rate = 0.95;

      const voices = window.speechSynthesis.getVoices();
      const ptVoice = voices.find(
        (v) => v.lang.includes("pt-BR") || v.lang.includes("pt_BR") || v.lang.includes("pt")
      );
      if (ptVoice) utterance.voice = ptVoice;

      window.speechSynthesis.speak(utterance);
    }, 100);
  } catch (e) {
    console.error("Erro na síntese de voz:", e);
  }
}

export default function MonitorPage({ params }) {
  const resolvedParams = params ? (params.then ? use(params) : params) : {};
  const sector = resolvedParams?.sector || "farmacia";

  const state = useSyncExternalStore(
    subscribeQueue,
    getQueueSnapshot,
    () => monitorServerSnapshot
  );
  const news = useSyncExternalStore(
    subscribeNews,
    getNewsSnapshot,
    () => serverNewsSnapshot
  );

  const [time, setTime] = useState("");
  const [newsIndex, setNewsIndex] = useState(0);

  useEffect(() => {
    if (typeof window !== "undefined" && "speechSynthesis" in window) {
      window.speechSynthesis.getVoices();
      window.speechSynthesis.onvoiceschanged = () => {
        window.speechSynthesis.getVoices();
      };
    }
  }, []);

  // Notícias
  useEffect(() => {
    fetch("/api/news")
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => {
        if (!data?.news) return;
        newsSnapshot = data.news;
        window.dispatchEvent(new Event("news-updated"));
      })
      .catch(() => undefined);
  }, []);

  // Relógio
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

    const newsTimer = setInterval(() => {
      setNewsIndex((index) => (news?.length ? (index + 1) % news.length : 0));
    }, 6000);

    return () => {
      clearInterval(clockTimer);
      clearInterval(newsTimer);
    };
  }, [news?.length]);

  // Supabase Realtime
  useEffect(() => {
    if (!isSupabaseConfigured || !supabase || !sector) return;

    const processCall = (numberInt, typeStr, createdAt) => {
      const previous = getQueueSnapshot() || monitorServerSnapshot;
      const queue = previous[sector] || {};
      const callTypeFormatted =
        typeStr === "preferential" || typeStr === "preferencial"
          ? "preferencial"
          : "normal";
      const field =
        callTypeFormatted === "preferencial" ? "priorityCurrent" : "normalCurrent";

      const nextQueue = {
        ...queue,
        [field]: numberInt,
        history: [
          {
            number: numberInt,
            type: callTypeFormatted,
            time: new Intl.DateTimeFormat("pt-BR", {
              hour: "2-digit",
              minute: "2-digit",
            }).format(new Date(createdAt || Date.now())),
          },
          ...(queue.history || []),
        ].slice(0, 8),
      };

      saveQueueState({ ...previous, [sector]: nextQueue });

      const textToSpeak = `Senha ${formatQueueNumber(
        numberInt,
        callTypeFormatted
      )}, dirigir-se ao atendimento.`;

      speakText(textToSpeak);
    };

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
          if (payload?.new?.number_int) {
            processCall(
              payload.new.number_int,
              payload.new.type,
              payload.new.created_at
            );
          }
        }
      )
      .on("broadcast", { event: "new_call" }, (response) => {
        if (response?.payload?.number_int) {
          processCall(
            response.payload.number_int,
            response.payload.type,
            response.payload.created_at
          );
        }
      })
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [sector]);

  const info = SECTORS[sector] || SECTORS.farmacia;
  const current = state[sector] || state.farmacia || { normalCurrent: 0, history: [] };
  const historyList = current.history || [];
  const latest = historyList[0] || {
    number: current.normalCurrent || 0,
    type: "normal",
  };

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
            <strong>{formatQueueNumber(latest.number, latest.type)}</strong>
            <span>
              {latest.type === "preferencial"
                ? "ATENDIMENTO PREFERENCIAL"
                : "ATENDIMENTO"}
            </span>
            <small>Dirija-se ao balcão de atendimento</small>
          </section>

          <section className={styles.recent}>
            <p className={styles.kicker}>ÚLTIMAS SENHAS</p>
            {historyList.slice(0, 4).map((item, index) => (
              <div
                className={styles.historyItem}
                key={`${item.number}-${item.time}-${index}`}
              >
                <strong
                  className={
                    item.type === "preferencial"
                      ? styles.priorityNumber
                      : styles.normalNumber
                  }
                >
                  {formatQueueNumber(item.number, item.type)}
                </strong>
                <span
                  className={
                    item.type === "preferencial"
                      ? styles.priority
                      : styles.normal
                  }
                >
                  {item.type === "preferencial"
                    ? "PREFERENCIAL"
                    : "ATENDIMENTO"}
                </span>
                <time>{item.time}</time>
              </div>
            ))}
          </section>
        </section>

        <section className={styles.news}>
          {news?.length ? (
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
          ) : (
            <div className={styles.emptyNews}>
              <strong>INFORMAÇÕES DA UNIDADE</strong>
            </div>
          )}
        </section>
      </div>
    </main>
  );
}