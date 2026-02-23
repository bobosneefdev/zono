import z from "zod";
import { PossibleZodOptional } from "./shared.js";

/**
 * IDEA
 * This is a new potential spin-off of the zono type-safe API project. It's hopefully new and improved way to
 * define, implement, and consume your API.
 * 
 * GOALS
 * - Define router shape first
 * - This router shape should allow the ability to know the path of the contract, and use it as a type generic.
 * - This should in turn allow the ability to enforce the contract has defined the path params required.
 * - We can spot a path param by it's key being prefixed with "$".
 */

type Contract = {
	method: ContractMethod;
	responses: ContractResponses;
	body?: z.ZodType;
	query?: ContractQuery;
	headers?: ContractHeaders;
    pathParams?: z.ZodObject<Record<string, z.ZodType<string, string>>>;
};

type ContractMethod =
	"get" |
	"post" |
	"put" |
	"delete" |
	"patch" |
	"options" |
	"head";

type ContractHeaders = z.ZodObject<Record<string, PossibleZodOptional<z.ZodType<string, string>>>>;

type ContractResponses = Record<number, {
    body?: z.ZodType;
    headers?: ContractHeaders;
}>;

type ContractQuery = z.ZodObject<Record<string, PossibleZodOptional<z.ZodType<string, string>>>>;

interface RouterShape {
    [key: string]: RouterRouterNode | ContractRouterNode;
};

type RouterRouterNode = {
    type: "router";
    router: RouterShape;
};

type ContractRouterNode = {
    type: "contract";
    router?: RouterShape;
};

type Router<TShape extends RouterShape> = {
    [K in keyof TShape]: TShape[K] extends RouterRouterNode
        ? Router<TShape[K]["router"]>
        : {
            contract: Contract;
        } & (
            TShape[K]["router"] extends RouterShape
                ? { router: Router<TShape[K]["router"]> }
                : { router?: undefined }
        );
};

function createRouter<
    TShape extends RouterShape,
    TRouter extends Router<TShape> = Router<TShape>,
>(_shape: TShape, router: TRouter): TRouter {
    return router;
}

createRouter({
    users: {
        type: "router",
        router: {
            $id: {
                type: "contract",
            },
        },
    },
}, {
    users: {
        $id: {
            contract: {
                method: "get",
                responses: {
                    200: {
                        body: z.object({
                            id: z.string(),
                            name: z.string(),
                            age: z.number().int(),
                        }),
                        headers: z.object({
                            test: z.string(),
                        }),
                    },
                },
            },
        },
    },
});