import { ZonoEndpointRecord } from "../shared/endpoint.js";
import { ZonoEndpointClient, ZonoEndpointClientOptions } from "./endpoint_client.js";

export function createZonoEndpointClientSuite<
	T extends ZonoEndpointRecord,
	U extends ZonoEndpointClientSuiteOptions<T>,
>(endpoints: T, opts: U): ZonoEndpointClientSuite<T, U> {
	const result = {} as Record<string, ZonoEndpointClient>;
	for (const key in endpoints) {
		const endpoint = endpoints[key];
		const overwrite = opts.overwriteSpecificEndpoints?.[key];
		result[key] = new ZonoEndpointClient(endpoint, {
			...opts,
			...overwrite,
		});
	}
	return result as ZonoEndpointClientSuite<T, U>;
}

export type ZonoEndpointClientSuiteOptions<T extends ZonoEndpointRecord = ZonoEndpointRecord> =
	ZonoEndpointClientOptions & {
		overwriteSpecificEndpoints?: {
			[K in keyof T]?: Partial<Omit<ZonoEndpointClientOptions, "">>;
		};
	};

export type ZonoEndpointClientSuite<
	T extends ZonoEndpointRecord = ZonoEndpointRecord,
	U extends ZonoEndpointClientSuiteOptions<T> = ZonoEndpointClientSuiteOptions<T>,
> = {
	[K in keyof T]: ZonoEndpointClient<T[K], ZonoEndpointClientCombinedOptions<T, U, K>>;
};

type ExtractEndpointOverwriteOptions<
	T extends ZonoEndpointRecord,
	U extends ZonoEndpointClientSuiteOptions<T>,
	K extends keyof T,
> = U["overwriteSpecificEndpoints"] extends Record<string, any>
	? K extends keyof U["overwriteSpecificEndpoints"]
		? U["overwriteSpecificEndpoints"][K]
		: never
	: never;

type ZonoEndpointClientCombinedOptions<
	T extends ZonoEndpointRecord,
	U extends ZonoEndpointClientSuiteOptions<T>,
	K extends keyof T,
> = ExtractEndpointOverwriteOptions<T, U, K> extends never
	? U
	: Omit<U, keyof ExtractEndpointOverwriteOptions<T, U, K>> &
			ExtractEndpointOverwriteOptions<T, U, K>;
