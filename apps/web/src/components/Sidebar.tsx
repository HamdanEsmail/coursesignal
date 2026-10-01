import {
  Bell,
  Clock3,
  Database,
  FileCheck2,
  MessageCircle,
  ShieldCheck,
  Smartphone,
} from "lucide-react";

const items = [
  { id: "receipt", label: "Receipt", icon: FileCheck2 },
  { id: "today", label: "iMessage demo", icon: MessageCircle },
  { id: "connect", label: "Connect", icon: Smartphone },
  { id: "watches", label: "Watches", icon: Bell },
  { id: "memory", label: "Memory", icon: Database },
  { id: "privacy", label: "Privacy", icon: ShieldCheck },
] as const;

export type ViewId = (typeof items)[number]["id"];

type SidebarProps = {
  active: ViewId;
  onSelect: (view: ViewId) => void;
};

export function Sidebar({ active, onSelect }: SidebarProps) {
  return (
    <aside className="sidebar" aria-label="Primary navigation">
      <nav className="sidebar__nav">
        {items.map(({ id, label, icon: Icon }) => (
          <button
            className={`nav-item ${active === id ? "nav-item--active" : ""}`}
            key={id}
            type="button"
            aria-current={active === id ? "page" : undefined}
            onClick={() => onSelect(id)}
          >
            <Icon aria-hidden="true" size={19} strokeWidth={1.7} />
            <span>{label}</span>
          </button>
        ))}
      </nav>

      <div className="sidebar__footer">
        <button className="sidebar-note" type="button" onClick={() => onSelect("watches")}>
          <Clock3 aria-hidden="true" size={19} strokeWidth={1.6} />
          <span>
            <strong>Quiet hours</strong>
            <small>10 PM–8 AM · Dubai</small>
          </span>
        </button>
        <button className="sidebar-note" type="button" onClick={() => onSelect("privacy")}>
          <ShieldCheck aria-hidden="true" size={19} strokeWidth={1.6} />
          <span>
            <strong>Privacy controls</strong>
            <small>Retention and deletion</small>
          </span>
        </button>
      </div>
    </aside>
  );
}
