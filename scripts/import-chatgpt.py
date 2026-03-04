#!/usr/bin/env python3
"""
Open Brain — ChatGPT Export Importer

Extracts conversations from a ChatGPT data export zip, filters trivial ones,
summarizes each into 1-3 distilled thoughts via LLM, and ingests them into
Open Brain through the ingest-thought endpoint.

Usage:
    python scripts/import-chatgpt.py path/to/export.zip [options]

Options:
    --dry-run              Parse, filter, summarize, but don't ingest
    --after YYYY-MM-DD     Only conversations created after this date
    --before YYYY-MM-DD    Only conversations created before this date
    --limit N              Max conversations to process
    --model openrouter     LLM backend: openrouter (default) or ollama
    --ollama-model NAME    Ollama model name (default: qwen3)
    --raw                  Skip summarization, ingest user messages directly
    --verbose              Show full summaries during processing

Environment variables:
    INGEST_URL             ingest-thought endpoint URL (required for live mode)
    INGEST_KEY             Auth key for ingest-thought endpoint (required for live mode)
    OPENROUTER_API_KEY     OpenRouter API key (required for summarization with openrouter)
"""

import argparse
import hashlib
import json
import os
import re
import sys
import time
import zipfile
from datetime import datetime, timezone
from pathlib import Path

# ─── Configuration ───────────────────────────────────────────────────────────

SCRIPT_DIR = Path(__file__).parent
SYNC_LOG_PATH = SCRIPT_DIR / "chatgpt-sync-log.json"

OPENROUTER_BASE = "https://openrouter.ai/api/v1"
OLLAMA_BASE = "http://localhost:11434"

INGEST_URL = os.environ.get("INGEST_URL", "")
INGEST_KEY = os.environ.get("INGEST_KEY", "")
OPENROUTER_API_KEY = os.environ.get("OPENROUTER_API_KEY", "")

# Filtering thresholds
MIN_TOTAL_MESSAGES = 4
MIN_USER_WORDS = 20
SKIP_TITLE_PATTERNS = re.compile(
    r"do not remember|forget this|don't remember|ignore this",
    re.IGNORECASE,
)

SUMMARIZATION_PROMPT = """\
You are distilling a ChatGPT conversation into standalone thoughts for a \
personal knowledge base. Extract 1-3 key thoughts, insights, decisions, or \
learnings from the user's messages. Each thought must be:
- A clear, standalone statement (makes sense without the conversation)
- Written in first person
- 1-3 sentences

Return JSON: {"thoughts": ["thought1", "thought2"]}
If the conversation has nothing worth capturing, return {"thoughts": []}"""

# ─── Sync Log ────────────────────────────────────────────────────────────────


def load_sync_log():
    """Load sync log from disk. Returns dict with ingested_ids and last_sync."""
    try:
        with open(SYNC_LOG_PATH) as f:
            return json.load(f)
    except (FileNotFoundError, json.JSONDecodeError):
        return {"ingested_ids": {}, "last_sync": ""}


def save_sync_log(log):
    """Save sync log to disk."""
    with open(SYNC_LOG_PATH, "w") as f:
        json.dump(log, f, indent=2)


# ─── HTTP Helpers ────────────────────────────────────────────────────────────

try:
    import requests
except ImportError:
    print("Missing dependency: requests")
    print("Install with: pip install requests")
    sys.exit(1)


def http_post_with_retry(url, headers, body, retries=2):
    """POST with exponential backoff retry on transient failures."""
    for attempt in range(retries + 1):
        try:
            resp = requests.post(url, headers=headers, json=body, timeout=30)
            if resp.status_code >= 500 and attempt < retries:
                time.sleep(1 * (attempt + 1))
                continue
            return resp
        except requests.RequestException:
            if attempt < retries:
                time.sleep(1 * (attempt + 1))
                continue
            raise
    return None  # unreachable


# ─── ChatGPT Export Parsing ──────────────────────────────────────────────────


