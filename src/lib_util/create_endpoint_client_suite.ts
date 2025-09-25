import { ZonoEndpointRecord } from "../classes/endpoint";
import { ZonoEndpointAxiosClient } from "../classes/endpoint_axios_client";
import { ZonoEndpointFetchClient } from "../classes/endpoint_fetch_client";
import { typedObjectEntries } from "../internal_util/typed_helpers";
import { ZonoEndpointClientOptions } from "../lib_types";

export function createZonoEndpointAxiosClientSuite<
    T extends ZonoEndpointRecord,
    U extends ZonoEndpointClientSuiteOptions<T>
>(
    endpoints: T,
    options: U,
) {
    return typedObjectEntries(endpoints).reduce(
        (prev, [key, value]) => {
            prev[key] = new ZonoEndpointAxiosClient(value, {
                ...options,
                ...options.overwriteSpecificOptions?.[key],
            }) as any;
            return prev;
        },
        {} as { [K in keyof T]: ZonoEndpointAxiosClient<T[K], GetCombinedOptions<T, K, U>> }
    );
}

export function createZonoEndpointFetchClientSuite<
    T extends ZonoEndpointRecord,
    U extends ZonoEndpointClientSuiteOptions<T>
>(
    endpoints: T,
    options: U,
) {
    return typedObjectEntries(endpoints).reduce(
        (prev, [key, value]) => {
            prev[key] = new ZonoEndpointFetchClient(value, {
                ...options,
                ...options.overwriteSpecificOptions?.[key],
            }) as any;
            return prev;
        },
        {} as { [K in keyof T]: ZonoEndpointFetchClient<T[K], GetCombinedOptions<T, K, U>> }
    );
}

export type ZonoEndpointClientSuiteOptions<T extends ZonoEndpointRecord = ZonoEndpointRecord> = ZonoEndpointClientOptions & {
    overwriteSpecificOptions?: {
        [K in keyof T]?: Partial<ZonoEndpointClientOptions>;
    }
};

type GetCombinedOptions<
    T extends ZonoEndpointRecord,
    K extends keyof T,
    U extends ZonoEndpointClientSuiteOptions<T>
> = U & (
    U["overwriteSpecificOptions"] extends Record<string, any>
        ? K extends keyof U["overwriteSpecificOptions"]
            ? NonNullable<U["overwriteSpecificOptions"][K]>
            : {}
        : {}
);