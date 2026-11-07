import React from "react";
import ReactDOM from "react-dom/client";
import { lazy, Suspense } from "react";
import LiveApp from "./LiveApp";
import "./index.css";
const DemoApp = lazy(() => import("./App"));
const params = new URLSearchParams(location.search);
const sample = params.get("demo") === "1";
const launchSample = sample && (
    params.get("launch") === "goa" ||
    history.state?.planzoDemoLaunch === "goa"
);
if (sample && params.get("launch") === "goa") {
    params.delete("launch");
    const query = params.toString();
    history.replaceState(
        { ...history.state, planzoDemoLaunch: "goa" },
        "",
        location.pathname + (query ? "?" + query : "") + "#/review",
    );
}
ReactDOM.createRoot(document.getElementById("root")!).render(<React.StrictMode>
    {sample ? <><p className="sample-banner">Separate fictional sample · <a href={location.pathname}>Return to shared Planzo</a></p><Suspense fallback={<p className="opening-status" role="status">Opening the fictional Goa sample…</p>}><DemoApp launchSample={launchSample}/></Suspense></> : <LiveApp />}
  </React.StrictMode>);
