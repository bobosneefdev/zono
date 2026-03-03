# Zono

TypeScript + Zod end-to-end type-safe HTTP contracts, clients, and server adapters.

Define routes once, then reuse the same contract across server and client with runtime validation and static typing.

## Install

```bash
bun add @bobosneefdev/zono zod
```

Optional peer dependency:
- `hono` for `@bobosneefdev/zono/hono` and `@bobosneefdev/zono/hono-gateway`

## Quick start: server + client

```ts
import { Hono } from "hono";
import z from "zod";
import type { RouterShape } from "@bobosneefdev/zono/contract";
import { createContracts } from "@bobosneefdev/zono/contract";
import { createClient } from "@bobosneefdev/zono/client";
import {
  createHono,
  createHonoMiddlewareHandlers,
  createHonoOptions,
  createHonoRouteHandlers,
} from "@bobosneefdev/zono/hono";
import { createMiddlewares } from "@bobosneefdev/zono/middleware";

const shape = {
  ROUTER: {
    health: { CONTRACT: true },
    profile: { CONTRACT: true },
    analytics: { CONTRACT: true },
  },
} as const satisfies RouterShape;

const contracts = createContracts(shape, {
  ROUTER: {
    health: {
      CONTRACT: {
        get: {
          responses: {
            200: {
              type: "JSON",
              schema: z.object({ status: z.literal("ok") }),
            },
          },
        },
      },
    },
    profile: {
      CONTRACT: {
        get: {
          responses: {
            200: {
              type: "JSON",
              schema: z.object({
                id: z.string().uuid(),
                email: z.string().email(),
              }),
            },
          },
        },
      },
    },
    analytics: {
      CONTRACT: {
        get: {
          responses: {
            200: {
              type: "SuperJSON",
              schema: z.object({
                generatedAt: z.date(),
                counters: z.map(z.string(), z.number()),
                tags: z.set(z.string()),
              }),
            },
          },
        },
      },
    },
  },
});

const middleware = createMiddlewares(contracts, {
  MIDDLEWARE: {
    rateLimit: {
      429: {
        type: "JSON",
        schema: z.object({ retryAfterSeconds: z.number().int().positive() }),
      },
    },
  },
});

const honoOptions = createHonoOptions({ errorMode: "public" });

const contractHandlers = createHonoContractHandlers(contracts, honoOptions, {
  ROUTER: {
    health: {
      HANDLER: {
        get: async () => ({
          type: "JSON" as const,
          status: 200 as const,
          data: { status: "ok" as const },
        }),
      },
    },
    profile: {
      HANDLER: {
        get: async () => ({
          type: "JSON" as const,
          status: 200 as const,
          data: {
            id: crypto.randomUUID(),
            email: "dev@example.com",
          },
        }),
      },
    },
    analytics: {
      HANDLER: {
        get: async () => ({
          type: "SuperJSON" as const,
          status: 200 as const,
          data: {
            generatedAt: new Date(),
            counters: new Map([
              ["active", 42],
              ["trial", 7],
            ]),
            tags: new Set(["growth", "engaged"]),
          },
        }),
      },
    },
  },
});

const middlewareHandlers = createHonoMiddlewareHandlers(middleware, honoOptions, {
  MIDDLEWARE: {
    rateLimit: async (_ctx, next) => {
      await next();
    },
  },
});

const app = new Hono();
createHono(app, contracts, contractHandlers, middleware, middlewareHandlers, honoOptions);

Bun.serve({ fetch: app.fetch, port: 3000 });

const client = createClient(contracts, {
  baseUrl: "http://localhost:3000",
  middleware: [middleware],
  serverErrorMode: "public",
});

const analytics = await client.analytics("get");
if (analytics.status === 200) {
  analytics.body.generatedAt; // Date
  analytics.body.counters; // Map<string, number>
  analytics.body.tags; // Set<string>
}
```

## Gateway composition

Use [generateHonoGatewayRoutesAndMiddleware](README.md#gateway-composition) to compose multiple services behind a single Hono gateway.

```ts
import { Hono } from "hono";
import { createMiddlewares } from "@bobosneefdev/zono/middleware";
import {
  createGatewayOptions,
  createHonoGateway,
  generateHonoGatewayRoutesAndMiddleware,
} from "@bobosneefdev/zono/hono-gateway";
import { createHonoMiddlewareHandlers } from "@bobosneefdev/zono/hono";

const { routes: gatewayRoutes, middleware: generatedGatewayMiddleware } =
  generateHonoGatewayRoutesAndMiddleware({
    usersService: {
      routes: usersContracts,
      middleware: usersMiddleware,
    },
    billingService: {
      routes: billingContracts,
      middleware: billingMiddleware,
    },
  });

const gatewayCustomMiddlewares = createMiddlewares(gatewayRoutes, {
  MIDDLEWARE: {
    requestLogging: {},
  },
});

const gatewayOptions = createGatewayOptions(gatewayRoutes, {
  services: {
    usersService: "http://localhost:3001",
    billingService: "http://localhost:3002",
  },
  errorMode: "public",
});

const gatewayCustomMiddlewareHandlers = createHonoMiddlewareHandlers(
  gatewayCustomMiddlewares,
  gatewayOptions,
  {
    MIDDLEWARE: {
      requestLogging: async (ctx, next) => {
        console.log(`[gateway] ${ctx.req.method} ${ctx.req.path}`);
        await next();
      },
    },
  },
);

const gatewayApp = new Hono();
createHonoGateway(
  gatewayApp,
  gatewayRoutes,
  gatewayCustomMiddlewares,
  gatewayCustomMiddlewareHandlers,
  gatewayOptions,
);
```

## SuperJSON guidance

Use `type: "SuperJSON"` when you need values that plain JSON cannot represent safely.

Typical cases:

- `Date`
- `Map`
- `Set`

Best practice:

- Prefer `type: "JSON"` for standard wire payloads
- Reserve `type: "SuperJSON"` for routes that need non-JSON-native values
- Keep schemas explicit so runtime validation and inferred types stay aligned

## Package surface

- `@bobosneefdev/zono/contract`
- `@bobosneefdev/zono/client`
- `@bobosneefdev/zono/middleware`
- `@bobosneefdev/zono/hono`
- `@bobosneefdev/zono/hono-gateway`

## Examples

- Full project example: `src/examples/example.ts`

## License

MIT - see `LICENSE`.
