import z from "zod";
import { ZonoEndpoint, ZonoEndpointRecord } from "../src/classes/endpoint";
import { ZonoServer } from "../src/classes/server";
import { ZonoSocketServer } from "../src/classes/socket_server";
import { ZonoSocketClient } from "../src/classes/socket_client";
import { ZonoEndpointHeadersDefinition, ZonoSocketDefinition } from "../src/lib_types";
import { createZonoEndpointClientSuite } from "../src/lib_util/create_endpoint_client_suite";

const PORT = 3000;

const KEY = "1234567890";

const GLOBAL_HEADERS = z.object({
    "Authorization": z.literal(KEY),
}) satisfies ZonoEndpointHeadersDefinition;

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
    },
);

const CLIENT = createZonoEndpointClientSuite(
    ENDPOINTS,
    {
        baseUrl: `http://localhost:${PORT}`,
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
                Authorization: KEY,
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

    it("Socket: Client sends message, server echoes back", () => {
        return new Promise<void>((res, rej) => {
            const timeout = setTimeout(() => {
                rej(new Error("Test timeout - no message received"));
            }, 5000);

            const listenerId = SOCKET_CLIENT.listen("message", (data) => {
                try {
                    expect(data.content).toBe("Echo: Hello from client!");
                    expect(typeof data.timestamp).toBe("number");
                    expect(data.timestamp).toBeGreaterThan(0);
                    
                    SOCKET_CLIENT.removeHandler("message", listenerId);
                    clearTimeout(timeout);
                    res();
                } catch (error) {
                    clearTimeout(timeout);
                    rej(error);
                }
            });

            SOCKET_CLIENT.emit("sendMessage", {
                content: "Hello from client!",
            });
        });
    });

    it("Socket: Client joins room, server notifies", () => {
        return new Promise<void>((res, rej) => {
            const timeout = setTimeout(() => {
                rej(new Error("Test timeout - no userJoined event received"));
            }, 5000);

            const listenerId = SOCKET_CLIENT.listen("userJoined", (data) => {
                try {
                    expect(data.username).toBe("testuser");
                    
                    SOCKET_CLIENT.removeHandler("userJoined", listenerId);
                    clearTimeout(timeout);
                    res();
                } catch (error) {
                    clearTimeout(timeout);
                    rej(error);
                }
            });

            SOCKET_CLIENT.emit("joinRoom", {
                username: "testuser",
                room: "general",
            });
        });
    });
});