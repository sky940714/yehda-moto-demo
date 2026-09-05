import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { oauthLogin } from "../../../../../db/auth";

export async function GET(request: Request) {
  const url = new URL(request.url);
  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");
  const providerError = url.searchParams.get("error");
  const jar = await cookies();
  const saved = jar.get("yada_facebook_oauth_state")?.value;
  jar.delete("yada_facebook_oauth_state");

  if (providerError) return NextResponse.redirect(`${url.origin}/?authError=facebook_cancelled`);
  if (!code || !state || !saved || state !== saved) {
    return NextResponse.redirect(`${url.origin}/?authError=invalid_state`);
  }

  try {
    const version = process.env.FACEBOOK_GRAPH_VERSION || "v23.0";
    const redirectUri = `${url.origin}/api/auth/callback/facebook`;
    const tokenQuery = new URLSearchParams({
      client_id: process.env.FACEBOOK_CLIENT_ID || "",
      client_secret: process.env.FACEBOOK_CLIENT_SECRET || "",
      redirect_uri: redirectUri,
      code,
    });
    const tokenResponse = await fetch(`https://graph.facebook.com/${version}/oauth/access_token?${tokenQuery}`, {
      cache: "no-store",
    });
    if (!tokenResponse.ok) throw new Error(`Facebook token exchange failed: ${tokenResponse.status}`);
    const token = (await tokenResponse.json()) as { access_token?: string };
    if (!token.access_token) throw new Error("Facebook did not return an access token");

    const profileQuery = new URLSearchParams({ fields: "id,name,email", access_token: token.access_token });
    const profileResponse = await fetch(`https://graph.facebook.com/${version}/me?${profileQuery}`, { cache: "no-store" });
    if (!profileResponse.ok) throw new Error(`Facebook profile request failed: ${profileResponse.status}`);
    const profile = (await profileResponse.json()) as { id?: string; name?: string; email?: string };
    if (!profile.id || !profile.email) throw new Error("Facebook 帳號未提供 Email");

    const result = await oauthLogin("facebook", profile.id, profile.email, profile.name || "會員");
    jar.set("yada_session", result.session, {
      httpOnly: true,
      sameSite: "lax",
      secure: process.env.NODE_ENV === "production",
      path: "/",
      maxAge: 30 * 86400,
    });
    return NextResponse.redirect(`${url.origin}/?auth=${result.user.phone ? "complete" : "phone"}`);
  } catch (error) {
    console.error("Facebook OAuth error", error);
    return NextResponse.redirect(`${url.origin}/?authError=facebook`);
  }
}
