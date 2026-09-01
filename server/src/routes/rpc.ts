import { Router } from "express";
import { prisma } from "../db.js";
import { asyncRoute, HttpError } from "../http.js";
import { requireAuth } from "../middleware/auth.js";

export const rpcRouter = Router();
rpcRouter.use(requireAuth);
rpcRouter.post("/:name", asyncRoute(async (request, response) => {
  const name = request.params.name;
  if (name === "has_role") {
    const requestedUserId = request.body?._user_id;
    const userId = ['admin', 'super_admin'].includes(request.user!.role) && requestedUserId ? requestedUserId : request.user!.id;
    const role = request.body?._role || "admin";
    const user = await prisma.appUser.findUnique({ where: { id: userId } });
    return response.json({ data: user?.role === "super_admin" || user?.role === role, error: null });
  }
  if (name === "is_user_approved") {
    const requestedUserId = request.body?._user_id;
    const userId = ['admin', 'super_admin'].includes(request.user!.role) && requestedUserId ? requestedUserId : request.user!.id;
    const user = await prisma.appUser.findUnique({ where: { id: userId } });
    return response.json({ data: Boolean(user?.is_active && user?.is_approved), error: null });
  }
  throw new HttpError(501, `RPC ${name} has not been migrated`);
}));
