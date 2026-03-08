import type {
	ContractMethodAtPath,
	ContractPath,
	ContractRouteEntries,
	ContractsTree,
	HTTPMethod,
	InferContractRequestData,
} from "../contract/contract.types.js";
import type { MiddlewareDefinition } from "../middleware/middleware.types.js";
import type { ClientResponseUnion, ErrorMode } from "../server/server.types.js";
import type { Prettify } from "../shared/shared.types.js";

type PrettifyUnion<T> = T extends unknown ? Prettify<T> : never;

export type ClientFetchMethod<
	TContracts extends ContractsTree,
	TMiddlewares extends { MIDDLEWARE: Record<string, MiddlewareDefinition> },
	TErrorMode extends ErrorMode,
> = <
	TPath extends ContractPath<TContracts>,
	TMethod extends keyof Extract<ContractRouteEntries<TContracts>, { path: TPath }>["contract"] &
		HTTPMethod,
>(
	path: TPath,
	method: TMethod,
	data?: InferContractRequestData<ContractMethodAtPath<TContracts, TPath, TMethod>>,
) => Promise<
	PrettifyUnion<
		ClientResponseUnion<
			ContractMethodAtPath<TContracts, TPath, TMethod>,
			TMiddlewares,
			TErrorMode
		>
	>
>;

export type Client<
	TContracts extends ContractsTree,
	TMiddlewares extends { MIDDLEWARE: Record<string, MiddlewareDefinition> },
	TErrorMode extends ErrorMode,
> = {
	fetch: ClientFetchMethod<TContracts, TMiddlewares, TErrorMode>;
};
