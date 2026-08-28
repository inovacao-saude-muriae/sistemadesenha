"use client";

import { useEffect, useState, useSyncExternalStore } from "react";
import Link from "next/link";
import Image from "next/image";
import { useRouter } from "next/navigation";
import {
  ImagePlus,
  LogOut,
  Monitor,
  RotateCcw,
  Save,
  ShieldCheck,
  Trash2,
  UserPlus,
} from "lucide-react";
import {
  getQueueSnapshot,
  getServerQueueSnapshot,
  getServerSessionSnapshot,
  getSessionSnapshot,
  GUICHES,
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

function getServerNewsSnapshot() {
  return serverNewsSnapshot;
}

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
  const news = useSyncExternalStore(
    subscribeNews,
    getNewsSnapshot,
    getServerNewsSnapshot
  );

  const [title, setTitle] = useState("");
  const [image, setImage] = useState("");
  const [user, setUser] = useState({
    name: "",
    login: "",
    password: "",
    sector: "farmacia",
    guiche: "none",
  });
  const [message, setMessage] = useState("");
  const [stats, setStats] = useState(null);
  const [draftNews, setDraftNews] = useState([]);
  const [savingNews, setSavingNews] = useState(false);
  const [, refreshNews] = useState(0);

  // Redirecionamento de segurança caso não seja Admin
  useEffect(() => {
    const current = getSessionSnapshot();
    if (!current || current.role !== "admin") router.push("/login");
  }, [router]);

  // Carrega lista inicial de notícias da API
  useEffect(() => {
    fetch("/api/news")
      .then((response) => (response.ok ? response.json() : null))
      .then((data) => {
        if (!data?.news) return;
        newsCache.splice(0, newsCache.length, ...data.news);
        setDraftNews(data.news);
        refreshNews((version) => version + 1);
        window.dispatchEvent(new Event("news-updated"));
      })
      .catch(() => undefined);
  }, []);

  // Carrega estatísticas do sistema
  useEffect(() => {
    fetch("/api/stats?days=30")
      .then((response) => (response.ok ? response.json() : null))
      .then(setStats)
      .catch(() => undefined);
  }, []);

  if (!session) return null;

  // Reseta os contadores do dia (Local e no Banco de Dados)
  async function reset(sectorId) {
    if (!window.confirm(`Tem certeza que deseja zerar a fila do setor ${SECTORS[sectorId]?.name || sectorId}?`)) {
      return;
    }

    try {
      // Zera o estado local
      const currentState = getQueueSnapshot();
      const next = {
        ...currentState,
        [sectorId]: {
          ...normalizeQueue(currentState[sectorId]),
          normalCurrent: 0,
          priorityCurrent: 0,
          history: [],
        },
      };
      saveQueueState(next);

      const response = await fetch("/api/queue/reset", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sector: sectorId }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok && !data.localOnly) {
        setMessage(data.error || "Ocorreu um erro ao zerar o contador no banco de dados.");
        return;
      }

      setMessage(`Contador do setor ${SECTORS[sectorId]?.name} zerado com sucesso.`);
    } catch {
      setMessage("Ocorreu um erro ao zerar o contador no banco de dados.");
    }
  }

  function addNews(event) {
    event.preventDefault();
    if (!title || !image) return;
    setDraftNews([{ id: `draft-${Date.now()}`, title, image }, ...draftNews]);
    setTitle("");
    setImage("");
    setMessage("Alteração pendente. Clique em 'Salvar notícias' para publicar.");
  }

  async function saveNews() {
    setSavingNews(true);
    setMessage("");
    try {
      const removed = news.filter(
        (item) => !draftNews.some((draft) => String(draft.id) === String(item.id))
      );
      for (const item of removed) {
        await fetch(`/api/news?id=${item.id}`, { method: "DELETE" });
      }

      const created = [];
      for (const item of draftNews.filter((item) => String(item.id).startsWith("draft-"))) {
        const response = await fetch("/api/news", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ title: item.title, image: item.image }),
        });
        const data = await response.json();
        if (!response.ok) throw new Error(data.error);
        created.push(data.news);
      }

      const response = await fetch("/api/news");
      const data = await response.json();
      if (!response.ok) throw new Error(data.error);

      newsCache.splice(0, newsCache.length, ...data.news);
      setDraftNews(data.news);
      refreshNews((version) => version + 1);
      window.dispatchEvent(new Event("news-updated"));

      setMessage(`${created.length} notícia(s) salva(s) com sucesso.`);
    } catch (error) {
      setMessage(error.message || "Não foi possível salvar as notícias.");
    } finally {
      setSavingNews(false);
    }
  }

  async function addUser(event) {
    event.preventDefault();
    setMessage("");
    try {
      const response = await fetch("/api/users", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(user),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error);

      setUser({ name: "", login: "", password: "", sector: "farmacia", guiche: "none" });
      setMessage(`Usuário ${data.login} criado para ${SECTORS[data.sector]?.name || data.sector}.`);
    } catch (error) {
      setMessage(error.message || "Não foi possível criar o usuário.");
    }
  }

  function deleteNews(id) {
    setDraftNews(draftNews.filter((item) => String(item.id) !== String(id)));
    setMessage("Exclusão pendente. Clique em 'Salvar notícias' para confirmar.");
  }

  function readImage(event) {
    const file = event.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => setImage(String(reader.result));
    reader.readAsDataURL(file);
  }

  return (
    <main className={styles.page}>
      <header>
        <div>
          <ShieldCheck size={19} /> PAINEL ADMINISTRATIVO
        </div>
        <Link
          href="/"
          onClick={() => window.localStorage.removeItem(SESSION_KEY)}
        >
          <LogOut size={16} /> Sair
        </Link>
      </header>

      <section className={styles.content}>
        <div className={styles.intro}>
          <div>
            <p>CONTROLE CENTRAL</p>
            <h1>Administração</h1>
            <span>
              Gerencie as unidades de atendimento, novos usuários e as notícias do monitor.
            </span>
          </div>
        </div>

        {message && <div className={styles.alertBox}>{message}</div>}

        <section className={styles.section}>
          <div className={styles.sectionTitle}>
            <div>
              <p>FILAS POR SERVIÇO</p>
              <h2>Controle dos atendimentos</h2>
            </div>
          </div>
          <div className={styles.sectors}>
            {Object.values(SECTORS).map((item) => {
              const queue = normalizeQueue(state[item.id]);
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
                    <Link href={`/monitor/${item.id}`}>
                      <Monitor size={16} /> Monitor
                    </Link>
                    <button type="button" onClick={() => reset(item.id)}>
                      <RotateCcw size={16} /> Limpar dia
                    </button>
                  </div>
                </article>
              );
            })}
          </div>
        </section>

        <section className={styles.section}>
          <div className={styles.sectionTitle}>
            <div>
              <p>ACESSOS</p>
              <h2>Criar usuário de atendimento</h2>
            </div>
          </div>
          <form className={styles.newsForm} onSubmit={addUser}>
            <input
              value={user.name}
              onChange={(event) =>
                setUser({ ...user, name: event.target.value })
              }
              placeholder="Nome completo"
              required
            />
            <input
              value={user.login}
              onChange={(event) =>
                setUser({ ...user, login: event.target.value })
              }
              placeholder="Login (ex: farmacia.atendimento)"
              pattern="[a-zA-Z0-9.-]+"
              required
            />
            <input
              type="password"
              minLength={6}
              value={user.password}
              onChange={(event) =>
                setUser({ ...user, password: event.target.value })
              }
              placeholder="Senha (mínimo 6 caracteres)"
              required
            />
            <select
              value={user.sector}
              onChange={(event) =>
                setUser({ ...user, sector: event.target.value })
              }
            >
              <option value="farmacia">Farmácia</option>
              <option value="recepcao">Recepção Saúde</option>
            </select>
            <select
              value={user.guiche}
              onChange={(event) =>
                setUser({ ...user, guiche: event.target.value })
              }
            >
              {GUICHES.map((guiche) => (
                <option key={guiche.id} value={guiche.id}>
                  {guiche.name}
                </option>
              ))}
            </select>
            <button type="submit">
              <UserPlus size={16} /> Criar usuário
            </button>
          </form>
        </section>

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
              onChange={(event) => setTitle(event.target.value)}
              placeholder="Título da notícia"
              required
            />
            <label className={styles.upload}>
              <ImagePlus size={18} />{" "}
              {image ? "Imagem selecionada" : "Adicionar imagem"}
              <input
                type="file"
                accept="image/*"
                onChange={readImage}
                required
              />
            </label>
            <button type="submit">
              <ImagePlus size={16} /> Adicionar à lista
            </button>
          </form>

          <div className={styles.newsGrid}>
            {draftNews.map((item, index) => (
              <article key={`${item.title}-${index}`}>
                <Image
                  src={item.image}
                  alt=""
                  width={300}
                  height={170}
                  unoptimized
                />
                <strong>{item.title}</strong>
                <button
                  className={styles.deleteNews}
                  type="button"
                  onClick={() => deleteNews(item.id)}
                >
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
            <Save size={16} /> {savingNews ? "Salvando..." : "Salvar notícias"}
          </button>
        </section>

        <section className={styles.section}>
          <div className={styles.sectionTitle}>
            <div>
              <p>GESTÃO</p>
              <h2>Histórico de atendimentos</h2>
            </div>
            <select
              defaultValue="30"
              onChange={(event) =>
                fetch(`/api/stats?days=${event.target.value}`)
                  .then((response) => (response.ok ? response.json() : null))
                  .then(setStats)
              }
            >
              <option value="7">Últimos 7 dias</option>
              <option value="30">Últimos 30 dias</option>
              <option value="90">Últimos 90 dias</option>
            </select>
          </div>

          {stats ? (
            <>
              <div className={styles.statsGrid}>
                <article>
                  <strong>{stats.summary?.total || 0}</strong>
                  <span>Total no período</span>
                </article>
                <article>
                  <strong>{stats.summary?.today || 0}</strong>
                  <span>Atendimentos hoje</span>
                </article>
                {stats.bySector?.map((item) => (
                  <article key={item.sector}>
                    <strong>{item.total}</strong>
                    <span>{SECTORS[item.sector]?.name || item.sector}</span>
                  </article>
                ))}
              </div>

              <div className={styles.historyList}>
                {stats.recent?.map((item, index) => (
                  <div key={`${item.created_at}-${index}`}>
                    <strong>{item.number_str}</strong>
                    <span>{SECTORS[item.sector_id || item.sector]?.name || item.sector_id || item.sector}</span>
                    <span>
                      {["preferencial", "preferential"].includes(item.type) ? "Preferencial" : "Normal"}
                    </span>
                    <time>
                      {new Intl.DateTimeFormat("pt-BR", {
                        dateStyle: "short",
                        timeStyle: "short",
                      }).format(new Date(item.created_at))}
                    </time>
                  </div>
                ))}
              </div>
            </>
          ) : (
            <p>Carregando histórico...</p>
          )}
        </section>
      </section>
    </main>
  );
}