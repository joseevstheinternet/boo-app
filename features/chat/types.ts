import { Timestamp } from 'firebase/firestore';

// ─── 타입 ─────────────────────────────────────────────────────────────────────

export interface Message {
  id: string;
  text: string;
  senderId: string;
  createdAt: Timestamp | null;
  read: boolean;
  imageUrl?: string;    // legacy single
  imageUrls?: string[]; // multi-image
  reactions?: Record<string, string>; // uid → 이모지
  replyTo?: {
    messageId: string;
    text: string;
    senderId: string;
  };
}

export type ChatItem =
  | { type: 'message'; data: Message; showAvatar: boolean; isFirst: boolean; isLast: boolean; isSingle: boolean }
  | { type: 'separator'; label: string };

// ─── 상수 ─────────────────────────────────────────────────────────────────────

export const HEADER_H = 56;
export const AVATAR_W = 32;
export const IMG_SINGLE = 216;
export const IMG_CELL   = 106;
export const IMG_GAP    = 2;

// ─── 헬퍼 ─────────────────────────────────────────────────────────────────────

export function toDateStr(d: Date): string {
  const y  = d.getFullYear();
  const m  = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${dd}`;
}

export function toKey(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

export function formatTime(ts: Timestamp): string {
  const d    = ts.toDate();
  const h    = d.getHours();
  const min  = String(d.getMinutes()).padStart(2, '0');
  const ampm = h < 12 ? '오전' : '오후';
  return `${ampm} ${h % 12 || 12}:${min}`;
}

export function dateSepLabel(dateStr: string): string {
  const today = toDateStr(new Date());
  const yest  = toDateStr(new Date(Date.now() - 86400000));
  if (dateStr === today) return '오늘';
  if (dateStr === yest)  return '어제';
  const [y, m, d] = dateStr.split('-').map(Number);
  return `${y}년 ${m}월 ${d}일`;
}

export function sameGroup(a: Message, b: Message): boolean {
  if (a.senderId !== b.senderId) return false;
  if (!a.createdAt || !b.createdAt) return false;
  const da = a.createdAt.toDate();
  const db = b.createdAt.toDate();
  return (
    da.getFullYear() === db.getFullYear() &&
    da.getMonth()    === db.getMonth()    &&
    da.getDate()     === db.getDate()     &&
    da.getHours()    === db.getHours()    &&
    da.getMinutes()  === db.getMinutes()
  );
}

export function buildChatItems(messages: Message[], myUid: string): ChatItem[] {
  const items: ChatItem[] = [];
  let lastDate = '';

  const validMessages = messages.filter(m => m.createdAt);

  for (let i = 0; i < validMessages.length; i++) {
    const msg  = validMessages[i];
    const prev = validMessages[i - 1];
    const next = validMessages[i + 1];

    const dateStr = toDateStr(msg.createdAt!.toDate());
    if (dateStr !== lastDate) {
      items.push({ type: 'separator', label: dateSepLabel(dateStr) });
      lastDate = dateStr;
    }

    const inGroupWithPrev = prev ? sameGroup(prev, msg) : false;
    const inGroupWithNext = next ? sameGroup(msg, next) : false;

    const isFirst  = !inGroupWithPrev;
    const isLast   = !inGroupWithNext;
    const isSingle = isFirst && isLast;
    const showAvatar = isFirst;

    items.push({ type: 'message', data: msg, showAvatar, isFirst, isLast, isSingle });
  }
  return items;
}