def extract_conversations(zip_path):
    """Extract conversations.json from the ChatGPT export zip."""
    with zipfile.ZipFile(zip_path, "r") as zf:
        # Look for conversations.json at any level in the zip
        candidates = [n for n in zf.namelist() if n.endswith("conversations.json")]
        if not candidates:
            print("Error: No conversations.json found in zip archive.")
            sys.exit(1)
        # Prefer the shortest path (top-level)
        target = min(candidates, key=len)
        with zf.open(target) as f:
            return json.load(f)


def conversation_hash(conv):
    """Generate a stable hash ID for a conversation."""
    title = conv.get("title", "")
    create_time = str(conv.get("create_time", ""))
    raw = f"{title}|{create_time}"
    return hashlib.sha256(raw.encode()).hexdigest()[:16]


def walk_messages(mapping):
    """Walk the mapping tree to extract messages in conversation order.

    The mapping is a dict of node_id -> node. Each node has an optional
    'message' field and 'parent'/'children' references forming a tree.
    We find the root (no parent or parent not in mapping) and walk depth-first.
    """
    if not mapping:
        return []

    # Find root node(s): nodes whose parent is None or not in the mapping
    roots = []
    for node_id, node in mapping.items():
        parent = node.get("parent")
        if parent is None or parent not in mapping:
            roots.append(node_id)

    if not roots:
        return []

    # Walk from root, following first child at each level (linear conversation)
    # For branched conversations, we follow the last child (most recent branch)
    messages = []
    visited = set()

    def walk(node_id):
        if node_id in visited or node_id not in mapping:
            return
        visited.add(node_id)
        node = mapping[node_id]
        msg = node.get("message")
        if msg and msg.get("content"):
            messages.append(msg)
        children = node.get("children", [])
        for child_id in children:
            walk(child_id)

    for root_id in roots:
        walk(root_id)

    return messages


def extract_user_text(messages):
    """Extract text from user messages only, concatenated with separators."""
    parts = []
    for msg in messages:
        author = msg.get("author", {})
        if author.get("role") != "user":
            continue
        content = msg.get("content", {})
        if content.get("content_type") != "text":
            continue
        text_parts = content.get("parts", [])
        text = "\n".join(str(p) for p in text_parts if isinstance(p, str)).strip()
        if text:
            parts.append(text)
    return "\n---\n".join(parts)


def count_messages(messages):
    """Count total messages (all roles) that have text content."""
    count = 0
    for msg in messages:
        content = msg.get("content", {})
        if content.get("content_type") == "text":
            parts = content.get("parts", [])
            text = "".join(str(p) for p in parts if isinstance(p, str)).strip()
            if text:
                count += 1
    return count


# ─── Conversation Filtering ─────────────────────────────────────────────────


def should_skip(conv, user_text, message_count, sync_log, args):
    """Return a skip reason string, or None if the conversation should be processed."""
    conv_id = conversation_hash(conv)

    # Already imported
    if conv_id in sync_log["ingested_ids"]:
        return "already_imported"

    # Date filtering
    create_time = conv.get("create_time")
    if create_time:
        conv_date = datetime.fromtimestamp(create_time, tz=timezone.utc).date()
        if args.after and conv_date < args.after:
            return "before_date_filter"
        if args.before and conv_date > args.before:
            return "after_date_filter"

    # Too few messages
    if message_count < MIN_TOTAL_MESSAGES:
        return "too_few_messages"

    # Title-based skip
    title = conv.get("title", "")
    if SKIP_TITLE_PATTERNS.search(title):
        return "skip_title"

    # Not enough user text
    word_count = len(user_text.split())
    if word_count < MIN_USER_WORDS:
        return "too_little_text"

    return None


# ─── LLM Summarization ──────────────────────────────────────────────────────


