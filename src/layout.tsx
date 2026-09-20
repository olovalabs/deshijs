import type { ReactNode } from 'react';
import './styles.css';

export interface RouteProps {
  children?: ReactNode;
  params: Record<string, string | string[]>;
  url: URL;
  route: { pattern: string; file: string };
}

export default function Layout({ children }: RouteProps) {
  return (
    <html lang="en">
      <head>
        <meta charSet="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <meta
          name="description"
          content="Deshi renders React TSX to static HTML and ships JavaScript only for explicit client islands."
        />
      </head>
      <body>
        <header className="navbar">
          <div className="nav-container">
            <a href="/" className="brand">
              <span className="logo-box">D</span>
              <strong>Deshi</strong>
            </a>
            <nav className="nav-links" aria-label="Main navigation">
              <a href="/">Home</a>
              <a href="/docs">Docs</a>
              <a href="/about">About</a>
              <a href="/blog">Blog</a>
              <a href="/counter">Islands</a>
            </nav>
          </div>
        </header>

        <main className="main-content">{children}</main>

        <footer className="footer">
          <p>© {new Date().getFullYear()} Deshi. React on the server, HTML in the browser.</p>
        </footer>
      </body>
    </html>
  );
}
