import assert from "node:assert/strict"
import fs from "node:fs/promises"
const { chromium } = await import(
  process.env.PLANZO_PLAYWRIGHT_MODULE || "playwright"
)
const browser = await chromium.launch({
  channel: process.env.PLANZO_BROWSER_CHANNEL || "chrome",
  headless: true,
})
const origin = process.env.PLANZO_TEST_URL || "http://127.0.0.1:5173"
const out = process.env.PLANZO_TEST_OUTPUT || "docs/test-evidence"
await fs.mkdir(out, { recursive: true })
const results = [],
  errors = []
const context = await browser.newContext({
  viewport: { width: 1440, height: 1120 },
})
const page = await context.newPage()
page.on("pageerror", (e) => errors.push(e.message))
const mark = (name) => {
  results.push({ name, status: "pass" })
  console.log("PASS " + name)
}
const actAs = async (id) =>
  page.getByLabel("Act as demo member").selectOption(id)
const scenario = async (name) => {
  await page.getByRole("button", { name: "Scenarios", exact: true }).click()
  await page
    .locator(".card")
    .filter({ has: page.getByRole("heading", { name, exact: true }) })
    .getByRole("button", { name: "Explore scenario", exact: true })
    .click()
}
async function checkAssets(p) {
  await p.evaluate(() => document.fonts.ready)
  await p.waitForFunction(() => [...document.images].every((i) => i.complete))
  const bad = await p
    .locator("img")
    .evaluateAll((images) =>
      images
        .filter((i) => !i.naturalWidth || !i.naturalHeight)
        .map((i) => i.src),
    )
  assert.deepEqual(bad, [])
  const external = await p
    .locator("img")
    .evaluateAll((images) =>
      images
        .filter((i) => new URL(i.src).origin !== location.origin)
        .map((i) => i.src),
    )
  assert.deepEqual(external, [])
}
try {
  await page.goto(origin)
  await page
    .getByRole("heading", { name: "Make room for everyone.", exact: true })
    .waitFor()
  await checkAssets(page)
  await page.screenshot({
    path: out + "/01-welcome-desktop.png",
    fullPage: true,
  })
  mark("Welcome matches the design structure and serves local Figma assets")
  await page
    .getByRole("button", { name: "Explore the Goa sample →", exact: true })
    .click()
  await page
    .getByRole("heading", { name: "Current published plan · v1" })
    .waitFor()
  assert.equal(
    await page
      .getByRole("button", { name: "Ready to book this plan", exact: true })
      .isDisabled(),
    true,
  )
  await page.getByText("₹8,690–10,780", { exact: true }).waitFor()
  mark("Readiness waits for explicit review of the current full cost")
  await page
    .getByRole("button", { name: "My private input", exact: true })
    .click()
  await page.getByLabel("Whole-trip ceiling · INR").fill("10000")
  await page
    .getByLabel("Tell us in your own words")
    .fill("Keep this edited text for retry.")
  await page
    .getByRole("button", { name: "Test save retry", exact: true })
    .click()
  await page.getByRole("button", { name: "Save draft", exact: true }).click()
  await page
    .getByRole("alert")
    .filter({ hasText: "Simulated save failure" })
    .waitFor()
  assert.equal(
    await page.getByLabel("Tell us in your own words").inputValue(),
    "Keep this edited text for retry.",
  )
  await page.getByRole("button", { name: "Save draft", exact: true }).click()
  await page.reload()
  assert.equal(
    await page.getByLabel("Whole-trip ceiling · INR").inputValue(),
    "10000",
  )
  assert.equal(
    await page.getByLabel("Tell us in your own words").inputValue(),
    "Keep this edited text for retry.",
  )
  mark("Edited forms survive a failed save, retry and reload")
  await page
    .getByLabel(
      "I checked the structured dates, whole-trip ceiling and requirements.",
    )
    .check()
  await page
    .getByRole("button", { name: "Confirm my private input", exact: true })
    .click()
  await page
    .getByRole("button", { name: "Explore this draft", exact: true })
    .first()
    .waitFor()
  assert.equal(
    await page
      .getByRole("button", { name: "Explore this draft", exact: true })
      .first()
      .isDisabled(),
    true,
  )
  mark("Unaffordable proposals are blocked after input changes")
  await scenario("Headcount changed")
  await page
    .getByRole("button", { name: "My private input", exact: true })
    .waitFor()
  await page.getByRole("button", { name: "Scenarios", exact: true }).waitFor()
  await page.goto(origin + "/#/costs")
  await page.getByText("₹9,240–11,462", { exact: true }).waitFor()
  mark("Five travellers are repriced using three rooms and fixed transport")
  await scenario("Plan changed")
  await page
    .getByText("Your earlier response is historical", { exact: true })
    .waitFor()
  assert.equal(
    await page
      .getByRole("button", { name: "Ready to book this plan", exact: true })
      .isDisabled(),
    true,
  )
  await actAs("sample-0")
  await page
    .getByRole("button", {
      name: "Revalidate & publish a fresh version",
      exact: true,
    })
    .click()
  await page
    .getByRole("heading", { name: "Current published plan · v2" })
    .waitFor()
  assert.equal(
    await page
      .getByRole("button", { name: "Ready to book this plan", exact: true })
      .isDisabled(),
    true,
  )
  mark(
    "A material edit invalidates readiness and creates a fresh review version",
  )
  await scenario("Five of six ready")
  assert.equal(
    await page
      .getByRole("button", { name: "Close this decision round", exact: true })
      .isDisabled(),
    true,
  )
  await page
    .getByRole("button", { name: "Fill pending sample readiness", exact: true })
    .click()
  await page
    .getByRole("button", { name: "Close this decision round", exact: true })
    .click()
  await page
    .getByRole("heading", { name: "Itinerary agreed · bookings pending" })
    .waitFor()
  mark(
    "Agreement requires six current explicit responses, including the organiser",
  )
  await page
    .getByRole("button", { name: "Prepare booking handoff", exact: true })
    .click()
  await page
    .getByRole("button", { name: "View task", exact: true })
    .first()
    .click()
  await page
    .getByRole("button", { name: "Mark booking as reported", exact: true })
    .click()
  await page
    .getByText("Booking reported · self-reported", { exact: true })
    .waitFor()
  await page.reload()
  assert.ok(await page.getByText("Booking reported", { exact: true }).count())
  mark("Booking reports persist and remain distinct from verified reservations")
  await page
    .getByRole("button", { name: "Compare booking providers", exact: true })
    .click()
  await page
    .getByRole("heading", { name: "Return travel · compare example offers" })
    .waitFor()
  assert.ok(
    await page
      .getByRole("link", { name: "Open provider search ↗", exact: true })
      .count(),
  )
  for (const name of [
    "Stay",
    "Local travel",
    "Food",
    "Activities",
    "Return travel",
  ]) {
    await page.getByRole("button", { name, exact: true }).click()
    await page
      .getByRole("heading", { name: name + " · compare example offers" })
      .waitFor()
  }
  await checkAssets(page)
  await page.screenshot({
    path: out + "/02-comparisons-desktop.png",
    fullPage: true,
  })
  mark(
    "All five provider categories work and external links keep local task state unchanged",
  )
  await scenario("Build day by day")
  await actAs("sample-0")
  await page
    .locator(".card")
    .filter({
      has: page.getByRole("heading", { name: "Return travel", exact: true }),
    })
    .getByRole("button", { name: "Compare options & vote", exact: true })
    .click()
  await page
    .getByRole("button", { name: "Open a fresh item poll", exact: true })
    .click()
  for (let i = 0; i < 6; i++) {
    await actAs("sample-" + i)
    await page
      .getByRole("button", { name: /Vote for this option/ })
      .nth(1)
      .click()
  }
  await actAs("sample-0")
  await page.getByRole("button", { name: "Close poll", exact: true }).click()
  await page.goto(origin + "/#/costs")
  await page.getByText("₹8,360–10,450", { exact: true }).waitFor()
  mark(
    "Item votes persist, close under the stated rule and update the actual complete cost",
  )
  const fresh = await browser.newContext({
    viewport: { width: 1440, height: 1120 },
  })
  const p = await fresh.newPage()
  p.on("pageerror", (e) => errors.push(e.message))
  await p.goto(origin)
  await p.getByRole("button", { name: "Create a trip", exact: true }).click()
  await p.getByLabel("Your name", { exact: true }).fill("Test organiser")
  await p
    .getByLabel("Email address", { exact: true })
    .fill("organiser@example.com")
  await p
    .getByLabel("Password · visual demo field", { exact: true })
    .fill("not-stored-password")
  await p
    .getByRole("button", { name: "Create demo account", exact: true })
    .click()
  await p
    .getByLabel("Group / trip name", { exact: true })
    .fill("Friends in Goa")
  await p.getByRole("button", { name: "Create trip", exact: true }).click()
  await p.getByLabel("Invitation link", { exact: true }).waitFor()
  const link = await p
    .getByLabel("Invitation link", { exact: true })
    .inputValue()
  const guest = await fresh.newPage()
  await guest.goto(link)
  await guest.getByLabel("Your name", { exact: true }).fill("Guest traveller")
  await guest
    .getByRole("button", { name: "Join as guest", exact: true })
    .click()
  await guest
    .getByRole("heading", { name: "My private brief", exact: true })
    .waitFor()
  assert.equal(
    await guest.getByLabel("Whole-trip ceiling · INR").inputValue(),
    "11000",
  )
  const saved = await guest.evaluate(() =>
    localStorage.getItem("planzo.demo.v1"),
  )
  assert.equal(saved.includes("not-stored-password"), false)
  mark(
    "New organisers create a trip; invited guests join without signup; password fields are never stored",
  )
  await fresh.close()
  const mobile = await browser.newContext({
    viewport: { width: 390, height: 844 },
    isMobile: true,
    deviceScaleFactor: 1,
  })
  const m = await mobile.newPage()
  m.on("pageerror", (e) => errors.push(e.message))
  await m.goto(origin)
  await checkAssets(m)
  await m.screenshot({ path: out + "/03-welcome-mobile.png", fullPage: true })
  assert.ok(
    await m.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
  )
  await m
    .getByRole("button", { name: "Explore the Goa sample →", exact: true })
    .click()
  await m
    .getByRole("heading", { name: "Current published plan · v1" })
    .waitFor()
  assert.ok(
    await m.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
  )
  const mobilePrice = await m
    .getByText("₹8,690–10,780", { exact: true })
    .boundingBox()
  const mobileReady = await m
    .getByRole("button", { name: "Ready to book this plan", exact: true })
    .boundingBox()
  assert.ok(mobilePrice.y < mobileReady.y)
  await m.screenshot({ path: out + "/04-review-mobile.png", fullPage: true })
  await m
    .getByRole("button", { name: "Toggle navigation", exact: true })
    .click()
  await m.getByRole("button", { name: "My private input", exact: true }).click()
  await m
    .getByRole("heading", { name: "My private brief", exact: true })
    .waitFor()
  assert.ok(
    await m.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
  )
  await m.screenshot({
    path: out + "/05-preferences-mobile.png",
    fullPage: true,
  })
  await checkAssets(m)
  mark(
    "390px welcome, review and preference screens scroll without horizontal overflow",
  )
  await mobile.close()
  assert.deepEqual(errors, [])
  mark("No uncaught browser errors in the tested desktop and mobile journeys")
  await fs.writeFile(
    out + "/browser-results.json",
    JSON.stringify(
      { date: new Date().toISOString(), results, errors },
      null,
      2,
    ),
  )
} catch (error) {
  console.error(error)
  await page.screenshot({ path: out + "/failure.png", fullPage: true })
  await fs.writeFile(
    out + "/browser-results.json",
    JSON.stringify(
      {
        date: new Date().toISOString(),
        results,
        errors,
        failure: String(error),
      },
      null,
      2,
    ),
  )
  process.exitCode = 1
} finally {
  await browser.close()
}
