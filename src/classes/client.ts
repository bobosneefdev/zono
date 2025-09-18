import { ZonoEndpointAny, ZonoEndpointClient, ZonoEndpointClientOptions, ZonoEndpointDefinition } from "./endpoint";

export class ZonoClient<
    T extends Record<string, ZonoEndpointAny>,
    U extends ZonoEndpointClientOptions
> {
    readonly endpoints: T;
    readonly options: U;

    constructor(endpoints: T, options: U) {
        this.endpoints = endpoints;
        this.options = options;
    }

    build(): {
        [K in keyof T]: ZonoEndpointClient<T[K]["definition"], U>;
    } {
        const result: Record<string, ZonoEndpointClient<ZonoEndpointDefinition, U>> = {};
        for (const [key, endpoint] of Object.entries(this.endpoints)) {
            result[key] = endpoint.createClient(this.options);
        }
        return result as {
            [K in keyof T]: ZonoEndpointClient<T[K]["definition"], U>;
        };
    }
}