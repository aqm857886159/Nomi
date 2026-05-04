import type { PrismaClient } from "../../types";
import type { Prisma } from "@prisma/client";
import { getPrismaClient } from "../../platform/node/prisma";

export type UserRow = {
	id: string;
	login: string;
	name: string | null;
	avatar_url: string | null;
	email: string | null;
	phone: string | null;
	role: string | null;
	guest: number;
	disabled?: number | null;
	deleted_at?: string | null;
	last_seen_at?: string | null;
	created_at: string;
	updated_at: string;
};

export async function listUsers(
	db: PrismaClient,
	input: {
		q?: string | null;
		page: number;
		pageSize: number;
		includeDeleted: boolean;
	},
): Promise<{ rows: UserRow[]; total: number }> {
	void db;
	const q = (input.q || "").trim();
	const where: Prisma.usersWhereInput = {
		...(!input.includeDeleted
			? { OR: [{ deleted_at: null }, { deleted_at: "" }] }
			: {}),
		...(q
			? {
					AND: [
						{
							OR: [
								{ login: { contains: q, mode: "insensitive" } },
								{ name: { contains: q, mode: "insensitive" } },
								{ email: { contains: q, mode: "insensitive" } },
								{ id: { contains: q, mode: "insensitive" } },
							],
						},
					],
				}
			: {}),
	};
	const safePage = Math.max(1, Math.floor(input.page));
	const safePageSize = Math.max(1, Math.floor(input.pageSize));
	const [total, users] = await Promise.all([
		getPrismaClient().users.count({ where }),
		getPrismaClient().users.findMany({
			where,
			orderBy: [{ created_at: "desc" }, { id: "desc" }],
			skip: (safePage - 1) * safePageSize,
			take: safePageSize,
		}),
	]);

	const rows = users.map((user) => ({
			id: user.id,
			login: user.login,
			name: user.name,
			avatar_url: user.avatar_url,
			email: user.email,
			phone: user.phone,
			role: user.role,
			guest: user.guest,
			disabled: user.disabled,
			deleted_at: user.deleted_at,
			last_seen_at: user.last_seen_at,
			created_at: user.created_at,
			updated_at: user.updated_at,
	}));
	return { rows, total };
}

export async function getUserById(
	db: PrismaClient,
	userId: string,
): Promise<UserRow | null> {
	void db;
	const user = await getPrismaClient().users.findUnique({
		where: { id: userId },
	});
	if (!user) return null;

	return {
		id: user.id,
		login: user.login,
		name: user.name,
		avatar_url: user.avatar_url,
		email: user.email,
		phone: user.phone,
		role: user.role,
		guest: user.guest,
		disabled: user.disabled,
		deleted_at: user.deleted_at,
		last_seen_at: user.last_seen_at,
		created_at: user.created_at,
		updated_at: user.updated_at,
	};
}

export async function updateUserAdminFields(
	db: PrismaClient,
	input: {
		userId: string;
		role: string | null;
		disabled: number;
		updatedAt: string;
	},
): Promise<void> {
	void db;
	await getPrismaClient().users.update({
		where: { id: input.userId },
		data: {
			role: input.role,
			disabled: input.disabled,
			updated_at: input.updatedAt,
		},
	});
}

export async function softDeleteUser(
	db: PrismaClient,
	input: {
		userId: string;
		deletedAt: string;
	},
): Promise<void> {
	void db;
	await getPrismaClient().users.update({
		where: { id: input.userId },
		data: {
			deleted_at: input.deletedAt,
			disabled: 1,
			role: null,
			updated_at: input.deletedAt,
		},
	});
}
