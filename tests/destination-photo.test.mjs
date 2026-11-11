import assert from "node:assert/strict";
import { test } from "node:test";
import { loadDestinationPhoto } from "../src/destinationPhoto.ts";

const photo = {
    thumburl: "https://upload.wikimedia.org/example.jpg",
    descriptionurl: "https://commons.wikimedia.org/wiki/File:Example.jpg",
    extmetadata: {
        Artist: { value: "<a>Author &amp; team</a>" },
        LicenseShortName: { value: "CC BY-SA 4.0" },
    },
};

test("loads only an attributable cover from Wikimedia and sends only the destination", async (t) => {
    const request = new AbortController();
    const fetch = t.mock.method(globalThis, "fetch", async (input, options) => {
        const url = new URL(input);
        assert.equal(options.credentials, "omit");
        assert.equal(options.referrerPolicy, "no-referrer");
        assert.equal(options.signal, request.signal);
        if (url.hostname === "en.wikipedia.org") {
            assert.equal(url.searchParams.get("titles"), "Panaji");
            return Response.json({ query: { pages: [{ pageimage: "Example.jpg" }] } });
        }
        assert.equal(url.hostname, "commons.wikimedia.org");
        assert.equal(url.searchParams.get("titles"), "File:Example.jpg");
        return Response.json({ query: { pages: [{ imageinfo: [photo] }] } });
    });
    assert.deepEqual(await loadDestinationPhoto(" Panaji ", request.signal), {
        imageUrl: photo.thumburl,
        sourceUrl: photo.descriptionurl,
        credit: "Author & team · CC BY-SA 4.0",
        licenseUrl: "https://creativecommons.org/licenses/by-sa/4.0/",
    });
    assert.equal(fetch.mock.callCount(), 2);
});

test("keeps the placeholder on no match, rate limit, disallowed image host or unsupported licence", async (t) => {
    const signal = new AbortController().signal;
    let commonsResult = Response.json({ query: { pages: [] } });
    t.mock.method(globalThis, "fetch", async (input) => {
        return new URL(input).hostname === "en.wikipedia.org"
            ? Response.json({ query: { pages: [{ pageimage: "Example.jpg" }] } })
            : commonsResult;
    });
    assert.equal(await loadDestinationPhoto("Panaji", signal), null);
    commonsResult = new Response(null, { status: 429 });
    assert.equal(await loadDestinationPhoto("Panaji", signal), null);
    commonsResult = Response.json({ query: { pages: [{ imageinfo: [{ ...photo, thumburl: "https://other.example/img.jpg" }] }] } });
    assert.equal(await loadDestinationPhoto("Panaji", signal), null);
    commonsResult = Response.json({ query: { pages: [{ imageinfo: [{ ...photo, extmetadata: {} }] }] } });
    assert.equal(await loadDestinationPhoto("Panaji", signal), null);
});

test("provides named licences for the curated destinations and rejects unsafe scene values", async () => {
    const { parseCoverScene } = await import("../supabase/functions/planzo-destination-cover/scene.ts");
    const signal = new AbortController().signal;
    for (const destination of ["Goa", "Tokyo"]) {
        const value = await loadDestinationPhoto(destination, signal);
        assert.match(value.credit, /CC BY-SA 4.0/);
        assert.equal(new URL(value.sourceUrl).hostname, "commons.wikimedia.org");
        assert.equal(new URL(value.licenseUrl).hostname, "creativecommons.org");
    }
    assert.deepEqual(parseCoverScene({ landscape: "coast", palette: "dawn", ignored: "<script>" }), {
        landscape: "coast", palette: "dawn",
    });
    assert.equal(parseCoverScene({ landscape: "<script>", palette: "dawn" }), null);
});
