import { Handler, Hono, MiddlewareHandler } from "hono";
import { ZonoEndpointHeadersDefinition } from "../lib_types.js";
import { ZonoEndpoint, ZonoEndpointRecord } from "./endpoint.js";
import { serve, Server } from "bun";
import { createDocument, ZodOpenApiOperationObject, ZodOpenApiPathsObject } from "zod-openapi";
import z from "zod";
import { ZonoSocketServer } from "./socket_server.js";
import { ContentfulStatusCode, SuccessStatusCode } from "hono/utils/http-status";
import { typedObjectEntries } from "../internal_util/typed_helpers.js";
import { OptionalPromise } from "../internal_types.js";

export class ZonoServer<
    T extends ZonoEndpointRecord,
    U extends ZonoServerOptions<T>,
> {
    readonly endpoints: T;
    readonly options: U;
    private _server: Server<any> | null = null;
    private coveredPaths: Set<string> = new Set();

    constructor(
        endpoints: T,
        options: U
    ) {
        this.endpoints = endpoints;
        this.options = options;
    }

    start(): Server<any> {
        if (this._server) throw new Error("Server already started");

        const app = new Hono();

        if (this.options.middleware) {
            for (const middleware of this.options.middleware) {
                app.use(middleware);
            }
        }

        for (const [endpointName, endpoint] of typedObjectEntries(this.endpoints)) {
            const path = `${this.options.basePath ?? ""}${endpoint.path}`;

            const coveredPath = this.getCoveredPath(endpoint.definition.method, path);
            if (this.coveredPaths.has(coveredPath)) {
                throw new Error(`Path ${coveredPath} is already covered`);
            }
            this.coveredPaths.add(coveredPath);

            const instantiator = app[endpoint.definition.method];
            const handler = this.createHandler(
                endpoint,
                this.options.handlers[endpointName],
                {
                    globalHeaders: this.options.globalHeaders,
                    obfuscate:
                        this.options.handlerOptions?.obfuscate ||
                        this.options.specificHandlerOptions?.[endpointName]?.obfuscate,
                },
            );
            instantiator(path, handler);
        }

        if (this.options.openApiOptions) {
            app.get(`${this.options.openApiOptions.path}.json`, (c) => c.json(this.getOpenApiJson()));
            app.get(this.options.openApiOptions.path, (c) => c.html(this.getOpenApiHtml()));
        }

        const socket = this.options.socket;
        const { websocket } = socket?.engine.handler() ?? {};

        const baseOptions = {
            fetch(req: Request, server: Server<any>) {
                if (socket) {
                    const url = new URL(req.url);
                    const socketStart = socket.serverOpts.path ?? "/socket.io";
                    if (url.pathname.startsWith(socketStart)) {
                        return socket.engine.handleRequest(req, server);
                    }
                }
                return app.fetch(req, server);
            },
            port: this.options.port,
            hostname: this.options.bind,
            idleTimeout: 30,
        };

        this._server = websocket 
            ? serve({ ...baseOptions, websocket })
            : serve(baseOptions);
        return this._server;
    }

    get server() {
        return this._server;
    }

    async stop(closeActiveConnections: boolean = false) {
        if (!this._server) return;
        await this._server.stop(closeActiveConnections);
        this.coveredPaths.clear();
        this._server = null;
    }

    private createHandler<T extends ZonoEndpoint>(
        endpoint: ZonoEndpoint,
        fn: ZonoEndpointHandler<T>,
        options?: ZonoEndpointHandlerOptions
    ): Handler {
        return async (ctx) => {
            try {
                let parsedPath: any;
                if (endpoint.definition.additionalPaths) {
                    const additionalPathCount = endpoint.definition.path.split("/").length;
                    const additionalPaths = ctx.req.path
                        .replace(this.options.basePath ?? "", "")
                        .split("/")
                        .slice(additionalPathCount);
                    const parsed = await endpoint.definition.additionalPaths.safeParseAsync(additionalPaths);
                    if (!parsed.success) {
                        const error = options?.obfuscate
                            ? { error: "Invalid path" }
                            : {
                                error: "Invalid path",
                                zodError: JSON.parse(parsed.error.message),
                            }
                        return ctx.json(error, 400);
                    }
                    parsedPath = parsed.data as any;
                }

                let parsedBody: any;
                if (endpoint.definition.body) {
                    const body = await ctx.req.json();
                    const parsed = await endpoint.definition.body.safeParseAsync(body);
                    if (!parsed.success) {
                        const error = options?.obfuscate
                            ? { error: "Invalid body" }
                            : {
                                error: "Invalid body",
                                zodError: JSON.parse(parsed.error.message),
                            }
                        return ctx.json(error, 400);
                    }
                    parsedBody = parsed.data as any;
                }

                let parsedQuery: any;
                if (endpoint.definition.query) {
                    const formatted: Record<string, Array<string> | string> = {};
                    for (const [key, fullSchema] of Object.entries(endpoint.definition.query.shape)) {
                        const schema = "unwrap" in fullSchema ? fullSchema.unwrap() : fullSchema;
                        const value = schema.type === "array" ? ctx.req.queries(key) : ctx.req.query(key);
                        if (!value) continue;
                        formatted[key] = value;
                    }
                    const parsed = await endpoint.definition.query.safeParseAsync(formatted);
                    if (!parsed.success) {
                        const error = options?.obfuscate
                            ? { error: "Invalid query" }
                            : {
                                error: "Invalid query",
                                zodError: JSON.parse(parsed.error.message),
                            }
                        return ctx.json(error, 400);
                    }
                    parsedQuery = parsed.data as any;
                }

                const combinedHeadersSchema = endpoint.definition.headers || options?.globalHeaders ? z.object({
                    ...endpoint.definition.headers?.shape,
                    ...options?.globalHeaders?.shape,
                }) : undefined;
                
                let parsedHeaders: any;
                if (combinedHeadersSchema) {
                    const headers: Record<string, string> = {};
                    for (const [key, schema] of Object.entries(combinedHeadersSchema.shape)) {
                        const header = ctx.req.header(key);
                        const parsed = await schema.safeParseAsync(header);
                        if (!parsed.success) {
                            const error = options?.obfuscate
                                ? { error: "Invalid header" }
                                : {
                                    error: "Invalid header",
                                    zodError: JSON.parse(parsed.error.message),
                                }
                            return ctx.json(error, 400);
                        }
                        headers[key] = parsed.data as any;
                    }
                    parsedHeaders = headers;
                }

                const response = await fn({
                    body: parsedBody,
                    query: parsedQuery,
                    headers: parsedHeaders,
                    additionalPaths: parsedPath,
                } as any);

                if (response.status !== 200) {
                    return ctx.json({ error: response.error }, response.status);
                }

                return ctx.json(response.data as any, 200);
            }
            catch (error) {
                console.debug(error);
                return ctx.json({ error: "Internal server error" }, 500);
            }
        }
    }

    private getOpenApiJson() {
        if (!this.options.openApiOptions) {
            throw new Error("OpenAPI options are not set");
        }
        const docs = createDocument({
            openapi: "3.0.0",
            info: {
                title: this.options.openApiOptions.title,
                version: this.options.openApiOptions.version,
            },
            paths: typedObjectEntries(this.endpoints).reduce((p, [name, { path, definition }]) => {
                p[path] = {
                    [definition.method]: this.getOpenApiOperationData(name),
                };
                return p;
            }, {} as ZodOpenApiPathsObject),
        });

        return docs;
    }

    private getOpenApiOperationData(name: keyof T): ZodOpenApiOperationObject {
        const endpointDefinition = this.endpoints[name].definition;
        const moreInfo = this.options.openApiOptions?.descriptions?.[name];
        const data: ZodOpenApiOperationObject = {
            ...moreInfo,
            responses: {
                "200": {
                    description: "Success",
                    content: {
                        "application/json": {
                            schema: endpointDefinition.response,
                        },
                    },
                },
            },
            requestParams: {},
        };

        if (endpointDefinition.body) {
            data.requestBody = {
                content: {
                    "application/json": {
                        schema: endpointDefinition.body,
                    },
                },
            };
        }

        if (endpointDefinition.query) {
            data.requestParams!.query = endpointDefinition.query;
        }

        if (endpointDefinition.headers) {
            data.requestParams!.header = endpointDefinition.headers;
        }

        return data;
    }

    private getOpenApiHtml() {
        if (!this.options.openApiOptions) {
            throw new Error("OpenAPI options are not set");
        }
        const str = `
            <!DOCTYPE html>
            <html>
                <head>
                    <title>${this.options.openApiOptions.title} Docs</title>
                    <link rel="stylesheet" href="https://unpkg.com/swagger-ui-dist/swagger-ui.css" />
                </head>
                <body>
                    <div id="swagger-ui"></div>
                    <script src="https://unpkg.com/swagger-ui-dist/swagger-ui-bundle.js"></script>
                    <script>
                        window.onload = () => {
                            SwaggerUIBundle({
                                url: '${this.options.openApiOptions.path}.json',
                                dom_id: '#swagger-ui',
                            })
                        }
                    </script>
                </body>
            </html>
        `;

        return str;
    }

    private getCoveredPath(method: string, path: string) {
        const parts = path.split("/");
        const formattedParts = [];
        for (const part of parts) {
            if (part.startsWith(":")) {
                formattedParts.push(`[${part.slice(1)}]`);
            } else {
                formattedParts.push(part);
            }
        }
        return `${method} ${formattedParts.join("/")}`;
    }
}

