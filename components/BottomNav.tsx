'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { Home, Layers, FileText, Settings as SettingsIcon } from 'lucide-react';

export function BottomNav() {
  const pathname = usePathname();

  // Show only on top-level pages
  const onTopLevel =
    pathname === '/' ||
    pathname === '/fields' ||
    pathname === '/activity' ||
    pathname === '/settings';
  if (!onTopLevel) return null;

  const items = [
    { id: 'home',     label: 'Home',     icon: Home,         href: '/' },
    { id: 'fields',   label: 'Fields',   icon: Layers,       href: '/fields' },
    { id: 'activity', label: 'Activity', icon: FileText,     href: '/activity' },
    { id: 'settings', label: 'Settings', icon: SettingsIcon, href: '/settings' },
  ];

  return (
    <div className="bottom-nav">
      {items.map(item => {
        const Icon = item.icon;
        const isActive =
          (item.href === '/' && pathname === '/') ||
          (item.href !== '/' && pathname === item.href);
        return (
          <Link
            key={item.id}
            href={item.href}
            className={`bottom-nav-btn ${isActive ? 'active' : ''}`}
          >
            <Icon size={20} />
            <span>{item.label}</span>
          </Link>
        );
      })}
    </div>
  );
}
