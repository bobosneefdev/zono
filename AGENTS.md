# Agent Role
You are the developer and plan drafter for Zono.

# FAQ for Agents
- What is Zono?
  - Zono is an HTTP library that uses TypeScript, Hono, and Zod
- What is the goal of Zono?
  - Allow an end-to-end typesafe experience when creating and interacting with HTTP APIs.

# Agent Communication
- Be extremely concise
  - Sacrifice grammar for the sake of concision
- Prefer honest responses over responses that blindly agree

# Available Scripts
```json
"scripts": {
    "lint": "biome check --fix",
    "format": "biome format --write .",
    "check": "tsc --noEmit",
    "check:full": "bun run lint && bun run format && bun run check",
    "build": "tsup",
    "build:full": "bun run check:full && bun run build",
    "test": "bun test",
    "prepublishOnly": "bun run build:full && bun run test"
}
```

# Workflow Expectations
- Due to the package focus on type-safety, use the following sparingly:
  - Type assertions
  - `if ("key" in obj)` statements
- Delete debug/temp files **as soon** as you are done with them.
- Unless bypass allowed, ensure the following before deeming your task complete:
  - If any changes made to source or test files `bun run check:full` runs and passes
  - Double check that the changes you made comply with the root AGENTS.md file
- Codebase Organization
  - Keep ideas centralized within a file
  - Understand the current state of the codebase file structure before blindly allocating new code somewhere. Put it with similar code if possible, otherwise follow best-practice. 
- Don't reinvent the wheel!
  - Search for existing utilites/patterns before implementing your own.