export type ZonoServerOptions<T extends ZonoEndpointRecord> = {
    bind: string;
    port: number;
    handlers: {
        [K in keyof T]: ZonoEndpointHandler<T[K]>;
    };
    basePath?: string;
    socket?: ZonoSocketServer;
    handlerOptions?: ZonoEndpointHandlerOptions;
    specificHandlerOptions?: Partial<Record<keyof T, ZonoEndpointHandlerOptions>>;
    globalHeaders?: ZonoEndpointHeadersDefinition;
    openApiOptions?: ZonoOpenApiOptions<T>;
    middleware?: Array<MiddlewareHandler>;
}

export type ZonoOpenApiOptions<T extends ZonoEndpointRecord> = {
    title: string;
    version: string;
    path: string;
    descriptions?: {
        [K in keyof T]?: Pick<
            ZodOpenApiOperationObject,
            "deprecated" |
            "summary" |
            "description" |
            "tags"
        >;
    }
}

export type ZonoEndpointHandler<T extends ZonoEndpoint = ZonoEndpoint> = (options: ZonoEndpointHandlerPassIn<T>) => ZonoEndpointHandlerReturn<T>;

export type ZonoEndpointHandlerReturn<T extends ZonoEndpoint = ZonoEndpoint> = OptionalPromise<{
    status: 200,
    data: z.input<T["definition"]["response"]>,
} | {
    status: Exclude<ContentfulStatusCode, SuccessStatusCode>,
    error: string,
}>;

export type ZonoEndpointHandlerOptions = {
    obfuscate?: boolean;
    globalHeaders?: ZonoEndpointHeadersDefinition;
}

export type ZonoEndpointHandlerPassIn<T extends ZonoEndpoint> = (
    T["definition"]["body"] extends z.ZodType ? { body: z.output<T["definition"]["body"]> } : {}
) & (
    T["definition"]["query"] extends z.ZodType ? { query: z.output<T["definition"]["query"]> } : {}
) & (
    T["definition"]["headers"] extends z.ZodType ? { headers: z.output<T["definition"]["headers"]> } : {}
) & (
    T["definition"]["additionalPaths"] extends z.ZodType ? { additionalPaths: z.output<T["definition"]["additionalPaths"]> } : {}
);