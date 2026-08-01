// The tab shell: three tabs (Expenses | Balances | Me), bottom tab bar on
// narrow viewports. Header, tab state and tab bar live here; each tab renders
// one screen component, all of which read the doc themselves and take no props.
//
// Above the tabs sits one "route": a full-screen sub-page that covers the
// shell, tab bar included. Three tabs and one sub-page is a useState, not a
// router.
import { useEffect, useState } from "preact/hooks";
import {
  ensureSelfRegistered,
  getSettings,
  listExpenses,
  listSettlements,
} from "../state/doc";
import { Balances } from "./Balances";
import { ExpenseList } from "./ExpenseList";
import { FirstRunSetup, GroupSettings, needsSetup } from "./GroupSettings";
import { ProfileForm } from "./ProfileForm";
import { useDocValue } from "./useDoc";
import { Icon, type IconName } from "./components/Icon";

type Tab = "expenses" | "balances" | "me";
type Route = "group" | null;

const TABS: ReadonlyArray<{ id: Tab; label: string; icon: IconName }> = [
  { id: "expenses", label: "Expenses", icon: "receipt" },
  { id: "balances", label: "Balances", icon: "scale" },
  { id: "me", label: "Me", icon: "user" },
];

export function App() {
  const [tab, setTab] = useState<Tab>("expenses");
  const [route, setRoute] = useState<Route>(null);
  const settings = useDocValue(getSettings);
  const firstRun = useDocValue(() =>
    needsSetup(getSettings(), listExpenses().length, listSettlements().length),
  );

  // Registering the local user is a document write, and every write flushes to
  // the chat — so doing it at startup (which main.tsx used to) posted
  // "X joined the split" into the group before the app had asked which
  // currency this split is even in. Opening Halvsies out of curiosity and
  // closing it again should leave no trace. Deferred until setup is done;
  // idempotent, so the screens' own useSelfId() calls stay harmless.
  useEffect(() => {
    if (firstRun) return;
    try {
      ensureSelfRegistered();
    } catch {
      // no webxdc host (vitest/SSR) — the doc still works
    }
  }, [firstRun]);

  // Nothing behind the setup screen may mount: the tab screens register the
  // local user on mount, which is exactly the write we are deferring.
  if (firstRun) return <FirstRunSetup open />;

  const activate = (id: Tab) => setTab(id);
  // A sub-page covers the shell completely; hide what it covers from assistive
  // tech rather than leaving two screens' worth of content readable at once.
  const covered = route !== null;

  return (
    <>
      <div className="app-shell" aria-hidden={covered ? "true" : undefined}>
        <header className="app-header">
          <h1 className="app-title">{settings.title || "Halvsies"}</h1>
          <span className="app-currency">{settings.groupCurrency}</span>
        </header>

        <main className="app-content">
          {tab === "expenses" && <ExpenseList />}
          {tab === "balances" && <Balances />}
          {tab === "me" && (
            <ProfileForm onOpenGroupSettings={() => setRoute("group")} />
          )}
        </main>

        <nav className="tab-bar" aria-label="Main">
          {TABS.map((item) => (
            <button
              key={item.id}
              type="button"
              className={"tab-btn" + (tab === item.id ? " active" : "")}
              aria-current={tab === item.id ? "page" : undefined}
              onPointerUp={() => activate(item.id)}
              onClick={(e) => {
                if (e.detail === 0) activate(item.id);
              }}
            >
              <span className="tab-icon">
                <Icon name={item.icon} size={22} strokeWidth={1.75} />
              </span>
              <span className="tab-label">{item.label}</span>
            </button>
          ))}
        </nav>
      </div>

      <GroupSettings open={route === "group"} onClose={() => setRoute(null)} />
    </>
  );
}
