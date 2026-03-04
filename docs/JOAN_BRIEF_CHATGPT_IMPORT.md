# Brief for Joan — MonkeyRun.com Blog Post (Chapter 2)

**Requested by:** Matt  
**For:** MonkeyRun.com  
**Topic:** Importing 3 years of ChatGPT conversations into Open Brain — what we built, how the session actually went, and what it cost

---

## Context: What Joan Should Know First

This is a sequel to the email capture post. If that one ships first, this one builds on it. If they ship together, Joan should know both stories reference the same underlying system: Open Brain — MonkeyRun's self-hosted AI memory layer built on Supabase + vector embeddings.

The email post is about pulling 30 days of email. This post is about something bigger: unlocking 3 years of ChatGPT conversations — 2,116 of them — and making them searchable.

---

## The Hook

When OpenAI lets you export your data, you get a zip file. Inside: a folder of JSON files totaling ~188MB of every conversation you've ever had with ChatGPT. For someone who's been using it since December 2022, that's years of decisions, research, personal context, business strategy, half-formed ideas — all locked in a format no AI can actually search.

The question we wanted to answer: **can we turn that archive into something Dr. Brian can retrieve on demand?**

Answer: yes. And it took one session, cost under $2, and produced a tool anyone can use.

---

## The Story Arc (for Joan to structure the post around)

### Act 1: The problem with "your data"

OpenAI gives you an export. It's 188MB of JSON across 22 files. There's a chat.html you can browse, but it's not searchable by meaning. You can't ask "what did I decide about hiring in early 2023?" You can only scroll.

This is the same problem we had with email — rich personal context, zero retrieval. The difference is scale: the ChatGPT archive contains *years* of Matt's thinking, not just 30 days.

### Act 2: We kicked it off with Claude Code Web

Matt opened the GitHub issue, described the problem in detail (archive structure, pipeline design, model strategy, CLI interface), then handed it to Claude Code's web version to build a first draft.

Claude Code Web spun up, read the issue, and produced a 596-line Python script on a new branch — `import-chatgpt.py`. It handled zip extraction, conversation filtering, LLM summarization, ingestion via the ingest-thought endpoint, progress tracking, and cost estimation.

**Time to first working draft: ~15 minutes.**

### Act 3: Dr. Brian did a code review

When Matt came back to Cursor, Dr. Brian (the Cursor agent) reviewed Claude Code's work before merging. He found 5 issues:

1. **Multi-file support was broken** — The script only looked for `conversations.json`. Real ChatGPT exports have 22 files (`conversations-000.json` through `conversations-021.json`). Without this fix, it would have silently processed 0 conversations.
2. **No `is_do_not_remember` filter** — ChatGPT has a "don't remember this" feature. The script needed to respect it.
3. **No `requirements.txt`** — Missing for open-source users.
4. **No `--report` flag** — The issue spec mentioned it; Claude Code skipped it.
5. **Hard truncation at 6,000 chars** — Minor but worth noting.

Fixed all five, merged to main. **Total review + fix time: ~20 minutes.**

### Act 4: The first live test — signal vs. noise problem

We ran it on 10 conversations. It worked — but Jared flagged something important when he checked Open Brain: the imported thoughts were too granular. Limericks. Tooth Fairy letter tips. Hotcocoa preferences.

For 2,116 conversations, that level of noise would produce thousands of low-signal thoughts that dilute search quality. The whole point of Open Brain is precision retrieval. Junk in = junk out.

**The fix:** Rewrote the LLM summarization prompt to be much stricter. New rules:

- **Capture:** Decisions and reasoning, people with context, project plans, lessons learned, business context, personal values and frameworks
- **Skip entirely:** One-off creative tasks (poems, letters, stories), generic Q&A, coding help with no lasting architectural decisions, hypothetical explorations with no conclusion

**Before the fix:** 22 thoughts from 10 conversations  
**After the fix:** 4 thoughts from 10 conversations — all high signal

We also expanded the title-based skip list (limericks, image generation, Tooth Fairy letters, translation requests).

### Act 5: Jared filed a new issue mid-run

We started the full 2,116-conversation import. At 282 conversations in, Jared filed issue #4: *Source Linking + Full-Text Storage*.

The problem: Open Brain was storing summarized thoughts but throwing away the ChatGPT conversation ID. That ID is what generates a direct backlink (`https://chatgpt.com/c/<id>`). Once a conversation is processed and marked done in the sync log, you can't go back and add the link without re-running.

