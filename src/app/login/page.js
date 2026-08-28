'use client';
import Link from 'next/link';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Eye, EyeOff, LockKeyhole, ShieldCheck } from 'lucide-react';
import { ATTENDANT_ACCOUNTS, SESSION_KEY } from '../../lib/queue';
import styles from './Login.module.css';

export default function LoginPage() {
	const router = useRouter();
	const [login, setLogin] = useState('');
	const [password, setPassword] = useState('');
	const [showPassword, setShowPassword] = useState(false);
	const [error, setError] = useState('');

	function handleSubmit(event) {
		event.preventDefault();
		const account = ATTENDANT_ACCOUNTS[login.trim().toLowerCase()];
		if (!account) { setError('Login inválido. Use uma conta de atendimento ou admin.'); return; }
		window.localStorage.setItem(SESSION_KEY, JSON.stringify(account));
		router.push(account.role === 'admin' ? '/admin' : '/dashboard');
	}

	return (
		<main className={styles.page}>
			<section className={styles.panel}>
				<h1>Sistema de Fila</h1>
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
						<div className={styles.passwordWrapper}>
							<input
								type={showPassword ? 'text' : 'password'}
								value={password}
								onChange={(event) => setPassword(event.target.value)}
								placeholder="Digite sua senha"
								required
							/>
							<button
								type="button"
								className={styles.togglePassword}
								onClick={() => setShowPassword((visible) => !visible)}
								aria-label={showPassword ? 'Ocultar senha' : 'Mostrar senha'}
							>
								{showPassword ? <EyeOff size={18} /> : <Eye size={18} />}
							</button>
						</div>
					</label>
					{error && <small className={styles.error}>{error}</small>}
					<button type="submit"><LockKeyhole size={17} /> Entrar no sistema</button>
				</form>
				<div className={styles.secure}><ShieldCheck size={16} /> O login abre o setor vinculado à conta</div>
				<Link href="/">Voltar para início</Link>
			</section>
		</main>
	);
}