"""Bridge between the chat API and Claude Code via the Claude Agent SDK."""

import os
from collections.abc import AsyncIterator
from typing import Any

from claude_agent_sdk import (
    AssistantMessage,
    ClaudeAgentOptions,
    ResultMessage,
    StreamEvent,
    SystemMessage,
    ToolResultBlock,
    ToolUseBlock,
    UserMessage,
    query,
)

from app.config import settings

MODELS = [
    {"id": "claude-opus-5-5", "name": "Claude Opus 5.5"},
    {"id": "claude-sonnet-5-5", "name": "Claude Sonnet 5.5"},
    {"id": "claude-haiku-5-5", "name": "Claude Haiku 5.5"},
    {"id": "claude-fable-5-1", "name": "Claude Fable 5.1"},
]


def ensure_credentials() -> None:
    if not (os.environ.get("ANTHROPIC_API_KEY") or os.environ.get("CLAUDE_CODE_OAUTH_TOKEN")):
        raise RuntimeError(
            "No Claude credentials. Set CLAUDE_CODE_OAUTH_TOKEN (Pro/Max plan, from `claude setup-token`) "
            "or ANTHROPIC_API_KEY in .env, then run `docker compose -f docker-compose.dev.yml up -d backend`."
        )


def _tool_result_content(content: Any) -> str:
    if content is None:
        return ""
    if isinstance(content, str):
        return content
    return "\n".join(part.get("text", "") for part in content if isinstance(part, dict))


async def run_turn(prompt: str, model: str, resume: str | None) -> AsyncIterator[dict[str, Any]]:
    """Run one chat turn through Claude Code and yield UI events.

    Event shapes:
      {"type": "session", "session_id"}
      {"type": "text", "text"}                       incremental text delta
      {"type": "tool_use", "id", "name", "input"}
      {"type": "tool_result", "tool_use_id", "content", "is_error"}
      {"type": "result", "session_id", "cost_usd", "is_error", "subtype"}
    """
    ensure_credentials()
    # On a subscription, total_cost_usd is an API-price estimate, not what you're billed.
    uses_api_key = bool(os.environ.get("ANTHROPIC_API_KEY"))

    options = ClaudeAgentOptions(
        model=model,
        cwd=settings.claude_workspace,
        resume=resume,
        system_prompt={"type": "preset", "preset": "claude_code"},
        allowed_tools=settings.claude_allowed_tools,
        # No interactive approval in the web UI: anything not in allowed_tools is denied.
        permission_mode="dontAsk",
        include_partial_messages=True,
    )

    async for message in query(prompt=prompt, options=options):
        if isinstance(message, SystemMessage) and message.subtype == "init":
            yield {"type": "session", "session_id": message.data.get("session_id")}

        elif isinstance(message, StreamEvent) and message.parent_tool_use_id is None:
            event = message.event
            if event.get("type") == "content_block_delta":
                delta = event.get("delta", {})
                if delta.get("type") == "text_delta":
                    yield {"type": "text", "text": delta.get("text", "")}
            elif event.get("type") == "message_start":
                # Separate text from consecutive assistant messages within one turn.
                yield {"type": "message_start"}

        elif isinstance(message, AssistantMessage) and message.parent_tool_use_id is None:
            # Text already arrived via stream deltas; only surface tool calls here.
            for block in message.content:
                if isinstance(block, ToolUseBlock):
                    yield {"type": "tool_use", "id": block.id, "name": block.name, "input": block.input}

        elif isinstance(message, UserMessage) and isinstance(message.content, list):
            for block in message.content:
                if isinstance(block, ToolResultBlock):
                    yield {
                        "type": "tool_result",
                        "tool_use_id": block.tool_use_id,
                        "content": _tool_result_content(block.content),
                        "is_error": bool(block.is_error),
                    }

        elif isinstance(message, ResultMessage):
            yield {
                "type": "result",
                "session_id": message.session_id,
                "cost_usd": message.total_cost_usd if uses_api_key else None,
                "is_error": message.is_error,
                "subtype": message.subtype,
                "result": message.result if message.is_error else None,
            }
