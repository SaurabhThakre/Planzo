import React from "react";
import ReactDOM from "react-dom/client";
import { lazy, Suspense, useLayoutEffect } from "react";
import LiveApp from "./LiveApp";
import "./index.css";
import "./presentation.css";
import { observePresentation } from "./presentation";
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
const root = document.getElementById("root")!;

function PlanzoApp() {
    useLayoutEffect(() => observePresentation(root), []);
    return sample ? <><p className="sample-banner">Separate fictional sample · <a href={location.pathname}>Return to shared Planzo</a></p><Suspense fallback={<p className="opening-status" role="status">Opening the fictional Goa sample…</p>}><DemoApp launchSample={launchSample}/></Suspense></> : <LiveApp />;
}

ReactDOM.createRoot(root).render(<React.StrictMode><PlanzoApp/></React.StrictMode>);