def summarize_openrouter(title, date_str, user_text):
    """Summarize a conversation into thoughts using OpenRouter."""
    if not OPENROUTER_API_KEY:
        print("Error: OPENROUTER_API_KEY environment variable required for summarization.")
        sys.exit(1)

    # Truncate to ~6000 chars to stay within context limits
    truncated = user_text[:6000]

    resp = http_post_with_retry(
        f"{OPENROUTER_BASE}/chat/completions",
        headers={
            "Authorization": f"Bearer {OPENROUTER_API_KEY}",
            "Content-Type": "application/json",
        },
        body={
            "model": "openai/gpt-4o-mini",
            "response_format": {"type": "json_object"},
            "messages": [
                {"role": "system", "content": SUMMARIZATION_PROMPT},
                {
                    "role": "user",
                    "content": f"Conversation title: {title}\nDate: {date_str}\n\nUser messages:\n{truncated}",
                },
            ],
            "temperature": 0,
        },
    )

    if not resp or resp.status_code != 200:
        status = resp.status_code if resp else "no response"
        print(f"   Warning: Summarization failed ({status}), skipping conversation.")
        return []

    try:
        data = resp.json()
        result = json.loads(data["choices"][0]["message"]["content"])
        thoughts = result.get("thoughts", [])
        return [t for t in thoughts if isinstance(t, str) and t.strip()]
    except (KeyError, json.JSONDecodeError, IndexError) as e:
        print(f"   Warning: Failed to parse summarization response: {e}")
        return []


def summarize_ollama(title, date_str, user_text, model_name="qwen3"):
    """Summarize a conversation using a local Ollama model."""
    truncated = user_text[:6000]

    prompt = (
        f"{SUMMARIZATION_PROMPT}\n\n"
        f"Conversation title: {title}\nDate: {date_str}\n\n"
        f"User messages:\n{truncated}"
    )

    try:
        resp = requests.post(
            f"{OLLAMA_BASE}/api/generate",
            json={
                "model": model_name,
                "prompt": prompt,
                "stream": False,
                "format": "json",
            },
            timeout=120,
        )
    except requests.RequestException as e:
        print(f"   Warning: Ollama request failed: {e}")
        return []

    if resp.status_code != 200:
        print(f"   Warning: Ollama returned {resp.status_code}")
        return []

    try:
        raw = resp.json().get("response", "")
        result = json.loads(raw)
        thoughts = result.get("thoughts", [])
        return [t for t in thoughts if isinstance(t, str) and t.strip()]
    except (json.JSONDecodeError, KeyError) as e:
        print(f"   Warning: Failed to parse Ollama response: {e}")
        return []


def summarize(title, date_str, user_text, args):
    """Dispatch to the appropriate summarization backend."""
    if args.model == "ollama":
        return summarize_ollama(title, date_str, user_text, args.ollama_model)
    return summarize_openrouter(title, date_str, user_text)


# ─── Ingestion ───────────────────────────────────────────────────────────────


def ingest_thought(content, extra_metadata):
    """POST a thought to the ingest-thought endpoint."""
    resp = http_post_with_retry(
        INGEST_URL,
        headers={
            "Content-Type": "application/json",
            "x-ingest-key": INGEST_KEY,
        },
        body={
            "content": content,
            "source": "chatgpt",
            "extra_metadata": extra_metadata,
        },
    )

    if not resp:
        return {"ok": False, "error": "No response from server"}

    try:
        return resp.json()
    except ValueError:
        return {"ok": False, "error": f"Invalid JSON response: {resp.status_code}"}


# ─── CLI ─────────────────────────────────────────────────────────────────────


def parse_date(s):
    """Parse a YYYY-MM-DD string to a date object."""
    try:
        return datetime.strptime(s, "%Y-%m-%d").date()
    except ValueError:
        print(f"Error: Invalid date format '{s}'. Use YYYY-MM-DD.")
        sys.exit(1)


