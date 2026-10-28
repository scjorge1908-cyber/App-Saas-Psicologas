import {
  createContext, forwardRef, useCallback, useContext, useEffect, useId, useRef, useState,
  type ButtonHTMLAttributes, type InputHTMLAttributes, type ReactNode, type SelectHTMLAttributes,
  type Ref, type TextareaHTMLAttributes,
} from 'react';
import type { AppointmentStatus } from '../lib/types';

export function cx(...c: Array<string | false | null | undefined>) {
  return c.filter(Boolean).join(' ');
}

// ---------------------------------------------------------------- Botão -----
type Variant = 'primary' | 'secondary' | 'ghost' | 'danger';
const VARIANTS: Record<Variant, string> = {
  primary: 'btn-degrade shadow-cartao hover:brightness-105 hover:shadow-elevado disabled:opacity-50',
  secondary: 'bg-papel text-anil-escuro border border-anil-escuro/50 hover:bg-anil-claro/60 disabled:opacity-50',
  ghost: 'text-anil-escuro hover:bg-anil-claro/70 disabled:opacity-50',
  danger: 'bg-vermelho-forte text-sobre-status hover:brightness-95 disabled:opacity-50',
};

export const Button = forwardRef<HTMLButtonElement, ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant; busy?: boolean; size?: 'md' | 'sm' }>(
  function Button({ variant = 'primary', busy, size = 'md', className, children, disabled, ...rest }, ref) {
    return (
      <button
        ref={ref}
        className={cx(
          'pressionar inline-flex items-center justify-center gap-2 rounded-botao font-bold transition-[filter,box-shadow,background-color] disabled:cursor-not-allowed',
          size === 'md' ? 'min-h-12 px-5 text-[0.9375rem]' : 'min-h-11 px-3.5 text-sm',
          VARIANTS[variant], className,
        )}
        disabled={disabled || busy}
        aria-busy={busy || undefined}
        {...rest}
      >
        {busy && <Spinner small />}
        {children}
      </button>
    );
  },
);

export function Spinner({ small, label = 'Carregando' }: { small?: boolean; label?: string }) {
  return (
    <span role="status" aria-label={label} className={cx('inline-block animate-spin rounded-full border-2 border-current border-r-transparent', small ? 'h-4 w-4' : 'h-6 w-6')} />
  );
}

export function Loading({ label = 'Carregando…' }: { label?: string }) {
  return (
    <div className="flex items-center gap-3 py-10 text-tinta-3">
      <Spinner /> <span>{label}</span>
    </div>
  );
}

// --------------------------------------------------------------- Campos -----
const inputBase = 'w-full min-w-0 min-h-12 rounded-campo border-[1.5px] border-linha bg-papel px-4 py-2 text-tinta placeholder:text-tinta-3 focus:border-anil focus:outline-none focus:ring-2 focus:ring-anil/25 disabled:bg-cinza-fundo aria-[invalid=true]:border-vermelho';

interface FieldProps { label: string; hint?: ReactNode; error?: string | null; required?: boolean; children: (id: string, describedBy?: string) => ReactNode; className?: string }
export function Field({ label, hint, error, required, children, className }: FieldProps) {
  const id = useId();
  const hintId = hint ? `${id}-hint` : undefined;
  const errId = error ? `${id}-err` : undefined;
  return (
    <div className={cx('flex flex-col gap-1', className)}>
      <label htmlFor={id} className="rotulo">
        {label}{required && <span className="text-vermelho" aria-hidden> *</span>}
      </label>
      {children(id, [hintId, errId].filter(Boolean).join(' ') || undefined)}
      {hint && !error && <p id={hintId} className="text-sm text-tinta-3">{hint}</p>}
      {error && <p id={errId} className="text-sm text-vermelho" role="alert">{error}</p>}
    </div>
  );
}

