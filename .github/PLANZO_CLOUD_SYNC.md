# Planzo cloud publishing setup

This GitHub Actions workflow runs independently of a laptop. Its scheduled window is 21 October–19 November 2026 at approximately 10:00 AM IST. GitHub can delay a scheduled run, so 10:00 AM is the requested start time rather than a guaranteed completion time.

On each run it exports the existing [Figma Make project](https://www.figma.com/make/4tPr5AkQO1g0L1esRvGRjz/Planzo-%E2%80%94-Working-Prototype), compares source code with the last successful sync, and stops if unchanged. When changed, it checks the exported app, asks an AI reviewer whether the user flow changed substantially, updates the README only if needed, clicks **Update** in Make's Publish dialog for [the existing Figma Site](https://person-siren-40913121.figma.site), and pushes the Make source to `main`. The Figma Make GitHub menu was disabled during setup, so this workflow uses Make's **Download code** export and a normal GitHub push.

## One-time setup

1. Create a revocable Figma browser session for this specific Make file on this Mac. From the repository folder, run:

   ```sh
   node scripts/capture_figma_session.cjs
   ```

   Sign in yourself in the browser opened by the script. The script verifies that the Planzo Make file and its Publish button are accessible, then prints the path to a temporary private session file. Do not commit or share that file.

2. In the repository's **Settings → Secrets and variables → Actions**, create repository secret `FIGMA_STORAGE_STATE_B64` with the complete contents of that file. Delete the local secret file after saving it. This session grants the cloud runner the same Figma access as the signed-in account until it expires or is revoked.
3. In [Google AI Studio](https://aistudio.google.com/api-keys), create a **Free Tier** Gemini API key without enabling billing. In the same GitHub Actions secrets page, create repository secret `GEMINI_API_KEY` with that key. The workflow uses Gemini 3.6 Flash only when Make code changes, to decide whether the README needs a substantial user-flow correction and to write that correction. Google's free tier may use submitted code and README content to improve its products. Free tier quotas can change or be exhausted; if the review fails, the workflow stops before publication or push.
4. In **Actions → Publish Planzo from Figma Make → Run workflow**, run the default **dry-run** mode. It checks Figma access, exports the code, runs the app's type checks, tests, and build if the source is new, reviews the README condition, and opens the existing site's Publish dialog to verify the controls. It does not publish or push.
5. After the dry run passes, the scheduled run is ready. The first scheduled run intentionally establishes a publication baseline, because the Make source already differs from the repository and the site's last published version predates those changes.

The workflow never writes a Figma password or session into source control or logs. A Figma session can still expire; repeat step 1 and replace `FIGMA_STORAGE_STATE_B64` when access fails. Anyone with permission to edit this repository's Actions workflow could cause it to use the session or Gemini API key, so limit workflow write access.

The prior Codex desktop schedule is paused so it will not duplicate the cloud run. The first actual publication and GitHub push are scheduled for October 21; the dry run verifies access and controls without publishing.
