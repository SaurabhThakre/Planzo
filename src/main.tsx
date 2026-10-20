import React from "react";
import ReactDOM from "react-dom/client";
import { lazy, Suspense } from "react";
import LiveApp from "./LiveApp";
import "./index.css";
const DemoApp = lazy(() => import("./App"));
const sample = new URLSearchParams(location.search).get("demo") === "1";
ReactDOM.createRoot(document.getElementById("root")!).render(<React.StrictMode>
    {sample ? <><p className="sample-banner">Separate fictional sample · <a href={location.pathname}>Return to shared Planzo</a></p><Suspense fallback={<p>Opening sample…</p>}><DemoApp /></Suspense></> : <LiveApp />}
  </React.StrictMode>);
