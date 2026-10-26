import { useEffect, type ReactNode } from "react";
import NumberFlow from "@number-flow/react";
import { useInView } from "react-intersection-observer";
import { ChevronRight, PauseCircle, X } from "lucide-react";
import { Tooltip as Hint, TooltipContent as HintContent, TooltipTrigger as HintTrigger } from "@/components/ui/skiper-ui/skiper101";
import { countdown, fmtDateTime, fmtDays, officerName, type Alert, type SlaInfo } from "@/lib/engine";
import { useStore } from "@/lib/store";
import type { Role } from "@/lib/types";

export function Button({ children, kind = "default", onClick, type = "button", disabled, title, small }: { children: ReactNode; kind?: "default" | "secondary" | "danger" | "ghost"; onClick?: () => void; type?: "button" | "submit"; disabled?: boolean; title?: string; small?: boolean }) {
  return <button type={type} className={`button ${kind} ${small ? "small" : ""}`} onClick={onClick} disabled={disabled} title={title}>{children}</button>;
}

export function Badge({ children, tone = "neutral" }: { children: ReactNode; tone?: string }) {
  return <span className={`badge ${tone}`}>{children}</span>;
}

export function CardHead({ title, sub, action, onAction, children }: { title: string; sub?: string; action?: string; onAction?: () => void; children?: ReactNode }) {
  return <div className="card-head"><div><h2>{title}</h2>{sub && <p>{sub}</p>}</div>{children}{action && <button onClick={onAction}>{action}<ChevronRight size={14}/></button>}</div>;
}

export function PageHeading({ title, sub, actions, eyebrow }: { title: string; sub: string; actions?: ReactNode; eyebrow?: ReactNode }) {
  return <div className="page-heading"><div>{eyebrow && <div className="eyebrow">{eyebrow}</div>}<h1>{title}</h1><p>{sub}</p></div>{actions && <div className="heading-actions">{actions}</div>}</div>;
}

export function Modal({ title, onClose, children, footer, wide }: { title: string; onClose: () => void; children: ReactNode; footer?: ReactNode; wide?: boolean }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);
  return <div className="modal-backdrop" onClick={onClose}>
    <div className={`modal ${wide ? "wide" : ""}`} role="dialog" aria-modal="true" aria-label={title} onClick={e => e.stopPropagation()}>
      <div className="modal-head"><h2>{title}</h2><button className="icon" onClick={onClose} aria-label="Close"><X size={18}/></button></div>
      <div className="modal-body">{children}</div>
      {footer && <div className="modal-foot">{footer}</div>}
    </div>
  </div>;
}

export function Field({ label, children, hint, wide }: { label: string; children: ReactNode; hint?: string; wide?: boolean }) {
  return <label className={`form-field ${wide ? "wide" : ""}`}><span>{label}</span>{children}{hint && <small>{hint}</small>}</label>;
}

export function Empty({ icon, title, text, action }: { icon?: ReactNode; title: string; text: string; action?: ReactNode }) {
  return <div className="empty">{icon && <div className="empty-icon">{icon}</div>}<h2>{title}</h2><p>{text}</p>{action}</div>;
}

export function Tabs<T extends string>({ tabs, value, onChange }: { tabs: { id: T; label: string; count?: number }[]; value: T; onChange: (v: T) => void }) {
  return <div className="tabs" role="tablist">{tabs.map(t => <button key={t.id} role="tab" aria-selected={value === t.id} className={value === t.id ? "active" : ""} onClick={() => onChange(t.id)}>{t.label}{t.count !== undefined && <i>{t.count}</i>}</button>)}</div>;
}

export function AnimatedValue({ value, suffix }: { value: number; suffix?: string }) {
  const { ref, inView } = useInView({ triggerOnce: true });
  return <span ref={ref}><NumberFlow value={inView ? value : 0} format={{ useGrouping: true, maximumFractionDigits: 1 }} locales="en-IN" suffix={suffix}/></span>;
}

export function Countdown({ due }: { due: string }) {
  const { now } = useStore();
  const c = countdown(due, now);
  return <span className={`countdown ${c.overdue ? "overdue" : c.days < 1 ? "soon" : ""}`} title={fmtDateTime(due)}>{c.label}</span>;
}