export const Input = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement>>(function Input({ className, ...p }, ref) {
  return <input ref={ref} className={cx(inputBase, className)} {...p} />;
});
export const Textarea = forwardRef<HTMLTextAreaElement, TextareaHTMLAttributes<HTMLTextAreaElement>>(function Textarea({ className, ...p }, ref) {
  return <textarea ref={ref} className={cx(inputBase, 'min-h-28 leading-relaxed', className)} {...p} />;
});
export const Select = forwardRef<HTMLSelectElement, SelectHTMLAttributes<HTMLSelectElement>>(function Select({ className, children, ...p }, ref) {
  return <select ref={ref} className={cx(inputBase, 'pr-8', className)} {...p}>{children}</select>;
});

/** Campo de texto com rótulo, em uma linha. */
export function TextField({ label, hint, error, required, className, ...input }: InputHTMLAttributes<HTMLInputElement> & { label: string; hint?: ReactNode; error?: string | null }) {
  return (
    <Field label={label} hint={hint} error={error} required={required} className={className}>
      {(id, d) => <Input id={id} aria-describedby={d} aria-invalid={!!error || undefined} required={required} {...input} />}
    </Field>
  );
}

// --------------------------------------------------------------- Status -----
export const STATUS_LABEL: Record<AppointmentStatus, string> = {
  agendado: 'Agendada', confirmado: 'Confirmada', atendido: 'Atendida', faltou: 'Falta', cancelado: 'Cancelada',
};
const STATUS_STYLE: Record<AppointmentStatus, string> = {
  agendado: 'bg-anil-claro text-sobre-anil-claro',
  confirmado: 'bg-azul-fundo text-azul',
  atendido: 'bg-verde-fundo text-verde',
  faltou: 'bg-ocre-fundo text-ocre',
  cancelado: 'bg-cinza-fundo text-tinta-2',
};
export const STATUS_BAR: Record<AppointmentStatus, string> = {
  agendado: 'border-l-anil', confirmado: 'border-l-azul-forte', atendido: 'border-l-verde-forte', faltou: 'border-l-ocre-forte', cancelado: 'border-l-linha-forte',
};
export function StatusBadge({ status }: { status: AppointmentStatus }) {
  return <span className={cx('inline-flex h-6 items-center gap-1.5 rounded-full px-2.5 text-[0.75rem] font-bold', STATUS_STYLE[status])}><span aria-hidden className="size-1.5 rounded-full bg-current opacity-85" />{STATUS_LABEL[status]}</span>;
}

export function Badge({ tone = 'neutro', children }: { tone?: 'neutro' | 'atencao' | 'ok' | 'erro' | 'anil'; children: ReactNode }) {
  const t = { neutro: 'bg-cinza-fundo text-tinta-2', atencao: 'bg-ocre-fundo text-ocre', ok: 'bg-verde-fundo text-verde', erro: 'bg-vermelho-fundo text-vermelho', anil: 'bg-anil-claro text-sobre-anil-claro' }[tone];
  return <span className={cx('inline-flex h-6 items-center rounded-full px-2.5 text-[0.75rem] font-bold', t)}>{children}</span>;
}

// ----------------------------------------------------------- Estruturas -----
export function PageHeader({ title, subtitle, actions }: { title: string; subtitle?: ReactNode; actions?: ReactNode }) {
  return (
    <header className="mb-5 flex flex-wrap items-end justify-between gap-3">
      <div>
        <h1 className="titulo-display text-[1.875rem] leading-tight text-tinta [overflow-wrap:anywhere]">{title}</h1>
        {subtitle && <p className="mt-1 text-tinta-2">{subtitle}</p>}
      </div>
      {actions && <div className="flex flex-wrap gap-2">{actions}</div>}
    </header>
  );
}

