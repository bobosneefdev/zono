// IDEAL EVENTUAL USAGE EXAMPLE:
import { Hono } from "hono";
import { Contract, createRouter } from "../contract.js";
import z from "zod";

const router = createRouter({
    users: {
        type: "router",
        router: {
            $id: {
                type: "contract",
                router: {
                    $postId: {
                        type: "contract",
                    },
                },
            },
        },
    },
}, {
    users: {
        $id: {
            contract: {
                method: "get",
                responses: {
                    200: {
                        body: z.object({
                            id: z.string(),
                            name: z.string(),
                        }),
                        headers: z.object({
                            "x-custom-header": z.string(),
                        }),
                    },
                },
                pathParams: z.object({
                    id: z.string(),
                }),
            },
            router: {
                $postId: {
                    contract: {
                        method: "get",
                        pathParams: z.object({
                            id: z.string(),
                            postId: z.string(),
                        }),
                        responses: {
                            200: {
                                body: z.object({
                                    id: z.string(),
                                    title: z.string(),
                                    likes: z.number().int(),
                                    views: z.number().int(),
                                    comments: z.array(z.object({
                                        userName: z.string(),
                                        content: z.string(),
                                    })),
                                }),
                                headers: z.object({
                                    "x-custom-header": z.string(),
                                }),
                            },
                        },
                    },
                },
            },
        },
    },
});

const app = new Hono();

type ServerHandler<
    TContract extends Contract,
    TParams extends [...Array<any>]
> = (data: ServerHandlerInput<TContract>, ...args: TParams) =>
    Promise<ServerHandlerOutput<TContract>>;

type ServerHandlerInput<TContract extends Contract> = null; // TODO
type ServerHandlerOutput<TContract extends Contract> = null; // TODO

initHono(
    app,
    router,
    { // implementation of the handlers
        users: {
            // for Hono TParams should be [Context] as you can see
            $id: {
                handler: async (data, c: Context) => {
                    return {
                        status: 200,
                        data: {
                            id: data.pathParams.id,
                            name: "John Doe",
                        },
                        headers: {
                            "x-custom-header": "Hello, world!",
                        },
                        opts: {
                            bypassOutgoingParse: true,
                        },
                    };
                },
                router: {
                    $postId: {
                        handler: async (data, c: Context) => {
                            return {
                                status: 200,
                                data: {
                                    id: data.pathParams.postId,
                                    title: "Post Title",
                                    likes: 100,
                                    views: 1000,
                                    comments: [
                                        {
                                            userName: "John Doe",
                                            content: "This is a comment",
                                        },
                                    ],
                                },
                                headers: {
                                    "x-custom-header": "Hello, world!",
                                },
                            };
                        },
                    },
                },
            },
        },
    },
);

Bun.serve({
    port: 3000,
    fetch: app.fetch,
});