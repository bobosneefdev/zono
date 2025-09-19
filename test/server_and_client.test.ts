import z from "zod";
import { ZonoEndpoint, ZonoEndpointRecord } from "../src/classes/endpoint";
import { ZonoServer } from "../src/classes/server";
import { ZonoHeadersDefinition } from "../src/types";
import { createZonoClient } from "../src/classes/client";

const PORT = 3000;

const KEY = "1234567890";

const GLOBAL_HEADERS = z.object({
    "Authorization": z.literal(KEY),
}) satisfies ZonoHeadersDefinition;

const ENDPOINTS = {
    getPeople: new ZonoEndpoint({
        method: "get",
        path: "/people",
        response: z.object({
            success: z.boolean(),
        }),
        additionalPaths: z.tuple([
            z.enum(["Bob", "Douglas", "Jeremy"]),
            z.enum(["Smith", "Jones", "Williams"]),
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
} satisfies ZonoEndpointRecord;

const SERVER = new ZonoServer(
    ENDPOINTS,
    {
        bind: "0.0.0.0",
        handlers: {
            getPeople: () => {
                return {
                    success: true,
                }
            },
            postPeople: () => {
                return {
                    success: true,
                }
            }
        },
        port: PORT,
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

const CLIENT = createZonoClient(
    ENDPOINTS,
    {
        baseUrl: `http://localhost:${PORT}`,
        globalHeaders: GLOBAL_HEADERS,
    },
);

describe("Server and Client", () => {
    beforeAll(() => {
        SERVER.start();
    });

    afterAll(async () => {
        await SERVER.stop();
    });

    it("GET /people", async () => {
        const response = await CLIENT.getPeople({
            additionalPaths: [
                "Bob",
                "Williams",
            ],
            headers: {
                Authorization: KEY,
            },
        });
        expect(response.parsed).toBe(true);
        if (response.parsed) {
            expect(response.response.data.success).toBe(true);
        }
    });


    it("POST /people", async () => {
        const response = await CLIENT.postPeople({
            body: {
                firstName: "Bob",
                lastName: "Williams",
            },
            headers: {
                Authorization: KEY,
                "X-Api-Key": KEY,
            },
        });
        expect(response.parsed).toBe(true);
        if (response.parsed) {
            expect(response.response.data.success).toBe(true);
        }
    });
})