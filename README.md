# Progress Ledger

A daily learning progress tracker: add tasks, check them off, watch a live completion ring, and see day/week/month trend graphs. Data is stored as `data/stored.json`, committed directly into this GitHub repo by the server — so it survives restarts, redeploys, and Render's free-tier spin-down.

## How it works

- `public/index.html`, `public/styles.css`, `public/main.js` — the frontend. Talks only to your own server via `fetch("/api/data")`, never to GitHub directly.
- `server.js` — a small Express server. Reads/writes `data/stored.json` in this repo using GitHub's Contents API. Writes are debounced by 3 seconds so rapid changes collapse into one commit instead of spamming your history.
- Every night, when the date changes, the app archives that day's finishing percentage into `history` and clears `tasks` for the new day — no manual reset needed.

## Deploying on Render

### 1. Push this repo to GitHub
If you haven't already: create a new repo on GitHub, then from this folder:
```
git init
git add .
git commit -m "Initial commit"
git remote add origin https://github.com/YOUR_USERNAME/YOUR_REPO.git
git push -u origin main
```

### 2. Create a GitHub Personal Access Token
1. GitHub → your profile picture → **Settings** → **Developer settings** → **Personal access tokens** → **Fine-grained tokens** → **Generate new token**
2. Token name: anything, e.g. `progress-ledger-render`
3. Expiration: **No expiration** (or the longest option available)
4. Repository access: **Only select repositories** → pick this repo
5. Permissions → Repository permissions → **Contents** → set to **Read and write**
6. Click **Generate token** and **copy it immediately** — GitHub only shows it once

**Never paste this token into a chat, issue, commit, or anywhere public.** If it's ever exposed, delete it from GitHub immediately and generate a new one.

### 3. Create the Web Service on Render
1. render.com → **New +** → **Web Service** → connect this repo
2. Build Command: `npm install`
3. Start Command: `npm start`

### 4. Set environment variables
In the service's **Environment** tab, add:

| Key | Value |
|---|---|
| `GITHUB_TOKEN` | the token from step 2 |
| `GITHUB_OWNER` | your GitHub username |
| `GITHUB_REPO` | this repo's name |

Optional (defaults shown):
| Key | Default |
|---|---|
| `GITHUB_BRANCH` | `main` |
| `GITHUB_FILE_PATH` | `data/stored.json` |

Click **Save, rebuild, and deploy**.

### 5. Confirm it worked
Check the **Logs** tab for:
```
Progress Ledger running at http://localhost:...
Data is stored at YOUR_USERNAME/YOUR_REPO/data/stored.json (branch: main)
```
If instead you see `Missing GitHub config`, one of the three required environment variables isn't set — double check for typos and that you clicked Save.

Then open your live URL, add a task, check it off, wait ~3 seconds, and check your repo on GitHub — a new commit with `data/stored.json` should appear.

## Notes on the free tier
- Render's free web service spins down after 15 minutes idle and takes ~30-60s to wake back up on the next visit. Your data is safe either way since it lives in GitHub, not on the server's disk.
- Every save eventually becomes a real commit to this repo (e.g. "Update progress ledger — 2026-08-07T..."). That's expected — it's how the data persists.
