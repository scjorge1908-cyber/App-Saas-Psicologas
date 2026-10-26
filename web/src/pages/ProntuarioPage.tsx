// Acesso direto ao prontuário: busca o paciente e abre a aba Prontuário da ficha dele.
// Mostra só nomes e a situação — o conteúdo clínico fica dentro da ficha (registro de acesso no banco).
import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import * as api from '../lib/api';
import { errorMessage } from '../lib/errors';
import { Badge, ErrorBox, Input, Loading } from '../components/ui';
import { IconChevronRight, IconLock, IconSearch } from '../components/icons';

const SITUACAO: Record<string, { rotulo: string; tom: 'ok' | 'neutro' | 'anil' }> = {
  ativo: { rotulo: 'Em atendimento', tom: 'ok' },
  inativo: { rotulo: 'Inativo', tom: 'neutro' },
  alta: { rotulo: 'Alta', tom: 'anil' },
};

export function ProntuarioPage() {
  const q = useQuery({ queryKey: ['patients'], queryFn: api.listPatients });
  const [busca, setBusca] = useState('');
  const lista = useMemo(() => {
    const t = busca.trim().toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
    return (q.data ?? []).filter((p) => !t || `${p.full_name} ${p.social_name ?? ''}`.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').includes(t));
  }, [q.data, busca]);

  return (
    <div className="flex flex-col gap-4">
      <header>
        <h1 className="text-[26px] font-bold">Prontuário</h1>
        <p className="flex items-center gap-1.5 text-[15px] text-tinta-2"><IconLock className="size-4" /> Sigiloso: só você acessa. Cada abertura fica registrada.</p>
      </header>
      <label className="relative block">
        <span className="sr-only">Buscar paciente</span>
        <IconSearch className="pointer-events-none absolute left-3 top-1/2 size-5 -translate-y-1/2 text-tinta-3" />
        <Input className="pl-10" placeholder="Buscar paciente" value={busca} onChange={(e) => setBusca(e.target.value)} />
      </label>
      {q.isLoading && <Loading />}
      {q.error && <ErrorBox>{errorMessage(q.error)}</ErrorBox>}
      {q.data && lista.length === 0 && <p className="text-tinta-3">{busca ? 'Nenhum paciente com esse nome.' : 'Nenhum paciente cadastrado ainda.'}</p>}
      <ul className="flex flex-col divide-y divide-linha overflow-hidden rounded-2xl border border-linha bg-papel">
        {lista.map((p) => (
          <li key={p.id}>
            <Link to={`/pacientes/${p.id}?aba=prontuario`} className="flex min-h-14 items-center gap-3 px-4 py-3 hover:bg-gesso">
              <span className="grid size-10 shrink-0 place-items-center rounded-full bg-anil-claro font-bold text-anil" aria-hidden>
                {(p.social_name || p.full_name).split(' ').filter(Boolean).slice(0, 2).map((x) => x[0]).join('').toUpperCase()}
              </span>
              <span className="min-w-0 flex-1 truncate font-bold">{p.social_name || p.full_name}</span>
              <Badge tone={SITUACAO[p.status]?.tom ?? 'neutro'}>{SITUACAO[p.status]?.rotulo ?? p.status}</Badge>
              <IconChevronRight className="text-tinta-3" />
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}
