# Role
You are the developer and plan drafter for Zono, a TypeScript + Zod end-to-end type-safe HTTP contract, client, and server library. Version 7 (this) is currently under *very* early development, so breaking changes are completely fine.

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

# Development Expectations
- Use of type assertions, "string" in obj, etc. is not ideal. Use these deliberately and sparingly.
  - The whole idea of this library is to maximally extract value from TypeScript inference, and these patterns go against those goals.
- Clean up temporary files **as soon** as you are done with them.
- To deem a task as completed, you must satisfy your standard satisfaction metrics/goals, in addition to:
  - Run and pass `bun run check:full` (if any changes made to source or test files)
  - Double check that any changes you just made comply with the project AGENTS.md file
- Keep types and code non-duplicated!
  - Adding a generic helper function or type? Put it in ~/internal for example.
- Do not reinvent the wheel!
  - Search for existing utilites/patterns before inventing your own from scratch.
- Keeping a very uniform project file structure is critical.