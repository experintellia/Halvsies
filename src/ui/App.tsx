// The tab shell: three tabs (Expenses | Balances | Me), bottom tab bar on
// narrow viewports. Header, tab state and tab bar live here; each tab renders
// one screen component, all of which read the doc themselves and take no props.
import { useState } from "preact/hooks";
import { getSettings } from "../state/doc";
import { Balances } from "./Balances";
import { ExpenseList } from "./ExpenseList";
import { ProfileForm } from "./ProfileForm";
import { useDocValue } from "./useDoc";
import { Icon, type IconName } from "./components/Icon";

type Tab = "expenses" | "balances" | "me";

const TABS: ReadonlyArray<{ id: Tab; label: string; icon: IconName }> = [
  { id: "expenses", label: "Expenses", icon: "receipt" },
  { id: "balances", label: "Balances", icon: "scale" },
  { id: "me", label: "Me", icon: "user" },
];

export function App() {
  const [tab, setTab] = useState<Tab>("expenses");
  const settings = useDocValue(getSettings);

  const activate = (id: Tab) => setTab(id);

  return (
    <div className="app-shell">
      <header className="app-header">
        <h1 className="app-title">{settings.title || "Halvsies"}</h1>
        <span className="app-currency">{settings.groupCurrency}</span>
      </header>

      <main className="app-content">
        {tab === "expenses" && <ExpenseList />}
        {tab === "balances" && <Balances />}
        {tab === "me" && <ProfileForm />}
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
  );
}
