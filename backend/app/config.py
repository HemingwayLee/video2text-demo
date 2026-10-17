from pydantic_settings import BaseSettings


class Settings(BaseSettings):
    database_url: str = "postgresql+psycopg://app:app@localhost:5432/app"
    cors_origins: list[str] = ["http://localhost:5174"]

    # Claude Code (Agent SDK) settings
    claude_workspace: str = "/workspace"
    claude_default_model: str = "claude-opus-5-5"
    claude_allowed_tools: list[str] = [
        "Read", "Write", "Edit", "Glob", "Grep", "Bash", "WebSearch", "WebFetch", "TodoWrite",
    ]


settings = Settings()