export function OfficerSelect({ value, onChange, roles, placeholder = "Choose officer", id }: { value: string; onChange: (id: string) => void; roles?: Role[]; placeholder?: string; id?: string }) {
  const { state } = useStore();
  const active = state.officers.filter(o => o.active);
  const preferred = roles ? active.filter(o => roles.includes(o.role)) : active;
  const others = roles ? active.filter(o => !roles.includes(o.role)) : [];
  return <select id={id} value={value} onChange={e => onChange(e.target.value)}>
    <option value="">{placeholder}</option>
    {preferred.map(o => <option key={o.id} value={o.id}>{o.name} · {o.role} · {o.region}</option>)}
    {others.length > 0 && <optgroup label="Other roles">{others.map(o => <option key={o.id} value={o.id}>{o.name} · {o.role} · {o.region}</option>)}</optgroup>}
  </select>;
}

export function SlaBar({ info }: { info: SlaInfo }) {
  const total = Math.max(info.limit, info.processing) + info.waiting || 1;
  const pct = (n: number) => `${(n / total) * 100}%`;
  return <div className="sla-bar" role="img" aria-label={`${fmtDays(info.processing)} processing of ${info.limit} days; ${fmtDays(info.waiting)} institution wait not counted`}>
    <i className={`proc ${info.overdue ? "over" : ""}`} style={{ width: pct(info.processing) }}/><i className="wait" style={{ width: pct(info.waiting) }}/><b style={{ left: pct(info.limit) }}/>
  </div>;
}

export function SlaClock({ info }: { info: SlaInfo }) {
  return <div className="sla-clock">
    <SlaBar info={info}/>
    <div className="sla-legend"><span><i className="proc"/>AICTE processing <strong>{fmtDays(info.processing)}</strong> of {info.limit}d</span><span><i className="wait"/>Waiting on institution <strong>{fmtDays(info.waiting)}</strong> · not counted</span><span>{info.overdue ? <strong className="danger-text">Overdue by {fmtDays(info.overdueDays)}</strong> : <>Remaining <strong>{fmtDays(info.remaining)}</strong></>}</span></div>
    {info.paused && <p className="sla-paused"><PauseCircle size={14}/>Clock paused: waiting for the institution to respond to a deficiency notice</p>}
  </div>;
}

export function SlaChip({ info }: { info: SlaInfo | null }) {
  if (!info) return <span className="muted">—</span>;
  const label = info.overdue ? `Overdue ${fmtDays(info.overdueDays)}` : info.paused ? `Paused · ${fmtDays(info.remaining)} left` : `${fmtDays(info.remaining)} left`;
  return <Hint><HintTrigger asChild><span className={`has-hint sla-cell ${info.overdue ? "danger-text" : ""}`}>{info.paused && <PauseCircle size={12}/>}{label}</span></HintTrigger>
    <HintContent side="top" className="hint">{fmtDays(info.processing)} of {info.limit} {info.stage} processing days used. {fmtDays(info.waiting)} waiting on the institution {info.paused ? "(clock paused now) " : ""}is not counted.</HintContent></Hint>;
}

export function AlertExplain({ alert }: { alert: Alert }) {
  return <div className="explain">
    <div><span>Why</span><p>{alert.reason}</p></div>
    <div><span>APH clause</span><p>{alert.clause ? <>{alert.clause.code} {alert.clause.title} {alert.rulesVersion && <Badge tone="blue">APH {alert.rulesVersion}</Badge>}{alert.clause.text && <small className="clause-text">{alert.clause.text}</small>}</> : <>No clause in the “{alert.clauseCategory}” category is configured in APH {alert.rulesVersion ?? "(none)"}. Add one in the Rulebook.</>}</p></div>
    <div><span>Deadline</span><p>{alert.deadline ? <>{fmtDateTime(alert.deadline)} · <Countdown due={alert.deadline}/></> : "No fixed deadline"}</p></div>
    <div><span>Required action</span><p>{alert.action}</p></div>
  </div>;
}

export const severityTone = (s: "critical" | "warning") => s === "critical" ? "red" : "amber";

export function Who({ id }: { id: string | null | undefined }) {
  const { state } = useStore();
  return <>{officerName(state, id)}</>;
}

export function Toasts() {
  const { toasts } = useStore();
  return <div className="toasts" aria-live="polite">{toasts.map(t => <div key={t.id} className={`toast ${t.kind}`}>{t.text}</div>)}</div>;
}

export function ListEditor({ items, onChange, placeholder }: { items: string[]; onChange: (items: string[]) => void; placeholder: string }) {
  return <div className="list-editor">
    {items.map((item, i) => <div key={i} className="list-row"><input value={item} onChange={e => onChange(items.map((x, j) => j === i ? e.target.value : x))} aria-label={placeholder}/><button type="button" className="icon" aria-label="Remove" onClick={() => onChange(items.filter((_, j) => j !== i))}><X size={15}/></button></div>)}
    <Button kind="secondary" small onClick={() => onChange([...items, ""])}>+ Add</Button>
  </div>;
}
