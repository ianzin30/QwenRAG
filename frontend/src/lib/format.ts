import type { ConversationSummary } from '../services/api';

export type HistoryGroup = 'Hoje' | 'Ontem' | 'Anteriores';

/** Same buckets as sidebar/ChatHistory.build_chat_history_sections (Today/Yesterday/Older). */
export function groupConversations(list: ConversationSummary[], now = new Date()): { label: HistoryGroup; items: ConversationSummary[] }[] {
  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  const startOfYesterday = startOfToday - 86_400_000;
  const groups: Record<HistoryGroup, ConversationSummary[]> = { Hoje: [], Ontem: [], Anteriores: [] };
  for (const c of list) {
    const t = Date.parse(c.updatedAt);
    const key: HistoryGroup = t >= startOfToday ? 'Hoje' : t >= startOfYesterday ? 'Ontem' : 'Anteriores';
    groups[key].push(c);
  }
  return (Object.keys(groups) as HistoryGroup[])
    .map((label) => ({ label, items: groups[label].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)) }))
    .filter((g) => g.items.length > 0);
}

const rtf = new Intl.RelativeTimeFormat('pt-BR', { numeric: 'auto' });

export function relativeTime(iso: string | undefined, now = Date.now()): string {
  if (!iso) return '';
  const diff = Date.parse(iso) - now;
  const minutes = Math.round(diff / 60_000);
  if (Math.abs(minutes) < 1) return 'agora';
  if (Math.abs(minutes) < 60) return rtf.format(minutes, 'minute');
  const hours = Math.round(minutes / 60);
  if (Math.abs(hours) < 24) return rtf.format(hours, 'hour');
  const days = Math.round(hours / 24);
  if (Math.abs(days) < 7) return rtf.format(days, 'day');
  const weeks = Math.round(days / 7);
  if (Math.abs(weeks) < 5) return rtf.format(weeks, 'week');
  return rtf.format(Math.round(days / 30), 'month');
}

export function formatSeconds(ms: number | undefined): string {
  if (ms === undefined) return '';
  return `${(ms / 1000).toLocaleString('pt-BR', { minimumFractionDigits: 1, maximumFractionDigits: 1 })} s`;
}

export function truncateTitle(text: string, max: number): string {
  const clean = text.replace(/\s+/g, ' ').trim();
  return clean.length > max ? `${clean.slice(0, max - 1)}…` : clean;
}

export function fileExtension(name: string): string {
  const i = name.lastIndexOf('.');
  return i > 0 ? name.slice(i + 1).toLowerCase() : '';
}

export function newId(): string {
  return typeof crypto !== 'undefined' && 'randomUUID' in crypto ? crypto.randomUUID() : `id-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}
