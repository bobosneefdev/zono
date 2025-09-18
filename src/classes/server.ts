import { Hono } from "hono";
import { ZonoHeadersDefinition } from "../types";
import { ZonoEndpointAny, ZonoEndpointHandler, ZonoEndpointHandlerOptions } from "./endpoint";
import { serve, Server } from "bun";
import { createDocument, ZodOpenApiOperationObject, ZodOpenApiPathsObject } from "zod-openapi";
import { typeSafeObjectEntries } from "../util";

export class ZonoServer<
    T extends Record<string, ZonoEndpointAny>,
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

    start() {
        const app = new Hono();

        for (const [endpointName, endpoint] of typeSafeObjectEntries(this.endpoints)) {
            const instantiator = app[endpoint.definition.method];
            const handler = endpoint.createHandler(
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

        this._server = serve({
            fetch: app.fetch,
            port: this.options.port,
            hostname: this.options.bind,
        });
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
            paths: typeSafeObjectEntries(this.endpoints).reduce((p, [name, { definition }]) => {
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

export type ZonoServerOptions<T extends Record<string, ZonoEndpointAny>> = {
    bind: string;
    port: number;
    handlerOptions?: ZonoEndpointHandlerOptions;
    specificHandlerOptions?: Partial<Record<keyof T, ZonoEndpointHandlerOptions>>;
    handlers: {
        [K in keyof T]: ZonoEndpointHandler<T[K]["definition"]>;
    };
    globalHeaders?: ZonoHeadersDefinition;
    openApiOptions?: ZonoOpenApiOptions<T>;
}

export type ZonoOpenApiOptions<T extends Record<string, ZonoEndpointAny>> = {
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