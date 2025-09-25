import z from "zod";
import { ZonoEndpointClientCallData, ZonoEndpointClientOptions } from "../lib_types";
import { ZonoEndpoint } from "./endpoint";
import { combineHeadersSchema } from "../internal_util/combine_headers_schema";

export class ZonoEndpointFetchClient<
    T extends ZonoEndpoint,
    U extends ZonoEndpointClientOptions
> {
    readonly endpoint: T;
    readonly options: U;

    constructor(
        endpoint: T,
        options: U,
    ) {
        this.endpoint = endpoint;
        this.options = options;
    }
    
    async call(callData: ZonoEndpointClientCallData<T, U>): Promise<ZonoEndpointFetchClientResponse<T>> {
        const [url, fetchConfig] = this.getFetchConfig(callData);
        const response = await fetch(url, fetchConfig);
        const data = await response.json();
        const parsed = await this.endpoint.definition.response.safeParseAsync(data);
        if (!parsed.success) {
            return {
                parsed: false,
                error: parsed.error,
                response,
            }
        }
        return {
            parsed: true,
            data: parsed.data as z.infer<T["definition"]["response"]>,
            response,
        }
    }

    getFetchConfig(callData: ZonoEndpointClientCallData<T, U>): [URL, RequestInit] {
        return [
            this.buildUrl(callData),
            {
                method: this.endpoint.definition.method,
                headers: this.buildHeaders(callData),
                body: this.buildBody(callData),
            }
        ]
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
            for (const [key, value] of Object.entries(parsed)) {
                url.searchParams.set(key, String(value));
            }
        }

        return url;
    }

    private buildHeaders(callData: ZonoEndpointClientCallData<T, U>): HeadersInit | undefined {
        const combinedHeaders = combineHeadersSchema([
            this.endpoint.definition.headers,
            this.options.globalHeaders,
        ]);
        if (!combinedHeaders) return undefined;
        const parsed = combinedHeaders.parse("headers" in callData ? callData.headers : undefined);
        return Object.entries(parsed).map(([key, value]) => [key, String(value)] as [string, string]);
    }

    private buildBody(callData: ZonoEndpointClientCallData<T, U>): BodyInit | undefined {
        if (!this.endpoint.definition.body) return undefined;
        const parsed = this.endpoint.definition.body.parse("body" in callData ? callData.body : undefined);
        return JSON.stringify(parsed);
    }
}

export type ZonoEndpointFetchClientResponse<T extends ZonoEndpoint> = ({
    parsed: true;
    data: z.infer<T["definition"]["response"]>;
} | {
    parsed: false;
    error: z.ZodError;
}) & {
    response: Response;
}