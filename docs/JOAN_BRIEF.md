# Brief for Joan — MonkeyRun.com Blog Post

**Requested by:** Matt  
**For:** MonkeyRun.com  
**Topic:** Open Brain email capture project — what we built, how we built it, and what it means for the way MonkeyRun works

---

## What This Post Should Do

Tell the story of this project in MonkeyRun's voice — honest, technical-but-accessible, learning in public. Not a tutorial (Nate's guide covers that). More of a "here's what we tried, what broke, what we learned, and why it matters for how we build software."

The target reader is someone who follows MonkeyRun — curious about AI-assisted development, interested in how AI tools actually get used in a real software studio, maybe considering building something similar.

---

## The Story in a Nutshell

MonkeyRun built a persistent AI memory layer using Nate B. Jones's Open Brain architecture — a self-hosted system where AI agents can save, search, and retrieve "thoughts" using semantic vector search. The base system captures notes you type into Slack. We extended it to pull email automatically.

The interesting part isn't the feature. It's how it was built: one session, one AI agent (Dr. Brian, running in Cursor + Claude), start to finish. The agent wrote the code, hit the bugs, debugged them, wrote the documentation, built the HTML visual overview, and prepared the Substack post for Nate's community.

We're sharing everything publicly — the code, the failures, the guide — because that's how MonkeyRun learns and how we think the industry should move.

---

## Key Points to Hit

**1. What we built**
- Gmail pull script: connects to your Gmail, filters noise, chunks long emails for better AI retrieval (RAG), ingests into a vector database
- 30 days of email → 153 searchable "thoughts" → $0.02 in API costs → 8 minutes of processing
- Now when you ask an AI "what have I said about [topic]?" — your sent email is in the answer

**2. The AI-as-developer angle**
- Dr. Brian is a Cursor agent with a persistent identity and memory of the project
- He hit real bugs (Supabase schema cache, Gmail API AND/OR mismatch, CSS-heavy travel confirmations chunked into 23 fragments) and fixed them
- The hardest parts weren't the ones we anticipated — that's always true, and AI doesn't change it. It just makes the debugging faster.

**3. Learning in public**
- Everything is on GitHub: github.com/MonkeyRun-com/monkeyrun-open-brain
- Visual guide live at: https://monkeyrun-com.github.io/monkeyrun-open-brain/
- We wrote a Substack contribution for Nate B. Jones's community as a thank-you for his original architecture

**4. What this means for how MonkeyRun builds**
- Persistent AI memory changes the development loop — the agent remembers decisions, past failures, architectural constraints across sessions
- Pull-based data ingestion (email, eventually calendar and meeting transcripts) means the AI has context you never had to manually capture
- This is the infrastructure play: before you build features, build the memory

**5. What's next**
- Google Calendar ingestion (same OAuth, already planned)
- Meeting transcript ingestion via Fathom webhook
- Possibly an OpenClaw-triggered weekly sync
- Building in public — follow along at monkeyrun.com

---

## Suggested Title Options

1. "We Gave Our AI Six Months of Email. Here's What It Learned."
2. "One Session, One Agent, One Email Pipeline: How MonkeyRun Builds with AI"
3. "The $0.02 Memory Upgrade: Adding Email to Our AI Brain"
4. "What Breaks When You Let an AI Build Its Own Memory System"

---

## Tone

- MonkeyRun voice: direct, honest, a little dry, technical but not jargon-heavy
- Acknowledge what broke — that's more interesting than what worked
- Not a tutorial — point to the GitHub guide for that
- End with something forward-looking about how this changes the way the studio works

---

## Assets Available

- Full guide: `docs/EMAIL_CAPTURE_GUIDE.md` (in repo)
- Visual HTML overview: https://monkeyrun-com.github.io/monkeyrun-open-brain/
- GitHub repo: https://github.com/MonkeyRun-com/monkeyrun-open-brain
- Stats to use: 170 emails fetched, 47 filtered, 123 processed, 153 thoughts ingested, $0.02 cost, 8 minutes

---

## Call to Action

- Visit the repo and star it if you're building something similar
- Read Nate B. Jones's original Open Brain guide at natebjones.com
- Watch this space — more data sources coming
