import Image from "next/image";
import Link from "next/link";

export function AppShell({
  children,
  title,
  subtitle,
  actions,
}: {
  children: React.ReactNode;
  title?: string;
  subtitle?: string;
  actions?: React.ReactNode;
}) {
  return (
    <div className="app-shell">
      <div className="ambient ambient-a" />
      <div className="ambient ambient-b" />
      <header className="topbar">
        <Link href="/" className="brand">
          <span className="brand-mark brand-mark-logo">
            <Image
              src="/cyclo-ia-logo.png?v=2"
              alt="Cyclo.ia"
              width={72}
              height={72}
              priority
              unoptimized
            />
          </span>
          <span className="brand-text">
            <strong>Cyclo.ia</strong>
            <small>Cronometragem operacional com IA</small>
          </span>
        </Link>
        <nav className="topnav">
          <Link href="/">Atividades</Link>
          <Link href="/atividades/nova" className="btn btn-primary btn-sm">
            Nova atividade
          </Link>
        </nav>
      </header>

      <main className="page">
        {(title || actions) && (
          <div className="page-header">
            <div>
              {title && <h1 className="page-title">{title}</h1>}
              {subtitle && <p className="page-subtitle">{subtitle}</p>}
            </div>
            {actions && <div className="page-actions">{actions}</div>}
          </div>
        )}
        {children}
      </main>
    </div>
  );
}
