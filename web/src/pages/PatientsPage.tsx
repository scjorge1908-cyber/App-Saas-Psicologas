import { useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import * as api from '../lib/api';
import type { PatientStatus } from '../lib/types';
import { errorMessage } from '../lib/errors';
import { formatPhone, money } from '../lib/format';
import { Badge, Button, Empty, ErrorBox, Input, Loading, PageHeader, Tabs } from '../components/ui';
import { IconPlus, IconSearch } from '../components/icons';
import { PatientForm } from '../components/patients/PatientForm';

const norm = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

export function PatientsPage() {
  const q = useQuery({ queryKey: ['patients'], queryFn: api.listPatients });
  const [term, setTerm] = useState('');
  const [status, setStatus] = useState<PatientStatus | 'todos'>('ativo');
  const [creating, setCreating] = useState(false);
  const nav = useNavigate();

  const list = useMemo(() => {
    const t = norm(term.trim());
    return (q.data ?? []).filter((p) =>
      (status === 'todos' || p.status === status)
      && (!t || norm(`${p.full_name} ${p.social_name ?? ''}`).includes(t) || (p.phone ?? '').includes(t.replace(/\D/g, '') || '§')));
  }, [q.data, term, status]);

  const counts = useMemo(() => {
    const c = { ativo: 0, inativo: 0, alta: 0 };
    for (const p of q.data ?? []) c[p.status]++;
    return c;
  }, [q.data]);

  return (
    <div>
      <PageHeader title="Pacientes" actions={<Button onClick={() => setCreating(true)}><IconPlus /> Novo paciente</Button>} />
      <div className="relative mb-3">
        <IconSearch className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-tinta-3" />
        <Input aria-label="Buscar paciente" placeholder="Buscar por nome ou telefone" value={term} onChange={(e) => setTerm(e.target.value)} className="pl-10" />
      </div>
      <Tabs label="Situação" value={status} onChange={setStatus} items={[
        { value: 'ativo', label: `Ativos (${counts.ativo})` },
        { value: 'inativo', label: `Inativos (${counts.inativo})` },
        { value: 'alta', label: `Alta (${counts.alta})` },
        { value: 'todos', label: 'Todos' },
      ]} />

      {q.isLoading && <Loading />}
      {q.error && <ErrorBox>{errorMessage(q.error)}</ErrorBox>}
      {q.data && q.data.length === 0 && (
        <Empty title="Nenhum paciente cadastrado." action={<Button variant="secondary" onClick={() => setCreating(true)}>Cadastrar o primeiro paciente</Button>}>
          Cadastre o paciente com nome e celular; o restante pode ser completado depois.
        </Empty>
      )}
      {q.data && q.data.length > 0 && list.length === 0 && <p className="py-6 text-tinta-2">Nenhum paciente encontrado com esse filtro.</p>}

      {list.length > 0 && (
        <ul className="divide-y divide-linha rounded-lg border border-linha bg-papel">
          {list.map((p) => (
            <li key={p.id}>
              <Link to={`/pacientes/${p.id}`} className="flex items-center justify-between gap-3 px-4 py-3.5 hover:bg-gesso">
                <span className="min-w-0">
                  <span className="block truncate font-bold">{p.social_name || p.full_name}</span>
                  <span className="block text-sm text-tinta-2">
                    {[p.phone && formatPhone(p.phone), p.session_price != null && `${money(p.session_price)} ${p.billing_mode === 'mensal' ? 'mensal' : 'por sessão'}`, p.modality === 'online' && 'online'].filter(Boolean).join(', ')}
                  </span>
                </span>
                {p.status !== 'ativo' && <Badge>{p.status === 'alta' ? 'Alta' : 'Inativo'}</Badge>}
              </Link>
            </li>
          ))}
        </ul>
      )}
      <PatientForm open={creating} onClose={() => setCreating(false)} onSaved={(p) => nav(`/pacientes/${p.id}`)} />
    </div>
  );
}
