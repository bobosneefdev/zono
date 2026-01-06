import z from "zod";
import { ZonoEndpoint, ZonoEndpointRecord } from "../src/classes/endpoint";
import { ZonoServer } from "../src/classes/server";
import { ZonoSocketServer } from "../src/classes/socket_server";
import { ZonoSocketClient } from "../src/classes/socket_client";
import { ZonoEndpointHeadersDefinition, ZonoSocketDefinition } from "../src/lib_types";
import { createZonoEndpointClientSuite } from "../src/lib_util/create_endpoint_client_suite";
import { Context, Next } from "hono";

const PORT = 3000;

const KEY = "1234567890";

const GLOBAL_HEADERS = z.object({
    "Authorization": z.literal(KEY).default(KEY),
}) satisfies ZonoEndpointHeadersDefinition;

// Middleware definitions
const requestLoggerMiddleware = async (c: Context, next: Next) => {
    console.log(`[${new Date().toISOString()}] ${c.req.method} ${c.req.url}`);
    await next();
};

const customHeaderMiddleware = async (c: Context, next: Next) => {
    await next();
    c.res.headers.set("X-Custom-Middleware", "true");
    c.res.headers.set("X-Request-ID", Math.random().toString(36).substring(7));
};

const contextModifierMiddleware = async (c: Context, next: Next) => {
    // Add custom data to context that can be accessed by handlers
    c.set("middlewareData", { timestamp: Date.now(), processed: true });
    await next();
};

const ENDPOINTS = {
    getPeople: new ZonoEndpoint({
        method: "get",
        path: "/people",
        response: z.object({
            success: z.boolean(),
        }),
        additionalPaths: z.tuple([
            z.enum(["Bob", "Douglas", "Jeremy"]),
            z.coerce.number<string>().pipe(z.enum({
                "Value1": 1,
            })),
        ]),
    }),
    postPeople: new ZonoEndpoint({
        method: "post",
        path: "/people",
        response: z.object({
            success: z.boolean(),
        }),
        body: z.object({
            firstName: z.enum(["Bob", "Douglas", "Jeremy"]),
            lastName: z.enum(["Smith", "Jones", "Williams"]),
        }),
        headers: z.object({
            "X-Api-Key": z.literal(KEY),
        }),
    }),
    coercedDateQuery: new ZonoEndpoint({
        method: "get",
        path: "/coercedDateQuery",
        response: z.object({
            success: z.boolean(),
        }),
        query: z.object({
            date: z.coerce.date<string>(),
        }),
    }),
    middlewareTest: new ZonoEndpoint({
        method: "get",
        path: "/middleware-test",
        response: z.object({
            success: z.boolean(),
            middlewareProcessed: z.boolean(),
        }),
    }),
} satisfies ZonoEndpointRecord;

const SOCKET_DEFINITION = {
    serverEvents: {
        message: z.object({
            content: z.string(),
            timestamp: z.number(),
        }),
        userJoined: z.object({
            username: z.string(),
        }),
    },
    clientEvents: {
        sendMessage: z.object({
            content: z.string(),
        }),
        joinRoom: z.object({
            username: z.string(),
            room: z.string(),
        }),
    },
} satisfies ZonoSocketDefinition;

const SOCKET_SERVER = new ZonoSocketServer(
    SOCKET_DEFINITION,
    {
        handlers: {
            sendMessage: (data) => {
                // Echo the message back with a timestamp
                SOCKET_SERVER.emit("message", {
                    content: `Echo: ${data.content}`,
                    timestamp: Date.now(),
                });
            },
            joinRoom: (data) => {
                // Notify that user joined
                SOCKET_SERVER.emit("userJoined", {
                    username: data.username,
                });
            },
        },
    },
);

const SERVER = new ZonoServer(
    ENDPOINTS,
    {
        bind: "0.0.0.0",
        handlers: {
            getPeople: () => {
                return {
                    status: 200,
                    data: {
                        success: true,
                    }
                }
            },
            postPeople: () => {
                return {
                    status: 200,
                    data: {
                        success: true,
                    }
                }
            },
            coercedDateQuery: (request) => {
                return {
                    status: 200,
                    data: {
                        success: request.query.date instanceof Date,
                    }
                }
            },
            middlewareTest: () => {
                return {
                    status: 200,
                    data: {
                        success: true,
                        middlewareProcessed: true,
                    }
                }
            },
        },
        port: PORT,
        socket: SOCKET_SERVER,
        handlerOptions: {
            obfuscate: false,
        },
        openApiOptions: {
            title: "Test API",
            path: "/docs",
            version: "1.0.0",
            descriptions: {
                getPeople: {
                    description: "This is just a test endpoint",
                },
            },
        },
        globalHeaders: GLOBAL_HEADERS,
        basePath: "/v1",
        middleware: [
            requestLoggerMiddleware,
            customHeaderMiddleware,
            contextModifierMiddleware,
        ],
    },
);

