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
  hydrated,
  listExpenses,
  listMembers,
  listSettlements,
  whenHydrated,
} from "../state/doc";
import { Balances } from "./Balances";
import { ExpenseList } from "./ExpenseList";
import { FirstRunSetup, GroupSettings, needsSetup } from "./GroupSettings";
import { ProfileForm } from "./ProfileForm";
import { useDocValue } from "./useDoc";
import { Icon, type IconName } from "./components/Icon";
import { TapButton } from "./components/TapButton";

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
  // Starts true already for tests/SSR (no host to wait for); on a real device
  // this flips once webxdc has replayed the chat history into the doc.
  const [ready, setReady] = useState(hydrated);
  const settings = useDocValue(getSettings);
  const memberCount = useDocValue(() => listMembers().length);
  const firstRun = useDocValue(() =>
    needsSetup(getSettings(), listExpenses().length, listSettlements().length),
  );

  // Until hydration lands, the doc may still be missing a previous session's
  // answer — deciding firstRun against it would flash the setup screen past
  // on every single open while history is still replaying in.
  useEffect(() => {
    if (ready) return;
    whenHydrated().then(() => setReady(true));
  }, [ready]);

  // Registering the local user is a document write, and every write flushes to
  // the chat — so doing it at startup (which main.tsx used to) posted
  // "X joined the split" into the group before the app had asked which
  // currency this split is even in. Opening Halvsies out of curiosity and
  // closing it again should leave no trace. Deferred until setup is done;
  // idempotent, so the screens' own useSelfId() calls stay harmless.
  useEffect(() => {
    if (!ready || firstRun) return;
    try {
      ensureSelfRegistered();
    } catch {
      // no webxdc host (vitest/SSR) — the doc still works
    }
  }, [ready, firstRun]);

  // Nothing may mount before hydration: the tab screens register the local
  // user on mount, which is exactly the write firstRun's own check must not
  // race. Blank is better than a setup screen that then has to un-flash.
  if (!ready) return null;
  // Nothing behind the setup screen may mount: the tab screens register the
  // local user on mount, which is exactly the write we are deferring.
  if (firstRun) return <FirstRunSetup open />;

  const activate = (id: Tab) => setTab(id);
  const openGroup = () => setRoute("group");
  // A sub-page covers the shell completely; hide what it covers from assistive
  // tech rather than leaving two screens' worth of content readable at once.
  const covered = route !== null;

  return (
    <>
      <div className="app-shell" aria-hidden={covered ? "true" : undefined}>
        {/* The group name is the way into group settings: they belong to
            everyone, so they live up here rather than under "Me". */}
        <header className="app-header">
          <h1 className="app-heading">
            {/* A big tap target for fingers; keyboard and screen-reader users
                get the one control that says what it does, the gear. */}
            <TapButton
              className="group-btn"
              tabIndex={-1}
              onActivate={openGroup}
            >
              <span className="app-title">{settings.title || "Halvsies"}</span>
              <span className="group-meta">
                {memberCount === 1 ? "1 person" : `${memberCount} people`} ·{" "}
                {settings.groupCurrency}
              </span>
            </TapButton>
          </h1>
          <TapButton
            className="icon-btn"
            ariaLabel="Group settings"
            onActivate={openGroup}
          >
            <Icon name="settings" size={20} strokeWidth={1.75} />
          </TapButton>
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

      <GroupSettings open={route === "group"} onClose={() => setRoute(null)} />
    </>
  );
}
