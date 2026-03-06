import type { ErrorMode } from "~/contract/contract.types.js";
import type { AdditionalHandlerParamsFn, HonoContextParams } from "~/hono/hono.types.js";
import type { MiddlewaresDefinition } from "~/middleware/middleware.types.js";

/** Input for a single service in the gateway */
export type GatewayService<
	TContracts extends { ROUTER: Record<string, unknown> } = {
		ROUTER: Record<string, unknown>;
	},
	TMiddlewares extends MiddlewaresDefinition<TContracts> = MiddlewaresDefinition<TContracts>,
> = {
	contracts: TContracts;
	middlewares: TMiddlewares;
};

/** Map of service names to their route/middleware definitions */
export type GatewayInput = Record<string, GatewayService>;

type GatewayServiceMaskNode<TNode> =
	| true
	| (TNode extends { ROUTER: infer TRouter extends Record<string, unknown> }
			? { [TKey in keyof TRouter & string]?: GatewayServiceMaskNode<TRouter[TKey]> }
			: never);

export type GatewayServiceMask<TContracts extends { ROUTER: Record<string, unknown> }> = {
	[TKey in keyof TContracts["ROUTER"] & string]?: GatewayServiceMaskNode<
		TContracts["ROUTER"][TKey]
	>;
};

type SelectGatewayContractsNode<TNode, TMask> = TMask extends true
	? TNode
	: TMask extends Record<string, unknown>
		? TNode extends { ROUTER: infer TRouter extends Record<string, unknown> }
			? SelectGatewayContractsRouter<TRouter, TMask> extends infer TPickedRouter extends
					Record<string, unknown>
				? keyof TPickedRouter extends never
					? never
					: { ROUTER: TPickedRouter }
				: never
			: never
		: never;

type SelectGatewayContractsRouter<
	TRouter extends Record<string, unknown>,
	TMask extends Record<string, unknown>,
> = {
	[TKey in keyof TRouter & keyof TMask & string as SelectGatewayContractsNode<
		TRouter[TKey],
		TMask[TKey]
	> extends never
		? never
		: TKey]: SelectGatewayContractsNode<TRouter[TKey], TMask[TKey]>;
};

export type SelectedGatewayContracts<
	TContracts extends { ROUTER: Record<string, unknown> },
	TMask extends GatewayServiceMask<TContracts>,
> = {
	ROUTER: SelectGatewayContractsRouter<TContracts["ROUTER"], TMask>;
};

/**
 * Generated route structure for the gateway from service inputs.
 * @template T - The gateway input type
 */
export type GeneratedGatewayContracts<T extends GatewayInput> = {
	ROUTER: {
		[K in keyof T & string]: T[K]["contracts"];
	};
};

/**
 * Generated middleware structure for the gateway from service inputs.
 * @template T - The gateway input type
 */
export type GeneratedGatewayMiddlewares<T extends GatewayInput> = {
	ROUTER: {
		[K in keyof T & string]: T[K]["middlewares"];
	};
};

/**
 * Complete gateway structure with routes and middleware.
 * @template T - The gateway input type
 */
export type GeneratedGateway<T extends GatewayInput> = {
	contracts: GeneratedGatewayContracts<T>;
	middlewares: GeneratedGatewayMiddlewares<T>;
};

/**
 * Configuration options for creating a Hono gateway.
 * @template TRoutes - The routes type
 * @template TContextParams - Additional parameters extracted from context
 */
export type GatewayOptions<TRoutes, TContextParams extends HonoContextParams = []> = {
	additionalHandlerParams?: AdditionalHandlerParamsFn<TContextParams>;
	services: TRoutes extends { ROUTER: infer R extends Record<string, unknown> }
		? { [K in keyof R & string]: string }
		: Record<string, string>;
	errorMode?: ErrorMode;
	basePath?: string;
};
