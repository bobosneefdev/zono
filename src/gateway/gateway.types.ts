import type {
	ContractMethodAtPath,
	ContractPath,
	ContractRouteEntries,
	ContractsTree,
	HTTPMethod,
	InferContractRequestData,
	InferContractResponseUnion,
} from "../contract/contract.types.js";
import type {
	InferAllMiddlewareResponseUnion,
	InferMiddlewareResponseUnion,
	MiddlewareDefinition,
	MiddlewareTree,
} from "../middleware/middleware.types.js";
import type {
	BoundMiddlewareHandlers,
	ClientFetchResponseUnion,
	ErrorMode,
	ErrorResponse,
	ServerContextCreator,
} from "../server/server.types.js";
import type { Prettify, Shape } from "../shared/shared.types.js";

type EmptyRecord = Record<never, never>;

export type GatewayServiceShape<TShape extends Shape> = {} & (TShape extends { CONTRACT: true }
	? { CONTRACT?: true }
	: EmptyRecord) &
	(TShape extends { SHAPE: infer TChildShape extends Record<string, Shape> }
		? {
				SHAPE?: {
					[TKey in keyof TChildShape]?: GatewayServiceShape<TChildShape[TKey]>;
				};
			}
		: EmptyRecord);

export type GatewayService<
	TShape extends Shape,
	TContracts extends ContractsTree,
	TMiddlewares extends { MIDDLEWARE: Record<string, MiddlewareDefinition> },
	TErrorMode extends ErrorMode,
> = {
	shape: GatewayServiceShape<TShape>;
	contracts: TContracts;
	middlewares: TMiddlewares;
	errorMode: TErrorMode;
	baseUrl: string;
};

type GatewayMiddlewareTreeFromContracts<TContracts extends ContractsTree> = {
	MIDDLEWARE?: Record<string, MiddlewareDefinition>;
} & (TContracts extends { SHAPE: infer TShape extends Record<string, ContractsTree> }
	? {
			SHAPE?: {
				[TKey in keyof TShape]?: GatewayMiddlewareTreeFromContracts<TShape[TKey]>;
			};
		}
	: EmptyRecord);

export type GatewayServices = Record<
	string,
	GatewayService<
		Shape,
		ContractsTree,
		{ MIDDLEWARE: Record<string, MiddlewareDefinition> },
		ErrorMode
	>
>;

export type GatewayMiddlewares<TServices extends GatewayServices> = {
	SHAPE: {
		[TService in keyof TServices]: GatewayMiddlewareTreeFromContracts<
			TServices[TService]["contracts"]
		>;
	};
};

type SplitPath<TPath extends string> = TPath extends ""
	? []
	: TPath extends `${infer THead}/${infer TRest}`
		? [THead, ...SplitPath<TRest>]
		: [TPath];

type PathSegments<TPath extends string> = TPath extends `/${infer TTrimmed}`
	? SplitPath<TTrimmed>
	: SplitPath<TPath>;

type MiddlewareDefinitionsAtNode<TNode> = TNode extends {
	MIDDLEWARE: infer TDefinitions;
}
	? TDefinitions extends Record<string, MiddlewareDefinition>
		? TDefinitions[keyof TDefinitions]
		: never
	: never;

type MiddlewareDefinitionsAlongPath<TNode, TSegments extends Array<string>> =
	| MiddlewareDefinitionsAtNode<TNode>
	| (TSegments extends [infer THead extends string, ...infer TTail extends Array<string>]
			? TNode extends { SHAPE: infer TShape extends Record<string, MiddlewareTree> }
				? THead extends keyof TShape
					? MiddlewareDefinitionsAlongPath<TShape[THead], TTail>
					: never
				: never
			: never);

type InferMiddlewareResponsesFromDefinitions<TDefinitionUnion> =
	TDefinitionUnion extends MiddlewareDefinition
		? InferMiddlewareResponseUnion<TDefinitionUnion>
		: never;

type GatewayServiceTreeAtRoot<
	TGatewayMiddlewares,
	TService extends PropertyKey,
> = TGatewayMiddlewares extends { SHAPE: infer TShape extends Record<PropertyKey, MiddlewareTree> }
	? TService extends keyof TShape
		? TShape[TService]
		: never
	: never;

type InferGatewayMiddlewareResponseUnionAtPath<
	TGatewayMiddlewares,
	TService extends PropertyKey,
	TPath extends string,
> = InferMiddlewareResponsesFromDefinitions<
	MiddlewareDefinitionsAlongPath<
		GatewayServiceTreeAtRoot<TGatewayMiddlewares, TService>,
		PathSegments<TPath>
	>
>;

type PrettifyUnion<T> = T extends unknown ? Prettify<T> : never;

type GatewayServiceClientFetchMethod<
	TService extends GatewayService<
		Shape,
		ContractsTree,
		{ MIDDLEWARE: Record<string, MiddlewareDefinition> },
		ErrorMode
	>,
	TGatewayMiddlewares,
	TServiceKey extends PropertyKey,
> = <
	TPath extends ContractPath<TService["contracts"]>,
	TMethod extends keyof Extract<
		ContractRouteEntries<TService["contracts"]>,
		{ path: TPath }
	>["contract"] &
		HTTPMethod,
>(
	path: TPath,
	method: TMethod,
	data?: InferContractRequestData<ContractMethodAtPath<TService["contracts"], TPath, TMethod>>,
) => Promise<
	PrettifyUnion<
		ClientFetchResponseUnion<
			| InferContractResponseUnion<
					ContractMethodAtPath<TService["contracts"], TPath, TMethod>
			  >
			| InferAllMiddlewareResponseUnion<TService["middlewares"]>
			| InferGatewayMiddlewareResponseUnionAtPath<TGatewayMiddlewares, TServiceKey, TPath>
			| ErrorResponse<TService["errorMode"]>
		>
	>
>;

export type GatewayClient<TServices extends GatewayServices, TGatewayMiddlewares = undefined> = {
	[TService in keyof TServices]: {
		fetch: GatewayServiceClientFetchMethod<TServices[TService], TGatewayMiddlewares, TService>;
	};
};

export type GatewayInitOptions<
	TServices extends GatewayServices,
	TGatewayMiddlewares extends GatewayMiddlewares<TServices>,
	TContext,
> = {
	middlewares?: BoundMiddlewareHandlers<TGatewayMiddlewares, TContext>;
	createContext?: ServerContextCreator<TContext>;
};
