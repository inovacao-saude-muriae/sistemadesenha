"use client";

import { use, useEffect, useState, useSyncExternalStore } from "react";
import Image from "next/image";
import { Clock3, Volume2, VolumeX } from "lucide-react";
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

export default function MonitorPage({ params }) {
  const { sector } = use(params);
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
  const [audioUnlocked, setAudioUnlocked] = useState(false);

  // Função para liberar a voz no navegador da TV com apenas um clique
  function enableAudio() {
    if (typeof window !== "undefined" && "speechSynthesis" in window) {
      window.speechSynthesis.cancel();
      playCallAlert();
      const testUtterance = new SpeechSynthesisUtterance("Som do monitor ativado.");
      testUtterance.lang = "pt-BR";
      window.speechSynthesis.speak(testUtterance);
      setAudioUnlocked(true);
    }
  }

  // Relógio e notícias
  useEffect(() => {
    const refreshNews = () =>
      fetch("/api/news")
        .then((res) => (res.ok ? res.json() : null))
        .then((data) => {
          if (!data?.news) return;
          newsSnapshot = data.news;
          window.dispatchEvent(new Event("news-updated"));
        })
        .catch(() => undefined);

    refreshNews();
    const newsRefreshTimer = setInterval(refreshNews, 10000);

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
      setNewsIndex((index) => (news.length ? (index + 1) % news.length : 0));
    }, 6000);

    return () => {
      clearInterval(newsRefreshTimer);
      clearInterval(clockTimer);
      clearInterval(newsTimer);
    };
  }, [news.length]);

  // Supabase Realtime (Recebe a chamada do Atendimento 1 e do Atendimento 2)
  useEffect(() => {
    if (!isSupabaseConfigured || !supabase) return;

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
          const previous = getQueueSnapshot();
          const queue = previous[sector] || {};
          const field =
            call.type === "preferential" ? "priorityCurrent" : "normalCurrent";
          const callTypeFormatted =
            call.type === "preferential" ? "preferencial" : "normal";

          const nextQueue = {
            ...queue,
            [field]: call.number_int,
            history: [
              {
                number: call.number_int,
                type: callTypeFormatted,
                time: new Intl.DateTimeFormat("pt-BR", {
                  hour: "2-digit",
                  minute: "2-digit",
                }).format(new Date(call.created_at)),
              },
              ...(queue.history || []),
            ].slice(0, 8),
          };

          saveQueueState({ ...previous, [sector]: nextQueue });

          // Toca a campainha e fala a senha na TV
          playCallAlert();
          if (typeof window !== "undefined" && "speechSynthesis" in window) {
            window.speechSynthesis.cancel();
            const text = `Senha ${formatQueueNumber(
              call.number_int,
              callTypeFormatted
            )}, dirigir-se ao atendimento.`;
            const utterance = new SpeechSynthesisUtterance(text);
            utterance.lang = "pt-BR";
            window.speechSynthesis.speak(utterance);
          }
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [sector]);

  const info = SECTORS[sector] || SECTORS.farmacia;
  const current = state[sector] || state.farmacia;
  const latest = current.history[0] || {
    number: current.normalCurrent || 0,
    type: "normal",
  };

  return (
    <main className={styles.monitor} onClick={enableAudio}>
      <header className={styles.header}>
        <div className={styles.sectorTitle}>{info.name.toUpperCase()}</div>
        <div className={styles.heading}>
          <strong>CENTRAL DE ATENDIMENTO</strong>
        </div>
        <div className={styles.headerMeta}>
          <button 
            type="button"
            onClick={enableAudio} 
            style={{
              background: audioUnlocked ? "#10b981" : "#ef4444",
              color: "#fff",
              border: "none",
              borderRadius: "4px",
              padding: "4px 8px",
              cursor: "pointer",
              fontSize: "12px",
              fontWeight: "bold",
              display: "inline-flex",
              alignItems: "center",
              gap: "4px",
              marginBottom: "4px"
            }}
          >
            {audioUnlocked ? <Volume2 size={14} /> : <VolumeX size={14} />}
            {audioUnlocked ? "Som Ativado" : "Clique p/ Ativar Som"}
          </button>
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
            {current.history.slice(0, 4).map((item, index) => (
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
          {news.length ? (
            <>
              <Image
                src={news[newsIndex]?.image}
                alt=""
                fill
                unoptimized
                sizes="(max-width: 900px) 100vw, 60vw"
              />
              <div className={styles.newsCaption}>
                <div className={styles.dots}>
                  {news.map((item, index) => (
                    <i
                      className={index === newsIndex ? styles.activeDot : ""}
                      key={item.title + index}
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