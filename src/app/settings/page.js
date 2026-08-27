'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { ArrowLeft, CheckCircle2, RotateCcw, Save } from 'lucide-react';
import { readQueueState, readSession, saveQueueState, SECTORS } from '../../lib/queue';
import styles from './Settings.module.css';

export default function SettingsPage() {
  const router = useRouter();
  const [session] = useState(readSession);
  const [numbers, setNumbers] = useState(() => { const currentSession = readSession(); if (!currentSession) return { normal: '1', preferencial: '1' }; const queue = readQueueState()[currentSession.sector]; return { normal: String(queue.normalCurrent >= 1000 ? 1 : queue.normalCurrent + 1), preferencial: String(queue.priorityCurrent >= 1000 ? 1 : queue.priorityCurrent + 1) }; });
  const [message, setMessage] = useState('');

  useEffect(() => {
    const currentSession = readSession();
    if (!currentSession || currentSession.role !== 'admin') router.push('/admin');
  }, [router]);

  if (!session) return null;
  const sectorInfo = SECTORS[session.sector];

  function saveNumber(event) {
    event.preventDefault();
    const normalNext = Math.min(1000, Math.max(1, Number(numbers.normal) || 1));
    const priorityNext = Math.min(1000, Math.max(1, Number(numbers.preferencial) || 1));
    const state = readQueueState();
    const updated = { ...state, [session.sector]: { ...state[session.sector], normalCurrent: normalNext === 1 ? 1000 : normalNext - 1, priorityCurrent: priorityNext === 1 ? 1000 : priorityNext - 1, history: [] } };
    saveQueueState(updated);
    setNumbers({ normal: String(normalNext), preferencial: String(priorityNext) });
    setMessage(`Próximas: N${String(normalNext).padStart(3, '0')} e P${String(priorityNext).padStart(3, '0')}`);
  }

  function resetQueue() {
    setNumbers({ normal: '1', preferencial: '1' });
    setMessage('Sequências reiniciadas. As próximas chamadas serão N001 e P001.');
    const state = readQueueState();
    saveQueueState({ ...state, [session.sector]: { ...state[session.sector], normalCurrent: 0, priorityCurrent: 0, history: [] } });
  }

  return <main className={styles.page}><header><Link href="/dashboard"><ArrowLeft size={17} /> Voltar ao dashboard</Link><span>CONFIGURAÇÕES DO SERVIÇO</span></header><section className={styles.content}><p className={styles.kicker}>SERVIÇO VINCULADO À CONTA</p><h1>{sectorInfo.name}</h1><p className={styles.description}>Cada tipo de atendimento possui uma sequência independente.</p><form onSubmit={saveNumber}><label>PRÓXIMA SENHA NORMAL<input type="number" min="1" max="1000" value={numbers.normal} onChange={(event) => setNumbers({ ...numbers, normal: event.target.value })} /></label><label>PRÓXIMA SENHA PREFERENCIAL<input type="number" min="1" max="1000" value={numbers.preferencial} onChange={(event) => setNumbers({ ...numbers, preferencial: event.target.value })} /></label><p className={styles.help}>Normal usa N e preferencial usa P. Salvar limpa apenas o histórico do monitor.</p><div className={styles.actions}><button className={styles.save} type="submit"><Save size={17} /> Salvar números</button><button className={styles.reset} type="button" onClick={resetQueue}><RotateCcw size={17} /> Começar ambos em 001</button></div></form>{message && <div className={styles.message}><CheckCircle2 size={17} /> {message}</div>}</section></main>;
}