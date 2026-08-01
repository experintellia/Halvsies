// The tab shell: three tabs (Expenses | Balances | Me), bottom tab bar on
// narrow viewports. Header, tab state and tab bar live here; each tab renders
// one screen component, all of which read the doc themselves and take no props.
//
// Above the tabs sits one "route": a full-screen sub-page that covers the
// shell, tab bar included. Three tabs and one sub-page is a useState, not a
// router.
import { useState } from "preact/hooks";
import { getSettings, listExpenses, listMembers } from "../state/doc";
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
    needsSetup(getSettings(), listMembers().length, listExpenses().length),
  );

  const activate = (id: Tab) => setTab(id);
  // A sub-page covers the shell completely; hide what it covers from assistive
  // tech rather than leaving two screens' worth of content readable at once.
  const covered = firstRun || route !== null;

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
      <FirstRunSetup open={firstRun} />
    </>
  );
}