export function Panel({ title, actions, children, className, recolhivel, aberto, ok, okTexto, detalhesRef }: { title?: string; actions?: ReactNode; children: ReactNode; className?: string; recolhivel?: boolean; aberto?: boolean;
  /** Seção concluída (28/10): cartão verde com ✓ (ex.: Perfil profissional completo). */ ok?: boolean; okTexto?: string; detalhesRef?: Ref<HTMLDetailsElement> }) {
  if (recolhivel && title) {
    // Seção que abre e fecha (Configurações): menos rolagem, uma coisa por vez
    return (
      <details ref={detalhesRef} className={cx('cartao group', ok && 'border-2 border-livre! bg-livre-fundo!', className)} open={aberto}>
        <summary className="flex min-h-14 cursor-pointer list-none items-center justify-between gap-3 px-4 py-3 [&::-webkit-details-marker]:hidden">
          <h2 className={cx('flex items-center gap-2 text-[1.0625rem] font-bold', ok && 'text-livre')}>
            {ok && <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden><circle cx="12" cy="12" r="9" /><path d="M8 12.3l2.6 2.6L16 9.5" /></svg>}
            {title}
            {ok && <span className="rounded-full bg-livre px-2 py-0.5 text-[0.75rem] font-bold text-papel">{okTexto ?? 'OK'}</span>}
          </h2>
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="shrink-0 text-tinta-3 transition-transform group-open:rotate-90" aria-hidden><path d="M9 5l7 7-7 7" /></svg>
        </summary>
        <div className="border-t border-linha/70 p-4">{actions && <div className="mb-3">{actions}</div>}{children}</div>
      </details>
    );
  }
  return (
    <section className={cx('cartao', className)}>
      {(title || actions) && (
        <div className="flex items-center justify-between gap-3 border-b border-linha/70 px-4 py-3.5">
          {title && <h2 className="text-[1.0625rem] font-bold">{title}</h2>}
          {actions}
        </div>
      )}
      <div className="p-4">{children}</div>
    </section>
  );
}

export function Empty({ title, children, action }: { title: string; children?: ReactNode; action?: ReactNode }) {
  return (
    <div className="flex flex-col items-start gap-2 rounded-cartao border border-dashed border-linha-forte bg-papel/60 p-6">
      <p className="font-bold">{title}</p>
      {children && <div className="text-tinta-2">{children}</div>}
      {action}
    </div>
  );
}

export function ErrorBox({ children }: { children: ReactNode }) {
  return <div role="alert" className="rounded-campo border border-vermelho/30 bg-vermelho-fundo px-4 py-3 text-vermelho">{children}</div>;
}

export function Notice({ children, tone = 'anil' }: { children: ReactNode; tone?: 'anil' | 'ocre' }) {
  return (
    <div className={cx('rounded-campo border px-4 py-3 text-[0.9375rem]', tone === 'anil' ? 'border-anil/25 bg-anil-claro text-sobre-anil-claro' : 'border-ocre/30 bg-ocre-fundo text-ocre')}>
      {children}
    </div>
  );
}

export function Tabs<T extends string>({ value, onChange, items, label }: { value: T; onChange: (v: T) => void; items: Array<{ value: T; label: string; count?: number }>; label: string }) {
  return (
    <div role="tablist" aria-label={label} className="-mx-1 mb-4 flex gap-1 overflow-x-auto border-b border-linha px-1">
      {items.map((it) => (
        <button
          key={it.value}
          role="tab"
          aria-selected={value === it.value}
          onClick={() => onChange(it.value)}
          className={cx(
            'shrink-0 border-b-[3px] px-3 py-2.5 font-bold transition-colors',
            value === it.value ? 'border-anil text-anil-escuro' : 'border-transparent text-tinta-3 hover:text-tinta',
          )}
        >
          {it.label}{it.count ? <span className="ml-1.5 rounded bg-ocre-fundo px-1.5 text-sm text-ocre num">{it.count}</span> : null}
        </button>
      ))}
    </div>
  );
}

