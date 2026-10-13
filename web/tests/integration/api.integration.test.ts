/**
 * Testes de integração pelo protocolo HTTP do Supabase (supabase-js real),
 * contra o gateway local + Postgres com as migrations reais.
 * Pré-requisito: scripts/e2e-db.sh && node dev-gateway/server.mjs
 */
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { beforeAll, describe, expect, it } from 'vitest';

const URL = process.env.SUPABASE_URL ?? 'http://localhost:54321';
const KEY = process.env.SUPABASE_ANON_KEY ?? 'dev-anon-key';
const run = Date.now().toString(36);

function client() {
  return createClient(URL, KEY, { auth: { persistSession: false, autoRefreshToken: false } });
}

async function newUser(name: string): Promise<{ sb: SupabaseClient; id: string }> {
  const sb = client();
  const { data, error } = await sb.auth.signUp({
    email: `${name}.${run}@exemplo.invalid`,
    password: 'Senha-Teste-123',
    options: { data: { full_name: `${name} Fictícia` } },
  });
  if (error) throw error;
  return { sb, id: data.user!.id };
}

let ana: { sb: SupabaseClient; id: string };
let bia: { sb: SupabaseClient; id: string };
let anaPatientId: string;

beforeAll(async () => {
  ana = await newUser('ana');
  bia = await newUser('bia');
});

describe('Autenticação', () => {
  it('cria perfil automaticamente no cadastro', async () => {
    const { data, error } = await ana.sb.from('profiles').select('id, full_name').single();
    expect(error).toBeNull();
    expect(data).toMatchObject({ id: ana.id, full_name: 'ana Fictícia' });
  });

  it('rejeita senha errada', async () => {
    const { error } = await client().auth.signInWithPassword({ email: `ana.${run}@exemplo.invalid`, password: 'errada-123' });
    expect(error?.message).toMatch(/Invalid login credentials/);
  });

  it('permite atualizar CRP no próprio perfil', async () => {
    const { error } = await ana.sb.from('profiles').update({ crp: '06/123456', onboarded_at: new Date().toISOString() }).eq('id', ana.id);
    expect(error).toBeNull();
  });

  it('valida formato do CRP', async () => {
    const { error } = await ana.sb.from('profiles').update({ crp: '123' }).eq('id', ana.id);
    expect(error?.code).toBe('23514');
  });
});

describe('Isolamento pela API', () => {
  it('Ana cria paciente; Bia não vê nem altera', async () => {
    const { data, error } = await ana.sb.from('patients').insert({ full_name: 'Paciente API Fictício', session_price: 150 }).select().single();
    expect(error).toBeNull();
    anaPatientId = data!.id;

    const seen = await bia.sb.from('patients').select('*');
    expect(seen.data).toEqual([]);

    const upd = await bia.sb.from('patients').update({ full_name: 'Hack' }).eq('id', anaPatientId).select();
    expect(upd.data).toEqual([]);

    const again = await ana.sb.from('patients').select('full_name').eq('id', anaPatientId).single();
    expect(again.data?.full_name).toBe('Paciente API Fictício');
  });

  it('Bia não agenda para paciente da Ana (FK composta)', async () => {
    const start = new Date(Date.now() + 86400e3 * 10);
    const { error } = await bia.sb.from('appointments').insert({
      patient_id: anaPatientId, starts_at: start.toISOString(), ends_at: new Date(+start + 50 * 60e3).toISOString(),
    });
    expect(error?.code).toBe('23503');
  });

  it('anônimo não lê tabelas', async () => {
    const { error } = await client().from('patients').select('*');
    expect(error?.code).toBe('42501');
  });
});

