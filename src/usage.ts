import z from "zod";
import { createRouter } from "./contract";
import { Hono } from "hono";
import { initHono } from "./hono";
import { createClient } from "./client";

const zUser = z.null(); // example/placeholder schema
const zFilter = z.null(); // example/placeholder schema

const router = createRouter({
    users: {
        type: "router",
        router: {
            $discordId: {
                type: "contract",
                router: {
                    filters: {
                        type: "contract",
                        router: {
                            $filterId: {
                                type: "contract",
                            },
                        },
                    },
                },
            },
        },
    },
}, {
    users: {
        $discordId: {
            contract: {
                get: {
                    pathParams: z.object({
                        discordId: z.string(),
                    }),
                    responses: {
                        200: {
                            body: zUser,
                        },
                    },
                },
            },
            router: {
                filters: {
                    contract: {
                        get: {
                            pathParams: z.object({
                                discordId: z.string(),
                            }),
                            responses: {
                                200: {
                                    body: z.array(zFilter),
                                },
                            },
                        },
                    },
                    router: {
                        $filterId: {
                            contract: {
                                get: {
                                    pathParams: z.object({
                                        discordId: z.string(),
                                        filterId: z.string(),
                                    }),
                                    responses: {
                                        200: {
                                            body: zFilter,
                                        },
                                    },
                                },
                            },
                        },
                    },
                },
            },
        },
    },
});

const app = new Hono();

initHono(app, router, {
    users: {
        $discordId: {
            handler: {
                get: async (input) => {
                    return {
                        status: 200,
                        data: null,
                    };
                },
            },
            router: {
                filters: {
                    handler: {
                        get: async (input) => {
                            return {
                                status: 200,
                                data: [null],
                            };
                        },
                    },
                    router: {
                        $filterId: {
                            handler: {
                                get: async (input) => {
                                    return {
                                        status: 200,
                                        data: null,
                                    };
                                },
                            },
                        },
                    },
                },
            },
        },
    },
});

Bun.serve({
    fetch: app.fetch,
    port: 3000,
});

console.log("Server is running on http://localhost:3000");

const client = createClient(router, {
    baseUrl: "http://localhost:3000",
});

(async () => {
    const resp = await client.get("/users/$discordId/filters", {
        pathParams: {
            discordId: "123",
        },
    });
    console.log(JSON.stringify(resp, null, 2));
})();