def parse_args():
    parser = argparse.ArgumentParser(
        description="Import ChatGPT conversations into Open Brain",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog="""\
Examples:
  python scripts/import-chatgpt.py export.zip --dry-run --limit 10
  python scripts/import-chatgpt.py export.zip --after 2024-01-01
  python scripts/import-chatgpt.py export.zip --model ollama --ollama-model qwen3
  python scripts/import-chatgpt.py export.zip --raw --limit 50""",
    )
    parser.add_argument("zip_path", help="Path to ChatGPT data export zip file")
    parser.add_argument("--dry-run", action="store_true", help="Parse and summarize but don't ingest")
    parser.add_argument("--after", type=parse_date, help="Only conversations after YYYY-MM-DD")
    parser.add_argument("--before", type=parse_date, help="Only conversations before YYYY-MM-DD")
    parser.add_argument("--limit", type=int, default=0, help="Max conversations to process (0 = unlimited)")
    parser.add_argument("--model", choices=["openrouter", "ollama"], default="openrouter", help="LLM backend (default: openrouter)")
    parser.add_argument("--ollama-model", default="qwen3", help="Ollama model name (default: qwen3)")
    parser.add_argument("--raw", action="store_true", help="Skip summarization, ingest user messages directly")
    parser.add_argument("--verbose", action="store_true", help="Show full summaries during processing")
    return parser.parse_args()


# ─── Main ────────────────────────────────────────────────────────────────────


