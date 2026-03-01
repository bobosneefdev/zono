# Zono

TypeScript + Zod end-to-end type-safe HTTP contracts, clients, and server adapters.

Define routes once, then reuse that contract everywhere:

- request/response validation at runtime
- end-to-end static types across server and client
- framework adapters for production integration

## Why Zono

Zono is contract-first. You describe your API shape and schemas with Zod, then generate strongly typed building blocks for:

- route contracts (`createRoutes`)
- server handlers (Hono adapter)
- client calls (`createClient`)
- middleware contracts and gateway composition

## Features

- Contract-first API design built on Zod schemas
- End-to-end type safety from input parsing to response bodies
- Typed HTTP client generated from route contracts
- Hono route + middleware adapters
- Hono gateway utilities for service aggregation/proxying
- Middleware contract composition for reusable error/response models

## Install

```bash
bun add @bobosneefdev/zono zod
```

Adapter peer dependencies as needed:

- `hono` for `@bobosneefdev/zono/hono` and `@bobosneefdev/zono/hono-gateway`
- `@sveltejs/kit` for `@bobosneefdev/zono/sveltekit`

## Quick Start (latest usage pattern)

This quick start reflects the style used in `src/examples/example.ts`:

```ts
import z from "zod";
import type { RouterShape } from "@bobosneefdev/zono/contract";
import { createRoutes } from "@bobosneefdev/zono/contract";
import { createClient } from "@bobosneefdev/zono/client";

const shape = {
  ROUTER: {
    users: {
      ROUTER: {
        register: { CONTRACT: true },
        $userId: { CONTRACT: true },
      },
    },
    health: { CONTRACT: true },
  },
} as const satisfies RouterShape;

const userSchema = z.object({
  id: z.string().uuid(),
  name: z.string(),
  email: z.string().email(),
});

const routes = createRoutes(shape, {
  ROUTER: {
    users: {
      ROUTER: {
        register: {
          CONTRACT: {
            post: {
              body: {
                contentType: "application/json",
                schema: z.object({
                  name: z.string(),
                  email: z.string().email(),
                }),
              },
              responses: {
                201: {
                  contentType: "application/json",
                  schema: userSchema,
                },
              },
            },
          },
        },
        $userId: {
          CONTRACT: {
            get: {
              pathParams: z.object({ userId: z.string().uuid() }),
              responses: {
                200: {
                  contentType: "application/json",
                  schema: userSchema,
                },
                404: {
                  contentType: "application/json",
                  schema: z.object({ message: z.string() }),
                },
              },
            },
          },
        },
      },
    },
    health: {
      CONTRACT: {
        get: {
          responses: {
            200: {
              contentType: "application/json",
              schema: z.object({ status: z.literal("ok") }),
            },
          },
        },
      },
    },
  },
});

const client = createClient(routes, {
  baseUrl: "http://localhost:3000",
  serverErrorMode: "public",
});

const created = await client.users.register.post({
  body: { name: "Ada Lovelace", email: "ada@example.com" },
});

if (created.status === 201) {
  console.log(created.body.id);
}

const fetched = await client.users.$userId.get({
  pathParams: { userId: crypto.randomUUID() },
});

if (fetched.status === 200) {
  console.log(fetched.body.email);
}

if (fetched.status === 404) {
  console.log(fetched.body.message);
}
```

## Transforms (important schema rule)

Route contract schemas support **top-level** `.transform(...)` chains while preserving HTTP-safe wire schemas.

- ✅ Top-level transform chains are allowed (sync + async)
- ❌ Nested transforms inside object properties are not allowed
- ✅ Invalid nested transforms fail fast at contract construction

Directional behavior:

- Client request input validates against the HTTP-safe/base input schema
- Server handler input receives transformed output
- Server handler return validates against HTTP-safe/base response schema
- Client response parsing applies full response schema (including top-level transforms)

Allowed:

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
              schema: z.object({ message: z.string() }).transform(async (body) => ({
                message: `${body.message}!`,
                id: crypto.randomUUID(),
              })),
            },
          },
        },
      },
    },
  },
});
```

Rejected (nested transform):

```ts
z.object({
  name: z.string().transform((value) => value.trim()), // not allowed
});
```

## Package Surface

Zono exports focused subpath modules:

- `@bobosneefdev/zono/contract` — route contracts + shared contract utilities
- `@bobosneefdev/zono/client` — typed HTTP client
- `@bobosneefdev/zono/server` — server handler and response utilities
- `@bobosneefdev/zono/middleware` — middleware contract utilities
- `@bobosneefdev/zono/hono` — Hono adapter
- `@bobosneefdev/zono/hono-gateway` — Hono gateway composition utilities
- `@bobosneefdev/zono/sveltekit` — SvelteKit adapter

## Examples

- Full end-to-end reference: `src/examples/example.ts`

## License

MIT — see `LICENSE`.
