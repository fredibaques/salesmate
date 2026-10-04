import { toNextJsHandler } from "better-auth/next-js";
import { getAuth } from "@/server/auth/auth";

const handler = () => toNextJsHandler(getAuth());

export const GET = (req: Request) => handler().GET(req);
export const POST = (req: Request) => handler().POST(req);
