"use client";
import { useState } from "react";
import "./admin.css";
import "./admin-login.css";

export default function AdminLogin(){const[error,setError]=useState(""),[busy,setBusy]=useState(false);async function submit(e:React.FormEvent<HTMLFormElement>){e.preventDefault();setBusy(true);setError("");const form=new FormData(e.currentTarget);const response=await fetch("/api/admin/auth",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({email:form.get("email"),password:form.get("password")})});const data=await response.json();if(response.ok){location.replace("/admin");return;}setError(data.error||"登入失敗。");setBusy(false);}return <main className="adminLogin"><form onSubmit={submit}><p>YADA STORE ADMIN</p><h1>後台登入</h1><label>管理員帳號<input name="email" type="email" autoComplete="username" required placeholder="請輸入管理員 Email"/></label><label>管理員密碼<input name="password" type="password" autoComplete="current-password" required placeholder="請輸入密碼"/></label>{error&&<div className="loginError" role="alert">{error}</div>}<button disabled={busy}>{busy?"驗證中…":"登入後台"}</button><a href="/">返回商店</a></form></main>}
