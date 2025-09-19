import axios, { AxiosRequestConfig, AxiosResponse } from "axios";
import { ZonoEndpoint } from "../classes/endpoint";
import z from "zod";
import { ZodStringLike, ZonoHeadersDefinition } from "../types";

export function createZonoClient<
    T extends ZonoEndpoint,
    U extends ZonoClientOptions
>(
    endpoint: T,
    options: U
): ZonoClient<T, U> {
    return async (
        callData: ZonoClientCallData<T, U>,
        axiosConfig?: ZonoClientAxiosConfig
    ) => {
        const config = getAxiosConfig(endpoint, options, callData, axiosConfig);
        const response = await axios(config);
        const parsedData = await endpoint.definition.response.safeParseAsync(response.data);
        if (!parsedData.success) {
            return {
                parsed: false,
                response,
                error: parsedData.error,
            }
        }
        response.data = parsedData.data;
        return {
            parsed: true,
            response,
        }
    }
}

function getAxiosConfig<
    T extends ZonoEndpoint,
    U extends ZonoClientOptions
>(
    endpoint: T,
    options: U,
    callData: ZonoClientCallData<T, U>,
    axiosConfig?: ZonoClientAxiosConfig
): AxiosRequestConfig {
    return {
        url: `${options.baseUrl}${endpoint.definition.path}${"additionalPaths" in callData ? `/${callData.additionalPaths.join("/")}` : ""}`,
        method: endpoint.definition.method,
        data: "body" in callData ? callData.body : undefined,
        params: "query" in callData ? callData.query : undefined,
        headers: "headers" in callData ? callData.headers : undefined,
        ...axiosConfig,
    }
}

export type ZonoClient<
    T extends ZonoEndpoint = ZonoEndpoint,
    U extends ZonoClientOptions = ZonoClientOptions
> = (
    options: ZonoClientCallData<T, U>,
    axiosConfig?: ZonoClientAxiosConfig,
) => Promise<ZonoClientResponse<T>>;

export type ZonoClientRecord<T extends Record<string, ZonoClient> = Record<string, ZonoClient>> = T;

export type ZonoClientOptions = {
    baseUrl: string;
    globalHeaders?: ZonoHeadersDefinition;
}

export type ZonoClientCallData<
    T extends ZonoEndpoint,
    U extends ZonoClientOptions
> = (
    T["definition"]["body"] extends z.ZodType
        ? { body: z.infer<T["definition"]["body"]> }
        : {}
) & (
    T["definition"]["query"] extends z.ZodType
        ? { query: z.infer<T["definition"]["query"]> }
        : {}
) & (
    U["globalHeaders"] extends z.ZodType
        ? { headers: z.infer<U["globalHeaders"]> }
        : {}
) & (
    T["definition"]["headers"] extends z.ZodType
        ? { headers: z.infer<T["definition"]["headers"]> }
        : {}
) & (
    T["definition"]["additionalPaths"] extends z.ZodTuple<Array<ZodStringLike>>
        ? { additionalPaths: z.infer<T["definition"]["additionalPaths"]> }
        : {}
);

export type ZonoClientResponse<T extends ZonoEndpoint> = {
    parsed: true;
    response: AxiosResponse<z.infer<T["definition"]["response"]>>;
} | {
    parsed: false;
    response: AxiosResponse<any>;
    error: z.ZodError;
};

type ZonoClientAxiosConfig = Omit<
    AxiosRequestConfig,
    "url" |
    "method" |
    "data" |
    "params" |
    "headers" |
    "transformRequest" |
    "transformResponse"
>;