/* eslint-disable react-hooks/set-state-in-effect -- data-fetch-on-mount pattern; setState occurs in async continuations */
'use client';

// Stage 6: header notification bell — per-user inbox with unread badge,
// 60s polling, and deep links into the case timeline. Bilingual (ar/en).

import { useCallback, useEffect, useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Bell, Clock, ScrollText, BadgeCheck, FileWarning, Inbox } from 'lucide-react';
import { api } from './api';
import { tr, T, type Lang } from './i18n';

export interface NotificationItem {
  id: string; type: string;
  titleAr: string; titleEn: string; bodyAr?: string; bodyEn?: string;
  caseId?: string; urgency?: string; readAt?: string; createdAt: string;
}

const URGENCY_STYLES: Record<string, string> = {
  overdue: 'border-red-300 bg-red-50 text-red-800',
  high: 'border-red-300 bg-red-50 text-red-800',
  critical: 'border-amber-300 bg-amber-50 text-amber-900',
  medium: 'border-amber-200 bg-amber-50/60 text-amber-800',
  soon: 'border-sky-300 bg-sky-50 text-sky-800',
  low: 'border-slate-200 bg-slate-50 text-slate-600'
};

const URGENCY_LABEL = {
  overdue: { ar: 'تجاوز الموعد', en: 'Overdue' },
  high: { ar: 'أولوية عالية', en: 'High priority' },
  critical: { ar: 'حرج', en: 'Critical' },
  medium: { ar: 'متوسط', en: 'Medium' },
  soon: { ar: 'قريب', en: 'Soon' },
  low: { ar: 'منخفض', en: 'Low' }
};

function TypeIcon({ type, className }: { type: string; className?: string }) {
  if (type === 'deadline.reminder') return <Clock className={className} />;
  if (type === 'draft.review_requested') return <ScrollText className={className} />;
  if (type === 'draft.released') return <BadgeCheck className={className} />;
  if (type === 'document.mismatch' || type === 'document.risk_high') return <FileWarning className={className} />;
  return <Inbox className={className} />;
}

function timeAgo(iso: string, lang: Lang): string {
  const mins = Math.max(0, Math.floor((Date.now() - new Date(iso).getTime()) / 60000));
  if (mins < 1) return tr(T.notifJustNow, lang);
  if (mins < 60) return `${mins} ${tr(T.notifMinAgo, lang)}`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours} ${tr(T.notifHourAgo, lang)}`;
  return `${Math.floor(hours / 24)} ${tr(T.notifDayAgo, lang)}`;
}

export function NotificationBell({ lang, orgId, onOpenCase }: {
  lang: Lang;
  orgId: string;
  onOpenCase: (caseId: string) => void;
}) {
  const [items, setItems] = useState<NotificationItem[]>([]);
  const [unread, setUnread] = useState(0);
  const [open, setOpen] = useState(false);
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);

  const load = useCallback(async () => {
    if (!orgId) return;
    try {
      const res = await api.get('/api/notifications') as unknown as { notifications: NotificationItem[]; unread: number };
      setItems(res.notifications || []);
      setUnread(res.unread || 0);
    } catch { /* session may be mid-switch; keep the last snapshot */ }
  }, [orgId]);

  useEffect(() => {
    load();
    timer.current = setInterval(load, 60000);
    return () => { if (timer.current) clearInterval(timer.current); };
  }, [load]);

  const markOne = async (n: NotificationItem) => {
    if (!n.readAt) {
      setItems(list => list.map(x => (x.id === n.id ? { ...x, readAt: new Date().toISOString() } : x)));
      setUnread(u => Math.max(0, u - 1));
      api.post('/api/notifications', { id: n.id }).then(load).catch(() => null);
    }
    if (n.caseId) {
      setOpen(false);
      onOpenCase(n.caseId);
    }
  };

  const markAll = async () => {
    setItems(list => list.map(x => ({ ...x, readAt: x.readAt || new Date().toISOString() })));
    setUnread(0);
    await api.post('/api/notifications', { all: true }).catch(() => null);
    load();
  };

  return (
    <Popover open={open} onOpenChange={v => { setOpen(v); if (v) load(); }}>
      <PopoverTrigger asChild>
        <Button size="sm" variant="ghost" className="relative" data-testid="notif-bell" aria-label={tr(T.notifBell, lang)}>
          <Bell className="h-4 w-4" />
          {unread > 0 && (
            <span
              className="absolute -top-1 -end-1 flex h-4 min-w-4 items-center justify-center rounded-full bg-red-600 px-1 text-[9px] font-bold text-white"
              data-testid="notif-badge"
              dir="ltr"
            >
              {unread > 99 ? '99+' : unread}
            </span>
          )}
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-80 p-0 sm:w-96" dir={lang === 'ar' ? 'rtl' : 'ltr'}>
        <div className="flex items-center justify-between border-b px-3 py-2">
          <div className="text-sm font-bold">{tr(T.notifTitle, lang)}</div>
          {unread > 0 && (
            <Button size="sm" variant="ghost" className="h-7 text-xs text-muted-foreground" onClick={markAll} data-testid="notif-read-all">
              {tr(T.notifMarkAll, lang)}
            </Button>
          )}
        </div>
        <div className="max-h-96 overflow-y-auto" data-testid="notif-list">
          {items.length === 0 ? (
            <div className="flex flex-col items-center gap-2 px-4 py-8 text-center text-xs text-muted-foreground">
              <Inbox className="h-6 w-6 opacity-40" />
              {tr(T.notifEmpty, lang)}
            </div>
          ) : (
            <ul className="divide-y">
              {items.map(n => {
                const urgent = !n.readAt && n.urgency && ['overdue', 'high'].includes(n.urgency);
                return (
                  <li key={n.id}>
                    <button
                      onClick={() => markOne(n)}
                      className={`w-full px-3 py-2.5 text-start transition-colors hover:bg-slate-50 ${n.readAt ? 'opacity-60' : ''}`}
                      data-testid={`notif-item-${n.type}`}
                      title={n.caseId ? tr(T.notifOpenCase, lang) : undefined}
                    >
                      <div className="flex items-start gap-2">
                        <span className={`mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-lg ${urgent ? 'bg-red-100 text-red-700' : 'bg-slate-100 text-slate-600'}`}>
                          <TypeIcon type={n.type} className="h-3.5 w-3.5" />
                        </span>
                        <span className="min-w-0 flex-1">
                          <span className="flex items-center gap-1.5">
                            {!n.readAt && <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-amber-500" aria-hidden />}
                            <span className="truncate text-xs font-semibold" dir="auto">{lang === 'ar' ? n.titleAr : n.titleEn}</span>
                          </span>
                          {(lang === 'ar' ? n.bodyAr : n.bodyEn) && (
                            <span className="mt-0.5 line-clamp-2 block text-[11px] leading-relaxed text-muted-foreground" dir="auto">
                              {lang === 'ar' ? n.bodyAr : n.bodyEn}
                            </span>
                          )}
                          <span className="mt-1 flex items-center gap-1.5">
                            {n.urgency && URGENCY_STYLES[n.urgency] && (
                              <Badge variant="outline" className={`h-4 px-1 text-[9px] ${URGENCY_STYLES[n.urgency]}`}>
                                {tr(URGENCY_LABEL[n.urgency] ?? { ar: n.urgency, en: n.urgency }, lang)}
                              </Badge>
                            )}
                            <span className="text-[10px] text-muted-foreground" dir="ltr">{timeAgo(n.createdAt, lang)}</span>
                          </span>
                        </span>
                      </div>
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      </PopoverContent>
    </Popover>
  );
}
