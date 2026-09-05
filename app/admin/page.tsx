import { cookies } from "next/headers";
import { currentAdmin } from "../../db/auth";
import AdminClient from "./admin-client";
import AdminLogin from "./admin-login";

export const dynamic = "force-dynamic";
export default async function AdminPage(){const jar=await cookies();const user=await currentAdmin(jar.get("yada_admin_session")?.value);if(!user)return <AdminLogin/>;return <AdminClient user={{name:user.name,role:user.role}}/>;}
