import type {
	AnyApiDefinition,
	ContractCallRoutes,
	ContractTree,
	HTTPMethod,
} from "../contract/contract.js";
import type {
	InferMiddlewareResponseUnionAtPath,
	MiddlewareTree,
} from "../middleware/middleware.js";
import {
	type ClientErrorMode,
	createFetchConfig,
	type ErrorMode,
	type ErrorResponse,
	type FetchConfig,
	type MapFetchRouteResponse,
	type MaybePromise,
	parseFetchResponse,
	type TypedFetch,
	type TypedFetchConfig,
	type TypedParseResponse,
} from "../shared/shared.js";

export type ClientOptions = {
	preRequest?: (url: string, init: RequestInit) => MaybePromise<FetchConfig>;
	postRequest?: (response: Response) => MaybePromise<Response>;
};

type ClientInferredErrorResponse<TErrorMode extends ClientErrorMode> = TErrorMode extends ErrorMode
	? ErrorResponse<TErrorMode>
	: never;

type ClientFetchRoutes<
	TContracts extends ContractTree,
	TMiddlewares extends MiddlewareTree,
	TErrorMode extends ClientErrorMode,
> = ContractCallRoutes<TContracts> extends infer TRoute
	? TRoute extends {
			path: infer TPath extends string;
			method: infer _TMethod extends HTTPMethod;
			request: infer _TRequest;
			response: infer _TResponse;
		}
		? MapFetchRouteResponse<
				TRoute,
				| InferMiddlewareResponseUnionAtPath<TMiddlewares, TPath>
				| ClientInferredErrorResponse<TErrorMode>
			>
		: never
	: never;

export type ClientFetchMethod<
	TContracts extends ContractTree,
	TMiddlewares extends MiddlewareTree,
	TErrorMode extends ClientErrorMode,
> = TypedFetch<ClientFetchRoutes<TContracts, TMiddlewares, TErrorMode>>;

export type ClientFetchConfigMethod<
	TContracts extends ContractTree,
	TMiddlewares extends MiddlewareTree,
	TErrorMode extends ClientErrorMode,
> = TypedFetchConfig<ClientFetchRoutes<TContracts, TMiddlewares, TErrorMode>>;

export type ClientParseResponseMethod<
	TContracts extends ContractTree,
	TMiddlewares extends MiddlewareTree,
	TErrorMode extends ClientErrorMode,
> = TypedParseResponse<ClientFetchRoutes<TContracts, TMiddlewares, TErrorMode>>;

export type Client<
	TContracts extends ContractTree,
	TMiddlewares extends MiddlewareTree,
	TErrorMode extends ClientErrorMode,
> = {
	fetch: ClientFetchMethod<TContracts, TMiddlewares, TErrorMode>;
	fetchConfig: ClientFetchConfigMethod<TContracts, TMiddlewares, TErrorMode>;
	parseResponse: ClientParseResponseMethod<TContracts, TMiddlewares, TErrorMode>;
};

/**
 * Creates a typed client from an API definition supplied as a type-only
 * generic (`createClient<typeof api>(baseUrl)`); no runtime schemas are
 * required in client bundles. Pass `"none"` as the second generic to exclude
 * Zono-generated error responses from the inferred union.
 */
export const createClient = <
	TApi extends AnyApiDefinition = AnyApiDefinition,
	TErrorMode extends ClientErrorMode = TApi["errorMode"],
>(
	baseUrl: string,
	options?: ClientOptions,
): Client<TApi["contracts"], TApi["middlewares"], TErrorMode> => {
	type TContracts = TApi["contracts"];
	type TMiddlewares = TApi["middlewares"];

	const fetchConfigMethod: ClientFetchConfigMethod<TContracts, TMiddlewares, TErrorMode> = (
		path,
		method,
		...request
	) => {
		const [url, init] = createFetchConfig(baseUrl, path, method, request[0]);
		return options?.preRequest ? options.preRequest(url, init) : [url, init];
	};

	const parseResponseMethod: ClientParseResponseMethod<
		TContracts,
		TMiddlewares,
		TErrorMode
	> = async (_path, _method, response) => {
		return parseFetchResponse(response) as Awaited<ReturnType<typeof parseResponseMethod>>;
	};

	const fetchMethod: ClientFetchMethod<TContracts, TMiddlewares, TErrorMode> = async (
		path,
		method,
		...request
	) => {
		const [url, init] = await fetchConfigMethod(path, method, ...request);
		const rawResponse = await fetch(url, init);
		const response = options?.postRequest
			? await options.postRequest(rawResponse)
			: rawResponse;
		return parseResponseMethod(path, method, response) as Awaited<
			ReturnType<typeof fetchMethod>
		>;
	};

	return {
		fetch: fetchMethod,
		fetchConfig: fetchConfigMethod,
		parseResponse: parseResponseMethod,
	};
};
