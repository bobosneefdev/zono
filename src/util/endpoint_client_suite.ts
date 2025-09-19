import { ZonoEndpointRecord } from "../classes/endpoint";
import { typedObjectEntries } from "../util";
import { createZonoClient, ZonoClient, ZonoClientOptions } from "./endpoint_client";

export function createZonoClientSuite<
    T extends ZonoEndpointRecord,
    U extends ZonoClientSuiteOptions<T>
>(
    endpoints: T,
    options: U
): { [K in keyof T]: ZonoClient<T[K], U> } {
    const result = typedObjectEntries(endpoints).reduce(
        (prev, [key, endpoint]) => {
            prev[key] = createZonoClient(endpoint, {
                ...options,
                ...options.overwriteSpecificOptions?.[key],
            });
            return prev;
        },
        {} as { [K in keyof T]: ZonoClient<T[K], U> }
    );
    return result;
}

export type ZonoClientSuiteOptions<T extends ZonoEndpointRecord> = ZonoClientOptions & {
    overwriteSpecificOptions?: {
        [K in keyof T]?: Partial<ZonoClientOptions>;
    }
};