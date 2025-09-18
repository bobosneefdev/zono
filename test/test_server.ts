import z from "zod";
import { ZonoEndpoint } from "../src/classes/endpoint";
import { ZonoServer } from "../src/classes/server";

const testServer = new ZonoServer(
    {
        test: new ZonoEndpoint({
            method: "get",
            path: "/test",
            response: z.object({
                message: z.string(),
            }),
            query: z.object({
                name: z.string(),
            }),
        }),
    },
    {
        handlers: {
            test: (data) => {
                return {
                    message: `Hey there ${data.query.name}`,
                }
            }
        },
        handlerOptions: {
            obfuscate: true,
        },
        bind: "0.0.0.0",
        port: 3000,
        openApiOptions: {
            title: "Test",
            path: "/docs",
            version: "1.0.0",
            descriptions: {
                test: {
                    description: "te"
                }
            }
        }
    },
);

testServer.start();