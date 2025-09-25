import axios, { AxiosRequestConfig, AxiosResponse, RawAxiosRequestHeaders } from "axios";
import { ZonoEndpointClientCallData, ZonoEndpointClientOptions } from "../lib_types";
import { ZonoEndpoint } from "./endpoint";
import z from "zod";
import { combineHeadersSchema } from "../internal_util/combine_headers_schema";

export class ZonoEndpointAxiosClient<
    T extends ZonoEndpoint,
    U extends ZonoEndpointClientOptions
> {
    readonly endpoint: T;
    readonly options: U;
    readonly axiosConfig?: CompatibleAxiosConfig;

    constructor(
        endpoint: T,
        options: U,
        axiosConfig?: CompatibleAxiosConfig
    ) {
        this.endpoint = endpoint;
        this.options = options;
        this.axiosConfig = axiosConfig;
    }

    async call(
        callData: ZonoEndpointClientCallData<T, U>,
        additionalConfig?: CompatibleAxiosConfig
    ): Promise<ZonoEndpointAxiosClientResponse<T>> {
        const config = this.getAxiosConfig(callData, additionalConfig);
        const response = await axios(config);
        const parsedData = await this.endpoint.definition.response.safeParseAsync(response.data);
        if (!parsedData.success) {
            return {
                parsed: false,
                response,
                error: parsedData.error,
            }
        }
        return {
            parsed: true,
            response,
            data: parsedData.data as z.infer<T["definition"]["response"]>,
        }
    }

    getAxiosConfig(
        callData: ZonoEndpointClientCallData<T, U>,
        additionalConfig?: CompatibleAxiosConfig
    ): AxiosRequestConfig {
        return {
            url: this.buildUrl(callData),
            method: this.endpoint.definition.method,
            data: this.buildData(callData),
            params: this.buildParams(callData),
            headers: this.buildHeaders(callData),
            ...this.axiosConfig,
            ...additionalConfig,
        }
    }

    private buildUrl(callData: ZonoEndpointClientCallData<T, U>): string {
        let urlStr = `${this.options.baseUrl}${this.endpoint.definition.path}`;
        if (this.endpoint.definition.additionalPaths) {
            const parsed = this.endpoint.definition.additionalPaths.parse("additionalPaths" in callData ? callData.additionalPaths : undefined);
            for (const path of parsed) {
                urlStr += `/${path}`;
            }
        }
        return urlStr;
    }

    private buildHeaders(callData: ZonoEndpointClientCallData<T, U>): RawAxiosRequestHeaders | undefined {
        const combinedHeaders = combineHeadersSchema([
            this.endpoint.definition.headers,
            this.options.globalHeaders,
        ]);
        if (!combinedHeaders) return undefined;
        return combinedHeaders.parse("headers" in callData ? callData.headers : undefined);
    }

    private buildData(callData: ZonoEndpointClientCallData<T, U>): any | undefined {
        if (!this.endpoint.definition.body) return undefined;
        return this.endpoint.definition.body.parse("body" in callData ? callData.body : undefined);
    }

    private buildParams(callData: ZonoEndpointClientCallData<T, U>): AxiosRequestConfig["params"] | undefined {
        if (!this.endpoint.definition.query) return undefined;
        return this.endpoint.definition.query.parse("query" in callData ? callData.query : undefined);
    }
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

export type ZonoEndpointAxiosClientResponse<T extends ZonoEndpoint> = {
    parsed: true;
    response: AxiosResponse<z.infer<T["definition"]["response"]>>;
    data: z.infer<T["definition"]["response"]>;
} | {
    parsed: false;
    response: AxiosResponse<any>;
    error: z.ZodError;
};