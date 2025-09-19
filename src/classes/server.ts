import { Handler, Hono, MiddlewareHandler } from "hono";
import { OptionalPromise, ZodStringLike, ZonoHeadersDefinition } from "../types";
import { ZonoEndpoint, ZonoEndpointRecord } from "./endpoint";
import { serve, Server } from "bun";
import { createDocument, ZodOpenApiOperationObject, ZodOpenApiPathsObject } from "zod-openapi";
import { typedObjectEntries } from "../util";
import z from "zod";

export class ZonoServer<
    T extends ZonoEndpointRecord,
    U extends ZonoServerOptions<T>,
> {
    readonly endpoints: T;
    readonly options: U;
    private _server: Server | null = null;

    constructor(
        endpoints: T,
        options: U
    ) {
        this.endpoints = endpoints;
        this.options = options;
    }

    start(): Server {
        const app = new Hono();

        for (const [endpointName, endpoint] of typedObjectEntries(this.endpoints)) {
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
            instantiator(endpoint.path, handler);
        }

        if (this.options.openApiOptions) {
            app.get(`${this.options.openApiOptions.path}.json`, (c) => c.json(this.getOpenApiJson()));
            app.get(this.options.openApiOptions.path, (c) => c.html(this.getOpenApiHtml()));
        }

        if (this.options.middleware) {
            for (const middleware of this.options.middleware) {
                app.use(middleware);
            }
        }

        this._server = serve({
            fetch: app.fetch,
            port: this.options.port,
            hostname: this.options.bind,
        });
        return this._server;
    }

    get server() {
        return this._server;
    }

    async stop() {
        if (!this._server) {
            return;
        }
        await this._server.stop();
        this._server = null;
    }

    private createHandler<T extends ZonoEndpoint>(
        endpoint: ZonoEndpoint,
        fn: ZonoEndpointHandler<T>,
        options?: ZonoEndpointHandlerOptions
    ): Handler {
        return async (ctx) => {
            let parsedPath: any;
            if (endpoint.definition.additionalPaths) {
                const additionalParts = ctx.req.path.split("/").slice(endpoint.definition.path.split("/").length);
                const parsed = await endpoint.definition.additionalPaths.safeParseAsync(additionalParts);
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
                const query = ctx.req.query();
                const parsed = await endpoint.definition.query.safeParseAsync(query);
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

            return ctx.json(response as any);
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
            paths: typedObjectEntries(this.endpoints).reduce((p, [name, { definition }]) => {
                p[definition.path] = {
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
}

export type ZonoServerOptions<T extends ZonoEndpointRecord> = {
    bind: string;
    port: number;
    handlerOptions?: ZonoEndpointHandlerOptions;
    specificHandlerOptions?: Partial<Record<keyof T, ZonoEndpointHandlerOptions>>;
    handlers: {
        [K in keyof T]: ZonoEndpointHandler<T[K]>;
    };
    globalHeaders?: ZonoHeadersDefinition;
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

export type ZonoEndpointHandler<T extends ZonoEndpoint = ZonoEndpoint> = (options: ZonoEndpointHandlerPassIn<T>) => OptionalPromise<z.infer<T["definition"]["response"]>>;

export type ZonoEndpointHandlerOptions = {
    obfuscate?: boolean;
    globalHeaders?: ZonoHeadersDefinition;
}

export type ZonoEndpointHandlerPassIn<T extends ZonoEndpoint> = (
    T["definition"]["body"] extends z.ZodType ? { body: z.infer<T["definition"]["body"]> } : {}
) & (
    T["definition"]["query"] extends z.ZodType ? { query: z.infer<T["definition"]["query"]> } : {}
) & (
    T["definition"]["headers"] extends z.ZodType ? { headers: z.infer<T["definition"]["headers"]> } : {}
) & (
    T["definition"]["additionalPaths"] extends z.ZodTuple<Array<ZodStringLike>> ? { additionalPaths: z.infer<T["definition"]["additionalPaths"]> } : {}
);