Matt's call: stop the import, implement it right, re-run clean.

**What we built:**

- **Source linking** — Every thought now stores a `source_ref` object in metadata: conversation ID, direct URL, title, date. When you search Open Brain and find a thought, you see the original ChatGPT link right in the result.
- **Full-text storage** — New `full_text` column in the database. Each thought stores the distilled summary (used for vector search) *and* the complete original user messages from the conversation (retrievable on demand). This means Open Brain can tell you what you decided *and* show you the exact conversation where you decided it.
- **MCP tool update** — `search_thoughts` now surfaces the source URL in every result and supports an `include_full_text` flag.

**Database migration, two edge function deploys, script updates: ~35 minutes.**

### Act 6: The final run

Third and final run. 2,116 conversations. Every thought going in has:
- A high-signal summary (the searchable part)
- The raw original user messages (the full-text part)
- A direct URL back to the source conversation
- Metadata: type, topics, people, action items, date

Estimated time: ~90 minutes. Estimated API cost: ~$1.27.

---

## The Numbers (use these in the post)

| Metric | Value |
|--------|-------|
| Total conversations in export | 2,116 |
| Conversation files in zip | 22 (multi-file format) |
| Export size | ~188MB |
| Filter rate (trivial convs skipped) | ~40-50% estimated |
| Thoughts generated | 823 |
| Actual API cost (summarization + ingestion) | $0.32 |
| Total wall-clock time for the session | ~4 hours (including re-runs) |
| Re-runs required | 3 (first run: baseline; second: source links; third: full-text) |
| Cost per re-run decision | $0 — we stopped early each time |
| Lines of Python shipped | 730+ |
| GitHub issues opened and closed | #2 closed, #4 partially closed |

---

## The Key Insight (the "so what" of the post)

**The re-run story is the real story.**

We ran the import three times. Not because of bugs — because the product got smarter mid-session. Each time, Jared or Matt caught something that would have made the data less useful, and stopping to fix it was the right call even though it cost time.

This is what AI-assisted development actually looks like: fast iteration cycles where you can afford to throw away partial work and start clean, because the cost of a re-run is $1.27 and 90 minutes, not a sprint.

The alternative — "let's just ship what we have and fix it later" — produces a database full of low-signal limericks and no backlinks. That's the old way.

---

## Secondary Insight: Two AI agents, one session

This post has an interesting structure Joan should lean into: **two different AI systems collaborated on this**.

- **Claude Code (web)** wrote the first draft — fast, capable, shipped a working 596-line script in 15 minutes
- **Dr. Brian (Cursor agent)** reviewed it, caught the critical bugs, monitored the runs, implemented the improvements, and made the product decisions

Neither could have done it alone in the same time. Claude Code Web is fast but has no memory of the project architecture. Dr. Brian has deep project context but is slower to scaffold new code from scratch. Together: a complete session in ~4 hours.

This is what "AI-assisted team" looks like in practice.

---

## Tone Notes

Same as the email post — honest, direct, a little dry. Acknowledge the re-runs. Don't make it sound seamless; the friction is the interesting part. The tools are impressive *because* they helped navigate real complexity, not because everything worked on the first try.

---

## Suggested Title Options

1. "Three Years of ChatGPT Conversations, One AI Agent, Three Runs to Get It Right"
2. "We Imported 2,116 ChatGPT Conversations Into Our AI Brain. Here's What We Threw Away."
3. "The $1.27 Memory Migration: How We Unlocked 3 Years of ChatGPT History"
4. "Stop, Fix, Re-Run: What AI-Assisted Development Actually Looks Like"

---

## Assets Available

- GitHub repo: https://github.com/MonkeyRun-com/monkeyrun-open-brain
- Script: `scripts/import-chatgpt.py` (public, anyone can use it)
- GitHub Pages: https://monkeyrun-com.github.io/monkeyrun-open-brain/
- Import report: `scripts/chatgpt-import-report.md` (generated after the final run — will have the real thought counts)
- Related issue thread: github.com/MonkeyRun-com/monkeyrun-open-brain/issues/2

---

## Call to Action

- Download your own ChatGPT export (Settings → Data Controls → Export) and run the script
- Star the repo if you're building something similar
- Follow MonkeyRun for Chapter 3 (Google Calendar, meeting transcripts)