describe('Agenda e confirmação pela API', () => {
  let apptId: string;
  let token: string;

  it('cria série e reporta conflitos', async () => {
    const d = new Date(Date.now() + 86400e3 * 14);
    const date = d.toISOString().slice(0, 10);
    const { data, error } = await ana.sb.rpc('create_appointment_series', {
      p_patient_id: anaPatientId, p_frequency: 'semanal', p_start_date: date, p_start_time: '15:00',
      p_duration_minutes: 50, p_occurrences: 3, p_price: 150, p_modality: 'presencial',
    });
    expect(error).toBeNull();
    expect(data.created).toHaveLength(3);
    const again = await ana.sb.rpc('create_appointment_series', {
      p_patient_id: anaPatientId, p_frequency: 'semanal', p_start_date: date, p_start_time: '15:30',
      p_duration_minutes: 50, p_occurrences: 3,
    });
    expect(again.data.created).toHaveLength(0);
    expect(again.data.conflicts).toHaveLength(3);
    apptId = data.created[0].id;
  });

  it('conflito direto retorna 23P01', async () => {
    const { data: a } = await ana.sb.from('appointments').select('starts_at, ends_at').eq('id', apptId).single();
    const { error } = await ana.sb.from('appointments').insert({ patient_id: anaPatientId, starts_at: a!.starts_at, ends_at: a!.ends_at });
    expect(error?.code).toBe('23P01');
  });

  it('paciente confirma por link e o agendamento muda', async () => {
    const r = await ana.sb.rpc('create_confirmation_link', { p_appointment_id: apptId });
    expect(r.error).toBeNull();
    token = r.data as string;
    const anon = client();
    const g = await anon.rpc('get_confirmation', { p_token: token });
    expect(g.data).toMatchObject({ state: 'pendente', patient_first_name: 'Paciente', professional_crp: '06/123456' });
    const c = await anon.rpc('respond_confirmation', { p_token: token, p_action: 'confirmar' });
    expect(c.data).toMatchObject({ ok: true, state: 'confirmado' });
    const { data: after } = await ana.sb.from('agenda_items').select('status, patient_response').eq('id', apptId).single();
    expect(after).toMatchObject({ status: 'confirmado', patient_response: 'confirmou' });
  });

  it('Bia não gera link para sessão da Ana', async () => {
    const r = await bia.sb.rpc('create_confirmation_link', { p_appointment_id: apptId });
    expect(r.error?.code).toBe('P0002');
  });
});

describe('Storage pela API', () => {
  const bytes = new TextEncoder().encode('%PDF-1.4 arquivo fictício');

  it('Ana envia e baixa arquivo na própria pasta', async () => {
    const p = `${ana.id}/${anaPatientId}/teste-${run}.pdf`;
    const up = await ana.sb.storage.from('prontuario').upload(p, bytes, { contentType: 'application/pdf' });
    expect(up.error).toBeNull();
    const dl = await ana.sb.storage.from('prontuario').download(p);
    expect(dl.error).toBeNull();
    expect(new Uint8Array(await dl.data!.arrayBuffer())).toEqual(bytes);
  });

  it('Bia não envia para a pasta da Ana nem baixa arquivos dela', async () => {
    const p = `${ana.id}/${anaPatientId}/intruso-${run}.pdf`;
    const up = await bia.sb.storage.from('prontuario').upload(p, bytes, { contentType: 'application/pdf' });
    expect(up.error).not.toBeNull();
    const dl = await bia.sb.storage.from('prontuario').download(`${ana.id}/${anaPatientId}/teste-${run}.pdf`);
    expect(dl.error).not.toBeNull();
  });

  it('tipo de arquivo não permitido é recusado', async () => {
    const up = await ana.sb.storage.from('prontuario').upload(`${ana.id}/x-${run}.exe`, bytes, { contentType: 'application/x-msdownload' });
    expect(up.error).not.toBeNull();
  });
});

describe('Recuperação de senha', () => {
  it('envia link e permite redefinir', async () => {
    const anon = client();
    const email = `bia.${run}@exemplo.invalid`;
    const { error } = await anon.auth.resetPasswordForEmail(email, { redirectTo: 'http://localhost:5173/redefinir-senha' });
    expect(error).toBeNull();
    const box = await (await fetch(`${URL}/__mailbox`)).json();
    const mail = box.reverse().find((m: { to: string }) => m.to === email);
    expect(mail?.type).toBe('recovery');
    const r = await fetch(mail.link, { redirect: 'manual' });
    const loc = r.headers.get('location')!;
    expect(loc).toContain('#access_token=');
    const hash = new URLSearchParams(loc.split('#')[1]);
    const s = client();
    await s.auth.setSession({ access_token: hash.get('access_token')!, refresh_token: hash.get('refresh_token')! });
    const upd = await s.auth.updateUser({ password: 'Nova-Senha-456' });
    expect(upd.error).toBeNull();
    const login = await client().auth.signInWithPassword({ email, password: 'Nova-Senha-456' });
    expect(login.error).toBeNull();
  });
});
