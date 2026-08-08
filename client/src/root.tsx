import { Links, Meta, Outlet, Scripts, ScrollRestoration } from "react-router";

import "bootstrap/dist/css/bootstrap.min.css";
import "katex/dist/katex.min.css";
import "bootstrap-icons/font/bootstrap-icons.css";

import "@/styles/reset.scss";
import "@/styles/global.scss";
import "@/styles/buttons.scss";
import "@/styles/forms.scss";

// Disable console.debug in production
console.debug = () => {};

export function Layout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <head>
        <meta charSet="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        {/* React Router doesn't inject this via the vite-pwa plugin by default. */}
        <link
          rel="manifest"
          href={`${import.meta.env.BASE_URL}manifest.webmanifest`}
        />
        <link rel="stylesheet" href={`${import.meta.env.BASE_URL}fonts.css`} />

        <Meta />
        <Links />
      </head>
      <body>
        <div id="root">{children}</div>
        <ScrollRestoration />
        <Scripts />
      </body>
    </html>
  );
}

export default function App() {
  return (
    <>
      <Outlet />
    </>
  );
}
