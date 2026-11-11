import assert from "node:assert/strict";
import { test } from "node:test";
import { repriceStay } from "../src/repriceStay.ts";

const start = "2026-12-14T15:30:12+05:30";
const end = "2026-12-15T06:40:12+05:30";
const stay = { id: "stay", kind: "stay", ref: "stay", route_ref: "hotel", start, end, cost_paise: 150000 };
const transfer = { ...stay, id: "transfer", kind: "activity", ref: "taxi", route_ref: "taxi", cost_paise: 50000 };
const document = { route_version: 1, steps: [stay, transfer], refs: [{ id: "taxi", title: "Taxi" }] };

test("repricing submits only the new stay amount and retains each route and exact timestamp", () => {
    assert.deepEqual(repriceStay(document, "stay", " 1680.07 "), [
        { start, end, kind: "stay", ref: "stay", route_ref: "hotel", title: "", cost_paise: 168007 },
        { start, end, kind: "activity", ref: "taxi", route_ref: "taxi", title: "Taxi", cost_paise: 50000 },
    ]);
    assert.equal(stay.cost_paise, 150000);
    assert(!Object.hasOwn(repriceStay({ ...document, route_version: undefined }, "stay", "1700")[0], "route_ref"));
});

test("repricing rejects an unchanged amount, non-stay ID and unsupported INR formats", () => {
    assert.throws(() => repriceStay(document, "stay", "1500.00"), /already/);
    assert.throws(() => repriceStay(document, "transfer", "1600"), /Choose a stay/);
    for (const amount of ["-1", "12.123", "1e3", "999999999.99", "1,700", ""]) {
        assert.throws(() => repriceStay(document, "stay", amount));
    }
    assert.equal(repriceStay(document, "stay", "0")[0].cost_paise, 0);
});
