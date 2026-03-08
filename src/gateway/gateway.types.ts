import type { Client } from "../client/client.types.js";
import type { ContractsTree } from "../contract/contract.types.js";
import type { MiddlewareDefinition } from "../middleware/middleware.types.js";
import type { ErrorMode } from "../server/server.types.js";
import type { Shape } from "../shared/shared.types.js";

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

export type GatewayServices = Record<
	string,
	GatewayService<
		Shape,
		ContractsTree,
		{ MIDDLEWARE: Record<string, MiddlewareDefinition> },
		ErrorMode
	>
>;

export type GatewayClient<TServices extends GatewayServices> = {
	[TService in keyof TServices]: {
		fetch: Client<
			TServices[TService]["contracts"],
			TServices[TService]["middlewares"],
			TServices[TService]["errorMode"]
		>["fetch"];
	};
};
