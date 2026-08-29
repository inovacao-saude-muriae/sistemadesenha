"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { LockKeyhole, Monitor, ShieldCheck, ChevronDown, ChevronUp } from "lucide-react";
import { ATTENDANT_ACCOUNTS, SESSION_KEY, SECTORS } from "../../lib/queue";
import styles from "./Login.module.css";

export default function LoginPage() {
  const router = useRouter();
  const [showAdmin, setShowAdmin] = useState(false);
  const [login, setLogin] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  async function handleSubmit(event) {
    event.preventDefault();
    setError("");
    setLoading(true);

    // Tenta conta local hard-coded primeiro
    const account = ATTENDANT_ACCOUNTS[login.trim().toLowerCase()];
    if (account) {
      if (account.password !== password) {
        setError("Login ou senha inválidos.");
        setLoading(false);
        return;
      }
      const sessionAccount = { ...account };
      delete sessionAccount.password;
      window.localStorage.setItem(SESSION_KEY, JSON.stringify(sessionAccount));
      router.push("/admin");
      return;
    }

    // Tenta Supabase Auth
    try {
      const response = await fetch("/api/auth", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ login, password }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error);
      window.localStorage.setItem(SESSION_KEY, JSON.stringify(data));
      router.push("/admin");
    } catch (requestError) {
      setError(requestError.message || "Login ou senha inválidos.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <main className={styles.page}>
      <section className={styles.panel}>
        {/* Logo / título */}
        <div className={styles.brand}>
          <div className={styles.brandMark}>S</div>
          <div>
            <strong>Central de Atendimento</strong>
            <span>Sistema de Senhas</span>
          </div>
        </div>

        {/* ── Botões de monitor ── */}
        <div className={styles.monitorSection}>
          <p className={styles.monitorLabel}>ABRIR MONITOR DE SENHAS</p>
          <div className={styles.monitorButtons}>
            {Object.values(SECTORS).map((s) => (
              <a
                key={s.id}
                href={`/monitor/${s.id}`}
                className={styles.monitorBtn}
              >
                <Monitor size={20} />
                <span>{s.name}</span>
              </a>
            ))}
          </div>
          <p className={styles.monitorHint}>
            O monitor exibe as senhas chamadas e permite passar senhas pelo mesmo dispositivo.
          </p>
        </div>

        <div className={styles.divider} />

        {/* ── Acesso admin (colapsável) ── */}
        <button
          type="button"
          className={styles.adminToggle}
          onClick={() => { setShowAdmin((v) => !v); setError(""); }}
        >
          <ShieldCheck size={15} />
          Acesso Administrativo
          {showAdmin ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
        </button>

        {showAdmin && (
          <form className={styles.adminForm} onSubmit={handleSubmit}>
            <label>
              Login
              <input
                type="text"
                value={login}
                onChange={(e) => setLogin(e.target.value)}
                placeholder="ex: admin"
                autoComplete="username"
                required
              />
            </label>
            <label>
              Senha
              <input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="Digite sua senha"
                autoComplete="current-password"
                required
              />
            </label>
            {error && <small className={styles.error}>{error}</small>}
            <button type="submit" disabled={loading}>
              <LockKeyhole size={16} />
              {loading ? "Entrando…" : "Entrar como Admin"}
            </button>
          </form>
        )}
      </section>
    </main>
  );
}
