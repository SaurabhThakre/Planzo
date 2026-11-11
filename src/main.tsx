import React from "react";
import ReactDOM from "react-dom/client";
import { useLayoutEffect } from "react";
import LiveApp from "./LiveApp";
import "./index.css";
import "./presentation.css";
import { observePresentation } from "./presentation";
const root = document.getElementById("root")!;

function PlanzoApp() {
    useLayoutEffect(() => observePresentation(root), []);
    return <LiveApp />;
}

ReactDOM.createRoot(root).render(<React.StrictMode><PlanzoApp/></React.StrictMode>);
