"use client";

import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";
import Link from "next/link";
import Image from "next/image";
import { useRouter } from "next/navigation";
import {
  AlertTriangle,
  Filter,
  ImagePlus,
  LogOut,
  Monitor,
  RotateCcw,
  Save,
  ShieldCheck,
  Trash2,
} from "lucide-react";
import {
  getQueueSnapshot,
  getServerQueueSnapshot,
  getServerSessionSnapshot,
  getSessionSnapshot,
  normalizeQueue,
  saveQueueState,
  SECTORS,
  SESSION_KEY,
  subscribeQueue,
  subscribeSession,
} from "../../lib/queue";
import styles from "./Admin.module.css";

let newsCache = [];
const serverNewsSnapshot = [];

function getNewsSnapshot() {
  if (typeof window === "undefined") return serverNewsSnapshot;
  return newsCache;
}
function getServerNewsSnapshot() { return serverNewsSnapshot; }
function subscribeNews(callback) {
  window.addEventListener("storage", callback);
  window.addEventListener("news-updated", callback);
  return () => {
    window.removeEventListener("storage", callback);
    window.removeEventListener("news-updated", callback);
  };
}

export default function AdminPage() {
  const router = useRouter();

  const session = useSyncExternalStore(subscribeSession, getSessionSnapshot, getServerSessionSnapshot);
  const state   = useSyncExternalStore(subscribeQueue,   getQueueSnapshot,   getServerQueueSnapshot);
  const news    = useSyncExternalStore(subscribeNews,    getNewsSnapshot,    getServerNewsSnapshot);

  const [title, setTitle]               = useState("");
  const [image, setImage]               = useState("");
  const [message, setMessage]           = useState("");
  const [stats, setStats]               = useState(null);
  const [statsLoading, setStatsLoading] = useState(false);
  const [draftNews, setDraftNews]       = useState([]);
  const [savingNews, setSavingNews]     = useState(false);
  const [resettingSector, setResettingSector] = useState({});
  const [, refreshNews]                 = useState(0);
  const pendingFileRef                  = useRef(null);

  // filtros de histórico
  const [filterSector, setFilterSector] = useState("");
  const [filterFrom,   setFilterFrom]   = useState("");
  const [filterTo,     setFilterTo]     = useState("");
  const [filterDays,   setFilterDays]   = useState("30");

  /* segurança: só admin */
  useEffect(() => {
    const current = getSessionSnapshot();
    if (!current || current.role !== "admin") router.push("/login");
  }, [router]);

  /* notícias */
  useEffect(() => {
    fetch("/api/news")
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => {
        if (!data?.news) return;
        newsCache.splice(0, newsCache.length, ...data.news);
        setDraftNews(data.news);
        refreshNews((v) => v + 1);
        window.dispatchEvent(new Event("news-updated"));
      })
      .catch(() => {});
  }, []);

  /* busca de estatísticas com filtros */
  const fetchStats = useCallback((overrides = {}) => {
    const days   = overrides.days   !== undefined ? overrides.days   : filterDays;
    const sector = overrides.sector !== undefined ? overrides.sector : filterSector;
    const from   = overrides.from   !== undefined ? overrides.from   : filterFrom;
    const to     = overrides.to     !== undefined ? overrides.to     : filterTo;

    const params = new URLSearchParams({ days });
    if (sector) params.set("sector", sector);
    if (from)   params.set("from", from);
    if (to)     params.set("to", to);

    setStatsLoading(true);
    fetch(`/api/stats?${params}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => { setStats(data); setStatsLoading(false); })
      .catch(() => setStatsLoading(false));
  }, [filterDays, filterSector, filterFrom, filterTo]);

  /* estatísticas — carrega ao montar */
  useEffect(() => { fetchStats(); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  if (!session) return null;

  /* ── reset de fila ── */
  async function resetSector(sectorId) {
    const isAll = sectorId === "all";
    const label = isAll
      ? "TODOS os setores (Farmácia e Recepção)"
      : SECTORS[sectorId]?.name || sectorId;

    const msg = isAll
      ? `ATENÇÃO\n\nIsso vai zerar as senhas de ${label}.\n\nA numeração voltará para 001. Esta ação não pode ser desfeita.\n\nDeseja continuar?`
      : `Zerar as senhas do setor "${label}"?\n\nA numeração voltará para 001.`;

    if (!window.confirm(msg)) return;

    const sectorsToReset = isAll ? Object.keys(SECTORS) : [sectorId];
    setResettingSector((prev) => {
      const next = { ...prev };
      sectorsToReset.forEach((s) => (next[s] = true));
      return next;
    });
    setMessage("");

    try {
      const currentState = getQueueSnapshot();
      const next = { ...currentState };
      sectorsToReset.forEach((s) => {
        next[s] = { ...normalizeQueue(currentState[s]), normalCurrent: 0, priorityCurrent: 0, history: [] };
      });
      saveQueueState(next);

      const res  = await fetch("/api/queue/reset", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sector: sectorId }),
      });
      const data = await res.json().catch(() => ({}));

      if (!res.ok && !data.localOnly) {
        setMessage(data.error || "Erro ao zerar o contador no banco.");
        return;
      }
      setMessage(isAll
        ? "Todas as senhas foram resetadas. Numeração reinicia em 001."
        : `Senhas de "${label}" zeradas. Numeração reinicia em 001.`);
    } catch {
      setMessage("Erro ao zerar os contadores.");
    } finally {
      setResettingSector((prev) => {
        const next = { ...prev };
        sectorsToReset.forEach((s) => delete next[s]);
        return next;
      });
    }
  }

  /* ── notícias ── */
  function addNews(event) {
    event.preventDefault();
    if (!title || !pendingFileRef.current) return;
    setDraftNews([{ id: `draft-${Date.now()}`, title, image, _file: pendingFileRef.current }, ...draftNews]);
    setTitle("");
    setImage("");
    pendingFileRef.current = null;
    setMessage("Alteração pendente. Clique em 'Salvar notícias' para publicar.");
  }

  async function saveNews() {
    setSavingNews(true);
    setMessage("");
    try {
      // Remove os que foram deletados do rascunho
      const removed = news.filter(
        (item) => !draftNews.some((d) => String(d.id) === String(item.id))
      );
      for (const item of removed) {
        await fetch(`/api/news?id=${item.id}`, { method: "DELETE" });
      }

      // Cria os novos (que têm id começando com "draft-")
      const created = [];
      for (const item of draftNews.filter((d) => String(d.id).startsWith("draft-"))) {
        const fd = new FormData();
        fd.append("title", item.title);
        fd.append("image", item._file);
        const res  = await fetch("/api/news", { method: "POST", body: fd });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error);
        created.push(data.news);
      }

      const res  = await fetch("/api/news");
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      newsCache.splice(0, newsCache.length, ...data.news);
      setDraftNews(data.news);
      refreshNews((v) => v + 1);
      window.dispatchEvent(new Event("news-updated"));
      setMessage(`${created.length} notícia(s) salva(s) com sucesso.`);
    } catch (err) {
      setMessage(err.message || "Não foi possível salvar as notícias.");
    } finally {
      setSavingNews(false);
    }
  }

  function deleteNews(id) {
    setDraftNews(draftNews.filter((item) => String(item.id) !== String(id)));
    setMessage("Exclusão pendente. Clique em 'Salvar notícias' para confirmar.");
  }

  function readImage(event) {
    const file = event.target.files?.[0];
    if (!file) return;
    pendingFileRef.current = file;
    // preview local via URL temporária
    setImage(URL.createObjectURL(file));
  }

  return (
    <main className={styles.page}>
      <header>
        <div><ShieldCheck size={19} /> PAINEL ADMINISTRATIVO</div>
        <Link href="/login" onClick={() => window.localStorage.removeItem(SESSION_KEY)}>
          <LogOut size={16} /> Sair
        </Link>
      </header>

      <section className={styles.content}>
        <div className={styles.intro}>
          <div>
            <p>CONTROLE CENTRAL</p>
            <h1>Administração</h1>
            <span>Gerencie as filas de atendimento e as notícias do monitor.</span>
          </div>
        </div>

        {message && <div className={styles.alertBox}>{message}</div>}

        {/* ── Controle de filas ── */}
        <section className={styles.section}>
          <div className={styles.sectionTitle}>
            <div>
              <p>FILAS POR SERVIÇO</p>
              <h2>Controle dos atendimentos</h2>
            </div>
          </div>

          <div className={styles.sectors}>
            {Object.values(SECTORS).map((item) => {
              const queue      = normalizeQueue(state[item.id]);
              const isReset    = !!resettingSector[item.id];
              return (
                <article key={item.id}>
                  <div>
                    <strong>{item.name}</strong>
                    <small>
                      Normal: N{String(queue.normalCurrent).padStart(3, "0")} ·
                      Preferencial: P{String(queue.priorityCurrent).padStart(3, "0")}
                    </small>
                  </div>
                  <div className={styles.cardActions}>
                    <Link href={`/monitor/${item.id}`} target="_blank">
                      <Monitor size={16} /> Abrir Monitor
                    </Link>
                    <button
                      type="button"
                      onClick={() => resetSector(item.id)}
                      disabled={isReset}
                      className={styles.resetSectorButton}
                    >
                      <RotateCcw size={16} />
                      {isReset ? "Resetando…" : "Resetar senhas"}
                    </button>
                  </div>
                </article>
              );
            })}
          </div>

          <div className={styles.resetAllWrapper}>
            <div className={styles.resetAllInfo}>
              <AlertTriangle size={16} />
              <span>Resetar todos os setores de uma vez — numeração volta para 001 em todos.</span>
            </div>
            <button
              type="button"
              className={styles.resetAllButton}
              onClick={() => resetSector("all")}
              disabled={Object.keys(resettingSector).length > 0}
            >
              <RotateCcw size={16} />
              {Object.keys(resettingSector).length > 0 ? "Resetando…" : "Resetar todos os setores"}
            </button>
          </div>
        </section>

        {/* ── Notícias do monitor ── */}
        <section className={styles.section}>
          <div className={styles.sectionTitle}>
            <div>
              <p>COMUNICAÇÃO</p>
              <h2>Notícias do monitor</h2>
            </div>
          </div>

          <form className={styles.newsForm} onSubmit={addNews}>
            <input
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="Título da notícia"
              required
            />
            <label className={styles.upload}>
              <ImagePlus size={18} /> {image ? "Imagem selecionada" : "Adicionar imagem"}
              <input type="file" accept="image/*" onChange={readImage} required />
            </label>
            <button type="submit">
              <ImagePlus size={16} /> Adicionar à lista
            </button>
          </form>

          <div className={styles.newsGrid}>
            {draftNews.map((item, i) => (
              <article key={`${item.title}-${i}`}>
                <Image src={item.image} alt="" width={300} height={170} unoptimized />
                <strong>{item.title}</strong>
                <button className={styles.deleteNews} type="button" onClick={() => deleteNews(item.id)}>
                  <Trash2 size={14} /> Excluir
                </button>
              </article>
            ))}
          </div>

          <button
            className={styles.saveNews}
            type="button"
            onClick={saveNews}
            disabled={savingNews}
          >
            <Save size={16} /> {savingNews ? "Salvando…" : "Salvar notícias"}
          </button>
        </section>

        {/* ── Histórico ── */}
        <section className={styles.section}>
          <div className={styles.sectionTitle}>
            <div>
              <p>GESTÃO</p>
              <h2>Histórico de atendimentos</h2>
            </div>
          </div>

          {/* filtros */}
          <div className={styles.historyFilters}>
            <div className={styles.filterGroup}>
              <label>Período</label>
              <select
                value={filterDays}
                onChange={(e) => {
                  setFilterDays(e.target.value);
                  setFilterFrom("");
                  setFilterTo("");
                  fetchStats({ days: e.target.value, from: "", to: "" });
                }}
              >
                <option value="1">Hoje</option>
                <option value="7">Últimos 7 dias</option>
                <option value="30">Últimos 30 dias</option>
                <option value="90">Últimos 90 dias</option>
              </select>
            </div>

            <div className={styles.filterGroup}>
              <label>Setor</label>
              <select
                value={filterSector}
                onChange={(e) => {
                  setFilterSector(e.target.value);
                  fetchStats({ sector: e.target.value });
                }}
              >
                <option value="">Todos os setores</option>
                {Object.values(SECTORS).map((s) => (
                  <option key={s.id} value={s.id}>{s.name}</option>
                ))}
              </select>
            </div>

            <div className={styles.filterGroup}>
              <label>De</label>
              <input
                type="date"
                value={filterFrom}
                onChange={(e) => setFilterFrom(e.target.value)}
              />
            </div>

            <div className={styles.filterGroup}>
              <label>Até</label>
              <input
                type="date"
                value={filterTo}
                onChange={(e) => setFilterTo(e.target.value)}
              />
            </div>

            <button
              className={styles.filterBtn}
              type="button"
              onClick={() => fetchStats()}
            >
              <Filter size={14} /> Filtrar
            </button>
          </div>

          {statsLoading && <p className={styles.loadingMsg}>Carregando…</p>}

          {stats && !statsLoading && (
            <div className={styles.statsGrid}>
              <article className={styles.statCard}>
                <strong>{stats.summary?.total ?? 0}</strong>
                <span>Total no período</span>
              </article>
              <article className={styles.statCard}>
                <strong>{stats.summary?.today ?? 0}</strong>
                <span>Atendimentos hoje</span>
              </article>
              <article className={`${styles.statCard} ${styles.statCardNormal}`}>
                <strong>{stats.summary?.normal ?? 0}</strong>
                <span>Senhas normais</span>
              </article>
              <article className={`${styles.statCard} ${styles.statCardPref}`}>
                <strong>{stats.summary?.preferencial ?? 0}</strong>
                <span>Preferenciais</span>
              </article>
            </div>
          )}
        </section>
      </section>
    </main>
  );
}
