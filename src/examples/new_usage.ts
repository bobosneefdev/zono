import z from "zod";
import { RouterShape } from "~/router/index.js";

// ./social/contract.ts
const socialShape = {
    ROUTER: {
        users: {
            ROUTER: {
                register: {
                    CONTRACT: true,
                },
                $userId: {
                    CONTRACT: true,
                    ROUTER: {
                        posts: {
                            CONTRACT: true,
                            ROUTER: {
                                $postId: {
                                    CONTRACT: true,
                                },
                            },
                        },
                    },
                },
            },
        },
    },
} satisfies RouterShape;

const zId = z.uuid();

const zTimestamp = z.number().int();

const zUserBase = z.object({
	first: z.string(),
	last: z.string(),
	email: z.email(),
	password: z.string(),
    age: z.number().int().min(13),
});

const zUser = zUserBase.extend({
	id: zId,
	createdAt: zTimestamp,
});

const zPostBase = z.object({
    parentId: zId.optional(),
    text: z.string(),
    imageUrls: z.array(z.url()),
});

const zPost = zPostBase.extend({
    id: zId,
    createdAt: zTimestamp,
});

const 