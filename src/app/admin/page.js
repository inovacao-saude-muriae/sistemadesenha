'use client';

import { useEffect, useState, useSyncExternalStore } from 'react';
import Link from 'next/link';
import Image from 'next/image';
import { useRouter } from 'next/navigation';
import { ImagePlus, LogOut, Monitor, RotateCcw, Save, ShieldCheck } from 'lucide-react';
import { getServerQueueSnapshot, getServerSessionSnapshot, getSessionSnapshot, normalizeQueue, readQueueState, saveQueueState, SECTORS, SESSION_KEY, subscribeSession } from '../../lib/queue';
import styles from './Admin.module.css';

const NEWS_KEY = 'saude-news';
let newsCache = [];
let newsRaw = null;
const serverNewsSnapshot = [];
function getNewsSnapshot() { if (typeof window === 'undefined') return serverNewsSnapshot; const raw = window.localStorage.getItem(NEWS_KEY) || '[]'; if (raw === newsRaw) return newsCache; newsRaw = raw; try { newsCache = JSON.parse(raw); } catch { newsCache = []; } return newsCache; }
function getServerNewsSnapshot() { return serverNewsSnapshot; }
function subscribeNews(callback) { window.addEventListener('storage', callback); window.addEventListener('news-updated', callback); return () => { window.removeEventListener('storage', callback); window.removeEventListener('news-updated', callback); }; }
export default function AdminPage() {
  const router = useRouter();
  const session = useSyncExternalStore(subscribeSession, getSessionSnapshot, getServerSessionSnapshot);
  const [state, setState] = useState(getServerQueueSnapshot);
  const news = useSyncExternalStore(subscribeNews, getNewsSnapshot, getServerNewsSnapshot);
  const [title, setTitle] = useState('');
  const [image, setImage] = useState('');
  useEffect(() => { const current = getSessionSnapshot(); if (!current || current.role !== 'admin') router.push('/login'); }, [router]);
  if (!session) return null;
  function reset(sector) { const next = { ...state, [sector]: { ...normalizeQueue(state[sector]), normalCurrent: 0, priorityCurrent: 0, history: [] } }; setState(next); saveQueueState(next); }
  function addNews(event) { event.preventDefault(); if (!title || !image) return; const next = [{ title, image }, ...news].slice(0, 8); window.localStorage.setItem(NEWS_KEY, JSON.stringify(next)); window.dispatchEvent(new Event('news-updated')); setTitle(''); setImage(''); }
  function readImage(event) { const file = event.target.files?.[0]; if (!file) return; const reader = new FileReader(); reader.onload = () => setImage(String(reader.result)); reader.readAsDataURL(file); }
  return <main className={styles.page}><header><div><ShieldCheck size={19} /> PAINEL ADMINISTRATIVO</div><Link href="/" onClick={() => window.localStorage.removeItem(SESSION_KEY)}><LogOut size={16} /> Sair</Link></header><section className={styles.content}><div className={styles.intro}><div><p>CONTROLE CENTRAL</p><h1>Administração</h1><span>Gerencie as duas unidades e as notícias exibidas nos monitores.</span></div></div><section className={styles.section}><div className={styles.sectionTitle}><div><p>FILAS POR SERVIÇO</p><h2>Controle dos atendimentos</h2></div></div><div className={styles.sectors}>{Object.values(SECTORS).map((item) => { const queue = normalizeQueue(state[item.id]); return <article key={item.id}><div><strong>{item.name}</strong><small>Normal: N{String(queue.normalCurrent).padStart(3, '0')} · Preferencial: P{String(queue.priorityCurrent).padStart(3, '0')}</small></div><div className={styles.cardActions}><Link href={`/monitor/${item.id}`}><Monitor size={16} /> Monitor</Link><button onClick={() => reset(item.id)}><RotateCcw size={16} /> Limpar dia</button></div></article>; })}</div></section><section className={styles.section}><div className={styles.sectionTitle}><div><p>COMUNICAÇÃO</p><h2>Notícias do monitor</h2></div></div><form className={styles.newsForm} onSubmit={addNews}><input value={title} onChange={(event) => setTitle(event.target.value)} placeholder="Título da notícia" required /><label className={styles.upload}><ImagePlus size={18} /> {image ? 'Imagem selecionada' : 'Adicionar imagem'}<input type="file" accept="image/*" onChange={readImage} required /></label><button><Save size={16} /> Publicar notícia</button></form><div className={styles.newsGrid}>{news.map((item, index) => <article key={`${item.title}-${index}`}><Image src={item.image} alt="" width={300} height={170} unoptimized /><strong>{item.title}</strong></article>)}</div></section></section></main>;
}