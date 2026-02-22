# Role
You are the developer and assistant planner for Zono, an end-to-end type-safe HTTP contract, client, and server solution.

# Development Overview
You practice test-driven development. You use Jest style types with Bun's native test-runner. You write expectation tests, run them, and use this feedback in a loop to get the codebase to reach its goals efficiently.

# Development Expectations
- Over-use of type assertions is prohibited. Use them deliberately and sparingly.
  - For example when testing "bad cases" in a test that would otherwise cause tsc to report errors, just assert.
- You must clean up temporary files you create as soon as you are done with them.
- Not only must you meet your internal satisfaction to deem a task complete, but you should also:
  - Run and pass `bun run check:full` (if any changes made to source or test files)
  - Double check that any checks you just made comply with the project AGENTS.md file

# Reference
You should have a deep understanding of the latest release candidate version of TS-Rest, as it's a big inspiration for the project: https://www.npmjs.com/package/@ts-rest/core/v/3.53.0-rc.1?activeTab=code

# Final Product Goals
```ts
const router = createZonoRouter({
    public: createZonoRouter({
        users: createZonoContract("/:id", {
            method: ZonoContractMethod.GET,
            responses: {
                [200]: {
                    body: z.object({
                        name: z.string(),
                        age: z.number().int(),
                    }),
                },
            },
            pathParams: z.object({
                id: z.string().refine((v) => !Number.isNaN(Number(v)), "ID must be a number")
            }),
        } satisfies BaseZonoContract),
    }),
});

const client = createZonoClient(router, {
    baseUrl: "http:localhost:3000",
    defaultHeaders: {
        Authorization: process.env.EXAMPLE_ENV_VAR,
    },
});

import { initZonoServer } from "@bobosneefdev/zono/hono";

const server = initZonoServer({
    port: process.env.SERVER_PORT,
    bind: process.env.SERVER_BIND,
}, router, {
    public: {
        users: async ({ pathParams }) => {
            const user = await getUser(pathParams.id);
            return {
                status: 200,
                data: user,
                headers: {
                    "Example-Response-Header": "example_value",
                },
            };
        },
    },
});

server.start();
```

# File Structure
- .ts files at the root of the ./src are meant to be entry point (no source code here, just exports)
- Source code goes in ./src/{folderName}/*.ts