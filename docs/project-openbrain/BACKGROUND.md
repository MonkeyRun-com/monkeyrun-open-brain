# Project OpenBrain — Background

> Last updated: 2026-03-10

## What Is Open Brain?

Open Brain is a personal knowledge/memory layer for AI agents — a semantic store that captures thoughts, decisions, context, and history from across an individual's digital life and makes it retrievable by AI systems via the Model Context Protocol (MCP).

The core idea: AI agents are stateless by default. Open Brain gives them persistent, searchable memory tied to a specific person — functioning as a "source of truth" for everything an agent needs to know about its user.

## The Nate B Jones Connection

Open Brain originated as a concept developed and popularized by **Nate B Jones** on Substack. Nate's writing attracted a highly engaged community of builders and creatives who rallied around the idea. The project has been building momentum in the Substack community with active discussion threads, user implementations, and growing interest in formalizing it as an open source project.

Matt has been a technical implementer and blogger about Open Brain, contributing working code while remaining heads-down on MonkeyRun projects. Others — notably Jonathan Edwards — have been more active in community management and advocacy during this period.

## The Jonathan Edwards Situation

**Jonathan Edwards** ("Limited Edition Jonathon") is:
- A videographer and aerial cinematographer based in Wilkes-Barre, PA
- Founder of NEPACC (900+ member creative community in Northeast Pennsylvania)
- An active community participant and advocate in Nate's Substack community
- Anti-ChatGPT/Sam Altman in his public commentary
- Contact: jon@contentionmedia.com | contentionmedia.com | vimeo.com/570drone

Jonathan received an early NDA from whoever is formalizing the Open Brain project — likely because of his active community involvement and advocacy. He reached out to Matt to share what he knows ("show me something cool"), positioning himself as a connector between Matt and the project formation team.

Jonathan is a content/community asset, not a technical contributor. His lane: video, creative community, content strategy.

## What's Being Formed (Likely)

Based on the NDA + meeting setup, the project is likely transitioning from:
- Nate's Substack concept → formal GitHub organization
- Community-driven → structured open source project with governance
- Informal → possibly backed (foundation, VC, or corporate sponsor)

The formal structure is unknown until after the meeting, but the NDA suggests pre-public plans are in motion.

## Matt's Open Brain Implementation

Matt built and runs a production Open Brain MCP server as part of MonkeyRun infrastructure:

- **Repo:** `MonkeyRun-com/monkeyrun-open-brain`
- **Stack:** Supabase pgvector + Edge Functions/Deno
- **Supabase ref:** `piigyjxxzrivwvupefsc`
- **Tools:** `capture_thought`, `search_thoughts`, `list_thoughts`, `thought_stats`
- **Scale:** 1,449+ thoughts captured (includes full ChatGPT history import)
- **MCP clients connected:** Claude Code, Cursor, ChatGPT, OpenClaw, Claude Desktop
- **Daily sync:** Automated 3AM cron job pushing daily notes → Open Brain
- **GitHub stars:** 7 organic (no marketing)
- **Blog coverage:** monkeyrun.com

This is not a toy project — it's a running production system that Matt actively depends on for his own AI agent workflows.
