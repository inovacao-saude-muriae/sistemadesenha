export const SECTORS = {
  farmacia: { id: 'farmacia', name: 'Farmácia', shortName: 'FARMÁCIA' },
  recepcao: { id: 'recepcao', name: 'Recepção Saúde', shortName: 'RECEPÇÃO' },
};

export const QUEUE_KEY = 'saude-queue-state';
export const SESSION_KEY = 'saude-attendant-session';
const serverQueueSnapshot = {
  farmacia: { normalCurrent: 0, priorityCurrent: 0, history: [], historyDate: '' },
  recepcao: { normalCurrent: 0, priorityCurrent: 0, history: [], historyDate: '' },
};
let clientQueueSnapshot = null;
let clientQueueRaw = null;
let clientSessionSnapshot = null;
let clientSessionRaw = null;

export const ATTENDANT_ACCOUNTS = {
  admin: { name: 'Administradora', initials: 'AD', role: 'admin' },
  'recepcao-atendimento': { name: 'Recepção Atendimento', initials: 'RA', sector: 'recepcao' },
  'farmacia-atendimento': { name: 'Farmácia Atendimento', initials: 'FA', sector: 'farmacia' },
};

function localDateKey() {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
}

export function nextQueueNumber(current = 0) {
  const next = Number(current) + 1;
  return next > 1000 ? 1 : next;
}

export function formatQueueNumber(number, type = 'normal') {
  const prefix = type === 'preferencial' ? 'P' : 'N';
  return `${prefix}${Number(number) === 1000 ? '1000' : String(Number(number) || 0).padStart(3, '0')}`;
}

export function getInitialState() {
  return {
    farmacia: { normalCurrent: 0, priorityCurrent: 0, history: [], historyDate: localDateKey() },
    recepcao: { normalCurrent: 0, priorityCurrent: 0, history: [], historyDate: localDateKey() },
  };
}

function clearHistoryFromNewDay(state) {
  const today = localDateKey();
  let changed = false;
  const nextState = Object.fromEntries(Object.entries(state).map(([sector, queue]) => {
    if (queue.historyDate === today) return [sector, queue];
    changed = true;
    return [sector, { ...queue, normalCurrent: queue.normalCurrent ?? (queue.historyDate ? queue.current : 0), priorityCurrent: queue.priorityCurrent ?? 0, history: [], historyDate: today }];
  }));
  if (changed && typeof window !== 'undefined') window.localStorage.setItem(QUEUE_KEY, JSON.stringify(nextState));
  return nextState;
}

export function readQueueState() {
  if (typeof window === 'undefined') return getInitialState();
  try {
    const saved = window.localStorage.getItem(QUEUE_KEY);
    return clearHistoryFromNewDay(saved ? JSON.parse(saved) : getInitialState());
  } catch {
    return getInitialState();
  }
}

export function saveQueueState(state) {
  window.localStorage.setItem(QUEUE_KEY, JSON.stringify(state));
  window.dispatchEvent(new CustomEvent('queue-updated', { detail: state }));
}

export function readSession() {
  if (typeof window === 'undefined') return null;
  try { return JSON.parse(window.localStorage.getItem(SESSION_KEY)); } catch { return null; }
}

export function normalizeQueue(queue) {
  return { normalCurrent: queue?.normalCurrent ?? queue?.current ?? 0, priorityCurrent: queue?.priorityCurrent ?? 0, history: queue?.history ?? [], historyDate: queue?.historyDate ?? localDateKey() };
}

export async function withQueueLock(callback) {
  if (navigator?.locks?.request) return navigator.locks.request('saude-queue-call', { mode: 'exclusive' }, callback);
  const lockKey = `${QUEUE_KEY}-lock`;
  const token = `${Date.now()}-${Math.random()}`;
  while (true) {
    const lock = Number(window.localStorage.getItem(lockKey) || 0);
    if (!lock || Date.now() - lock > 3000) {
      window.localStorage.setItem(lockKey, `${Date.now()}:${token}`);
      if (window.localStorage.getItem(lockKey).endsWith(token)) break;
    }
    await new Promise((resolve) => window.setTimeout(resolve, 40));
  }
  try { return await callback(); } finally { if (window.localStorage.getItem(lockKey)?.endsWith(token)) window.localStorage.removeItem(lockKey); }
}

export function playCallAlert() {
  if (!window.AudioContext && !window.webkitAudioContext) return;
  const AudioContextClass = window.AudioContext || window.webkitAudioContext;
  const context = new AudioContextClass();
  const notes = [880, 1108, 1318];
  notes.forEach((frequency, index) => {
    const start = context.currentTime + index * 0.13;
    const oscillator = context.createOscillator();
    const gain = context.createGain();
    oscillator.type = 'sine';
    oscillator.frequency.setValueAtTime(frequency, start);
    gain.gain.setValueAtTime(0.0001, start);
    gain.gain.exponentialRampToValueAtTime(0.16, start + 0.018);
    gain.gain.exponentialRampToValueAtTime(0.0001, start + 0.26);
    oscillator.connect(gain).connect(context.destination);
    oscillator.start(start);
    oscillator.stop(start + 0.28);
  });
  window.setTimeout(() => context.close(), 700);
}

export function subscribeQueue(callback) {
  window.addEventListener('queue-updated', callback);
  window.addEventListener('storage', callback);
  return () => { window.removeEventListener('queue-updated', callback); window.removeEventListener('storage', callback); };
}

export function getQueueSnapshot() {
  const raw = window.localStorage.getItem(QUEUE_KEY);
  if (raw === clientQueueRaw && clientQueueSnapshot) return clientQueueSnapshot;
  clientQueueRaw = raw;
  clientQueueSnapshot = readQueueState();
  return clientQueueSnapshot;
}
export function getServerQueueSnapshot() { return serverQueueSnapshot; }
export function subscribeSession(callback) { window.addEventListener('storage', callback); return () => window.removeEventListener('storage', callback); }
export function getSessionSnapshot() {
  const raw = window.localStorage.getItem(SESSION_KEY);
  if (raw === clientSessionRaw) return clientSessionSnapshot;
  clientSessionRaw = raw;
  clientSessionSnapshot = readSession();
  return clientSessionSnapshot;
}
export function getServerSessionSnapshot() { return null; }