import type {
	ContractCallRoutes,
	ContractTree,
	ContractTreeFor,
	HTTPMethod,
} from "../contract/contract.js";
import type {
	InferMiddlewareResponseUnionAtPath,
	MiddlewareTree,
	MiddlewareTreeFor,
} from "../middleware/middleware.js";
import type { ClientErrorMode, ErrorResponse, ServerErrorMode } from "../server/server.js";
import {
	type ApiShape,
	createFetchConfig,
	type MapFetchRouteResponse,
	parseFetchResponse,
	type TypedFetch,
	type TypedFetchConfig,
	type TypedParseResponse,
} from "../shared/shared.js";

type ClientInferredErrorResponse<TErrorMode extends ClientErrorMode> =
	TErrorMode extends ServerErrorMode ? ErrorResponse<TErrorMode> : never;

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

export const createClient = <
	TShape extends ApiShape,
	TContracts extends ContractTreeFor<TShape> & ContractTree,
	TMiddlewares extends MiddlewareTreeFor<TShape>,
	TErrorMode extends ClientErrorMode,
>(
	baseUrl: string,
): Client<TContracts, TMiddlewares, TErrorMode> => {
	const fetchConfigMethod: ClientFetchConfigMethod<TContracts, TMiddlewares, TErrorMode> = (
		path,
		method,
		data,
	) => {
		return createFetchConfig(baseUrl, path, method, data);
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
		data,
	) => {
		const [url, init] = fetchConfigMethod(path, method, data);
		const response = await fetch(url, init);
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
