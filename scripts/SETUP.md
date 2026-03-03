# Gmail Pull Script — Setup

Local script that fetches emails from Gmail and feeds them into Open Brain.

## Prerequisites

- [Deno](https://deno.com) installed (`brew install deno` on Mac)
- A Google account with Gmail
- Your Open Brain `ingest-thought` endpoint URL and key

## Step 1: Create Google Cloud OAuth Credentials

1. Go to [Google Cloud Console](https://console.cloud.google.com/)
2. Create a new project (or select an existing one)
3. Enable the **Gmail API**: [Enable here](https://console.cloud.google.com/apis/library/gmail.googleapis.com)
4. Go to **APIs & Services > OAuth consent screen**
   - Choose "External" user type
   - Fill in app name (e.g., "Open Brain Gmail"), your email for support/developer contact
   - Add scope: `https://www.googleapis.com/auth/gmail.readonly`
   - Add your Gmail address as a test user
   - Save
5. Go to **APIs & Services > Credentials**
   - Click **Create Credentials > OAuth client ID**
   - Application type: **Desktop app**
   - Name: "Open Brain"
   - Click **Create**
   - Click **Download JSON**
   - Save the file as `scripts/credentials.json` in this project

The redirect URI `http://localhost:3847/callback` is used automatically by the script.

## Step 2: Set Environment Variables

```bash
export INGEST_URL="https://YOUR_PROJECT_REF.supabase.co/functions/v1/ingest-thought"
export INGEST_KEY="your-ingest-key"
```

These are only needed for live ingestion (not for `--dry-run`).

## Step 3: Run the Script

### First Run (Authorization)

```bash
deno run --allow-net --allow-read --allow-write --allow-env scripts/pull-gmail.ts --dry-run --window=24h
```

This will:
1. Open a URL in your terminal — copy it into your browser
2. Authorize with Google (you'll see a consent screen)
3. Redirect back to `localhost:3847/callback` — the script catches this automatically
4. Save `token.json` for future runs (no re-auth needed)

### Explore Your Labels

```bash
deno run --allow-net --allow-read --allow-write --allow-env scripts/pull-gmail.ts --list-labels
```

### Dry Run (See What Would Be Captured)

```bash
# Last 24 hours of sent emails
deno run --allow-net --allow-read --allow-write --allow-env scripts/pull-gmail.ts --dry-run --window=24h --labels=SENT

# Last week of sent + starred
deno run --allow-net --allow-read --allow-write --allow-env scripts/pull-gmail.ts --dry-run --window=7d --labels=SENT,STARRED

# Last 30 days, limit to 20 emails
deno run --allow-net --allow-read --allow-write --allow-env scripts/pull-gmail.ts --dry-run --window=30d --limit=20
```

### Live Ingestion

```bash
# Start small: last 24 hours of sent mail
deno run --allow-net --allow-read --allow-write --allow-env scripts/pull-gmail.ts --window=24h --labels=SENT

# Scale up incrementally
deno run --allow-net --allow-read --allow-write --allow-env scripts/pull-gmail.ts --window=7d --labels=SENT,STARRED
deno run --allow-net --allow-read --allow-write --allow-env scripts/pull-gmail.ts --window=30d --labels=SENT,STARRED
```

## Options Reference

| Flag | Default | Description |
|------|---------|-------------|
| `--window=` | `24h` | Time window: `24h`, `7d`, `30d`, `1y`, `all` |
| `--labels=` | `SENT` | Comma-separated Gmail label IDs |
| `--dry-run` | off | Show what would be captured without ingesting |
| `--limit=` | `50` | Max emails to process |
| `--list-labels` | off | List all Gmail labels and exit |

## Common Label IDs

| Label | Description |
|-------|-------------|
| `SENT` | Your sent emails (highest signal) |
| `STARRED` | Emails you starred |
| `IMPORTANT` | Gmail's auto-importance marking |
| `INBOX` | Your inbox |
| `CATEGORY_PERSONAL` | Gmail's "Primary" tab |
| `CATEGORY_PROMOTIONS` | Marketing emails (skip these) |
| `CATEGORY_SOCIAL` | Social notifications (skip these) |
| `CATEGORY_UPDATES` | Automated updates (skip these) |

You can also use custom label names. Run `--list-labels` to see all available labels in your account.

## Files Created

- `scripts/credentials.json` — Your Google OAuth credentials (gitignored)
- `scripts/token.json` — Your access/refresh tokens (gitignored, auto-created on first auth)

## Cost Estimates

| Window | Typical Volume | Est. Cost |
|--------|---------------|-----------|
| 24 hours | 5-20 emails | ~$0.01 |
| 7 days | 30-100 emails | ~$0.05 |
| 30 days | 100-500 emails | ~$0.20 |
| 1 year | 1,000-5,000 emails | ~$2.00 |

Costs are for embedding (text-embedding-3-small) + metadata extraction (gpt-4o-mini) via OpenRouter.
