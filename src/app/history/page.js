"use client";

import Link from "next/link";
import { useEffect, useSyncExternalStore } from "react";
import { useRouter } from "next/navigation";
import { ArrowLeft, CheckCircle2 } from "lucide-react";
import {
  formatQueueNumber,
  getQueueSnapshot,
  getServerQueueSnapshot,
  getServerSessionSnapshot,
  getSessionSnapshot,
  normalizeQueue,
  SECTORS,
  subscribeQueue,
  subscribeSession,
} from "../../lib/queue";
import styles from "./History.module.css";

export default function HistoryPage() {
  const router = useRouter();
  const session = useSyncExternalStore(
    subscribeSession,
    getSessionSnapshot,
    getServerSessionSnapshot,
  );
  const state = useSyncExternalStore(
    subscribeQueue,
    getQueueSnapshot,
    getServerQueueSnapshot,
  );

  useEffect(() => {
    if (!getSessionSnapshot()) router.push("/login");
  }, [router]);

  if (!session) return null;

  const sector = SECTORS[session.sector] ? session.sector : "farmacia";
  const sectorInfo = SECTORS[sector];
  const items = normalizeQueue(state[sector]).history;

  return (
    <main className={styles.page}>
      <header>
        <Link href="/dashboard">
          <ArrowLeft size={17} /> Voltar ao dashboard
        </Link>
        <span>HISTÓRICO DE CHAMADAS</span>
      </header>
      <section className={styles.content}>
        <div className={styles.title}>
          <div>
            <p>REGISTRO OPERACIONAL</p>
            <h1>Histórico de chamadas</h1>
            <span>{sectorInfo.name} · atendimentos realizados</span>
          </div>
        </div>
        <div className={styles.table}>
          <div className={styles.head}>
            <span>senha</span>
            <span>tipo</span>
            <span>setor</span>
            <span>horário</span>
            <span>status</span>
          </div>
          {items.length === 0 ? (
            <p className={styles.empty}>Nenhuma chamada registrada hoje.</p>
          ) : (
            items.map((item, index) => (
              <div
                className={styles.row}
                key={`${item.number}-${item.time}-${index}`}
              >
                <strong>{formatQueueNumber(item.number, item.type)}</strong>
                <span
                  className={
                    item.type === "preferencial" ? styles.priority : styles.normal
                  }
                >
                  {item.type === "preferencial" ? "Preferencial" : "Normal"}
                </span>
                <span>{sectorInfo.name}</span>
                <span>{item.time}</span>
                <span className={styles.called}>
                  <CheckCircle2 size={15} /> Concluída
                </span>
              </div>
            ))
          )}
        </div>
      </section>
    </main>
  );
}