const CLIENT = createZonoEndpointClientSuite(
    ENDPOINTS,
    {
        baseUrl: `http://localhost:${PORT}/v1`,
        globalHeaders: GLOBAL_HEADERS,
    },
);

let SOCKET_CLIENT: ZonoSocketClient<typeof SOCKET_DEFINITION>;

describe("Server and Client", () => {
    beforeAll(async () => {
        SERVER.start();
        // Start socket server (assuming it starts automatically in constructor)
        
        // Create socket client
        SOCKET_CLIENT = new ZonoSocketClient(SOCKET_DEFINITION, {
            url: `http://localhost:${PORT}`,
        });
        
        // Wait a bit for connections to establish
        await new Promise(resolve => setTimeout(resolve, 100));
    });

    afterAll(async () => {
        SOCKET_CLIENT.socket.disconnect();
        await SERVER.stop(true);
        process.exit(0);
    });

    it("Simple GET endpoint, has coerced path", async () => {
        const response = await CLIENT.getPeople.axios({
            additionalPaths: [
                "Bob",
                1,
            ],
            headers: {
                Authorization: undefined,
            },
        });
        if (response.success) {
            expect(response.data.success).toBe(true);
        }
        else {
            console.error(response);
        }
        expect(response.success).toBe(true);
    });


    it("Simple POST endpoint, nothing special", async () => {
        const response = await CLIENT.postPeople.fetch({
            body: {
                firstName: "Bob",
                lastName: "Williams",
            },
            headers: {
                Authorization: KEY,
                "X-Api-Key": KEY,
            },
        });
        if (response.success) {
            expect(response.data.success).toBe(true);
        }
        else {
            console.error(response);
        }
        expect(response.success).toBe(true);
    });

    it("GET endpoint with a coerced date query", async () => {
        const response = await CLIENT.coercedDateQuery.fetch({
            query: {
                date: new Date(),
            },
            headers: {
                Authorization: KEY,
            }
        });

        if (response.success) {
            expect(response.data.success).toBe(true);
        }

        expect(response.success).toBe(true);
    });

    it("Socket: Client sends message, server echoes back", async () => {
        let resolve: () => void;
        const promise = new Promise<void>((res) => resolve = res);

        SOCKET_CLIENT.listen("once", "message", (data) => {
            expect(data.content).toBe("Echo: Hello from client!");
            expect(typeof data.timestamp).toBe("number");
            expect(data.timestamp).toBeGreaterThan(0);
            resolve();
        });

        SOCKET_CLIENT.emit("sendMessage", {
            content: "Hello from client!",
        });

        await promise;
    });

    it("Socket: Client joins room, server notifies", async () => {
        let resolve: () => void;
        const promise = new Promise<void>((res) => resolve = res);

        const listenerId = SOCKET_CLIENT.listen("on", "userJoined", (data) => {
            expect(data.username).toBe("testuser");
            SOCKET_CLIENT.removeHandler("userJoined", listenerId);
            resolve();
        });

        SOCKET_CLIENT.emit("joinRoom", {
            username: "testuser",
            room: "general",
        });

        await promise;
    });

    it("Middleware: Custom headers are added to responses", async () => {
        const response = await CLIENT.middlewareTest.fetch({
            headers: {
                Authorization: KEY,
            },
        });

        expect(response.success).toBe(true);
        if (response.success) {
            expect(response.data.success).toBe(true);
            expect(response.data.middlewareProcessed).toBe(true);
        }

        // Check that custom headers were added by middleware
        expect(response.response.headers.get("X-Custom-Middleware")).toBe("true");
        expect(response.response.headers.get("X-Request-ID")).toBeDefined();
        expect(response.response.headers.get("X-Request-ID")).toMatch(/^[a-z0-9]+$/);
    });

    it("Middleware: Request logging works", async () => {
        // Capture console.log to verify middleware logging
        const originalLog = console.log;
        const logMessages: string[] = [];
        console.log = (...args: any[]) => {
            logMessages.push(args.join(" "));
        };

        try {
            const response = await CLIENT.middlewareTest.fetch({
                headers: {
                    Authorization: KEY,
                },
            });

            expect(response.success).toBe(true);
            
            // Verify that the request was logged
            const logMessage = logMessages.find(msg => 
                msg.includes("GET") && 
                msg.includes("/v1/middleware-test")
            );
            expect(logMessage).toBeDefined();
            expect(logMessage).toMatch(/\[\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z\] GET/);
        } finally {
            console.log = originalLog;
        }
    });

    it("Middleware: All endpoints receive middleware", async () => {
        // Test that middleware applies to all endpoints, not just the middleware test endpoint
        const response = await CLIENT.getPeople.axios({
            additionalPaths: [
                "Bob",
                1,
            ],
            headers: {
                Authorization: KEY,
            },
        });

        expect(response.success).toBe(true);
        if (response.success) {
            expect(response.data.success).toBe(true);
        }

        // Verify middleware headers are present on all endpoints
        expect(response.response.headers["x-custom-middleware"]).toBe("true");
        expect(response.response.headers["x-request-id"]).toBeDefined();
    });
});