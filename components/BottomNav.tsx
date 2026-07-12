'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { Home, Layers, FileText, ClipboardList, Clock, Users, Building2, Sprout, NotebookPen, Settings as SettingsIcon, type LucideIcon } from 'lucide-react';

interface NavItem { id: string; label: string; icon: LucideIcon; href: string }

const FARM_ITEMS: NavItem[] = [
  { id: 'home', label: 'Home', icon: Home, href: '/' },
  { id: 'fields', label: 'Fields', icon: Layers, href: '/fields' },
  { id: 'activity', label: 'Activity', icon: FileText, href: '/activity' },
  { id: 'diary', label: 'Diary', icon: NotebookPen, href: '/diary' },
  { id: 'settings', label: 'Settings', icon: SettingsIcon, href: '/settings' },
];

// Contractors have no fields/activity — their world is the jobs sent to them.
const CONTRACTOR_ITEMS: NavItem[] = [
  { id: 'jobs', label: 'Jobs', icon: ClipboardList, href: '/jobs' },
  { id: 'timesheets', label: 'Timesheets', icon: Clock, href: '/timesheets' },
  { id: 'team', label: 'Team', icon: Users, href: '/settings/team' },
  { id: 'settings', label: 'Settings', icon: SettingsIcon, href: '/settings' },
];

// Agronomists review client farms — Farms (their list), then the selected
// farm's Fields and Plan, plus Settings. No logging.
const AGRONOMIST_ITEMS: NavItem[] = [
  { id: 'farms', label: 'Farms', icon: Building2, href: '/agronomist' },
  { id: 'fields', label: 'Fields', icon: Layers, href: '/fields' },
  { id: 'plan', label: 'Plan', icon: Sprout, href: '/plan' },
  { id: 'settings', label: 'Settings', icon: SettingsIcon, href: '/settings' },
];

export function BottomNav({ accountType = 'farm', jobBadge = 0 }: { accountType?: 'farm' | 'contractor' | 'agronomist'; jobBadge?: number }) {
  const pathname = usePathname();
  const items = accountType === 'contractor' ? CONTRACTOR_ITEMS : accountType === 'agronomist' ? AGRONOMIST_ITEMS : FARM_ITEMS;
  const topLevel = new Set(items.map((i) => i.href));
  if (!topLevel.has(pathname)) return null;

  return (
    <div className="bottom-nav">
      {items.map((item) => {
        const Icon = item.icon;
        const isActive = pathname === item.href;
        return (
          <Link key={item.id} href={item.href} className={`bottom-nav-btn ${isActive ? 'active' : ''}`}>
            <span style={{ position: 'relative', display: 'inline-flex' }}>
              <Icon size={20} />
              {item.id === 'jobs' && jobBadge > 0 && (
                <span style={{ position: 'absolute', top: -5, right: -8, minWidth: 16, height: 16, padding: '0 4px', borderRadius: 8, background: 'var(--clay, #b06a37)', color: '#fff', fontSize: 10, fontWeight: 700, display: 'flex', alignItems: 'center', justifyContent: 'center', lineHeight: 1 }}>{jobBadge > 9 ? '9+' : jobBadge}</span>
              )}
            </span>
            <span>{item.label}</span>
          </Link>
        );
      })}
    </div>
  );
}
