import type { ReactNode } from "react";

type PageHeaderProps = {
  eyebrow: string;
  title: string;
  description: string;
  actions?: ReactNode;
  alignActionsWithTitle?: boolean;
};

export function PageHeader({
  eyebrow,
  title,
  description,
  actions,
  alignActionsWithTitle = false,
}: PageHeaderProps) {
  return (
    <header className={alignActionsWithTitle ? "page-header page-header--title-actions" : "page-header"}>
      <div className="page-header-copy">
        <p className="micro-label">{eyebrow}</p>
        <div className="page-title-row">
          <h1 className="page-title">{title}</h1>
          {alignActionsWithTitle && actions && <div className="page-actions">{actions}</div>}
        </div>
        <p className="page-description">{description}</p>
      </div>
      {!alignActionsWithTitle && actions && <div className="page-actions">{actions}</div>}
    </header>
  );
}
