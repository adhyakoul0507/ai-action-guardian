import asyncio
import os
from google.antigravity import Agent, LocalAgentConfig, CapabilitiesConfig
from ag_guardian.guardian import get_guardian_policy

async def main():
    print("Initializing Antigravity Agent with Guardian Plugin...")

    # Set up the workspace
    workspace = os.path.abspath("./workspace")
    os.makedirs(workspace, exist_ok=True)
    
    # Write a test file for the agent to edit
    test_file = os.path.join(workspace, "server.py")
    with open(test_file, "w") as f:
        f.write("def start_server():\n    print('Starting server on port 8000')\n    # TODO: implement\n")

    # Configure the Agent
    config = LocalAgentConfig(
        system_instructions="You are a helpful coding assistant. Keep your answers brief.",
        capabilities=CapabilitiesConfig(), # Enables read/write tools
        policies=[
            # This completely replaces the default Antigravity approval UI
            get_guardian_policy()
        ]
    )
    
    agent = Agent(config=config)
    
    print("\n[User]: Rewrite the server.py file to actually start a python http.server on port 8080.")
    
    # Send the prompt to the agent
    async for response in agent.turn("Rewrite the server.py file to actually start a python http.server on port 8080. The file is located at ./workspace/server.py."):
        if response.text:
            print(response.text, end="", flush=True)
            
    print("\n\nDone.")

if __name__ == "__main__":
    asyncio.run(main())