def main():
    args = parse_args()

    if not os.path.isfile(args.zip_path):
        print(f"Error: File not found: {args.zip_path}")
        sys.exit(1)

    # Validate env vars for live mode
    if not args.dry_run:
        if not INGEST_URL:
            print("Error: INGEST_URL environment variable required for live mode.")
            print("Example: export INGEST_URL=https://YOUR_REF.supabase.co/functions/v1/ingest-thought")
            sys.exit(1)
        if not INGEST_KEY:
            print("Error: INGEST_KEY environment variable required for live mode.")
            sys.exit(1)

    if not args.raw and args.model == "openrouter" and not OPENROUTER_API_KEY:
        print("Error: OPENROUTER_API_KEY environment variable required for summarization.")
        print("Use --raw to skip summarization, or --model ollama for local inference.")
        sys.exit(1)

    print(f"\nExtracting conversations from {args.zip_path}...")
    conversations = extract_conversations(args.zip_path)
    print(f"Found {len(conversations)} conversations.\n")

    # Sort by create_time (oldest first)
    conversations.sort(key=lambda c: c.get("create_time", 0))

    sync_log = load_sync_log()

    # Display run configuration
    mode = "DRY RUN" if args.dry_run else "LIVE"
    summarize_mode = "raw (no summarization)" if args.raw else f"{args.model}"
    if args.model == "ollama" and not args.raw:
        summarize_mode += f" ({args.ollama_model})"
    print(f"  Mode:        {mode}")
    print(f"  Summarizer:  {summarize_mode}")
    if args.after:
        print(f"  After:       {args.after}")
    if args.before:
        print(f"  Before:      {args.before}")
    if args.limit:
        print(f"  Limit:       {args.limit}")
    print()

    # Counters
    total = len(conversations)
    already_imported = 0
    filtered = 0
    filter_reasons = {}
    processed = 0
    thoughts_generated = 0
    ingested = 0
    errors = 0
    total_user_words = 0

    for conv in conversations:
        # Respect limit
        if args.limit and processed >= args.limit:
            break

        # Parse conversation
        messages = walk_messages(conv.get("mapping", {}))
        user_text = extract_user_text(messages)
        message_count = count_messages(messages)

        # Filter
        skip_reason = should_skip(conv, user_text, message_count, sync_log, args)
        if skip_reason:
            if skip_reason == "already_imported":
                already_imported += 1
            else:
                filtered += 1
                filter_reasons[skip_reason] = filter_reasons.get(skip_reason, 0) + 1
            continue

        processed += 1
        word_count = len(user_text.split())
        total_user_words += word_count

        title = conv.get("title", "(untitled)")
        create_time = conv.get("create_time")
        date_str = (
            datetime.fromtimestamp(create_time, tz=timezone.utc).strftime("%Y-%m-%d")
            if create_time
            else "unknown"
        )
        conv_id = conversation_hash(conv)

        print(f"{processed}. {title}")
        print(f"   {message_count} messages | {word_count} user words | {date_str}")

        # Summarize or use raw
        if args.raw:
            # In raw mode, treat the whole user text as a single thought
            thoughts = [user_text]
        else:
            thoughts = summarize(title, date_str, user_text, args)

        thoughts_generated += len(thoughts)

        if not thoughts:
            print("   -> No thoughts extracted (empty summary)")
            # Still mark as processed in sync log so we don't retry
            if not args.dry_run:
                sync_log["ingested_ids"][conv_id] = datetime.now(timezone.utc).isoformat()
                save_sync_log(sync_log)
            print()
            continue

        if args.verbose or args.dry_run:
            for i, thought in enumerate(thoughts, 1):
                preview = thought if len(thought) <= 200 else thought[:200] + "..."
                print(f"   Thought {i}: {preview}")

        if args.dry_run:
            print()
            continue

        # Ingest thoughts
        extra_metadata = {
            "chatgpt_title": title,
            "chatgpt_create_time": date_str,
            "chatgpt_conversation_hash": conv_id,
        }

        all_ok = True
        for i, thought in enumerate(thoughts):
            content = f"[ChatGPT: {title} | {date_str}] {thought}"
            result = ingest_thought(content, extra_metadata)

            if result.get("ok"):
                ingested += 1
                topics = ", ".join(result.get("topics", []))
                print(f"   -> Thought {i + 1}: {result.get('type', '?')} — {topics}")
            else:
                errors += 1
                all_ok = False
                print(f"   -> ERROR (thought {i + 1}): {result.get('error', 'unknown')}")

            time.sleep(0.2)  # 200ms rate limit

        # Update sync log on success
        if all_ok:
            sync_log["ingested_ids"][conv_id] = datetime.now(timezone.utc).isoformat()
            save_sync_log(sync_log)

        print()

    # ─── Summary ─────────────────────────────────────────────────────────────

    print("─" * 60)
    print("Summary:")
    print(f"  Conversations found:    {total}")
    if already_imported > 0:
        print(f"  Already imported:       {already_imported} (skipped)")
    if filtered > 0:
        reasons = ", ".join(f"{v} {k}" for k, v in sorted(filter_reasons.items(), key=lambda x: -x[1]))
        print(f"  Filtered (trivial):     {filtered} ({reasons})")
    print(f"  Processed:              {processed}")
    print(f"  Total user words:       {total_user_words:,}")
    print(f"  Thoughts generated:     {thoughts_generated}")
    if not args.dry_run:
        print(f"  Ingested:               {ingested}")
        print(f"  Errors:                 {errors}")

    # Cost estimation
    if not args.raw and processed > 0:
        # gpt-4o-mini via OpenRouter: ~$0.15/1M input, ~$0.60/1M output
        # Rough estimate: avg 800 tokens input per conv, 200 tokens output
        est_input_tokens = processed * 800
        est_output_tokens = processed * 200
        summarize_cost = (est_input_tokens * 0.15 / 1_000_000) + (est_output_tokens * 0.60 / 1_000_000)
    else:
        summarize_cost = 0

    # Ingest cost: embedding ($0.02/1M tokens) + metadata extraction ($0.15+$0.60/1M)
    ingest_cost = thoughts_generated * 0.00015  # ~150 tokens avg per thought
    total_cost = summarize_cost + ingest_cost
    print(f"  Est. API cost:          ${total_cost:.4f}")
    if not args.raw and summarize_cost > 0:
        print(f"    Summarization:        ${summarize_cost:.4f}")
        print(f"    Ingestion:            ${ingest_cost:.4f}")
    print("─" * 60)


if __name__ == "__main__":
    main()