// ---------------------------------------------------------------- Diálogo ---
export function Dialog({ open, onClose, title, children, footer, wide }: { open: boolean; onClose: () => void; title: string; children: ReactNode; footer?: ReactNode; wide?: boolean }) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (open && !d.open) {
      if (typeof d.showModal === 'function') d.showModal(); else d.setAttribute('open', '');
    }
    if (!open && d.open) {
      if (typeof d.close === 'function') d.close(); else d.removeAttribute('open');
    }
  }, [open]);
  return (
    <dialog
      ref={ref}
      onCancel={(e) => { e.preventDefault(); onClose(); }}
      className={cx(
        'm-0 mt-auto w-full max-w-none rounded-t-grande bg-papel p-0 text-tinta shadow-flutuante backdrop:bg-black/45 sm:m-auto sm:rounded-grande',
        wide ? 'sm:max-w-2xl' : 'sm:max-w-lg',
      )}
      aria-labelledby="dlg-title"
    >
      {open && (
        <div className="flex max-h-[92dvh] flex-col">
          <div className="flex items-center justify-between gap-3 border-b border-linha px-5 py-4">
            <h2 id="dlg-title" className="text-xl font-bold">{title}</h2>
            <button onClick={onClose} className="grid size-11 shrink-0 place-items-center rounded-full text-tinta-3 hover:bg-cinza-fundo" aria-label="Fechar">
              <svg width="20" height="20" viewBox="0 0 20 20" aria-hidden><path d="M5 5l10 10M15 5L5 15" stroke="currentColor" strokeWidth="2" strokeLinecap="round" /></svg>
            </button>
          </div>
          <div className="overflow-y-auto px-5 py-4"
            // Teclado virtual: depois que ele abre, traz o campo focado para o meio da área visível
            onFocus={(e) => { const t = e.target as HTMLElement; if (/^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName)) setTimeout(() => t.scrollIntoView({ block: 'center', behavior: 'smooth' }), 320); }}>{children}</div>
          {footer && <div className="flex flex-wrap justify-end gap-2 border-t border-linha px-5 py-3 pb-safe">{footer}</div>}
        </div>
      )}
    </dialog>
  );
}

// ------------------------------------------------------- Confirmação -------
interface ConfirmOpts { title: string; body?: ReactNode; confirmLabel: string; danger?: boolean }
const ConfirmCtx = createContext<(o: ConfirmOpts) => Promise<boolean>>(async () => false);
export const useConfirm = () => useContext(ConfirmCtx);

// ---------------------------------------------------------------- Avisos ----
type Toast = { id: number; text: string; tone: 'ok' | 'erro' };
const ToastCtx = createContext<(text: string, tone?: 'ok' | 'erro') => void>(() => {});
export const useToast = () => useContext(ToastCtx);

export function FeedbackProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const [pending, setPending] = useState<(ConfirmOpts & { resolve: (v: boolean) => void }) | null>(null);

  const toast = useCallback((text: string, tone: 'ok' | 'erro' = 'ok') => {
    const id = Date.now() + Math.random();
    setToasts((t) => [...t, { id, text, tone }]);
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), tone === 'erro' ? 7000 : 3500);
  }, []);

  const confirm = useCallback((o: ConfirmOpts) => new Promise<boolean>((resolve) => setPending({ ...o, resolve })), []);
  const close = (v: boolean) => { pending?.resolve(v); setPending(null); };

  return (
    <ToastCtx.Provider value={toast}>
      <ConfirmCtx.Provider value={confirm}>
        {children}
        <Dialog
          open={!!pending}
          onClose={() => close(false)}
          title={pending?.title ?? ''}
          footer={<>
            <Button variant="secondary" onClick={() => close(false)}>Voltar</Button>
            <Button variant={pending?.danger ? 'danger' : 'primary'} onClick={() => close(true)}>{pending?.confirmLabel}</Button>
          </>}
        >
          <div className="text-tinta-2">{pending?.body}</div>
        </Dialog>
        <div aria-live="polite" className="pointer-events-none fixed inset-x-0 bottom-20 z-50 flex flex-col items-center gap-2 px-4 lg:bottom-6">
          {toasts.map((t) => (
            <div key={t.id} className={cx('pointer-events-auto max-w-md rounded-campo px-4 py-3 font-bold shadow-flutuante', t.tone === 'ok' ? 'bg-inverso text-sobre-inverso' : 'bg-vermelho-forte text-sobre-status')}>
              {t.text}
            </div>
          ))}
        </div>
      </ConfirmCtx.Provider>
    </ToastCtx.Provider>
  );
}

export function DescList({ items }: { items: Array<[string, ReactNode]> }) {
  return (
    <dl className="grid grid-cols-1 gap-x-6 gap-y-3 sm:grid-cols-2">
      {items.filter(([, v]) => v !== null && v !== undefined && v !== '').map(([k, v]) => (
        <div key={k}>
          <dt className="rotulo">{k}</dt>
          <dd className="font-bold">{v}</dd>
        </div>
      ))}
    </dl>
  );
}
