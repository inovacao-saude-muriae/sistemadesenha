"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { LockKeyhole, ShieldCheck } from "lucide-react";
import { ATTENDANT_ACCOUNTS, SESSION_KEY } from "../../lib/queue";
import styles from "./Login.module.css";
export default function LoginPage() {
  const router = useRouter();
  const [login, setLogin] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  async function handleSubmit(event) {
    event.preventDefault();
    const account = ATTENDANT_ACCOUNTS[login.trim().toLowerCase()];
    if (account && account.password !== password) {
      setError("Login ou senha inválidos.");
      return;
    }
    if (account) {
      const sessionAccount = { ...account };
      delete sessionAccount.password;
      window.localStorage.setItem(SESSION_KEY, JSON.stringify(sessionAccount));
      router.push(account.role === "admin" ? "/admin" : "/dashboard");
      return;
    }
    try {
      const response = await fetch("/api/auth", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ login, password }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error);
      window.localStorage.setItem(SESSION_KEY, JSON.stringify(data));
      router.push(data.role === "admin" ? "/admin" : "/dashboard");
    } catch (requestError) {
      setError(requestError.message || "Login ou senha inválidos.");
    }
  }
  return (
    <main className={styles.page}>
      <section className={styles.panel}>
        <p>Central de Atendimento</p>
        <form onSubmit={handleSubmit}>
          <label>
            Login do serviço
            <input
              type="text"
              value={login}
              onChange={(event) => setLogin(event.target.value)}
              placeholder="ex: farmacia-atendimento"
              required
            />
          </label>
          <label>
            Senha
            <input
              type="password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              placeholder="Digite sua senha"
              required
            />
          </label>
          {error && <small className={styles.error}>{error}</small>}
          <button type="submit">
            <LockKeyhole size={17} /> Entrar no sistema
          </button>
        </form>
        <div className={styles.secure}>
          <ShieldCheck size={16} /> O login abre o setor vinculado à conta
        </div>
      </section>
    </main>
  );
}
