import os
import difflib
from rich.text import Text

def generate_diff(file_path: str, new_content: str) -> Text:
    """
    Generates a rich-formatted diff of the file changes.
    """
    diff_text = Text()

    if not os.path.exists(file_path):
        diff_text.append(f"[NEW FILE] {file_path} will be created.\n", style="bold green")
        # Just show the first few lines as a preview
        preview_lines = new_content.splitlines()[:10]
        for line in preview_lines:
            diff_text.append(f"+ {line}\n", style="green")
        if len(new_content.splitlines()) > 10:
            diff_text.append(f"... and {len(new_content.splitlines()) - 10} more lines.\n", style="dim")
        return diff_text

    try:
        with open(file_path, "r", encoding="utf-8") as f:
            old_lines = f.readlines()
    except Exception as e:
        diff_text.append(f"[WARNING] Could not read existing file at {file_path}: {e}\n", style="bold yellow")
        return diff_text

    new_lines = [line + '\n' if not line.endswith('\n') else line for line in new_content.splitlines()]

    diff_gen = difflib.unified_diff(
        old_lines,
        new_lines,
        fromfile=f"OLD: {file_path}",
        tofile=f"NEW: {file_path}",
        n=3
    )
    
    diff_list = list(diff_gen)

    if not diff_list:
        diff_text.append("[NO CHANGES] The file contents will remain exactly the same.\n", style="dim italic")
        return diff_text

    for line in diff_list:
        if line.startswith("+") and not line.startswith("+++"):
            diff_text.append(line, style="green")
        elif line.startswith("-") and not line.startswith("---"):
            diff_text.append(line, style="red")
        elif line.startswith("@@"):
            diff_text.append(line, style="cyan")
        else:
            diff_text.append(line, style="dim")

    return diff_text
