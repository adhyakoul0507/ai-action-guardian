# AI Action Guardian (Zero-Trust Agent Firewall)

An enterprise-grade, zero-trust execution firewall that intercepts and secures autonomous AI agents using local Small Language Models (SLMs).

## Features
- **Real-Time Execution Interception**: Uses a WebSocket proxy to silently scrape Chrome DevTools protocol memory and intercept AI shell execution threads.
- **Local SLM Translation (Ollama)**: Integrates Meta's Llama 3.2 3B model locally to dynamically translate highly technical and abstract UNIX commands into simple, context-aware English for a human-in-the-loop authorization gate.
- **Air-Gapped Security**: Operates 100% offline without relying on cloud API keys.
- **Heuristic Risk Engine**: Includes dynamic blast-radius calculation and path sensitivity parsing, backed by a 10,000+ command offline dictionary as an absolute failsafe.

## Setup
1. Ensure [Ollama](https://ollama.com/) is installed and running with `llama3.2:3b` pulled (`ollama run llama3.2:3b`).
2. Run `npm install` in the `desktop` folder.
3. Start the Chat Head UI: `cd desktop && npm start`.
4. Start the Agent Proxy: `cd proxy && node src/index.js --server`.

## Architecture
The firewall sits between an autonomous AI agent and the host operating system. It parses any `tool_call` or bash shell command the AI attempts to execute, pauses it, sends the payload to the local Llama model for a security audit and plain-english translation, and routes the response to an Electron Chat Head UI for manual approval.
