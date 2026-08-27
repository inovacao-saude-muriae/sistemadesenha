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
  Volume2,
  VolumeX,
} from "lucide-react";
import {
  formatQueueNumber,
  getQueueSnapshot,
  getServerQueueSnapshot,
  getServerSessionSnapshot,
  getSessionSnapshot,
  nextQueueNumber,
  normalizeQueue,
  playCallAlert,
  readQueueState,
  saveQueueState,
  SECTORS,
  SESSION_KEY,
  subscribeQueue,
  subscribeSession,
  withQueueLock,
} from "../../lib/queue";
import { isSupabaseConfigured, supabase } from "../../lib/supabase";
import styles from "./Dashboard.module.css";

export default function DashboardPage() {
  const router = useRouter();
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
  const [sound, setSound] = useState(true);
  const [notice, setNotice] = useState("Pronto para o próximo atendimento");
  const [time, setTime] = useState("");
  const [calling, setCalling] = useState(false);

  // Redirecionamento e relógio local
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

  // Sincronização em tempo real via Supabase Realtime
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
              ].slice(0, 8),
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

  // Função para chamar a próxima senha (Normal ou Preferencial)
  const callNext = useCallback(
    async (type) => {
      if (calling) return;
      setCalling(true);

      await withQueueLock(async () => {
        const latestState = readQueueState();
        const latest = normalizeQueue(latestState[sector]);
        const field =
          type === "preferencial" ? "priorityCurrent" : "normalCurrent";
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
            setNotice(
              data.error || "Não foi possível conectar à sequência central."
            );
            next = null;
          } else {
            next = data.number;
          }
        } catch {
          next = null;
        }

        if (!Number.isInteger(next) || next < 1 || next > 1000) {
          setNotice("Não foi possível conectar à sequência central.");
          setCalling(false);
          return;
        }

        const updated = {
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
            ].slice(0, 8),
          },
        };

        saveQueueState(updated);
        setNotice(
          type === "preferencial"
            ? "Senha preferencial chamada"
            : "Senha normal chamada"
        );

        playCallAlert();
        if (sound && "speechSynthesis" in window) {
          window.speechSynthesis.cancel();
          const guicheText =
            session?.guiche && session.guiche !== "none"
              ? `, dirigir-se ao ${session.guiche.replace("guiche-", "guichê ")}`
              : ", dirigir-se ao atendimento";

          const text = `Senha ${formatQueueNumber(next, type)}${guicheText}.`;
          const utterance = new SpeechSynthesisUtterance(text);
          utterance.lang = "pt-BR";
          window.speechSynthesis.speak(utterance);
        }
      });

      setCalling(false);
    },
    [calling, sector, session, sound]
  );

  // Função para chamar novamente a última senha
  const reCall = useCallback(() => {
    const lastItem = current.history[0];
    if (!lastItem) {
      setNotice("Nenhuma senha anterior para chamar.");
      return;
    }

    setNotice(`Chamando novamente: ${formatQueueNumber(lastItem.number, lastItem.type)}`);

    playCallAlert();
    if (sound && "speechSynthesis" in window) {
      window.speechSynthesis.cancel();
      const guicheText =
        session?.guiche && session.guiche !== "none"
          ? `, dirigir-se ao ${session.guiche.replace("guiche-", "guichê ")}`
          : ", dirigir-se ao atendimento";

      const text = `Senha ${formatQueueNumber(lastItem.number, lastItem.type)}${guicheText}.`;
      const utterance = new SpeechSynthesisUtterance(text);
      utterance.lang = "pt-BR";
      window.speechSynthesis.speak(utterance);
    }
  }, [current.history, session, sound]);

  // Atalhos de teclado e passador de slides
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
            <Link href={`/monitor/${sector}`} className={styles.monitorLink}>
              <Monitor size={17} /> Abrir monitor
            </Link>
            <div className={styles.headerTime}>
              <Clock3 size={16} /> {time}
            </div>
          </div>
        </header>
        <div className={styles.toolbar}>
          <div>
            <span className={styles.label}>SERVIÇO VINCULADO À CONTA</span>
            <div className={styles.serviceName}>{sectorInfo.name}</div>
          </div>
          <button
            className={styles.soundButton}
            onClick={() => setSound(!sound)}
          >
            {sound ? <Volume2 size={17} /> : <VolumeX size={17} />} Som{" "}
            {sound ? "ativado" : "desativado"}
          </button>
        </div>
        <div className={styles.grid}>
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
              onClick={reCall}
              style={{
                marginTop: "12px",
                padding: "12px",
                background: "#2563eb",
                color: "#ffffff",
                border: "none",
                borderRadius: "8px",
                fontWeight: "600",
                cursor: "pointer",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                gap: "8px",
                width: "100%",
              }}
            >
              <RotateCcw size={18} /> CHAMAR NOVAMENTE ( BOTÃO LUZ / &apos;B&apos; )
            </button>
            <p className={styles.helper}>
              Normal e preferencial possuem sequências independentes.
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
                key={`${item.number}-${item.time}-${index}`}
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