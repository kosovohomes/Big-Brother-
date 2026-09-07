'use client';

// Auth screen: login / register / join-by-code. Multi-tenant SaaS entry.

import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { ShieldCheck } from 'lucide-react';
import { api, ApiError } from './api';
import { tr, T, type Lang } from './i18n';
import { DisclaimerBar } from './compliance';

export interface Me {
  user: { id: string; email: string; name: string };
  orgs: { id: string; name: string; type: string; plan: string; joinCode: string }[];
  activeOrg: { id: string; name: string; type: string; plan: string; joinCode: string; reviewQueueEnabled: boolean } | null;
  role: string;
}

export function AuthScreen({ lang, onAuth }: { lang: Lang; onAuth: () => void }) {
  const [email, setEmail] = useState('ahmed@demo.kw');
  const [password, setPassword] = useState('demo1234');
  const [name, setName] = useState('');
  const [joinCode, setJoinCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const run = async (fn: () => Promise<unknown>) => {
    setBusy(true); setError('');
    try { await fn(); onAuth(); }
    catch (e) { setError(e instanceof ApiError ? e.message : String(e)); }
    finally { setBusy(false); }
  };

  return (
    <div className="mx-auto flex min-h-screen max-w-5xl flex-col justify-center gap-6 px-4 py-10" dir={lang === 'ar' ? 'rtl' : 'ltr'}>
      <div className="text-center">
        <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-2xl bg-gradient-to-br from-slate-800 to-slate-600 text-white shadow-lg">
          <ShieldCheck className="h-8 w-8" />
        </div>
        <h1 className="text-3xl font-bold tracking-tight">{tr(T.appName, lang)}</h1>
        <p className="mt-2 text-sm text-muted-foreground">{tr(T.brandSub, lang)}</p>
      </div>

      <DisclaimerBar lang={lang} />

      <Card>
        <CardHeader>
          <CardTitle>{tr(T.login, lang)} / {tr(T.register, lang)}</CardTitle>
          <CardDescription>{tr(T.demoAccounts, lang)} ahmed@demo.kw · ngo@demo.kw · lawyer@demo.kw · admin@demo.kw</CardDescription>
        </CardHeader>
        <CardContent>
          <Tabs defaultValue="login">
            <TabsList className="mb-4 w-full">
              <TabsTrigger value="login" className="flex-1">{tr(T.login, lang)}</TabsTrigger>
              <TabsTrigger value="register" className="flex-1">{tr(T.register, lang)}</TabsTrigger>
              <TabsTrigger value="join" className="flex-1">{tr(T.joinByCode, lang)}</TabsTrigger>
            </TabsList>

            <TabsContent value="login" className="space-y-3">
              <div className="grid gap-2">
                <Label htmlFor="email">{tr(T.email, lang)}</Label>
                <Input id="email" dir="ltr" value={email} onChange={e => setEmail(e.target.value)} data-testid="login-email" />
              </div>
              <div className="grid gap-2">
                <Label htmlFor="pw">{tr(T.password, lang)}</Label>
                <Input id="pw" type="password" dir="ltr" value={password} onChange={e => setPassword(e.target.value)} data-testid="login-password" />
              </div>
              <Button className="w-full" disabled={busy} onClick={() => run(() => api.post('/api/auth/login', { email, password }))} data-testid="login-submit">
                {tr(T.login, lang)}
              </Button>
            </TabsContent>

            <TabsContent value="register" className="space-y-3">
              <div className="grid gap-2">
                <Label>{tr(T.name, lang)}</Label>
                <Input value={name} onChange={e => setName(e.target.value)} />
              </div>
              <div className="grid gap-2">
                <Label>{tr(T.email, lang)}</Label>
                <Input dir="ltr" value={email} onChange={e => setEmail(e.target.value)} />
              </div>
              <div className="grid gap-2">
                <Label>{tr(T.password, lang)}</Label>
                <Input type="password" dir="ltr" value={password} onChange={e => setPassword(e.target.value)} />
              </div>
              <Button className="w-full" disabled={busy || !name} onClick={() => run(() => api.post('/api/auth/register', { email, password, name }))}>
                {tr(T.register, lang)}
              </Button>
            </TabsContent>

            <TabsContent value="join" className="space-y-3">
              <p className="text-sm text-muted-foreground">
                {lang === 'ar'
                  ? 'لديك رمز دعوة من جمعية أو مكتب؟ سجّل دخولك أولًا ثم أدخل الرمز هنا للانضمام إلى مساحة عملهم.'
                  : 'Have an invite code from an NGO or firm? Sign in first, then enter the code to join their workspace.'}
              </p>
              <div className="grid gap-2">
                <Label>{lang === 'ar' ? 'رمز الدعوة' : 'Invite code'}</Label>
                <Input dir="ltr" placeholder="JOIN-XXXXXX" value={joinCode} onChange={e => setJoinCode(e.target.value)} />
              </div>
              <Button className="w-full" disabled={busy} onClick={() => run(() => api.post('/api/auth/switch-org', { joinCode }))}>
                {tr(T.joinByCode, lang)}
              </Button>
            </TabsContent>
          </Tabs>
          {error && <p className="mt-3 text-sm text-red-600">{error}</p>}
        </CardContent>
      </Card>
    </div>
  );
}
