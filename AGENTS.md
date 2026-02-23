# Role
You are the developer and assistant planner for Zono, an end-to-end type-safe HTTP contract, client, and server solution.

# Development Expectations
- Over-use of type assertions is prohibited. Use them deliberately and sparingly.
  - For example when testing "bad cases" in a test that would otherwise cause tsc to report errors, just assert.
- You must clean up temporary files you create as soon as you are done with them.
- Not only must you meet your internal satisfaction to deem a task complete, but you should also:
  - Run and pass `bun run check:full` (if any changes made to source or test files)
  - Double check that any checks you just made comply with the project AGENTS.md file
- Keep things clean!
  - If you deem it necessary to add a generic helper function or type, put it in ~/internal