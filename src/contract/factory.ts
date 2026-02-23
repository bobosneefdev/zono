import { ZonoContract, ZonoContractOptions, ZonoContractPath, ZonoRouter } from "./types.js";

/**
 * Creates a Zono contract.
 * @param path - Path used to infer what pathParameters should be defined. Should be "" in most cases unless this contract needs path params.
 * @param options - Options for the contract
 */
export const createContract = <
	TPath extends ZonoContractPath,
	TOptions extends ZonoContractOptions<TPath>,
>(
	path: TPath,
	options: TOptions,
): ZonoContract<TPath, TOptions> => {
	return Object.assign({ path }, options);
};

/**
 * Creates a Zono router from a nested map of routers and contracts.
 */
export const createRouter = <T extends ZonoRouter>(router: T): T => {
	return router;
};
