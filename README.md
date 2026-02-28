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

## Route Schema Transform Rules

Route contract schemas support top-level `.transform(...)` chains while preserving HTTP-safe wire schemas.

- ✅ Top-level transform chains are allowed (sync and async)
- ❌ Nested transforms are not allowed anywhere inside the base schema
- Validation fails fast when contracts are created if nested transforms are detected

Directional behavior:

- Client request input validates against the HTTP-safe/base schema
- Server handler input receives transformed output
- Server handler return is validated against the HTTP-safe/base response schema
- Client response parsing applies full response schema including top-level transforms

Example:

```ts
const routes = createRoutes(shape, {
  ROUTER: {
    transforms: {
      CONTRACT: {
        post: {
          body: {
            contentType: "application/json",
            schema: z
              .object({ name: z.string() })
              .transform(async (input) => ({ name: input.name.trim() }))
              .transform((input) => ({ normalized: input.name.toUpperCase() })),
          },
          responses: {
            200: {
              contentType: "application/json",
              schema: z
                .object({ message: z.string() })
                .transform((body) => ({ message: `${body.message}!` })),
            },
          },
        },
      },
    },
  },
});
```

Nested transform example (rejected at contract construction time):

```ts
z.object({
  name: z.string().transform((value) => value.trim()), // not allowed (nested)
});
```

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
