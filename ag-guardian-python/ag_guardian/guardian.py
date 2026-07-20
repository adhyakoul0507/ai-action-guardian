from google.antigravity import types
from google.antigravity.hooks import policy
from rich.console import Console
from rich.panel import Panel
from rich.prompt import Confirm
from rich.text import Text

from .diff_engine import generate_diff
from .explainer import explain_with_ollama

console = Console()

async def enriched_approval_handler(tool_call: types.ToolCall) -> bool:
    """
    An enhanced ask_user handler for Antigravity.
    Intercepts the default tool call, fetches a plain English explanation,
    generates file diffs, and presents a beautiful Rich panel before asking
    for execution approval.
    """
    tool_name = tool_call.name
    args = tool_call.args

    # 1. Fetch plain English explanation from Ollama
    with console.status("[dim]Guardian is analyzing the action...[/dim]", spinner="dots"):
        explanation = await explain_with_ollama(tool_name, args)

    # 2. Build the Markdown content
    markdown = f"\n> [!IMPORTANT]\n> **🛡️ AI Action Guardian**: `{tool_name}`\n>\n> {explanation}\n"
    
    # 3. Check for specific tool risks
    if tool_name in ["run_command", "bash"]:
        cmd = args.get("command", args.get("CommandLine", ""))
        if "rm " in cmd or "delete" in cmd:
            markdown += "> \n> > [!CAUTION]\n> > **CRITICAL RISK:** This command is destructive and irreversible.\n"
        else:
            markdown += "> \n> > [!WARNING]\n> > Execute shell command directly on host.\n"
            
    elif tool_name in ["write_to_file", "replace_file_content", "write_file", "edit_file", "multi_replace_file_content"]:
        path = args.get("TargetFile", args.get("path", args.get("file", "Unknown path")))
        new_content = args.get("CodeContent", args.get("ReplacementContent", args.get("content", "")))
        
        # 4. Generate Diff
        if path and new_content:
            diff_text = generate_diff(path, new_content)
            markdown += f"\n```diff\n{diff_text}\n```\n"
            markdown += "\n> [!WARNING]\n> Modifying this file will overwrite existing contents.\n"

    # 5. Output Markdown to the Antigravity Chat Stream
    print(markdown)

    # 6. Prompt User
    is_approved = Confirm.ask("[bold cyan]Approve this action?[/bold cyan]")
    
    if is_approved:
        console.print("[green]Action approved.[/green]\n")
        return True
    else:
        console.print("[red]Action denied.[/red]\n")
        return False

def get_guardian_policy():
    """
    Returns the Antigravity policy object configured to use the enriched handler.
    """
    # Ask user for everything (you can customize this to only ask for run_command/write_file)
    return policy.ask_user("*", handler=enriched_approval_handler)
