import asyncio
from google.antigravity import types
from ag_guardian.guardian import enriched_approval_handler

# Mock the Confirm.ask for test
import rich.prompt
rich.prompt.Confirm.ask = lambda x: True

async def main():
    print("Testing plugin UI...")
    tc = types.ToolCall(
        id="call_1",
        name="write_file",
        args={
            "TargetFile": "./test_file.txt",
            "CodeContent": "Hello\nWorld\nChanged!"
        }
    )
    with open("./test_file.txt", "w") as f:
        f.write("Hello\nWorld\n")
        
    res = await enriched_approval_handler(tc)
    print("Result:", res)

asyncio.run(main())
