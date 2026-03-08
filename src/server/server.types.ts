import type { Context } from "hono";
import type {
	Contract,
	ContractMethodAtPath,
	ContractMethodDefinition,
	ContractPath,
	ContractRouteEntries,
	Contracts,
	ContractsTree,
	HTTPMethod,
	InferContractRequestData,
	InferContractResponseUnion,
} from "../contract/contract.types.js";
import type {
	InferAllMiddlewareResponseUnion,
	MiddlewareDefinition,
	Middlewares,
	MiddlewareTree,
} from "../middleware/middleware.types.js";
import type { Shape } from "../shared/shared.types.js";

export type ServerContextCreator<T = unknown> = (ctx: Context) => Promise<T> | T;

export type ErrorMode = "public" | "private";

export type Public500ErrorData = {
	message: string;
};

export type Private500ErrorData = {
	message: string;
	issues?: unknown;
	stack?: string;
};

export type Public400ErrorData = {
	message: string;
	issues: Array<unknown>;
};

export type Private400ErrorData = {
	message: string;
	issueCount: number;
};

export type NotFoundErrorData = {
	message: string;
};

export type PublicErrorData = Public400ErrorData | NotFoundErrorData | Public500ErrorData;

export type PrivateErrorData = Private400ErrorData | NotFoundErrorData | Private500ErrorData;

export type ErrorResponse<TErrorMode extends ErrorMode> =
	| {
			status: 400;
			type: "JSON";
			data: TErrorMode extends "public" ? Public400ErrorData : Private400ErrorData;
	  }
	| {
			status: 404;
			type: "JSON";
			data: NotFoundErrorData;
	  }
	| {
			status: 500;
			type: "JSON";
			data: TErrorMode extends "public" ? Public500ErrorData : Private500ErrorData;
	  };

export type RuntimeHandlerResponse = {
	status: number;
	type: "JSON" | "SuperJSON" | "Text" | "Contentless" | "FormData" | "Blob" | "Bytes";
	data: unknown;
	headers?: HeadersInit;
};

export type ContractHandler<TMethodDefinition extends ContractMethodDefinition, TContext> = (
	data: InferContractRequestData<TMethodDefinition>,
	ctx: Context,
	ourContext: TContext,
) =>
	| Promise<InferContractResponseUnion<TMethodDefinition>>
	| InferContractResponseUnion<TMethodDefinition>;

export type ContractHandlerMap<TContract extends Contract, TContext> = {
	[TMethod in keyof TContract & HTTPMethod]?: NonNullable<
		TContract[TMethod]
	> extends ContractMethodDefinition
		? ContractHandler<NonNullable<TContract[TMethod]>, TContext>
		: never;
};

type ContractHandlersFromShape<TShapeNode, TContext> =
	TShapeNode extends Record<string, unknown>
		? {
				[K in keyof TShapeNode]: ContractHandlersFromContracts<TShapeNode[K], TContext>;
			}
		: never;

export type ContractHandlersFromContracts<TContractsNode, TContext> = TContractsNode extends {
	CONTRACT: infer TContract;
	SHAPE: infer TShapeNode;
}
	? {
			HANDLER: TContract extends Contract ? ContractHandlerMap<TContract, TContext> : never;
			SHAPE: ContractHandlersFromShape<TShapeNode, TContext>;
		}
	: TContractsNode extends { CONTRACT: infer TContract }
		? {
				HANDLER: TContract extends Contract
					? ContractHandlerMap<TContract, TContext>
					: never;
			}
		: TContractsNode extends { SHAPE: infer TShapeNode }
			? {
					SHAPE: ContractHandlersFromShape<TShapeNode, TContext>;
				}
			: never;

export type MiddlewareHandler<_TDefinition extends MiddlewareDefinition, TContext> = (
	ctx: Context,
	next: () => Promise<void>,
	ourContext: TContext,
) => Promise<void | RuntimeHandlerResponse> | void | RuntimeHandlerResponse;

type MiddlewareHandlersFromShape<TShapeNode, TContext> =
	TShapeNode extends Record<string, unknown>
		? {
				[K in keyof TShapeNode]-?: MiddlewareHandlersFromTree<
					NonNullable<TShapeNode[K]>,
					TContext
				>;
			}
		: never;

type MiddlewareHandlersFromTree<TMiddlewaresNode, TContext> = TMiddlewaresNode extends {
	MIDDLEWARE: infer TMiddlewareMap;
	SHAPE: infer TShapeNode;
}
	? {
			MIDDLEWARE: TMiddlewareMap extends Record<string, MiddlewareDefinition>
				? {
						[TName in keyof TMiddlewareMap]: MiddlewareHandler<
							TMiddlewareMap[TName],
							TContext
						>;
					}
				: never;
			SHAPE: MiddlewareHandlersFromShape<TShapeNode, TContext>;
		}
	: TMiddlewaresNode extends { MIDDLEWARE: infer TMiddlewareMap }
		? {
				MIDDLEWARE: TMiddlewareMap extends Record<string, MiddlewareDefinition>
					? {
							[TName in keyof TMiddlewareMap]: MiddlewareHandler<
								TMiddlewareMap[TName],
								TContext
							>;
						}
					: never;
			}
		: TMiddlewaresNode extends { SHAPE: infer TShapeNode }
			? {
					SHAPE: MiddlewareHandlersFromShape<TShapeNode, TContext>;
				}
			: never;

export type MiddlewareHandlers<
	TMiddlewares extends MiddlewareTree,
	TContext,
> = MiddlewareHandlersFromTree<TMiddlewares, TContext>;

export type BoundContractHandlers<TContracts extends ContractsTree, TContext> = {
	contracts: TContracts;
	handlers: ContractHandlersFromContracts<TContracts, TContext>;
};

export type BoundMiddlewareHandlers<TMiddlewares extends MiddlewareTree, TContext> = {
	middlewares: TMiddlewares;
	handlers: MiddlewareHandlers<TMiddlewares, TContext>;
};

export type InitHonoOptions<TShape extends Shape, TContext = unknown> = {
	contracts: BoundContractHandlers<Contracts<TShape>, TContext>;
	middlewares?: BoundMiddlewareHandlers<Middlewares<TShape>, TContext>;
	errorMode: ErrorMode;
	createContext: ServerContextCreator<TContext>;
};

export type ClientResponseUnion<
	TMethodDefinition extends ContractMethodDefinition,
	TMiddlewares extends { MIDDLEWARE: Record<string, MiddlewareDefinition> },
	TErrorMode extends ErrorMode,
> =
	| InferContractResponseUnion<TMethodDefinition>
	| InferAllMiddlewareResponseUnion<TMiddlewares>
	| ErrorResponse<TErrorMode>;

export type ClientFetchResponseUnion<T> = T extends unknown
	? Omit<T, "type"> & { response: Response }
	: never;

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
	ClientFetchResponseUnion<
		ClientResponseUnion<
			ContractMethodAtPath<TContracts, TPath, TMethod>,
			TMiddlewares,
			TErrorMode
		>
	>
>;
