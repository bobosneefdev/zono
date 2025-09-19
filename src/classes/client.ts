import axios, { AxiosRequestConfig, AxiosResponse } from "axios";
import { ZonoEndpoint, ZonoEndpointRecord } from "./endpoint";
import z from "zod";
import { ZodStringLike, ZonoHeadersDefinition } from "../types";
import { typedObjectEntries } from "../util";

export function createZonoClient<
    T extends ZonoEndpointRecord,
    U extends ZonoEndpointClientOptions
>(
    endpoints: T,
    options: U
): { [K in keyof T]: ZonoEndpointClient<T[K], U> } {
    const result = typedObjectEntries(endpoints).reduce(
        (prev, [key, endpoint]) => {
            prev[key] = createEndpointClient(endpoint, options);
            return prev;
        },
        {} as { [K in keyof T]: ZonoEndpointClient<T[K], U> }
    );
    return result;
}

function createEndpointClient<
    T extends ZonoEndpoint,
    U extends ZonoEndpointClientOptions
>(
    endpoint: T,
    options: U
): ZonoEndpointClient<T, U> {
    return async (
        callData: ZonoEndpointClientCallData<T, U>,
        axiosConfig?: CompatibleAxiosRequestConfig
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
    U extends ZonoEndpointClientOptions
>(
    endpoint: T,
    options: U,
    callData: ZonoEndpointClientCallData<T, U>,
    axiosConfig?: CompatibleAxiosRequestConfig
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

export type ZonoEndpointClient<
    T extends ZonoEndpoint,
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
    T extends ZonoEndpoint,
    U extends ZonoEndpointClientOptions
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

export type ZonoEndpointClientResponse<T extends ZonoEndpoint> = {
    parsed: true;
    response: AxiosResponse<z.infer<T["definition"]["response"]>>;
} | {
    parsed: false;
    response: AxiosResponse<any>;
    error: z.ZodError;
};

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