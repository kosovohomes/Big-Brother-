// iCalendar export for the Deadline Radar (PRD §5.2 AC1 — next deadlines).
// Produces RFC 5545 VCALENDAR text with one VEVENT per deadline.
// Descriptions stay neutral and carry the not-legal-advice notice.

import { DISCLAIMER_AR, DISCLAIMER_EN } from './banners';
import type { DeadlineItem } from './types';

function icsEscape(s: string): string {
  return s.replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\r?\n/g, '\\n');
}

function icsDate(iso: string): string {
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getUTCFullYear()}${pad(d.getUTCMonth() + 1)}${pad(d.getUTCDate())}`;
}

function icsStamp(iso: string): string {
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getUTCFullYear()}${pad(d.getUTCMonth() + 1)}${pad(d.getUTCDate())}T${pad(d.getUTCHours())}${pad(d.getUTCMinutes())}${pad(d.getUTCSeconds())}Z`;
}

export function buildICalendar(caseMeta: { number: string; court: string }, deadlines: DeadlineItem[]): string {
  const lines: string[] = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//Big Brother//Deadline Radar v2.1//AR',
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
    `X-WR-CALNAME:${icsEscape(`Deadline Radar — قضية ${caseMeta.number || ''} (${caseMeta.court || ''})`)}`
  ];
  const now = icsStamp(new Date().toISOString());
  for (const d of deadlines) {
    if (d.urgency === 'done') continue;
    lines.push(
      'BEGIN:VEVENT',
      `UID:${d.id}@big-brother`,
      `DTSTAMP:${now}`,
      `DTSTART;VALUE=DATE:${icsDate(d.dueAt)}`,
      `SUMMARY:${icsEscape(`[${d.kind}] ${d.titleAr}`)}`,
      `DESCRIPTION:${icsEscape(`${d.titleEn}\n${DISCLAIMER_AR}\n${DISCLAIMER_EN}`)}`,
      'TRANSP:TRANSPARENT',
      'END:VEVENT'
    );
  }
  lines.push('END:VCALENDAR');
  return lines.join('\r\n') + '\r\n';
}
