import { createContract, createRouter } from "~/contract.js";
import { createZonoClient } from "~/client.js";
import z from "zod";
import { Hono } from "hono";
import { initHono } from "~/hono.js";

const router = createRouter({
    "": createContract("/:id", {
        pathParams: z.object({
            id: z.string(),
        }),
        method: "get",
        responses: {
            200: {
                body: z.object({
                    id: z.string(),
                    name: z.string(),
                    age: z.number().int(),
                }),
                headers: z.object({
                    test: z.string(),
                }),
            }
        },
    }),
});

const app = new Hono();

initHono(app, router, {
    "": async () => {
        return {
            status: 200,
            data: {
                id: "123",
                name: "John Doe",
                age: 21,
            },
            headers: {
                test: "asdf",
            },
        };
    },
});

Bun.serve({
    port: 8080,
    fetch: app.fetch,
});

const client = createZonoClient(router, {
    baseUrl: "http://localhost:8080",
});

client[""]({
    pathParams: {
        id: "123",
    }
}).then((res) => {
    console.log(JSON.stringify(res, null, 2));
});