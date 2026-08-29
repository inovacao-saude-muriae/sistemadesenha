"use client";

"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { LockKeyhole } from "lucide-react";
import { SESSION_KEY } from "../../lib/queue";
import styles from "./Login.module.css";

export default function LoginPage() {
  const router  = useRouter();
  const [login, setLogin]       = useState("");
  const [password, setPassword] = useState("");
  const [error, setError]       = useState("");
  const [loading, setLoading]   = useState(false);

  async function handleSubmit(e) {
    e.preventDefault();
    setError("");
    setLoading(true);

    try {
      const res = await fetch("/api/auth", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ login, password }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      
      window.localStorage.setItem(SESSION_KEY, JSON.stringify(data));
      document.cookie = `session=1; path=/; max-age=86400; SameSite=Lax`;
      router.push("/home");
    } catch (err) {
      setError(err.message || "Usuário ou senha inválidos.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <main className={styles.page}>

      {/* ── Hero ── */}
      <div className={styles.hero}>
        <div className={styles.heroContent}>
          <div className={styles.heroMark}>S</div>
          <h1>Sistema de<br />Atendimento</h1>
          <p>Gerenciamento de senhas e filas para unidades de saúde.</p>
          <div className={styles.heroDots}>
            <span /><span /><span />
          </div>
        </div>
      </div>

      {/* ── Painel de login ── */}
      <div className={styles.side}>
        <div className={styles.panel}>

          {/* brand só no mobile */}
          <div className={styles.mobileBrand}>
            <div className={styles.brandMark}>S</div>
            <div>
              <strong>Central de Atendimento</strong>
              <span>Sistema de Senhas</span>
            </div>
          </div>

          <h2 className={styles.panelTitle}>Entrar no sistema</h2>
          <p className={styles.panelSub}>Digite suas credenciais para continuar.</p>

          <form className={styles.form} onSubmit={handleSubmit}>
            <label>
              Usuário
              <input
                type="text"
                value={login}
                onChange={(e) => setLogin(e.target.value)}
                placeholder="ex: admin"
                autoComplete="username"
                autoFocus
                required
              />
            </label>

            <label>
              Senha
              <input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="••••••••"
                autoComplete="current-password"
                required
              />
            </label>

            {error && <div className={styles.errorBox}>{error}</div>}

            <button type="submit" disabled={loading}>
              <LockKeyhole size={17} />
              {loading ? "Entrando…" : "Entrar"}
            </button>
          </form>

        </div>
      </div>

    </main>
  );
}
