import {
  BookOpenText,
  Database,
  Keyboard,
  MessageSquareText,
  NotebookPen,
  ShieldCheck,
} from "lucide-react";
import type { AppView } from "../views.js";

const items: Array<{
  id: AppView;
  label: string;
  icon: typeof NotebookPen;
}> = [
  { id: "start", label: "Start here", icon: NotebookPen },
  { id: "example", label: "Example", icon: MessageSquareText },
  { id: "commands", label: "What to text", icon: Keyboard },
  { id: "receipt", label: "Sources", icon: BookOpenText },
  { id: "memory", label: "What it remembers", icon: Database },
  { id: "privacy", label: "Privacy", icon: ShieldCheck },
];

type SidebarProps = {
  view: AppView;
  onNavigate: (view: AppView) => void;
};

export function Sidebar({ view, onNavigate }: SidebarProps) {
  return (
    <aside className="sidebar" id="primary-navigation">
      <nav className="sidebar__nav" aria-label="Field guide">
        {items.map((item) => {
          const Icon = item.icon;
          const active = view === item.id;
          return (
            <button
              key={item.id}
              type="button"
              className={active ? "nav-item nav-item--active" : "nav-item"}
              aria-current={active ? "page" : undefined}
              onClick={() => onNavigate(item.id)}
            >
              <Icon aria-hidden="true" size={18} strokeWidth={1.75} />
              <span>{item.label}</span>
            </button>
          );
        })}
      </nav>
      <div className="sidebar__footer">
        <p className="sidebar-note">
          <strong>iMessage only</strong>
          <small>This page teaches the line. It does not chat.</small>
        </p>
      </div>
    </aside>
  );
}
