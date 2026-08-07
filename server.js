const express = require("express");
const path = require("path");

const app = express();
const PORT = process.env.PORT || 3000;

/*
 * Storage: this app now writes stored.json directly into your GitHub repo,
 * using GitHub's Contents API, instead of a database or local disk. Every
 * save becomes a real commit you can see in your repo's history.
 *
 * Required environment variables (set these in Render's Environment tab):
 *   GITHUB_TOKEN  - a GitHub Personal Access Token with "repo" scope
 *   GITHUB_OWNER  - your GitHub username or org, e.g. "janedoe"
 *   GITHUB_REPO   - the repo name, e.g. "progress-ledger"
 * Optional:
 *   GITHUB_BRANCH   - defaults to "main"
 *   GITHUB_FILE_PATH - defaults to "data/stored.json"
 */
const { GITHUB_TOKEN, GITHUB_OWNER, GITHUB_REPO } = process.env;
const GITHUB_BRANCH = process.env.GITHUB_BRANCH || "main";
const GITHUB_FILE_PATH = process.env.GITHUB_FILE_PATH || "data/stored.json";

if (!GITHUB_TOKEN || !GITHUB_OWNER || !GITHUB_REPO) {
  console.error(
    "Missing GitHub config. Set GITHUB_TOKEN, GITHUB_OWNER, and GITHUB_REPO " +
      "as environment variables (in Render: Environment tab)."
  );
  process.exit(1);
}

const API_BASE = `https://api.github.com/repos/${GITHUB_OWNER}/${GITHUB_REPO}/contents/${GITHUB_FILE_PATH}`;
const GH_HEADERS = {
  Authorization: `Bearer ${GITHUB_TOKEN}`,
  Accept: "application/vnd.github+json",
  "User-Agent": "progress-ledger-app",
};

const DEFAULT_STATE = () => {
  const d = new Date();
  const today = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  return { startDate: today, currentDate: today, tasks: [], history: {} };
};

// Fetch the current file (content + sha). sha is required by GitHub to update
// an existing file — it's how the API prevents accidentally clobbering
// someone else's concurrent edit. Returns { data, sha } or { data, sha: null }
// if the file doesn't exist yet.
async function readFromGitHub() {
  const res = await fetch(`${API_BASE}?ref=${GITHUB_BRANCH}`, { headers: GH_HEADERS });

  if (res.status === 404) {
    return { data: DEFAULT_STATE(), sha: null };
  }
  if (!res.ok) {
    throw new Error(`GitHub GET failed: ${res.status} ${await res.text()}`);
  }

  const json = await res.json();
  const decoded = Buffer.from(json.content, "base64").toString("utf-8");
  return { data: JSON.parse(decoded), sha: json.sha };
}

// Commit new content to the file. Always re-reads the current sha right
// before writing, so this is safe even if something else changed the file
// in between (e.g. you editing it by hand on GitHub).
async function writeToGitHub(newState) {
  const { sha } = await readFromGitHub().catch(() => ({ sha: null }));

  const body = {
    message: `Update progress ledger — ${new Date().toISOString()}`,
    content: Buffer.from(JSON.stringify(newState, null, 2)).toString("base64"),
    branch: GITHUB_BRANCH,
  };
  if (sha) body.sha = sha;

  const res = await fetch(API_BASE, {
    method: "PUT",
    headers: { ...GH_HEADERS, "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    throw new Error(`GitHub PUT failed: ${res.status} ${await res.text()}`);
  }
}

app.use(express.json());
app.use(express.static(path.join(__dirname, "public")));

app.get("/api/data", async (req, res) => {
  try {
    const { data } = await readFromGitHub();
    res.json(data);
  } catch (err) {
    console.error("Failed to read from GitHub:", err);
    res.status(500).json({ error: "Could not read ledger data from GitHub" });
  }
});

// Debounce writes: rapid successive saves (e.g. checking off several tasks
// quickly) collapse into a single commit a couple seconds later, instead of
// spamming one commit per click.
const DEBOUNCE_MS = 3000;
let pendingState = null;
let debounceTimer = null;
let flushPromise = Promise.resolve();

function scheduleCommit(state) {
  pendingState = state;
  if (debounceTimer) clearTimeout(debounceTimer);
  debounceTimer = setTimeout(() => {
    const toCommit = pendingState;
    pendingState = null;
    flushPromise = flushPromise
      .then(() => writeToGitHub(toCommit))
      .catch((err) => console.error("Failed to commit ledger to GitHub:", err));
  }, DEBOUNCE_MS);
}

app.post("/api/data", (req, res) => {
  scheduleCommit(req.body);
  res.json({ ok: true, note: `Will commit to GitHub within ${DEBOUNCE_MS / 1000}s` });
});

app.listen(PORT, () => {
  console.log(`Progress Ledger running at http://localhost:${PORT}`);
  console.log(`Data is stored at ${GITHUB_OWNER}/${GITHUB_REPO}/${GITHUB_FILE_PATH} (branch: ${GITHUB_BRANCH})`);
});
