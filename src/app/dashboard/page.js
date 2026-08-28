"use client";

import { useCallback, useEffect, useState, useSyncExternalStore } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  Bell,
  CheckCircle2,
  Clock3,
  LogOut,
  Monitor,
  RotateCcw,
  Settings2,
  Trash2,
} from "lucide-react";
import {
  clearMonitorHistory,
  formatQueueNumber,
  getQueueSnapshot,
  getServerQueueSnapshot,
  getServerSessionSnapshot,
  getSessionSnapshot,
  nextQueueNumber,
  normalizeQueue,
  readQueueState,
  saveQueueState,
  SECTORS,
  SESSION_KEY,
  subscribeQueue,
  subscribeSession,
  withQueueLock,
} from "../../lib/queue";
import { isSupabaseConfigured, supabase } from "../../lib/supabase";
import { announceQueueCall, forceAnnounce, initSpeechClient, unlockSpeech } from "../../lib/speech";
import styles from "./Dashboard.module.css";

const emptySubscribe = () => () => {};
function useIsClient() {
  return useSyncExternalStore(
    emptySubscribe,
    () => true,
    () => false
  );
}

export default function DashboardPage() {
  const router = useRouter();
  const isClient = useIsClient();

  const session = useSyncExternalStore(
    subscribeSession,
    getSessionSnapshot,
    getServerSessionSnapshot
  );
  const state = useSyncExternalStore(
    subscribeQueue,
    getQueueSnapshot,
    getServerQueueSnapshot
  );

  const [notice, setNotice] = useState("Pronto para o próximo atendimento");
  const [time, setTime] = useState("");
  const [calling, setCalling] = useState(false);

  useEffect(() => {
    const storedSession = getSessionSnapshot();
    if (!storedSession) {
      router.push("/login");
      return undefined;
    }
    const timer = window.setInterval(
      () =>
        setTime(
          new Intl.DateTimeFormat("pt-BR", {
            hour: "2-digit",
            minute: "2-digit",
            second: "2-digit",
          }).format(new Date())
        ),
      1000
    );
    return () => {
      window.clearInterval(timer);
    };
  }, [router]);

  useEffect(() => {
    initSpeechClient();
    const unlock = () => unlockSpeech();
    window.addEventListener("pointerdown", unlock, { once: true });
    window.addEventListener("keydown", unlock, { once: true });
    return () => {
      window.removeEventListener("pointerdown", unlock);
      window.removeEventListener("keydown", unlock);
    };
  }, []);

  useEffect(() => {
    if (!isSupabaseConfigured || !supabase || !session?.sector) return;

    const channel = supabase
      .channel(`realtime-dashboard-${session.sector}`)
      .on(
        "postgres_changes",
        {
          event: "INSERT",
          schema: "public",
          table: "queue_calls",
          filter: `sector_id=eq.${session.sector}`,
        },
        (payload) => {
          const call = payload.new;
          if (!call || !call.number_int) return;

          const latestState = readQueueState();
          const latest = normalizeQueue(latestState[session.sector]);
          const callTypeFormatted =
            call.type === "preferential" || call.type === "preferencial"
              ? "preferencial"
              : "normal";
          const field =
            callTypeFormatted === "preferencial"
              ? "priorityCurrent"
              : "normalCurrent";

          if (
            latest.history.length > 0 &&
            latest.history[0].number === call.number_int &&
            latest.history[0].type === callTypeFormatted
          ) {
            return;
          }

          const updated = {
            ...latestState,
            [session.sector]: {
              ...latest,
              [field]: call.number_int,
              history: [
                {
                  number: call.number_int,
                  type: callTypeFormatted,
                  time: new Intl.DateTimeFormat("pt-BR", {
                    hour: "2-digit",
                    minute: "2-digit",
                  }).format(new Date(call.created_at || Date.now())),
                },
                ...latest.history,
              ].slice(0, 10),
            },
          };

          saveQueueState(updated);
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [session?.sector]);

  const sector = session?.sector || "farmacia";
  const current = normalizeQueue(state[sector]);
  const sectorInfo = SECTORS[sector] || SECTORS.farmacia;

  const callNext = useCallback(
    async (type) => {
      if (calling) return;
      setCalling(true);

      await withQueueLock(async () => {
        let next;

        try {
          const response = await fetch("/api/queue/call", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              sector,
              type,
              attendantId: session?.id || null,
            }),
          });
          const data = await response.json();
          if (!response.ok) {
            if (data.useLocal) {
              const latestState = readQueueState();
              const latest = normalizeQueue(latestState[sector]);
              next =
                type === "preferencial"
                  ? nextQueueNumber(latest.priorityCurrent)
                  : nextQueueNumber(latest.normalCurrent);
            } else {
              setNotice(data.error || "Erro ao conectar à sequência central.");
              next = null;
            }
          } else {
            next = Number(data.number);
          }
        } catch {
          next = null;
        }

        next = Number(next);

        if (!Number.isInteger(next) || next < 1 || next > 1000) {
          setNotice("Não foi possível conectar à sequência central.");
          setCalling(false);
          return;
        }

        const latestState = readQueueState();
        const latest = normalizeQueue(latestState[sector]);
        const field =
          type === "preferencial" ? "priorityCurrent" : "normalCurrent";
        saveQueueState({
          ...latestState,
          [sector]: {
            ...latest,
            [field]: next,
            history: [
              {
                number: next,
                type,
                time: new Intl.DateTimeFormat("pt-BR", {
                  hour: "2-digit",
                  minute: "2-digit",
                }).format(new Date()),
              },
              ...latest.history,
            ].slice(0, 10),
          },
        });

        setNotice(
          type === "preferencial"
            ? "Senha preferencial chamada"
            : "Senha normal chamada"
        );

        announceQueueCall(next, type);
      });

      setCalling(false);
    },
    [calling, sector, session]
  );

  const reCall = useCallback(() => {
    const lastItem = current.history[0];
    if (!lastItem) {
      setNotice("Nenhuma senha anterior para chamar.");
      return;
    }

    setNotice(`Chamando novamente: ${formatQueueNumber(lastItem.number, lastItem.type)}`);

    // forceAnnounce ignora a deduplicação para garantir que a repetição seja falada
    forceAnnounce(lastItem.number, lastItem.type);
  }, [current.history]);

  const handleClearHistory = () => {
    clearMonitorHistory(sector);
    setNotice("Histórico do painel limpo com sucesso!");
  };

  useEffect(() => {
    function handleKeyDown(event) {
      if (
        ["INPUT", "SELECT", "TEXTAREA", "BUTTON"].includes(event.target.tagName)
      ) {
        return;
      }

      const key = event.key.toLowerCase();
      const normalCall = ["arrowright", "pagedown", " "].includes(key);
      const priorityCall = ["arrowleft", "pageup"].includes(key);
      const recallCall = ["b", ".", "f5", "escape"].includes(key);

      if (recallCall) {
        event.preventDefault();
        reCall();
        return;
      }

      if (!normalCall && !priorityCall) return;

      event.preventDefault();
      callNext(priorityCall ? "preferencial" : "normal");
    }

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [callNext, reCall]);

  if (!isClient) {
    return null;
  }

  return (
    <main
      className={`${styles.shell} ${
        session?.accessLevel === 2 ? styles.secondary : ""
      }`}
    >
      <aside className={styles.sidebar}>
        <nav className={styles.nav}>
          <Link className={styles.activeNav} href="/dashboard">
            <Bell size={18} /> Chamadas
          </Link>
          <Link href="/history">
            <Clock3 size={18} /> Histórico
          </Link>
          {session?.role === "admin" && (
            <Link href="/admin">
              <Settings2 size={18} /> Administração
            </Link>
          )}
        </nav>
        <div className={styles.sidebarFoot}>
          <div className={styles.profile}>
            <div className={styles.avatar}>{session?.initials || "AT"}</div>
            <div>
              <strong>{session?.name || "Atendente"}</strong>
              <small>{sectorInfo.name}</small>
            </div>
          </div>
          <Link
            href="/"
            className={styles.logout}
            onClick={() => window.localStorage.removeItem(SESSION_KEY)}
          >
            <LogOut size={17} /> Sair
          </Link>
        </div>
      </aside>
      <section className={styles.main}>
        <header className={styles.header}>
          <div>
            <p className={styles.eyebrow}>PAINEL DE ATENDIMENTO</p>
            <h1>
              Olá, {session?.name || "Atendente"} <span>👋</span>
            </h1>
            <p className={styles.muted}>
              Controle as chamadas da sua unidade em tempo real.
            </p>
          </div>
          <div className={styles.headerActions}>
            <div className={styles.connection}>
              <CheckCircle2 size={16} /> Sistema online
            </div>

            <Link
              href={`/monitor/${sector}`}
              className={styles.monitorLink}
              target="_blank"
              rel="noopener noreferrer"
            >
              <Monitor size={17} /> Abrir monitor
            </Link>

            <div className={styles.headerTime}>
              <Clock3 size={16} /> {time || "--:--:--"}
            </div>
          </div>
        </header>

        <div className={styles.grid} style={{ marginTop: "32px" }}>
          <section className={styles.currentCard}>
            <div className={styles.cardTop}>
              <div>
                <span className={styles.label}>ÚLTIMA SENHA CHAMADA</span>
                <p className={styles.sectorName}>{sectorInfo.name}</p>
              </div>
              <span className={styles.live}>
                <i /> AO VIVO
              </span>
            </div>
            <div className={styles.queueNumber}>
              {current.history[0]
                ? formatQueueNumber(
                    current.history[0].number,
                    current.history[0].type
                  )
                : "N001"}
            </div>
            <p className={styles.callType}>
              {current.history[0]?.type === "preferencial"
                ? "ATENDIMENTO PREFERENCIAL"
                : "ATENDIMENTO NORMAL"}
            </p>
            <div className={styles.notice}>
              <CheckCircle2 size={18} /> {notice}
            </div>
          </section>
          <section className={styles.actionsCard}>
            <div className={styles.cardTop}>
              <div>
                <span className={styles.label}>PRÓXIMA CHAMADA</span>
                <h2>Escolha o tipo de atendimento</h2>
              </div>
              <span className={styles.counter}>
                {current.history.length} hoje
              </span>
            </div>
            <button
              className={styles.normalButton}
              disabled={calling}
              onClick={() => callNext("normal")}
            >
              <span>
                <Bell size={22} /> {calling ? "CHAMANDO..." : "CHAMAR NORMAL"}
              </span>
              <small>
                Próxima senha:{" "}
                {formatQueueNumber(
                  nextQueueNumber(current.normalCurrent),
                  "normal"
                )}
              </small>
            </button>
            <button
              className={styles.priorityButton}
              disabled={calling}
              onClick={() => callNext("preferencial")}
            >
              <span>
                <Bell size={22} />{" "}
                {calling ? "CHAMANDO..." : "CHAMAR PREFERENCIAL"}
              </span>
              <small>
                Próxima senha:{" "}
                {formatQueueNumber(
                  nextQueueNumber(current.priorityCurrent),
                  "preferencial"
                )}
              </small>
            </button>
            <button
              type="button"
              className={styles.recallButton}
              onClick={reCall}
            >
              <RotateCcw size={18} /> CHAMAR NOVAMENTE ( BOTÃO LUZ / &apos;B&apos; )
            </button>
            <button
              type="button"
              className={styles.recallButton}
              onClick={handleClearHistory}
              style={{ marginTop: "10px", backgroundColor: "#ef4444", color: "#fff" }}
            >
              <Trash2 size={18} /> LIMPAR PAINEL DE CHAMADAS
            </button>
            <p className={styles.helper}>
              Limpar o painel remove as senhas do monitor sem resetar a sequência numérica.
            </p>
          </section>
        </div>
        <section className={styles.recent}>
          <div className={styles.sectionHeading}>
            <div>
              <span className={styles.label}>ÚLTIMAS CHAMADAS</span>
              <h2>Histórico recente</h2>
            </div>
            <Link href="/history">Ver histórico completo →</Link>
          </div>
          <div className={styles.table}>
            <div className={styles.tableHead}>
              <span>SENHA</span>
              <span>TIPO</span>
              <span>HORÁRIO</span>
              <span>STATUS</span>
            </div>
            {current.history.slice(0, 5).map((item, index) => (
              <div
                className={styles.tableRow}
                key={`${item.number}-${item.type}-${item.time}-${index}`}
              >
                <strong>{formatQueueNumber(item.number, item.type)}</strong>
                <span
                  className={
                    item.type === "preferencial"
                      ? styles.priorityTag
                      : styles.normalTag
                  }
                >
                  {item.type === "preferencial" ? "Preferencial" : "Normal"}
                </span>
                <span>{item.time}</span>
                <span className={styles.called}>
                  <CheckCircle2 size={15} /> Chamada
                </span>
              </div>
            ))}
          </div>
        </section>
      </section>
    </main>
  );
}