import httpx
import json

OLLAMA_URL = "http://localhost:11434/api/generate"
MODEL = "llama3.2:3b"

SYSTEM_PROMPT = """You are a security assistant inside a tool called "AI Action Guardian".
Your job is to explain in ONE plain English sentence what a shell/file/database/git command is about to do.

Rules:
- Write exactly ONE sentence. No bullet points, no markdown, no extra commentary.
- Be specific: mention the actual file path, table name, remote branch, etc. from the command.
- Use plain language a non-technical user can understand.
- If the action is destructive or irreversible, say so clearly (e.g. "permanently", "cannot be undone").
- Do NOT say "The AI" or "The agent" — just describe the action directly.
- Do NOT start with "This command" — start with a verb (e.g. "Delete", "Push", "Overwrite").
"""

async def explain_with_ollama(tool_name: str, args: dict) -> str:
    """
    Calls the local Ollama instance to explain what a command does.
    Falls back to a basic template if Ollama is unreachable.
    """
    cmd = args.get("command", args.get("CommandLine", ""))
    path = args.get("path", args.get("TargetFile", args.get("file", "")))
    query = args.get("query", args.get("sql", ""))

    action_desc = f"Tool: {tool_name}\n"
    if cmd: action_desc += f"Command: {cmd}\n"
    if path: action_desc += f"Path: {path}\n"
    if query: action_desc += f"Query: {query}\n"
    if not cmd and not path and not query:
        action_desc += f"Arguments: {json.dumps(args)[:200]}\n"

    prompt = f"{SYSTEM_PROMPT}\n\nNow explain this action in one sentence:\n{action_desc}\nOutput:"

    fallback = f"Execute tool '{tool_name}'."
    if cmd: fallback = f"Run command: `{cmd}`"
    elif path: fallback = f"Modify file: `{path}`"

    try:
        async with httpx.AsyncClient(timeout=5.0) as client:
            response = await client.post(
                OLLAMA_URL,
                json={
                    "model": MODEL,
                    "prompt": prompt,
                    "stream": False,
                    "options": {
                        "temperature": 0.2,
                        "num_predict": 80,
                    }
                }
            )
            response.raise_for_status()
            data = response.json()
            explanation = data.get("response", "").strip()
            
            if explanation and len(explanation) > 10:
                return explanation
            return fallback

    except Exception:
        # Silently fallback to template if Ollama is down
        return fallback
