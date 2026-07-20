import asyncio
import os
from unittest.mock import MagicMock

# Create a mock for the Antigravity ToolCall object
class MockToolCall:
    def __init__(self, name, args):
        self.name = name
        self.args = args

# Mock google.antigravity so we can import our module without the real SDK installed
import sys
mock_types = MagicMock()
mock_types.ToolCall = MockToolCall
sys.modules['google.antigravity'] = MagicMock()
sys.modules['google.antigravity.hooks'] = MagicMock()
sys.modules['google.antigravity'].types = mock_types

# Now we can import the guardian
from ag_guardian.guardian import enriched_approval_handler

async def run_test():
    print("\n--- AI Action Guardian: Terminal UI Test ---\n")
    
    # Setup a fake file so we can show a diff
    with open("dummy_auth.py", "w") as f:
        f.write("def login(user, password):\n    return user == 'admin'\n")

    # Mock Tool Call 1: Destructive Command
    print("\n\n👉 Test 1: Destructive Shell Command")
    tc1 = MockToolCall(
        name="run_command", 
        args={"command": "rm -rf ./build"}
    )
    # Automatically respond 'n' for the test so it doesn't hang
    # But since it's an interactive demo, we'll actually let the user answer it if run manually.
    
    # Mock Tool Call 2: File Edit
    print("\n\n👉 Test 2: File Edit (Diff View)")
    tc2 = MockToolCall(
        name="write_file", 
        args={
            "path": "./dummy_auth.py",
            "content": "def login(user, password):\n    result = db.query('SELECT...')\n    return bcrypt.verify(...)\n"
        }
    )

    try:
        await enriched_approval_handler(tc1)
        await enriched_approval_handler(tc2)
    finally:
        # Cleanup
        if os.path.exists("dummy_auth.py"):
            os.remove("dummy_auth.py")

if __name__ == "__main__":
    try:
        asyncio.run(run_test())
    except KeyboardInterrupt:
        pass
