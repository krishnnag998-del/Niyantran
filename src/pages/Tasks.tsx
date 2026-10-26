import { useState } from "react";
import { CheckCircle2, Circle, ClipboardCopy, Download, ListChecks, Plus } from "lucide-react";
import { Badge, Button, CardHead, Countdown, Empty, Field, Modal, OfficerSelect, PageHeading, Tabs } from "@/components/kit";
import { digest, fmtDateTime, localDate, officerName, taskDue } from "@/lib/engine";
import { useNav } from "@/lib/nav";
import { useStore } from "@/lib/store";
import type { State, Task } from "@/lib/types";

const KIND_LABEL: Record<Task["kind"], string> = { stage: "Workflow stage", deficiency: "Deficiency review", "evc-visit": "EVC visit", "evc-report": "EVC report", manual: "Manual" };

function digestText(state: State, officerId: string, now: number) {
  const d = digest(state, officerId, now);
  const line = (v: { task: Task; due: string }) => `  • ${v.task.title} (due ${fmtDateTime(v.due)})`;
  return [
    `Aaj Ka Kaam: daily digest for ${officerName(state, officerId)}, ${new Date(now).toLocaleDateString("en-IN", { weekday: "long", day: "numeric", month: "long", year: "numeric" })}`,
    "", `Overdue (${d.overdue.length})`, ...d.overdue.map(line),
    "", `Due today (${d.today.length})`, ...d.today.map(line),
    "", `Next 7 days (${d.week.length})`, ...d.week.map(line),
  ].join("\n");
}

function NewTask({ onClose }: { onClose: () => void }) {
  const { state, me, run } = useStore();
  const [title, setTitle] = useState("");
  const [owner, setOwner] = useState(me?.id ?? "");
  const [due, setDue] = useState(`${localDate(Date.now())}T17:00`);
  const [appId, setAppId] = useState("");
  return <Modal title="New task" onClose={onClose} footer={<><Button kind="secondary" onClick={onClose}>Cancel</Button><Button onClick={() => run({ type: "TASK_CREATE", title, owner, due, appId }, "Task created") && onClose()}>Create task</Button></>}>
    <div className="form-grid">
      <Field label="Task" wide><input value={title} onChange={e => setTitle(e.target.value)} autoFocus/></Field>
      <Field label="Owner"><OfficerSelect value={owner} onChange={setOwner}/></Field>
      <Field label="Due"><input type="datetime-local" value={due} onChange={e => setDue(e.target.value)}/></Field>
      <Field label="Application (optional)" wide><select value={appId} onChange={e => setAppId(e.target.value)}><option value="">Not linked</option>{state.applications.filter(a => a.stage !== "Closed").map(a => <option key={a.id} value={a.id}>{a.ref}</option>)}</select></Field>
    </div>
  </Modal>;
}

type Filter = "mine" | "open" | "done";

