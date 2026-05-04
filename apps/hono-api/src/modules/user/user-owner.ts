import { AppError } from "../../middleware/error";
import { getPrismaClient } from "../../platform/node/prisma";
import type { AppContext } from "../../types";

function buildOwnerMissingError(ownerId: string): AppError {
	return new AppError(`Owner user not found: ${ownerId}`, {
		status: 404,
		code: "owner_user_not_found",
	});
}

export async function assertOwnerUserExists(
	c: AppContext,
	ownerId: string,
): Promise<void> {
	const normalizedOwnerId = ownerId.trim();
	if (!normalizedOwnerId) {
		throw new AppError("Owner user id is required", {
			status: 400,
			code: "owner_user_id_required",
		});
	}

	const row = await getPrismaClient().users.findUnique({
		where: { id: normalizedOwnerId },
		select: { id: true },
	});
	if (!row) {
		throw buildOwnerMissingError(normalizedOwnerId);
	}
}
