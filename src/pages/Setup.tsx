import { useState } from "react";
import { Zap } from "lucide-react";
import { Button } from "@/components/kit";
import { OfficerFields } from "@/pages/Settings";
import { useStore, type OfficerInput } from "@/lib/store";

export default function Setup() {
  const { run } = useStore();
  const [value, setValue] = useState<OfficerInput>({ name: "", role: "Director", region: "", email: "", affiliations: [], active: true });
  return <div className="setup">
    <div className="setup-card card">
      <div className="preloader-brand"><div className="brandmark"><Zap size={19}/></div><div><strong>NIYANTRAN</strong><span>APH COMPLIANCE ENGINE</span></div></div>
      <h1>Set up your workspace</h1>
      <p>Start by creating your own officer profile. You can add other officers, publish the APH rulebook and register institutions next. All data stays in this browser.</p>
      <OfficerFields value={value} onChange={setValue}/>
      <p className="muted">A Director or Regional Officer can sign decisions and approve rule publication.</p>
      <Button onClick={() => run({ type: "SETUP", officer: value }, "Workspace ready")}>Create profile and continue</Button>
    </div>
  </div>;
}
