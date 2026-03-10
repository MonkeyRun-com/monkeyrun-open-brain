# Meeting Debrief: Jonathan Edwards — March 10, 2026

> Raw transcript: TRANSCRIPT-JONATHAN-2026-03-10.txt
> Duration: ~1hr 15min | Tone: Excellent — high energy, instant rapport

---

## TL;DR

The project is real, imminent, and Matt has a confirmed role. GitHub repo launches **before March 12** (possibly pushed to Mon/Tue). Matt is offered **first Admin** on the repo. Contribution standards need to be defined this week. The brand name **OB1 / Obi-Wan** was coined by Claude during the call and both Matt and Jonathan loved it.

---

## The Team (what we now know)

| Person | Role |
|---|---|
| **Nate Jones** | Founder/thought leader. Seattle. Getting thousands of subscribers/day. Has multiple parallel projects. |
| **Jonathan Edwards** | Content/community/resources. Signed NDA. Business partner with Nate on **AI CRED** (registered in Delaware). Contributes prompt kits, guides, tools. Basically Nate's right-hand creative. |
| **Caleb** | Developer on Nate's team. Does website work. Being assigned an issue to build an OB1 page. |
| **Adrian** | Another team member (Jonathan assigned a Linear issue to them about the publish date). |
| **Matt** | Offered first Admin on the GitHub. Contribution standards + community stewardship. Product management + evangelist role. |

**Key insight:** Jonathan is NOT just a community member — he's Nate's collaborator. He built Content Master Pro that Nate's whole team runs on. AI CRED is a registered Delaware entity. This is a real operation.

---

## Timeline (URGENT)

- **Now → March 12:** GitHub repo needs to be live and tested
- **March 12 (or moved to Mon/Tue):** "Open Brain 2 / Electric Boogaloo" Substack post goes live — introduces extensions concept + GitHub
- **Before March 12:** "Your Open Brain Has a Heartbeat" post (loop integration)
- **March 12 (Thursday):** Team standup — Jonathan will bring Matt's input
- **Next few weeks/months:** Jonathan flying to Seattle to help set up Nate's recording studio

---

## Confirmed Repo Structure

Four top-level directories, each a different contribution type:

- **`/recipes`** — Step-by-step builds on top of Open Brain (Matt's email loader + ChatGPT import are natural fits here)
- **`/schemas`** — Custom metadata/table extensions (taste preferences table, CRM contact schema)
- **`/dashboards`** — Frontend templates on top of Open Brain data (personal dashboards, family calendars on Vercel)
- **`/integrations`** — MCP server extensions, webhook receivers, new capture sources

**Contribution rules drafted in-call:**
- Every contribution lives in exactly one of the four directories
- Each contribution is a single subfolder
- Must contain a README (auto-rejected without)
- Must contain `metadata.json`

---

## Matt's Role (Confirmed)

- **First Admin on the GitHub**
- Help define contribution standards
- Community stewardship + PR quality control (not heavy coding — more product management)
- Jonathan specifically said: *"Your product management background is exactly right for this"*
- Matt's response: All in. 4-8 hrs/day, 7 days/week (probably more)

---

## OB1 / Obi-Wan Brand Origin

Claude (Jonathan's Claude) started calling Open Brain "Obi-Wan" organically because there's an Open Brain 2 post coming. Jonathan mentioned it. Matt immediately said "OB1. Why not?" Both loved it on the spot. Jonathan then asked Claude to create a Linear issue for Caleb to build an OB1 page on Nate's website.

**OB1 is now the working name.** Jonathan confirmed Nate has greenlit the community GitHub concept.

---

## Key Ideas Brainstormed (worth capturing)

1. **Auto-generated explainer videos for extensions** — Require contributors to submit a script explaining their extension → auto-convert via Remotion + ElevenLabs → every extension gets a video. Jonathan's pipeline: Claude Code + Remotion + 11 Labs. Already working.

2. **Open Brain for Open Brain** — A community sentiment/insight tracker. Discord noise → structured knowledge about what community wants. "There should be an Open Brain for the Open Brain community."

3. **PR review agent** — Agent reviews PRs against intent engineering principles. Nate's vision as the system prompt. Catches architectural drift before human review.

4. **First GitHub repo targeted at non-developers** — Jonathan's framing: *"I've never heard of a GitHub repo targeted at people who don't know what GitHub is. This is the first."* This is the positioning.

5. **"Open Brain becomes a verb"** — The north star. Like Google, Slack, Zoom.

6. **"Clone Me" folder** — Jonathan's idea: a documented folder in his repo capturing his full video workflow so others can replicate it. Mini side repo.

---

## Jonathan's Secret Weapon (relevant for OB1)

Jonathan runs Claude Code **headlessly on a Mac mini** connected to his server. It monitors Telegram every X minutes as a cron job. He texts it requests and it runs workflows autonomously — including generating explainer videos via:

- **Remotion** — React-based video generation (all code, no generative AI for visuals)
- **ElevenLabs** — Voice synthesis with character-level timestamps
- **Claude Code** — Orchestration layer

He's planning to clone Nate's voice in 11 Labs for future video content. No generative AI for visuals — everything is code/React components. Fast iteration, no token burn on re-renders.

---

## NDA Notes

Jonathan mentioned he "said a little too much" and would edit the transcript. Matt confirmed they'd keep it between them. The NDA covers Nate's team details and what's being planned. Do not share team structure details publicly. This is background context only.

---

## Action Items for Matt

### URGENT (this week, before March 12)
- [ ] Confirm GitHub admin access with Jonathan (email: jon@contentionmedia.com)
- [ ] Port email history loader and ChatGPT import to repo `/recipes` format
- [ ] Draft contribution standards doc (README + metadata.json requirements, folder structure rules)

### This Week
- [ ] Research: best practices for community OSS GitHub launch
- [ ] Research: Discord setup for OSS communities (bots, moderation, insight capture)
- [ ] Propose OB1 Discord structure to Jonathan with agent integration ideas
- [ ] Research open source legal structures (MIT license enough? LLC? Foundation?)

### Soon
- [ ] Reach out to Nate directly — he's in Seattle. Mutual colleagues at the incubator know him. Also: Jonathan is flying to Seattle in coming weeks. That's an intro opportunity.
- [ ] Think through OB1 branding hierarchy: Open Brain (technical) → OB1 (product/brand) → Obi-Wan (community term of endearment)

---

## Things to Research for Thursday Standup Input

Jonathan said he can bring Matt's input to the Thursday March 12 standup. Prepare:
1. Proposed contribution standards (the 4-folder model + metadata requirements)
2. Discord structure proposal
3. Matt's extensions ready to submit as seed contributions
4. OB1 community launch playbook outline
