export type TabId = 'my' | 'mine' | 'team' | 'oncall' | 'local' | 'issues' | 'calendar';

interface TabSpec {
  id: TabId;
  label: string;
  badge?: number | string | null;
}

interface Props {
  tabs: TabSpec[];
  active: TabId;
  onChange: (tab: TabId) => void;
}

export function Tabs({ tabs, active, onChange }: Props) {
  return (
    <nav className="tabs" role="tablist">
      {tabs.map((t) => (
        <button
          key={t.id}
          type="button"
          role="tab"
          aria-selected={t.id === active}
          className={`tab${t.id === active ? ' tab-active' : ''}`}
          onClick={() => onChange(t.id)}
        >
          {t.label}
          {t.badge != null && t.badge !== '' && <span className="tab-badge">{t.badge}</span>}
        </button>
      ))}
    </nav>
  );
}
