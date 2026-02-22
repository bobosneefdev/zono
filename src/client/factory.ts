import { ZonoContract, ZonoRouter } from "~/contract/types.js";
import { ZonoClient, ZonoClientConfig } from "./types.js";

function resolvePath(path: string, pathParams?: Record<string, any>): string {
	if (!pathParams) return path;
	let resolved = path;
	for (const [key, value] of Object.entries(pathParams)) {
		resolved = resolved.replace(`:${key}`, encodeURIComponent(String(value)));
	}
	return resolved;
}

function processRouterOrContract(item: any, config: ZonoClientConfig, prefix = ""): any {
	if ("path" in item && "method" in item && "responses" in item) {
		// It's a ZonoContract
		const contract: ZonoContract<any, any> = item;
		return async (args: any) => {
			const pathParams = args?.pathParams;
			const query = args?.query;
			const body = args?.body;
			const headers = args?.headers;

			// Optional input validation
			if (!config.ignoreInputValidation) {
				if (contract.pathParams) contract.pathParams.parse(pathParams);
				if (contract.query) contract.query.parse(query);
				if (contract.body) contract.body.parse(body);
				if (contract.headers) contract.headers.parse(headers);
			}

			const contractPath = resolvePath(String(contract.path), pathParams);
			const urlPath = `${prefix}${contractPath}`.replace(/\/+/g, "/");
			const url = new URL(urlPath, config.baseUrl);
			if (query) {
				for (const [key, value] of Object.entries(query)) {
					if (Array.isArray(value)) {
						for (const v of value) url.searchParams.append(key, String(v));
					} else if (value !== undefined) {
						url.searchParams.set(key, String(value));
					}
				}
			}

			const promisedHeaders = Object.fromEntries(
				Object.entries(config.defaultHeaders ?? {}).map(([key, value]) => {
					if (typeof value === "function") {
						return [key, value()];
					}
					return [key, value];
				}),
			);
			const reqHeaders = new Headers(await awaitRecord(promisedHeaders));
			if (headers) {
				for (const [key, value] of Object.entries(headers)) {
					if (value !== undefined) reqHeaders.set(key, String(value));
				}
			}

			if (body && !(body instanceof FormData)) {
				reqHeaders.set("Content-Type", "application/json");
			}

			const reqOptions: RequestInit = {
				method: contract.method.toUpperCase(),
				headers: reqHeaders,
				body: body ? (body instanceof FormData ? body : JSON.stringify(body)) : undefined,
			};

			const response = await fetch(url.toString(), reqOptions);
			const status: number = response.status;

			const responseSpec =
				contract.responses[status as unknown as keyof typeof contract.responses];
			if (!responseSpec) {
				throw new Error(`Unexpected status code: ${status}`);
			}

			let resBody: any;
			if (responseSpec.body) {
				const contentType = response.headers.get("Content-Type");
				if (contentType?.includes("application/json")) {
					resBody = await response.json();
				} else {
					resBody = await response.text();
				}
			}

			let resHeaders: Record<string, string | undefined> = {};
			if (responseSpec.headers) {
				response.headers.forEach((value, key) => {
					resHeaders[key] = value;
				});
			}

			if (!config.ignoreOutputValidation) {
				if (responseSpec.body) {
					resBody = responseSpec.body.parse(resBody);
				}
				if (responseSpec.headers) {
					resHeaders = responseSpec.headers.parse(resHeaders);
				}
			}

			return { status, data: resBody, headers: resHeaders };
		};
	}

	// It's a Router, recurse
	const result: any = {};
	for (const [key, value] of Object.entries(item)) {
		result[key] = processRouterOrContract(value, config, `${prefix}/${key}`);
	}
	return result;
}

async function awaitRecord(
	record: Record<string, string | Promise<string>>,
): Promise<Record<string, string>> {
	const entries = await Promise.all(
		Object.entries(record).map(async ([key, value]) => [key, await value]),
	);
	return Object.fromEntries(entries);
}

export const createZonoClient = <T extends ZonoRouter>(
	router: T,
	config: ZonoClientConfig,
): ZonoClient<T> => {
	return processRouterOrContract(router, config);
};
