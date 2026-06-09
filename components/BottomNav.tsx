'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { Home, Layers, FileText, ClipboardList, Settings as SettingsIcon, type LucideIcon } from 'lucide-react';

interface NavItem { id: string; label: string; icon: LucideIcon; href: string }

const FARM_ITEMS: NavItem[] = [
  { id: 'home', label: 'Home', icon: Home, href: '/' },
  { id: 'fields', label: 'Fields', icon: Layers, href: '/fields' },
  { id: 'activity', label: 'Activity', icon: FileText, href: '/activity' },
  { id: 'settings', label: 'Settings', icon: SettingsIcon, href: '/settings' },
];

// Contractors have no fields/activity — their world is the jobs sent to them.
const CONTRACTOR_ITEMS: NavItem[] = [
  { id: 'jobs', label: 'Jobs', icon: ClipboardList, href: '/jobs' },
  { id: 'settings', label: 'Settings', icon: SettingsIcon, href: '/settings' },
];

export function BottomNav({ accountType = 'farm' }: { accountType?: 'farm' | 'contractor' }) {
  const pathname = usePathname();
  const items = accountType === 'contractor' ? CONTRACTOR_ITEMS : FARM_ITEMS;
  const topLevel = new Set(items.map((i) => i.href));
  if (!topLevel.has(pathname)) return null;

  return (
    <div className="bottom-nav">
      {items.map((item) => {
        const Icon = item.icon;
        const isActive = pathname === item.href;
        return (
          <Link key={item.id} href={item.href} className={`bottom-nav-btn ${isActive ? 'active' : ''}`}>
            <Icon size={20} />
            <span>{item.label}</span>
          </Link>
        );
      })}
    </div>
  );
}
