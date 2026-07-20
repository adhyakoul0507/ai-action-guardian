import os
import difflib
from google.antigravity.hooks import hooks, policy
from google.antigravity import types

def get_file_diff(file_path: str, new_content: str) -> str:
    """Generates a readable diff if the file exists and is being modified."""
    if not os.path.exists(file_path):
        return f"\n[NEW FILE] {file_path} will be created.\n"

    try:
        with open(file_path, "r", encoding="utf-8") as f:
            old_lines = f.readlines()
    except Exception:
        return f"\n[WARNING] Could not read existing file at {file_path} to generate diff.\n"
    
    new_lines = [line + '\n' if not line.endswith('\n') else line for line in new_content.splitlines()]
    
    diff = list(difflib.unified_diff(
        old_lines, 
        new_lines, 
        fromfile=f"OLD: {file_path}", 
        tofile=f"NEW: {file_path}", 
        n=3
    ))
    
    if not diff:
        return f"\n[NO CHANGES] The file contents will remain the same.\n"
        
    return "\n" + "".join(diff)

async def enriched_approval_handler(tool_call: types.ToolCall) -> bool:
    """
    A custom approval handler for Antigravity that shows plain English and a diff
    before asking the user for permission.
    """
    print(f"\n{'='*60}")
    print(f"🛡️  AI ACTION GUARDIAN (Antigravity Plugin)")
    print(f"{'='*60}")
    
    tool_name = tool_call.name
    args = tool_call.args
    
    # 1. Plain English Explanation
    print(f"\nTool: {tool_name}")
    
    if tool_name in ["run_command", "bash"]:
        cmd = args.get("command", args.get("CommandLine", "Unknown command"))
        print(f"Action: Execute a shell command on your machine.")
        print(f"Command: {cmd}")
        if "rm " in cmd or "delete" in cmd:
            print("⚠️  CRITICAL RISK: This command is destructive and irreversible!")
            
    elif tool_name in ["write_to_file", "replace_file_content", "write_file", "edit_file"]:
        path = args.get("TargetFile", args.get("path", args.get("file", "Unknown path")))
        content = args.get("CodeContent", args.get("ReplacementContent", args.get("content", "")))
        
        print(f"Action: Modify file contents.")
        print(f"Target: {path}")
        
        # 2. Show the Diff
        if path and content:
            print("\n--- DIFF PREVIEW ---")
            diff_text = get_file_diff(path, content)
            print(diff_text)
            print("--------------------\n")
            
    else:
        print(f"Arguments: {args}")
        
    print(f"{'='*60}")
    
    # 3. Ask for permission
    while True:
        response = input(f"Approve this action? (y/n): ").strip().lower()
        if response in ['y', 'yes']:
            return True
        elif response in ['n', 'no']:
            return False
        print("Please answer 'y' or 'n'.")

# This is how a user would configure their Antigravity Agent
# config = LocalAgentConfig(
#     policies=[
#         # We use our enriched handler instead of the default blind approval
#         policy.ask_user("*", handler=enriched_approval_handler)
#     ]
# )
