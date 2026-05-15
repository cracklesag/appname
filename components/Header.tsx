import Link from 'next/link';
import { ArrowLeft } from 'lucide-react';

export function Header({
  title,
  subtitle,
  backHref,
  right,
}: {
  title: string;
  subtitle?: string;
  backHref?: string;
  right?: React.ReactNode;
}) {
  return (
    <div className="page-header">
      <div className="page-header-row">
        {backHref && (
          <Link href={backHref} className="icon-btn" aria-label="Back" style={{ marginLeft: -4 }}>
            <ArrowLeft size={22} />
          </Link>
        )}
        <div style={{ flex: 1 }}>
          {subtitle && <div className="page-header-subtitle">{subtitle}</div>}
          <h1 className="page-header-title">{title}</h1>
        </div>
        {right}
      </div>
    </div>
  );
}
