import { describe, expect, it } from "vitest";
import { renderToString } from "react-dom/server";
import { loadDemo } from "@/lib/demo";
import { NavContext, type Params } from "@/lib/nav";
import { StoreProvider, dispatch } from "@/lib/store";
import { emptyState, type State } from "@/lib/types";
import ApplicationsPage from "@/pages/Applications";
import AuditPage from "@/pages/Audit";
import EvidencePage from "@/pages/Evidence";

// Renders pages against real store state (no mocked responses). Synthetic data only.
const NOW = Date.now();
const demo = () => loadDemo(emptyState(), NOW);
const render = (state: State, page: string, params: Params, Page: () => React.ReactElement) => renderToString(
  <StoreProvider initial={state}><NavContext.Provider value={{ page, params, go: () => {} }}><Page/></NavContext.Provider></StoreProvider>);

describe("Evidence Intelligence workspace", () => {
  it("25. loads the consistency matrix and findings from real store state", () => {
    const s = demo();
    const html = render(s, "Evidence Intelligence", { appId: s.applications[0].id }, EvidencePage);
    expect(html).toContain("Consistency matrix");
    expect(html).toContain("Plot 4, Sector 12, Greater Noida");
    expect(html).toContain("MISMATCH");
    expect(html).toContain("Decision support, not a decision");
    expect(html).toContain("Machine-extracted");
    expect(html).not.toContain("View only");
  });

  it("26. shows permission-denied, empty and not-found states", () => {
    const s = demo();
    const evc = s.officers.find(o => o.role === "EVC Coordinator")!.id;
    const asEvc = dispatch(s, { type: "USER_SWITCH", id: evc }, evc, NOW + 10_000);
    expect(render(asEvc, "Evidence Intelligence", { appId: s.applications[0].id }, EvidencePage)).toContain("View only");

    const dir = s.officers.find(o => o.role === "Director")!.id;
    const bare = dispatch(asEvc, { type: "APP_CREATE", institutionId: s.institutions[0].id, appType: "LoA", submittedAt: new Date(NOW).toISOString() }, dir, NOW + 20_000);
    const html = render(bare, "Evidence Intelligence", { appId: bare.applications[1].id }, EvidencePage);
    expect(html).toContain("No documents uploaded");

    expect(render(s, "Evidence Intelligence", { appId: "missing" }, EvidencePage)).toContain("Application not found");
    expect(render(emptyState(), "Evidence Intelligence", {}, EvidencePage)).toContain("No applications yet");
  });

  it("27. existing case file and audit pages still render, now with evidence links and metadata", () => {
    const s = demo();
    const caseFile = render(s, "Applications", { appId: s.applications[0].id }, ApplicationsPage);
    expect(caseFile).toContain("Required documents");
    expect(caseFile).toContain("Evidence intelligence");
    expect(caseFile).toContain("Evidence findings awaiting officer confirmation");
    expect(render(s, "Audit Trail", {}, AuditPage)).toContain("Evidence uploaded");
  });
});
