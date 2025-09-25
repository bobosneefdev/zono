import { ZonoEndpointRecord } from "../classes/endpoint.js";
import { ZonoEndpointClient } from "../classes/endpoint_client.js";
import { typedObjectEntries } from "../internal_util/typed_helpers.js";
import { ZonoEndpointClientOptions } from "../lib_types.js";

export function createZonoEndpointClientSuite<
    T extends ZonoEndpointRecord,
    U extends ZonoEndpointClientSuiteOptions<T>
>(
    endpoints: T,
    options: U,
) {
    return typedObjectEntries(endpoints).reduce(
        (prev, [key, value]) => {
            prev[key] = new ZonoEndpointClient(value, {
                ...options,
                ...options.overwriteSpecificOptions?.[key],
            }) as any;
            return prev;
        },
        {} as { [K in keyof T]: ZonoEndpointClient<T[K], GetCombinedOptions<T, K, U>> }
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