export default function TasksPage() {
  const { state, now, me, run, toast } = useStore();
  const { go } = useNav();
  const [digestFor, setDigestFor] = useState(me?.id ?? "");
  const [filter, setFilter] = useState<Filter>("mine");
  const [creating, setCreating] = useState(false);
  const who = digestFor || me?.id || "";
  const d = digest(state, who, now);

  const rows = state.tasks
    .filter(t => filter === "done" ? t.status === "done" : t.status === "open" && (filter === "open" || t.owner === me?.id))
    .map(t => ({ t, due: taskDue(state, t, now) }))
    .sort((a, b) => filter === "done" ? (b.t.doneAt ?? "").localeCompare(a.t.doneAt ?? "") : a.due.localeCompare(b.due));

  const copy = async () => { try { await navigator.clipboard.writeText(digestText(state, who, now)); toast("Digest copied"); } catch { toast("Clipboard access was blocked by the browser.", "error"); } };
  const download = () => {
    const a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob([digestText(state, who, now)], { type: "text/plain" }));
    a.download = `aaj-ka-kaam-${localDate(now)}.txt`;
    a.click();
    URL.revokeObjectURL(a.href);
  };
  const section = (title: string, items: typeof d.today, tone: string) => <div className="digest-section"><h3><Badge tone={tone}>{items.length}</Badge>{title}</h3>
    {items.length === 0 ? <p className="muted">Nothing here.</p> : <ul className="simple-list">{items.map(v => <li key={v.task.id}><div><strong>{v.task.title}</strong><small>{KIND_LABEL[v.task.kind]} · due {fmtDateTime(v.due)}</small></div><Countdown due={v.due}/></li>)}</ul>}</div>;

  return <>
    <PageHeading title="Aaj Ka Kaam" sub="Every task has an owner and a due date. Workflow tasks are created and closed automatically; stage deadlines follow the fair SLA clock."
      actions={<Button onClick={() => setCreating(true)}><Plus size={16}/>New task</Button>}/>
    <article className="card digest-card">
      <CardHead title="Daily task digest" sub={`${d.overdue.length} overdue · ${d.today.length} due today · ${d.week.length} in the next 7 days`}>
        <div className="button-row"><OfficerSelect value={who} onChange={setDigestFor} placeholder="Choose officer"/><Button small kind="secondary" onClick={copy}><ClipboardCopy size={14}/>Copy</Button><Button small kind="secondary" onClick={download}><Download size={14}/>Download</Button></div>
      </CardHead>
      <div className="digest-grid">{section("Overdue", d.overdue, "red")}{section("Due today", d.today, "amber")}{section("Next 7 days", d.week, "blue")}</div>
    </article>
    <article className="card">
      <div className="toolbar"><Tabs<Filter> value={filter} onChange={setFilter} tabs={[{ id: "mine", label: "My open tasks", count: state.tasks.filter(t => t.status === "open" && t.owner === me?.id).length }, { id: "open", label: "All open", count: state.tasks.filter(t => t.status === "open").length }, { id: "done", label: "Completed", count: state.tasks.filter(t => t.status === "done").length }]}/></div>
      {rows.length === 0 ? <Empty icon={<ListChecks/>} title="No tasks" text={filter === "done" ? "Completed tasks will appear here." : "Tasks are created when applications move through the workflow, or you can add one."}/>
        : <div className="table-wrap"><table><thead><tr><th/><th>Task</th><th>Owner</th><th>Due</th><th>Type</th><th>Application</th></tr></thead><tbody>
          {rows.map(({ t, due }) => { const app = state.applications.find(a => a.id === t.appId); return <tr key={t.id}>
            <td><button className="check" onClick={() => run({ type: "TASK_TOGGLE", taskId: t.id })} disabled={t.kind !== "manual"} title={t.kind !== "manual" ? "Completes automatically when the workflow step is done" : t.status === "open" ? "Mark done" : "Reopen"} aria-label={t.status === "open" ? "Mark done" : "Reopen"}>{t.status === "done" ? <CheckCircle2 size={18}/> : <Circle size={18}/>}</button></td>
            <td><strong className={t.status === "done" ? "struck" : ""}>{t.title}</strong><small>{t.status === "done" ? `Done ${fmtDateTime(t.doneAt)} · ${officerName(state, t.doneBy)}` : `Created ${fmtDateTime(t.createdAt)} by ${officerName(state, t.createdBy)}`}</small></td>
            <td>{t.status === "open" ? <OfficerSelect value={t.owner ?? ""} onChange={id => id && run({ type: "TASK_REASSIGN", taskId: t.id, owner: id }, "Task reassigned")} placeholder="Unassigned"/> : officerName(state, t.owner)}</td>
            <td className="nowrap">{fmtDateTime(due)}{t.status === "open" && <><br/><Countdown due={due}/></>}</td>
            <td><Badge>{KIND_LABEL[t.kind]}</Badge></td>
            <td>{app ? <button className="link" onClick={() => go("Applications", { appId: app.id })}>{app.ref}</button> : "—"}</td>
          </tr>; })}
        </tbody></table></div>}
    </article>
    {creating && <NewTask onClose={() => setCreating(false)}/>}
  </>;
}
