import type { ReactNode } from 'react';

interface CardProps {
  title: string;
  tag?: string;
  children?: ReactNode;
}

export default function Card({ title, tag = 'Feature', children }: CardProps) {
  return (
    <article className="feature-card">
      <span className="card-tag">{tag}</span>
      <h2>{title}</h2>
      <div className="card-body">{children}</div>
    </article>
  );
}
