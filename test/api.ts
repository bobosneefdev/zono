import z from "zod";
import { ZonoEndpoint, ZonoEndpointAny } from "../src/classes/endpoint";
import { ZonoServer } from "../src/classes/server";
import { ZonoClient } from "../src/classes/client";

const PORT = 3000;

const endpoints = {
    test: new ZonoEndpoint({
        method: "get",
        path: "/test/:name",
        response: z.object({
            greeting: z.string(),
        }),
        additionalPaths: z.tuple([
            z.literal("test"),
            z.enum(["Jake", "Douglas", "Jeremy"]),
            z.enum(["Smith", "Jones"]),
        ]),
    }),
} satisfies Record<string, ZonoEndpointAny>;

const server = new ZonoServer(
    endpoints,
    {
        bind: "0.0.0.0",
        handlers: {
            test: (data) => {
                return {
                    greeting: `Hello ${data.additionalPaths[1]} ${data.additionalPaths[2]}!`,
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
                test: {
                    description: "This is just a test endpoint",
                },
            },
        },
    },
);

server.start();

const client = new ZonoClient(endpoints, { baseUrl: `http://localhost:${PORT}` }).build();

// client.test({
//     additionalPaths: [
//         "Jake",
//         "Jones",
//     ]
// }).then((response) => {
//     console.log(response.data);
// });