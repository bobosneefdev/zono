# Zono

TypeScript + Zod end-to-end type-safe HTTP contracts, clients, and server adapters.

Zono helps you define API contracts once and use them across your client and server with runtime validation and strong static inference.

## Features

- Contract-first API design built on Zod schemas
- End-to-end type safety from request input to response output
- Typed HTTP client generation from router contracts
- Server-side contract parsing/validation utilities
- Framework adapters for Hono and SvelteKit
- Gateway utilities for Hono-based proxy/aggregation flows

## Install

```bash
bun add @bobosneefdev/zono zod
```

For adapter packages, install relevant peer dependencies as needed:

- `hono` for `@bobosneefdev/zono/hono` and `@bobosneefdev/zono/hono-gateway`
- `@sveltejs/kit` for `@bobosneefdev/zono/sveltekit`

## Quick Start/Example

```ts
import { createRouter } from "@bobosneefdev/zono/contract";
import { createClient } from "@bobosneefdev/zono/client";
import z from "zod";

const shape = {
  users: {
    TYPE: "router",
    ROUTER: {
      $userId: {
        TYPE: "contract",
      },
    },
  },
} as const;

const router = createRouter(shape, {
  users: {
    $userId: {
      CONTRACT: {
        get: {
          pathParams: z.object({ userId: z.uuid() }),
          responses: {
            200: {
              contentType: "application/json",
              schema: z.object({ id: z.uuid(), name: z.string() }),
            },
          },
        },
      },
    },
  },
});

const client = createClient(router, {
  baseUrl: "http://localhost:3000",
});

const result = await client.get("users.$userId", {
  pathParams: { userId: "550e8400-e29b-41d4-a716-446655440000" },
});

if (result.status === 200) {
  // result.body is typed from the contract's 200 schema
  console.log(result.body.name);
}
```

For a larger end-to-end example (contracts, handlers, client, and adapters), see `src/examples/usage.ts`.

## Package Surface

Zono currently exports focused subpath modules:

- `@bobosneefdev/zono/contract` — router/contract definitions and contract resolution utilities
- `@bobosneefdev/zono/client` — typed HTTP client
- `@bobosneefdev/zono/server` — server handler and response utilities
- `@bobosneefdev/zono/hono` — Hono adapter
- `@bobosneefdev/zono/hono-gateway` — Hono gateway utilities
- `@bobosneefdev/zono/sveltekit` — SvelteKit adapter

## License

MIT — see `LICENSE`.
