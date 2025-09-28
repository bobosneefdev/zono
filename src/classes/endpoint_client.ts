import z from "zod";
import { ZonoEndpointClientCallData, ZonoEndpointClientOptions } from "../lib_types.js";
import { ZonoEndpoint } from "./endpoint.js";
import { combineHeadersSchema } from "../internal_util/combine_headers_schema.js";
import axios, { AxiosRequestConfig, AxiosResponse, RawAxiosRequestHeaders } from "axios";

export class ZonoEndpointClient<
    T extends ZonoEndpoint = ZonoEndpoint,
    U extends ZonoEndpointClientOptions = ZonoEndpointClientOptions
> {
    readonly endpoint: T;
    readonly options: U;
    readonly defaultAxiosConfig?: CompatibleAxiosConfig;

    constructor(
        endpoint: T,
        options: U,
        defaultAxiosConfig?: CompatibleAxiosConfig
    ) {
        this.endpoint = endpoint;
        this.options = options;
        this.defaultAxiosConfig = defaultAxiosConfig;
    }
    
    async fetch(callData: ZonoEndpointClientCallData<T, U>): Promise<ZonoEndpointClientFetchResponse<T>> {
        const fetchConfig = this.getFetchConfig(callData);
        const response = await fetch(...fetchConfig);
        if (response.status !== 200) {
            return {
                success: false,
                response,
            }
        }
        const data = await response.json();
        const parsed = await this.endpoint.definition.response.safeParseAsync(data);
        if (!parsed.success) {
            return {
                success: false,
                zodError: parsed.error,
                response,
            }
        }
        return {
            success: true,
            data: parsed.data as z.infer<T["definition"]["response"]>,
            response,
        }
    }

    getFetchConfig(callData: ZonoEndpointClientCallData<T, U>): [URL, RequestInit] {
        const body = this.buildFetchBody(callData);
        const headers = body
            ? {
                "Content-Type": "application/json",
                ...this.buildFetchHeaders(callData)
            }
            : this.buildFetchHeaders(callData);
        return [
            this.buildUrl(callData),
            {
                method: this.endpoint.definition.method,
                headers,
                body,
            }
        ]
    }

    private buildFetchHeaders(callData: ZonoEndpointClientCallData<T, U>): HeadersInit | undefined {
        const combinedHeaders = combineHeadersSchema([
            this.endpoint.definition.headers,
            this.options.globalHeaders,
        ]);
        if (!combinedHeaders) return undefined;
        const parsed = combinedHeaders.parse("headers" in callData ? callData.headers : undefined);
        return Object.entries(parsed).reduce((prev, [key, value]) => {
            prev[key] = String(value);
            return prev;
        }, {} as Record<string, string>);
    }

    private buildFetchBody(callData: ZonoEndpointClientCallData<T, U>): BodyInit | undefined {
        if (!this.endpoint.definition.body) return undefined;
        const parsed = this.endpoint.definition.body.parse("body" in callData ? callData.body : undefined);
        return JSON.stringify(parsed);
    }

    async axios(
        callData: ZonoEndpointClientCallData<T, U>,
        additionalConfig?: CompatibleAxiosConfig
    ): Promise<ZonoEndpointClientAxiosResponse<T>> {
        const config = this.getAxiosConfig(callData, additionalConfig);
        const response = await axios(config);
        if (response.status !== 200) {
            return {
                success: false,
                response,
            }
        }
        const parsedData = await this.endpoint.definition.response.safeParseAsync(response.data);
        if (!parsedData.success) {
            return {
                success: false,
                response,
                zodError: parsedData.error,
            }
        }
        return {
            success: true,
            response,
            data: parsedData.data as z.infer<T["definition"]["response"]>,
        }
    }

    getAxiosConfig(
        callData: ZonoEndpointClientCallData<T, U>,
        additionalConfig?: CompatibleAxiosConfig
    ): AxiosRequestConfig {
        return {
            url: this.buildUrl(callData).toString(),
            method: this.endpoint.definition.method,
            data: this.buildAxiosData(callData),
            headers: this.buildAxiosHeaders(callData),
            ...this.defaultAxiosConfig,
            ...additionalConfig,
        }
    }

    private buildAxiosHeaders(callData: ZonoEndpointClientCallData<T, U>): RawAxiosRequestHeaders | undefined {
        const combinedHeaders = combineHeadersSchema([
            this.endpoint.definition.headers,
            this.options.globalHeaders,
        ]);
        if (!combinedHeaders) return undefined;
        return combinedHeaders.parse("headers" in callData ? callData.headers : undefined);
    }

    private buildAxiosData(callData: ZonoEndpointClientCallData<T, U>): any | undefined {
        if (!this.endpoint.definition.body) return undefined;
        return this.endpoint.definition.body.parse("body" in callData ? callData.body : undefined);
    }

    private buildUrl(callData: ZonoEndpointClientCallData<T, U>): URL {
        let urlStr = `${this.options.baseUrl}${this.endpoint.definition.path}`;
        if (this.endpoint.definition.additionalPaths) {
            const parsed = this.endpoint.definition.additionalPaths.parse("additionalPaths" in callData ? callData.additionalPaths : undefined);
            for (const path of parsed) {
                urlStr += `/${path}`;
            }
        }

        const url = new URL(urlStr);
        if ("query" in callData && this.endpoint.definition.query) {
            const parsed = this.endpoint.definition.query.parse(callData.query);
            if (parsed) {
                for (const [key, value] of Object.entries(parsed)) {
                    if (Array.isArray(value)) {
                        for (const item of value) {
                            url.searchParams.append(key, String(item));
                        }
                    }
                    else {
                        url.searchParams.set(key, String(value));
                    }
                }
            }
        }

        return url;
    }
}

export type ZonoEndpointClientRecord<T extends Record<string, ZonoEndpoint> = Record<string, ZonoEndpoint>> = T;

export type ZonoEndpointClientFetchResponse<T extends ZonoEndpoint> = ({
    success: true;
    data: z.infer<T["definition"]["response"]>;
} | {
    success: false;
    zodError?: z.ZodError;
}) & {
    response: Response;
}

type CompatibleAxiosConfig = Omit<
    AxiosRequestConfig,
    "url" |
    "method" |
    "data" |
    "params" |
    "headers" |
    "transformRequest" |
    "transformResponse"
>;

export type ZonoEndpointClientAxiosResponse<T extends ZonoEndpoint> = {
    success: true;
    response: AxiosResponse<z.infer<T["definition"]["response"]>>;
    data: z.infer<T["definition"]["response"]>;
} | {
    success: false;
    response: AxiosResponse<any>;
    zodError?: z.ZodError;
};