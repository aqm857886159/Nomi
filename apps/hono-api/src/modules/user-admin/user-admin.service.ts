import { AppError } from "../../middleware/error";
import type { AppContext } from "../../types";
import { getPrismaClient } from "../../platform/node/prisma";
import { isAdminRequest } from "../auth/admin-request";
import { getUserById, listUsers, softDeleteUser, updateUserAdminFields } from "./user-admin.repo";
import type {
	AdminUserDto,
	AdminUserListResponseDto,
} from "./user-admin.schemas";

async function ensureUserAdminSchema(c: AppContext): Promise<void> {
	void c;
}

function requireAdmin(c: AppContext): void {
	if (!isAdminRequest(c)) {
		throw new AppError("Forbidden", { status: 403, code: "forbidden" });
	}
}

function normalizeRole(role: unknown): string | null {
	const r = typeof role === "string" ? role.trim().toLowerCase() : "";
	if (!r) return null;
	if (r === "admin") return "admin";
	return null;
}

function normalizeDeletedAt(value: unknown): string | null {
	const s = typeof value === "string" ? value.trim() : "";
	return s ? s : null;
}

function normalizeDisabled(value: unknown): boolean {
	return Number(value ?? 0) !== 0;
}

function mapUserRowToDto(row: any): AdminUserDto {
	return {
		id: String(row.id),
		login: String(row.login || ""),
		name: typeof row.name === "string" ? row.name : row.name ?? null,
		avatarUrl:
			typeof row.avatar_url === "string" ? row.avatar_url : row.avatar_url ?? null,
		email: typeof row.email === "string" ? row.email : row.email ?? null,
		phone: typeof row.phone === "string" ? row.phone : row.phone ?? null,
		role: normalizeRole(row.role),
		guest: Number(row.guest ?? 0) !== 0,
		disabled: normalizeDisabled(row.disabled),
		deletedAt: normalizeDeletedAt(row.deleted_at),
		lastSeenAt:
			typeof row.last_seen_at === "string"
				? row.last_seen_at
				: row.last_seen_at ?? null,
		createdAt: String(row.created_at || ""),
		updatedAt: String(row.updated_at || ""),
	};
}

async function countActiveAdmins(c: AppContext): Promise<number> {
	void c;
	return getPrismaClient().users.count({
		where: {
			role: "admin",
			OR: [{ deleted_at: null }, { deleted_at: "" }],
			disabled: 0,
		},
	});
}

export async function listAdminUsers(
	c: AppContext,
	input: {
		q?: string | null;
		page?: number;
		pageSize?: number;
		includeDeleted?: boolean;
	},
): Promise<AdminUserListResponseDto> {
	requireAdmin(c);
	await ensureUserAdminSchema(c);

	const page =
		typeof input.page === "number" && Number.isFinite(input.page)
			? Math.max(1, Math.floor(input.page))
			: 1;
	const pageSize =
		typeof input.pageSize === "number" && Number.isFinite(input.pageSize)
			? Math.max(1, Math.min(500, Math.floor(input.pageSize)))
			: 20;

	const result = await listUsers(c.env.DB, {
		q: input.q,
		page,
		pageSize,
		includeDeleted: Boolean(input.includeDeleted),
	});
	return {
		items: result.rows.map(mapUserRowToDto),
		total: result.total,
		page,
		pageSize,
	};
}

export async function updateAdminUser(
	c: AppContext,
	input: {
		actorUserId: string;
		userId: string;
		role?: string | null;
		disabled?: boolean;
	},
): Promise<AdminUserDto> {
	requireAdmin(c);
	await ensureUserAdminSchema(c);

	if (!input.userId) {
		throw new AppError("userId is required", {
			status: 400,
			code: "invalid_request",
		});
	}

	if (
		input.actorUserId &&
		input.userId === input.actorUserId &&
		input.disabled === true
	) {
		throw new AppError("不能禁用自己", {
			status: 400,
			code: "cannot_disable_self",
		});
	}

	const existing = await getUserById(c.env.DB, input.userId);
	if (!existing) {
		throw new AppError("User not found", {
			status: 404,
			code: "user_not_found",
		});
	}

	const existingDeletedAt = normalizeDeletedAt((existing as any).deleted_at);
	if (existingDeletedAt) {
		throw new AppError("该用户已删除", {
			status: 400,
			code: "user_deleted",
		});
	}

	const existingRole = normalizeRole(existing.role);
	const existingDisabled = normalizeDisabled((existing as any).disabled);

	const nextRole =
		Object.prototype.hasOwnProperty.call(input, "role")
			? normalizeRole(input.role)
			: existingRole;
	const nextDisabled =
		typeof input.disabled === "boolean" ? input.disabled : existingDisabled;

	const isExistingActiveAdmin = existingRole === "admin" && !existingDisabled;
	const willLoseAdmin = isExistingActiveAdmin && nextRole !== "admin";
	const willBeDisabled = isExistingActiveAdmin && nextDisabled === true;

	if (willLoseAdmin || willBeDisabled) {
		const adminCount = await countActiveAdmins(c);
		if (adminCount <= 1) {
			throw new AppError("至少保留一个可用管理员账号", {
				status: 400,
				code: "cannot_remove_last_admin",
			});
		}
	}

	const nowIso = new Date().toISOString();
	await updateUserAdminFields(c.env.DB, {
		userId: input.userId,
		role: nextRole,
		disabled: nextDisabled ? 1 : 0,
		updatedAt: nowIso,
	});

	const updated = await getUserById(c.env.DB, input.userId);
	if (!updated) {
		throw new AppError("User not found", {
			status: 404,
			code: "user_not_found",
		});
	}
	return mapUserRowToDto(updated);
}

export async function deleteAdminUser(
	c: AppContext,
	input: { actorUserId: string; userId: string },
): Promise<void> {
	requireAdmin(c);
	await ensureUserAdminSchema(c);

	if (!input.userId) {
		throw new AppError("userId is required", {
			status: 400,
			code: "invalid_request",
		});
	}

	if (input.actorUserId && input.userId === input.actorUserId) {
		throw new AppError("不能删除自己", {
			status: 400,
			code: "cannot_delete_self",
		});
	}

	const existing = await getUserById(c.env.DB, input.userId);
	if (!existing) {
		// idempotent
		return;
	}

	const existingDeletedAt = normalizeDeletedAt((existing as any).deleted_at);
	if (existingDeletedAt) {
		// idempotent
		return;
	}

	const existingRole = normalizeRole(existing.role);
	const existingDisabled = normalizeDisabled((existing as any).disabled);
	const isExistingActiveAdmin = existingRole === "admin" && !existingDisabled;

	if (isExistingActiveAdmin) {
		const adminCount = await countActiveAdmins(c);
		if (adminCount <= 1) {
			throw new AppError("至少保留一个可用管理员账号", {
				status: 400,
				code: "cannot_remove_last_admin",
			});
		}
	}

	const nowIso = new Date().toISOString();
	await softDeleteUser(c.env.DB, { userId: input.userId, deletedAt: nowIso });
}
