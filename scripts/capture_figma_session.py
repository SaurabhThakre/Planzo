#!/usr/bin/env python3
"""One-time, user-operated Figma sign-in for the Planzo cloud sync."""

import base64
import gzip
import json
from pathlib import Path

from playwright.sync_api import sync_playwright


MAKE_URL = "https://www.figma.com/make/4tPr5AkQO1g0L1esRvGRjz/Planzo-%E2%80%94-Working-Prototype"
SECRET_PATH = Path.home() / ".config" / "planzo-cloud-sync" / "figma-session-secret.txt"


def main() -> None:
    with sync_playwright() as playwright:
        browser = playwright.chromium.launch(headless=False)
        context = browser.new_context()
        page = context.new_page()
        page.goto(MAKE_URL, wait_until="domcontentloaded")
        input("Sign in to Figma in the opened browser, confirm the Planzo Make file is open, then press Return here. ")
        page.get_by_role("button", name="Publish", exact=True).wait_for(timeout=30_000)
        state = context.storage_state(indexed_db=True)
        test_context = browser.new_context(storage_state=state)
        test_page = test_context.new_page()
        test_page.goto(MAKE_URL, wait_until="domcontentloaded")
        test_page.get_by_role("button", name="Publish", exact=True).wait_for(timeout=30_000)
        test_context.close()
        browser.close()

    encoded = base64.b64encode(gzip.compress(json.dumps(state).encode("utf-8"))).decode("ascii")
    if len(encoded.encode("ascii")) > 48_000:
        raise RuntimeError("Figma session exceeds GitHub's repository secret limit")
    SECRET_PATH.parent.mkdir(parents=True, exist_ok=True)
    SECRET_PATH.write_text(encoded)
    SECRET_PATH.chmod(0o600)
    print(f"Saved the revocable session secret to {SECRET_PATH} ({len(encoded)} characters).")
    print("Add its contents as the FIGMA_STORAGE_STATE_B64 repository Actions secret, then delete this local file.")


if __name__ == "__main__":
    main()
