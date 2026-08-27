"use client";

import { use, useEffect, useState, useSyncExternalStore } from "react";
import Image from "next/image";
import { Clock3 } from "lucide-react";
import {
  formatQueueNumber,
  getQueueSnapshot,
  saveQueueState,
  SECTORS,
  subscribeQueue,
} from "../../../lib/queue";
import { isSupabaseConfigured, supabase } from "../../../lib/supabase";
import styles from "./Monitor.module.css";

let newsSnapshot = [];
const serverNewsSnapshot = [];
const monitorServerSnapshot = {
  farmacia: {
    normalCurrent: 0,
    priorityCurrent: 0,
    history: [],
    historyDate: "",
  },
  recepcao: {
    normalCurrent: 0,
    priorityCurrent: 0,
    history: [],
    historyDate: "",
  },
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
    () => monitorServerSnapshot,
  );
  const news = useSyncExternalStore(
    subscribeNews,
    getNewsSnapshot,
    () => serverNewsSnapshot,
  );
  const [time, setTime] = useState("");
  const [newsIndex, setNewsIndex] = useState(0);

  useEffect(() => {
    const refreshNews = () =>
      fetch("/api/news")
        .then((response) => (response.ok ? response.json() : null))
        .then((data) => {
          if (!data?.news) return;
          newsSnapshot = data.news;
          window.dispatchEvent(new Event("news-updated"));
        })
        .catch(() => undefined);
    refreshNews();
    const newsRefreshTimer = window.setInterval(refreshNews, 5000);
    return () => window.clearInterval(newsRefreshTimer);
  }, []);

  useEffect(() => {
    const timer = window.setInterval(() => {
      setTime(
        new Intl.DateTimeFormat("pt-BR", {
          hour: "2-digit",
          minute: "2-digit",
          second: "2-digit",
        }).format(new Date()),
      );
    }, 1000);
    const newsTimer = window.setInterval(() => {
      setNewsIndex((index) => (news.length ? (index + 1) % news.length : 0));
    }, 6000);
    return () => {
      window.clearInterval(timer);
      window.clearInterval(newsTimer);
    };
  }, [news.length]);

  useEffect(() => {
    const syncCentralQueue = () =>
      fetch(`/api/queue/call?sector=${sector}`)
        .then((response) => (response.ok ? response.json() : null))
        .then((centralQueue) => {
          if (!centralQueue) return;
          const currentState = getQueueSnapshot();
          saveQueueState({ ...currentState, [sector]: centralQueue });
        })
        .catch(() => undefined);
    syncCentralQueue();
    const queueRefreshTimer = window.setInterval(syncCentralQueue, 2000);
    return () => window.clearInterval(queueRefreshTimer);
  }, [sector]);

  useEffect(() => {
    if (!isSupabaseConfigured) return undefined;
    const channel = supabase
      .channel(`monitor-${sector}`)
      .on(
        "postgres_changes",
        {
          event: "INSERT",
          schema: "public",
          table: "queue_calls",
          filter: `sector_id=eq.${sector}`,
        },
        ({ new: call }) => {
          const previous = getQueueSnapshot();
          const queue = previous[sector] || {};
          const field =
            call.type === "preferential" ? "priorityCurrent" : "normalCurrent";
          const nextQueue = {
            ...queue,
            [field]: call.number,
            history: [
              {
                number: call.number_int,
                type: call.type === "preferential" ? "preferencial" : "normal",
                time: new Intl.DateTimeFormat("pt-BR", {
                  hour: "2-digit",
                  minute: "2-digit",
                }).format(new Date(call.created_at)),
              },
              ...(queue.history || []),
            ].slice(0, 8),
          };
          saveQueueState({ ...previous, [sector]: nextQueue });
        },
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
            className={`${styles.featured} ${latest.type === "preferencial" ? styles.featuredPriority : ""}`}
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
