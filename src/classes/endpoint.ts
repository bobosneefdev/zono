import z from "zod";
import { OptionalPromise, ZodStringLike, ZonoHeadersDefinition, ZonoQueryDefinition } from "../types";
import { Handler } from "hono";
import axios, { AxiosRequestConfig, AxiosResponse } from "axios";

export class ZonoEndpoint<T extends ZonoEndpointDefinition> {
    readonly definition: T;
    readonly path: `/${string}`;

    constructor(definition: T) {
        this.definition = definition;
        this.path = this.createPath(definition);
    }

    private createPath(definition: T): `/${string}` {
        let path = definition.path;

        if (definition.additionalPaths) {
            const pathParts = definition.additionalPaths?._zod.def.items ?? [];
            for (let i = 0; i < pathParts.length; i++) {
                path += `/:${i}`;
            }
        }
        return path;
    }

    createHandler(
        fn: ZonoEndpointHandler<T>,
        options?: ZonoEndpointHandlerOptions
    ): Handler {
        return async (ctx) => {
            let parsedPath: any;
            if (this.definition.additionalPaths) {
                const additionalParts = ctx.req.path.split("/").slice(this.definition.path.split("/").length);
                const parsed = await this.definition.additionalPaths.safeParseAsync(additionalParts);
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
            if (this.definition.body) {
                const body = await ctx.req.json();
                const parsed = await this.definition.body.safeParseAsync(body);
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
            if (this.definition.query) {
                const query = ctx.req.query();
                const parsed = await this.definition.query.safeParseAsync(query);
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

            const combinedHeadersSchema = this.definition.headers || options?.globalHeaders ? z.object({
                ...this.definition.headers?.shape,
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

    createClient<U extends ZonoEndpointClientOptions>(options: U): ZonoEndpointClient<T, U> {
        return async (
            callData: ZonoEndpointClientCallData<T, U>,
            axiosConfig?: CompatibleAxiosRequestConfig
        ) => {
            const config = this.getAxiosConfig(options, callData, axiosConfig);
            const response = await axios(config);
            return response;
        }
    }

    private getAxiosConfig<U extends ZonoEndpointClientOptions>(
        options: U,
        callData: ZonoEndpointClientCallData<T, U>,
        axiosConfig?: CompatibleAxiosRequestConfig
    ): AxiosRequestConfig {
        return {
            url: `${options.baseUrl}${this.definition.path}${"additionalPaths" in callData ? `/${callData.additionalPaths.join("/")}` : ""}`,
            method: this.definition.method,
            data: "body" in callData ? callData.body : undefined,
            params: "query" in callData ? callData.query : undefined,
            headers: "headers" in callData ? callData.headers : undefined,
            ...axiosConfig,
        }
    }
}

export type ZonoEndpointAny = ZonoEndpoint<ZonoEndpointDefinition>;

export type ZonoEndpointDefinition = {
    method: "get" | "post" | "put" | "delete" | "patch";
    path: `/${string}`;
    body?: z.ZodType;
    query?: ZonoQueryDefinition;
    headers?: ZonoHeadersDefinition;
    additionalPaths?: z.ZodTuple<Array<ZodStringLike>>;
    response: z.ZodType;
}

export type ZonoEndpointHandler<T extends ZonoEndpointDefinition> = (options: ZonoEndpointHandlerPassIn<T>) => OptionalPromise<z.infer<T["response"]>>;

export type ZonoEndpointHandlerAny = ZonoEndpointHandler<ZonoEndpointDefinition>;

export type ZonoEndpointHandlerOptions = {
    obfuscate?: boolean;
    globalHeaders?: ZonoHeadersDefinition;
}

export type ZonoEndpointHandlerPassIn<T extends ZonoEndpointDefinition> = (
    T["body"] extends z.ZodType ? { body: z.infer<T["body"]> } : {}
) & (
    T["query"] extends z.ZodType ? { query: z.infer<T["query"]> } : {}
) & (
    T["headers"] extends z.ZodType ? { headers: z.infer<T["headers"]> } : {}
) & (
    T["additionalPaths"] extends z.ZodTuple<Array<ZodStringLike>> ? { additionalPaths: z.infer<T["additionalPaths"]> } : {}
);

type CompatibleAxiosRequestConfig = Omit<
    AxiosRequestConfig,
    "url" |
    "method" |
    "data" |
    "params" |
    "headers" |
    "transformRequest" |
    "transformResponse"
>;

export type ZonoEndpointClient<
    T extends ZonoEndpointDefinition,
    U extends ZonoEndpointClientOptions
> = (
    options: ZonoEndpointClientCallData<T, U>,
    axiosConfig?: CompatibleAxiosRequestConfig,
) => Promise<ZonoEndpointClientResponse<T>>;

export type ZonoEndpointClientAny = ZonoEndpointClient<any, any>;

export type ZonoEndpointClientOptions = {
    baseUrl: string;
    globalHeaders?: ZonoHeadersDefinition;
}

export type ZonoEndpointClientCallData<
    T extends ZonoEndpointDefinition,
    U extends ZonoEndpointClientOptions
> = (
    T["body"] extends z.ZodType
        ? { body: z.infer<T["body"]> }
        : {}
) & (
    T["query"] extends z.ZodType
        ? { query: z.infer<T["query"]> }
        : {}
) & (
    U["globalHeaders"] extends z.ZodType
        ? { headers: z.infer<U["globalHeaders"]> }
        : {}
) & (
    T["headers"] extends z.ZodType
        ? { headers: z.infer<T["headers"]> }
        : {}
) & (
    T["additionalPaths"] extends z.ZodTuple<Array<ZodStringLike>>
        ? { additionalPaths: z.infer<T["additionalPaths"]> }
        : {}
);

export type ZonoEndpointClientResponse<T extends ZonoEndpointDefinition> = AxiosResponse<z.infer<T["response"]>>;