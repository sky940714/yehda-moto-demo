import { randomBytes } from "node:crypto";
import { cookies } from "next/headers";
import { NextResponse } from "next/server";

export async function GET(request: Request) {
  const clientId = process.env.FACEBOOK_CLIENT_ID;
  if (!clientId) return NextResponse.json({ error: "Facebook 登入尚未設定。" }, { status: 503 });

  const state = randomBytes(24).toString("base64url");
  const jar = await cookies();
  jar.set("yada_facebook_oauth_state", state, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: 600,
  });

  const origin = new URL(request.url).origin;
  const version = process.env.FACEBOOK_GRAPH_VERSION || "v23.0";
  const query = new URLSearchParams({
    client_id: clientId,
    redirect_uri: `${origin}/api/auth/callback/facebook`,
    response_type: "code",
    scope: "email,public_profile",
    state,
  });
  return NextResponse.redirect(`https://www.facebook.com/${version}/dialog/oauth?${query}`);
}
