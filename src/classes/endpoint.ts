import z from "zod";
import { OptionalPromise, ZodStringLike, ZonoHeadersDefinition, ZonoQueryDefinition } from "../types";
import { Handler } from "hono";
import axios, { AxiosRequestConfig, AxiosResponse } from "axios";

export class ZonoEndpoint<T extends ZonoEndpointDefinition> {
    readonly definition: T;

    constructor(definition: T) {
        this.definition = definition;
    }

    createHandler(
        fn: ZonoEndpointHandler<T>,
        options?: ZonoEndpointHandlerOptions
    ): Handler {
        return async (ctx) => {
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

            let parsedHeaders: any;
            if (this.definition.headers) {
                const headers = ctx.req.header();
                const parsed = await this.definition.headers.safeParseAsync(headers);
                if (!parsed.success) {
                    const error = options?.obfuscate
                        ? { error: "Invalid headers" }
                        : {
                            error: "Invalid headers",
                            zodError: JSON.parse(parsed.error.message),
                        }
                    return ctx.json(error, 400);
                }
                parsedHeaders = parsed.data as any;
            }

            const response = await fn({
                body: parsedBody,
                query: parsedQuery,
                headers: parsedHeaders,
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
            url: `${options.baseUrl}${this.definition.path}`,
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
    path: string;
    body?: z.ZodType;
    query?: ZonoQueryDefinition;
    headers?: ZonoHeadersDefinition;
    response: z.ZodType;
}

export type ZonoEndpointHandler<T extends ZonoEndpointDefinition> = (options: ZonoEndpointHandlerPassIn<T>) => OptionalPromise<z.infer<T["response"]>>;

export type ZonoEndpointHandlerAny = ZonoEndpointHandler<ZonoEndpointDefinition>;

export type ZonoEndpointHandlerOptions = {
    obfuscate?: boolean;
}

export type ZonoEndpointHandlerPassIn<T extends ZonoEndpointDefinition> = (
    T["body"] extends z.ZodType ? { body: z.infer<T["body"]> } : Record<string, never>
) & (
    T["query"] extends z.ZodType ? { query: z.infer<T["query"]> } : Record<string, never>
) & (
    T["headers"] extends z.ZodType ? { headers: z.infer<T["headers"]> } : Record<string, never>
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
    U extends ZonoEndpointClientOptions
        ? T["headers"] extends z.ZodType
            ? U["globalHeaders"] extends z.ZodType
                ? { headers: z.infer<T["headers"]> & z.infer<U["globalHeaders"]> }
                : { headers: z.infer<T["headers"]> }
            : U["globalHeaders"] extends z.ZodType
                ? { headers: z.infer<U["globalHeaders"]> }
                : {}
        : T["headers"] extends z.ZodType
            ? { headers: z.infer<T["headers"]> }
            : {}
);

export type ZonoEndpointClientResponse<T extends ZonoEndpointDefinition> = AxiosResponse<z.infer<T["response"]>>;