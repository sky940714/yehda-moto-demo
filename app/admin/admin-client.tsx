"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import type { CatalogOptionKind, CatalogOptions, CatalogProduct, ProductSpecification, ProductVariant } from "../../db/catalog";
import "./admin.css";
import "./admin-login.css";
import "./admin-modules.css";
import "./admin-bulk.css";
import "./admin-catalog.css";

type Props = { user: { name: string; role: string } };
type Tab = "overview" | "products" | "categories" | "brands" | "vehicles" | "orders" | "returns" | "members" | "settings";
type Overview = { products: number; orders: number; pendingOrders: number; revenue: number };
type ApiError = { error?: string };
type AdminOrder = { id:number; number:string; customerName:string; customerPhone:string; total:number; status:string; paymentMethod:string; paymentStatus:string; shippingMethod:string; shippingCarrier:string|null; trackingNumber:string|null;cancellationReason:string|null; logisticsId:string|null; logisticsStatus:string|null; logisticsMessage:string|null; createdAt:string };
type AdminReturn = { id:number; orderNumber:string; customerName:string; reason:string; status:string; createdAt:string; resolutionNote:string|null; refundMethod:string|null; refundAmount:number|null; refundReference:string|null };
type StoreSettings = { returnAddress:string; returnRecipient:string; returnPhone:string; notificationEmail:string };
type AdminMember={id:string;name:string;email:string;phone:string|null;createdAt:string;points:number;orders:number;spent:number};

const empty: Partial<CatalogProduct> = { name: "", brand: "", cat: "", price: 0, stock: 0, status: "draft", color: "smoke", fit: [], image: undefined, images: [], specifications: [], variants: [], description: "", shippingType: "small" };
const emptyOptions: CatalogOptions = { brands: [], categories: [], vehicles: [] };
const nav: { id: Tab; label: string; icon: string }[] = [
  { id: "overview", label: "數據總覽", icon: "⌁" },
  { id: "products", label: "商品管理", icon: "□" },
  { id: "categories", label: "分類管理", icon: "▦" },
  { id: "brands", label: "品牌管理", icon: "◆" },
  { id: "vehicles", label: "車種資料庫", icon: "⌖" },
  { id: "orders", label: "訂單管理", icon: "▤" },
  { id: "returns", label: "退貨管理", icon: "↩" },
  { id: "members", label: "會員管理", icon: "♙" },
  { id: "settings", label: "網站設定", icon: "⚙" },
];

export default function AdminClient({ user }: Props) {
  const [tab, setTab] = useState<Tab>("overview");
  const [products, setProducts] = useState<CatalogProduct[]>([]);
  const [overview, setOverview] = useState<Overview>({ products: 0, orders: 0, pendingOrders: 0, revenue: 0 });
  const [editing, setEditing] = useState<Partial<CatalogProduct> | null>(null);
  const [query, setQuery] = useState("");
  const [message, setMessage] = useState("");
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [options, setOptions] = useState<CatalogOptions>(emptyOptions);
  const [optionDialog, setOptionDialog] = useState<{ kind: CatalogOptionKind; label: string } | null>(null);
  const [orders,setOrders]=useState<AdminOrder[]>([]);
  const [returns,setReturns]=useState<AdminReturn[]>([]);
  const [storeSettings,setStoreSettings]=useState<StoreSettings>({returnAddress:"",returnRecipient:"",returnPhone:"",notificationEmail:""});
  const [members,setMembers]=useState<AdminMember[]>([]);

  const load = async () => {
    const [p, o, c, ordersResponse, returnsResponse, settingsResponse, membersResponse] = await Promise.all([fetch("/api/admin/products"), fetch("/api/admin/overview"), fetch("/api/admin/catalog-options"), fetch("/api/admin/orders"), fetch("/api/admin/returns"), fetch("/api/admin/settings"), fetch("/api/admin/members")]);
    if (p.ok) setProducts(((await p.json()) as { products: CatalogProduct[] }).products);
    if (o.ok) setOverview(((await o.json()) as { overview: Overview }).overview);
    if (c.ok) setOptions(((await c.json()) as { options: CatalogOptions }).options);
    if(ordersResponse.ok)setOrders(((await ordersResponse.json()) as {orders:AdminOrder[]}).orders);
    if(returnsResponse.ok)setReturns(((await returnsResponse.json()) as {returns:AdminReturn[]}).returns);
    if(settingsResponse.ok)setStoreSettings(((await settingsResponse.json()) as {settings:StoreSettings}).settings);
    if(membersResponse.ok)setMembers(((await membersResponse.json()) as {members:AdminMember[]}).members);
  };
  useEffect(() => { void Promise.resolve().then(load); }, []);

  const shown = useMemo(() => products.filter((p) => `${p.name}${p.brand}${p.cat}${p.sku}`.toLowerCase().includes(query.toLowerCase())), [products, query]);
  const categories = useMemo(() => aggregate(products.map((p) => p.cat)), [products]);
  const brands = useMemo(() => aggregate(products.map((p) => p.brand)), [products]);
  const vehicles = useMemo(() => aggregate(products.flatMap((p) => p.fit).filter((x) => x !== "全車種")), [products]);

  const signOut = async () => { await fetch("/api/admin/auth", { method: "DELETE" }); location.replace("/admin"); };
  const openTab = (next: Tab) => { setTab(next); setEditing(null); setMessage(""); };
  const beginProduct = () => { setTab("products"); setEditing(empty); };

  const save = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const form = new FormData(e.currentTarget);
    const body = { ...editing, name: form.get("name"), sku: form.get("sku"), brand: form.get("brand"), cat: form.get("cat"), price: Number(form.get("price")), stock: Number(form.get("stock")), status: form.get("status"), images: form.getAll("images").map(String), description: form.get("description"), fit: form.getAll("fit").map(String), specifications: JSON.parse(String(form.get("specifications") || "[]")) as ProductSpecification[], variants: JSON.parse(String(form.get("variants") || "[]")) as ProductVariant[], shippingType: form.get("shippingType") };
    const response = await fetch("/api/admin/products", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    const data = (await response.json()) as ApiError;
    if (!response.ok) { setMessage(data.error || "儲存失敗"); return; }
    setMessage("商品已儲存並寫入資料庫。"); setEditing(null); await load();
  };
  const remove = async (id: number) => { if (!confirm("確定刪除此商品？此操作會留下管理紀錄。")) return; await fetch(`/api/admin/products?id=${id}`, { method: "DELETE" }); await load(); };
  const toggleSelected = (id:number) => setSelected((current) => { const next=new Set(current); if(next.has(id))next.delete(id);else next.add(id); return next; });
  const toggleShown = () => setSelected((current) => shown.length > 0 && shown.every((product) => current.has(product.id)) ? new Set([...current].filter((id) => !shown.some((product) => product.id === id))) : new Set([...current, ...shown.map((product) => product.id)]));
  const bulkStatus = async (status:CatalogProduct["status"]) => { const ids=[...selected]; if(!ids.length)return; const response=await fetch("/api/admin/products",{method:"PATCH",headers:{"Content-Type":"application/json"},body:JSON.stringify({ids,status})}); const data=(await response.json()) as ApiError & { updated?: number }; if(!response.ok){setMessage(data.error||"批次更新失敗。");return;} setMessage(`已更新 ${data.updated ?? 0} 項商品。`);setSelected(new Set());await load(); };
  const bulkDelete = async () => { const ids=[...selected];if(!ids.length||!confirm(`確定刪除已選取的 ${ids.length} 項商品？此操作無法復原。`))return;const response=await fetch("/api/admin/products",{method:"DELETE",headers:{"Content-Type":"application/json"},body:JSON.stringify({ids})});const data=(await response.json()) as ApiError & { deleted?: number };if(!response.ok){setMessage(data.error||"批次刪除失敗。");return;}setMessage(`已刪除 ${data.deleted ?? 0} 項商品。`);setSelected(new Set());await load();};
  const upload = async (file: File) => { setMessage(`正在上傳 ${file.name}…`); const form = new FormData(); form.set("file", file); const response = await fetch("/api/admin/uploads", { method: "POST", body: form }); const data = (await response.json()) as ApiError & { url?: string }; if (!response.ok || !data.url) { setMessage(data.error || "圖片上傳失敗。"); return undefined; } setMessage("圖片已上傳至 Cloudflare R2。"); return data.url; };
  const addOption = async (kind:CatalogOptionKind,label:string) => setOptionDialog({kind,label});
  const saveOption = async (name:string) => { if(!optionDialog)return false;const response=await fetch("/api/admin/catalog-options",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({kind:optionDialog.kind,name})});const data=(await response.json()) as ApiError;if(!response.ok){setMessage(data.error||`新增${optionDialog.label}失敗。`);return false;}setMessage(`${optionDialog.label}「${name}」已加入資料庫。`);setOptionDialog(null);await load();return true; };
  const reorderOptions = async (kind:CatalogOptionKind,names:string[]) => { const response=await fetch("/api/admin/catalog-options",{method:"PATCH",headers:{"Content-Type":"application/json"},body:JSON.stringify({kind,names})});const data=(await response.json()) as ApiError;if(!response.ok){setMessage(data.error||"排序儲存失敗。");return;}setMessage("顯示優先順序已更新。");await load(); };
  const updateOrder = async(id:number,status:string,shippingCarrier?:string,trackingNumber?:string)=>{const response=await fetch("/api/admin/orders",{method:"PATCH",headers:{"Content-Type":"application/json"},body:JSON.stringify({id,status,shippingCarrier,trackingNumber})});const data=await response.json() as ApiError;if(!response.ok){setMessage(data.error||"訂單更新失敗。");return;}setMessage(status==="cancelled"?"訂單已取消，庫存已回補。":status==="shipped"?"訂單已標示出貨。":"訂單狀態已更新。");await load();};
  const createLogistics = async(id:number)=>{const response=await fetch("/api/admin/logistics",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({orderId:id})});const data=await response.json() as ApiError&{logisticsId?:string};if(!response.ok){setMessage(data.error||"綠界物流建單失敗。");return;}setMessage(`綠界物流單已建立${data.logisticsId?`：${data.logisticsId}`:""}`);await load();};
  const updateReturn = async(id:number,status:string,note:string,refundMethod?:string,refundAmount?:number,refundReference?:string)=>{const response=await fetch("/api/admin/returns",{method:"PATCH",headers:{"Content-Type":"application/json"},body:JSON.stringify({id,status,note,refundMethod,refundAmount,refundReference})});const data=await response.json() as ApiError;if(!response.ok){setMessage(data.error||"退貨更新失敗。");return;}setMessage(status==="received"?"已確認收到退貨，庫存已回補。":status==="refunded"?"退款紀錄已儲存。":"退貨狀態已更新。");await load();};
  const adjustPoints=async(userId:string,points:number,reason:string)=>{const response=await fetch("/api/admin/members",{method:"PATCH",headers:{"Content-Type":"application/json"},body:JSON.stringify({userId,points,reason})});const data=await response.json() as ApiError;if(!response.ok){setMessage(data.error||"點數調整失敗。");return;}setMessage("會員點數已調整並留下明細紀錄。");await load();};
  const exportOverview = () => { const rows = [["指標", "數值"], ["商品總數", overview.products], ["訂單總數", overview.orders], ["待處理訂單", overview.pendingOrders], ["累計營業額", overview.revenue]]; const blob = new Blob(["\ufeff" + rows.map((r) => r.join(",")).join("\n")], { type: "text/csv;charset=utf-8" }); const url = URL.createObjectURL(blob); const link = document.createElement("a"); link.href = url; link.download = `yada-overview-${new Date().toISOString().slice(0, 10)}.csv`; link.click(); URL.revokeObjectURL(url); };

  const title = nav.find((item) => item.id === tab)?.label || "後台管理";
  return <div className="realAdmin">
    <aside>
      <div className="brand"><b>燁達</b><span>STORE ADMIN</span></div>
      <nav>{nav.map((item) => <button key={item.id} className={tab === item.id ? "active" : ""} onClick={() => openTab(item.id)}><i>{item.icon}</i>{item.label}{item.id === "orders" && overview.pendingOrders > 0 && <em>{overview.pendingOrders}</em>}</button>)}</nav>
      <Link href="/">← 返回前台商城</Link>
    </aside>
    <main>
      <header><div><small>燁達機車精品 / {title}</small><h1>{title}</h1></div><div className="identity"><span>{user.name.slice(0, 1).toUpperCase()}</span><div><b>{user.name}</b><small>{user.role.toUpperCase()}</small></div><button onClick={signOut}>登出</button></div></header>
      {message && <div className="notice">{message}</div>}
      {tab === "overview" && <OverviewPanel overview={overview} beginProduct={beginProduct} openTab={openTab} exportOverview={exportOverview} />}
      {tab === "products" && <ProductsPanel products={shown} query={query} setQuery={setQuery} setEditing={setEditing} remove={remove} beginProduct={beginProduct} selected={selected} toggleSelected={toggleSelected} toggleShown={toggleShown} bulkStatus={bulkStatus} bulkDelete={bulkDelete} clearSelected={()=>setSelected(new Set())} />}
      {tab === "categories" && <IndexPanel key={options.categories.join("|")} eyebrow="PRODUCT CATEGORIES" title="商品分類" kind="category" names={options.categories} counts={categories} noun="項商品" empty="目前沒有商品分類" onAdd={()=>addOption("category","分類")} onReorder={reorderOptions} impact="前台首頁的「本週焦點分類」與商品分類篩選，會依此順序顯示。" />}
      {tab === "brands" && <IndexPanel key={options.brands.join("|")} eyebrow="PRODUCT BRANDS" title="品牌資料" kind="brand" names={options.brands} counts={brands} noun="項商品" empty="目前沒有品牌資料" onAdd={()=>addOption("brand","品牌")} onReorder={reorderOptions} impact="前台「品牌專區」與品牌篩選，會依此順序顯示。" />}
      {tab === "vehicles" && <IndexPanel key={options.vehicles.join("|")} eyebrow="FITMENT DATABASE" title="適用車種" kind="vehicle" names={options.vehicles} counts={vehicles} noun="項相容商品" empty="目前沒有車種資料" onAdd={()=>addOption("vehicle","車種")} onReorder={reorderOptions} impact="新增商品時的適用車種選單，會依此順序顯示。" />}
      {tab === "orders" && <OrdersPanel orders={orders} update={updateOrder} createLogistics={createLogistics} />}
      {tab === "returns" && <ReturnsPanel returns={returns} update={updateReturn} settings={storeSettings} />}
      {tab === "members" && <MembersPanel members={members} adjust={adjustPoints} />}
      {tab === "settings" && <SettingsPanel />}
      {editing && <ProductModal editing={editing} setEditing={setEditing} save={save} upload={upload} options={options} />}
      {optionDialog && <OptionDialog label={optionDialog.label} save={saveOption} close={()=>setOptionDialog(null)} />}
    </main>
  </div>;
}

function OverviewPanel({ overview, beginProduct, openTab, exportOverview }: { overview: Overview; beginProduct: () => void; openTab: (tab: Tab) => void; exportOverview: () => void }) {
  return <section className="adminBody">
    <div className="overviewTop"><div><p>REAL-TIME STORE DATA</p><h2>商店營運狀態</h2><span>所有數字皆來自正式資料庫，不顯示模擬交易。</span></div><button onClick={beginProduct}>＋ 新增商品</button></div>
    <div className="metrics">{[["商品總數", overview.products], ["訂單總數", overview.orders], ["待處理訂單", overview.pendingOrders], ["累計營業額", `NT$ ${Number(overview.revenue).toLocaleString()}`]].map(([key, value]) => <article key={key}><small>{key}</small><b>{value}</b></article>)}</div>
    <section className="moduleCard"><div className="moduleHead"><div><p>QUICK ACTIONS</p><h2>快速操作</h2></div></div><div className="quickActions"><button onClick={beginProduct}>＋<span>新增商品</span></button><button onClick={() => openTab("orders")}>＋<span>建立訂單</span></button><button onClick={() => openTab("vehicles")}>＋<span>新增車種</span></button><button onClick={() => openTab("settings")}>＋<span>更新首頁</span></button><button onClick={exportOverview}>↓<span>匯出報表</span></button><button onClick={() => openTab("settings")}>⚙<span>網站設定</span></button></div></section>
  </section>;
}

function ProductsPanel({ products, query, setQuery, setEditing, remove, beginProduct, selected, toggleSelected, toggleShown, bulkStatus, bulkDelete, clearSelected }: { products: CatalogProduct[]; query: string; setQuery: (value: string) => void; setEditing: (product: Partial<CatalogProduct> | null) => void; remove: (id: number) => void; beginProduct: () => void; selected:Set<number>;toggleSelected:(id:number)=>void;toggleShown:()=>void;bulkStatus:(status:CatalogProduct["status"])=>void;bulkDelete:()=>void;clearSelected:()=>void }) {
  const allShownSelected=products.length>0&&products.every((product)=>selected.has(product.id));
  return <section className="adminBody"><div className="toolbar"><input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="搜尋商品、品牌、分類或 SKU"/><button onClick={beginProduct}>＋ 新增商品</button></div>{selected.size>0&&<div className="bulkBar"><b>已選取 {selected.size} 項</b><button onClick={()=>bulkStatus("active")}>批次上架</button><button onClick={()=>bulkStatus("draft")}>移至草稿</button><button onClick={()=>bulkStatus("out_of_stock")}>標示缺貨</button><button className="danger" onClick={bulkDelete}>批次刪除</button><button className="quiet" onClick={clearSelected}>取消選取</button></div>}<div className="productTable"><table><thead><tr><th className="selectCell"><input type="checkbox" checked={allShownSelected} onChange={toggleShown} aria-label="選取目前顯示的所有商品"/></th><th>商品</th><th>分類</th><th>價格</th><th>庫存</th><th>狀態</th><th>操作</th></tr></thead><tbody>{products.map((p) => <tr key={p.id} className={selected.has(p.id)?"selectedRow":""}><td className="selectCell"><input type="checkbox" checked={selected.has(p.id)} onChange={()=>toggleSelected(p.id)} aria-label={`選取 ${p.name}`}/></td><td><b>{p.name}</b><small>{p.brand} · {p.sku}</small></td><td>{p.cat}</td><td>NT$ {p.price.toLocaleString()}</td><td>{p.stock}</td><td><span className={`pill ${p.status}`}>{p.status === "active" ? "上架中" : p.status === "draft" ? "草稿" : "缺貨"}</span></td><td><button onClick={() => setEditing(p)}>編輯</button><button className="danger" onClick={() => remove(p.id)}>刪除</button></td></tr>)}</tbody></table>{!products.length && <div className="tableEmpty">找不到符合條件的商品</div>}</div></section>;
}

function IndexPanel({ eyebrow, title, kind, names, counts, noun, empty, onAdd, onReorder, impact }: { eyebrow: string; title: string; kind: CatalogOptionKind; names:string[]; counts: { name: string; count: number }[]; noun: string; empty: string; onAdd:()=>void; onReorder:(kind:CatalogOptionKind,names:string[])=>Promise<void>; impact:string }) {
  const [ordered,setOrdered]=useState(names),[dragging,setDragging]=useState<string|null>(null);
  const countMap=new Map(counts.map((row)=>[row.name,row.count]));
  const move=(target:string)=>{if(!dragging||dragging===target)return;const next=[...ordered],from=next.indexOf(dragging),to=next.indexOf(target);next.splice(from,1);next.splice(to,0,dragging);setOrdered(next);void onReorder(kind,next);setDragging(null);};
  return <section className="adminBody"><section className="moduleCard"><div className="moduleHead"><div><p>{eyebrow}</p><h2>{title}</h2><span>這些選項儲存在資料庫，新增商品時會出現在下拉選單。</span></div><button onClick={onAdd}>＋ 新增項目</button></div><div className="priorityGuide"><b>拖曳調整顯示優先順序</b><span>{impact}</span></div>{ordered.length ? <div className="indexGrid sortableIndex">{ordered.map((name,index) => <article key={name} draggable onDragStart={()=>setDragging(name)} onDragOver={(event)=>event.preventDefault()} onDrop={()=>move(name)}><i>⠿</i><em>#{String(index+1).padStart(2,"0")}</em><b>{name}</b><span>{countMap.get(name)||0} {noun}</span></article>)}</div> : <div className="moduleEmpty"><h3>{empty}</h3><p>請先新增一個選項，再建立商品。</p></div>}</section></section>;
}

function OptionDialog({ label, save, close }: { label:string; save:(name:string)=>Promise<boolean>; close:()=>void }) {
  const [name,setName]=useState(""),[error,setError]=useState(""),[busy,setBusy]=useState(false);
  return <div className="modal" role="dialog" aria-modal="true" aria-label={`新增${label}`}><form className="optionDialog" onSubmit={async(event)=>{event.preventDefault();setBusy(true);setError("");const ok=await save(name.trim());setBusy(false);if(!ok)setError(`無法新增${label}，請確認名稱是否重複。`);}}><div className="modalHead"><div><p>ADD NEW OPTION</p><h2>新增{label}</h2></div><button type="button" onClick={close}>×</button></div><div className="optionDialogBody"><label>{label}名稱<input autoFocus value={name} maxLength={150} onChange={(event)=>setName(event.target.value)} placeholder={`例如：${label === "分類" ? "傳動系統" : "品牌名稱"}`} required /></label><small>儲存後會立即出現在商品編輯頁的下拉選單中。</small>{error&&<b>{error}</b>}</div><div className="actions"><button type="button" onClick={close}>取消</button><button type="submit" disabled={busy}>{busy?"儲存中…":`新增${label}`}</button></div></form></div>;
}

function OrdersPanel({ orders, update, createLogistics }: { orders: AdminOrder[]; update:(id:number,status:string,shippingCarrier?:string,trackingNumber?:string)=>void; createLogistics:(id:number)=>Promise<void> }) {
  const pending=orders.filter((order)=>["pending","confirmed","preparing"].includes(order.status)).length;
  return <section className="adminBody"><div className="statusStrip"><span>全部訂單 <b>{orders.length}</b></span><span>待處理 <b>{pending}</b></span><span>付款待確認 <b>{orders.filter((order)=>order.paymentStatus!=="paid"&&order.paymentStatus!=="cod").length}</b></span></div><section className="moduleCard"><div className="moduleHead"><div><p>ORDER MANAGEMENT</p><h2>訂單與配送處理</h2><span>建立訂單即保留庫存；付款確認或貨到付款後，可建立綠界物流單。</span></div></div>{orders.length?<div className="orderList">{orders.map((order)=><OrderCard key={`${order.id}:${order.status}:${order.shippingCarrier||""}:${order.trackingNumber||""}:${order.logisticsId||""}`} order={order} update={update} createLogistics={createLogistics}/>)}</div>:<div className="moduleEmpty"><h3>目前沒有訂單</h3><p>顧客完成結帳後，訂單會自動出現在這裡。</p></div>}</section></section>;
}

function OrderCard({order,update,createLogistics}:{order:AdminOrder;update:(id:number,status:string,shippingCarrier?:string,trackingNumber?:string)=>void;createLogistics:(id:number)=>Promise<void>}){
  const [status,setStatus]=useState(order.status),[carrier,setCarrier]=useState(order.shippingCarrier||""),[tracking,setTracking]=useState(order.trackingNumber||"");
  const eligible=!order.logisticsId&&order.shippingMethod!=="pickup"&&order.status!=="cancelled"&&["paid","cod"].includes(order.paymentStatus);
  return <article className="fulfillmentCard"><div className="fulfillmentHead"><div><b>{order.number}</b><small>{new Date(order.createdAt).toLocaleString("zh-TW")} · {order.customerName}／{order.customerPhone}</small></div><strong>NT$ {order.total.toLocaleString()}</strong></div><div className="fulfillmentMeta"><span>{order.paymentMethod==="cod"?"貨到付款":order.paymentMethod}</span><span>{order.paymentStatus}</span><span>{order.shippingMethod}</span>{order.logisticsId&&<span>綠界物流單 {order.logisticsId}</span>}{order.logisticsMessage&&<span>{order.logisticsMessage}</span>}</div>{eligible&&<button className="createLogistics" onClick={()=>void createLogistics(order.id)}>建立綠界物流單</button>}<div className="fulfillmentControls"><label>訂單狀態<select value={status} onChange={event=>setStatus(event.target.value)}>{[["pending","待確認"],["confirmed","已確認"],["preparing","備貨中"],["shipped","已出貨"],["completed","已完成"],["cancelled","取消訂單（回補庫存）"]].map(([value,label])=><option key={value} value={value}>{label}</option>)}</select></label><label>物流公司<select value={carrier} onChange={event=>setCarrier(event.target.value)}><option value="">尚未指定</option><option>綠界物流</option><option>黑貓宅急便</option><option>中華郵政</option></select></label><label>物流單號<input value={tracking} onChange={event=>setTracking(event.target.value)} placeholder={carrier==="綠界物流"?"綠界串接後自動帶入":"例如：1234567890"}/></label><button onClick={()=>update(order.id,status,carrier,tracking)}>{status==="shipped"?"儲存並標示出貨":"儲存變更"}</button></div></article>;
}

function ReturnsPanel({ returns, update, settings }: { returns: AdminReturn[]; update:(id:number,status:string,note:string,refundMethod?:string,refundAmount?:number,refundReference?:string)=>void; settings:StoreSettings }) {
  return <section className="adminBody"><section className="moduleCard"><div className="moduleHead"><div><p>RETURN MANAGEMENT</p><h2>退貨與退款處理</h2><span>流程：申請 → 同意退貨 → 收到退件（自動回補庫存）→ 完成退款。信用卡在綠界後台退刷後，再回來記錄結果。</span></div></div>{returns.length?<div className="returnList">{returns.map((item)=><ReturnCard key={`${item.id}:${item.status}:${item.resolutionNote||""}:${item.refundReference||""}`} item={item} update={update} settings={settings}/>)}</div>:<div className="moduleEmpty"><h3>目前沒有退貨申請</h3><p>顧客提出退貨申請後，將在這裡依流程處理與記錄。</p></div>}</section></section>;
}

function ReturnCard({item,update,settings}:{item:AdminReturn;update:(id:number,status:string,note:string,refundMethod?:string,refundAmount?:number,refundReference?:string)=>void;settings:StoreSettings}){
  const [status,setStatus]=useState(item.status),[note,setNote]=useState(item.resolutionNote||""),[method,setMethod]=useState(item.refundMethod||""),[amount,setAmount]=useState(item.refundAmount?.toString()||""),[reference,setReference]=useState(item.refundReference||"");
  const applyApproval=()=>{setStatus("approved");if(!note.trim()&&settings.returnAddress&&settings.returnRecipient&&settings.returnPhone)setNote(`退貨申請已核准。請妥善包裝商品後寄回：${settings.returnAddress}。收件人：${settings.returnRecipient}；電話：${settings.returnPhone}。請保留寄件憑證，商品到件確認後會依原付款方式辦理退款。`);};
  return <article className="returnCard"><div><p>{item.orderNumber} · {item.customerName}</p><h3>{item.reason}</h3><small>{new Date(item.createdAt).toLocaleString("zh-TW")}</small></div><div className="returnControls"><label>處理狀態<select value={status} onChange={event=>event.target.value==="approved"?applyApproval():setStatus(event.target.value)}>{[["requested","申請中"],["approved","同意退貨"],["received","已收到退件／回補庫存"],["refunded","已退款"],["rejected","拒絕申請"],["cancelled","已取消"]].map(([value,label])=><option key={value} value={value}>{label}</option>)}</select></label>{status==="approved"&&<small className="returnPrivateHint">已套用後台私密退貨資料；可在下方調整後再儲存。</small>}<label>處理說明<textarea value={note} onChange={event=>setNote(event.target.value)} placeholder="核准後可填退貨方式與地址；拒絕時請填理由。"/></label>{status==="refunded"&&<><label>退款方式<select value={method} onChange={event=>setMethod(event.target.value)}><option value="">請選擇</option><option value="ecpay_card">綠界信用卡退刷</option><option value="manual_transfer">手動匯款退款</option></select></label><label>退款金額<input type="number" min="0" value={amount} onChange={event=>setAmount(event.target.value)}/></label><label>退款紀錄／末五碼<input value={reference} onChange={event=>setReference(event.target.value)} placeholder="例如：退刷完成／12345"/></label></>}<button onClick={()=>update(item.id,status,note,method,Number(amount),reference)}>儲存處理結果</button></div></article>;
}

function MembersPanel({members,adjust}:{members:AdminMember[];adjust:(userId:string,points:number,reason:string)=>Promise<void>}){
  const [query,setQuery]=useState(""),[editing,setEditing]=useState<string|null>(null),[points,setPoints]=useState(""),[reason,setReason]=useState("");
  const shown=members.filter(member=>`${member.name}${member.email}${member.phone||""}`.toLowerCase().includes(query.toLowerCase()));
  const save=async(id:string)=>{await adjust(id,Number(points),reason);setEditing(null);setPoints("");setReason("");};
  return <section className="adminBody"><section className="moduleCard"><div className="moduleHead"><div><p>CUSTOMER DATABASE</p><h2>會員與點數管理</h2><span>點數依完成訂單發放；所有折抵、退回與人工調整都會保留帳務明細。</span></div></div><div className="toolbar"><input value={query} onChange={event=>setQuery(event.target.value)} placeholder="搜尋姓名、Email 或手機"/></div>{shown.length?<div className="memberAdminList">{shown.map(member=><article key={member.id}><div><b>{member.name}</b><small>{member.email} · {member.phone||"未填手機"}</small><small>加入於 {new Date(member.createdAt).toLocaleDateString("zh-TW")}</small></div><div><strong>{member.points.toLocaleString()} 點</strong><small>可折 NT$ {member.points.toLocaleString()}</small></div><div><b>{member.orders} 筆訂單</b><small>累計消費 NT$ {member.spent.toLocaleString()}</small></div><button onClick={()=>setEditing(editing===member.id?null:member.id)}>調整點數</button>{editing===member.id&&<div className="memberPointForm"><input type="number" value={points} onChange={event=>setPoints(event.target.value)} placeholder="例如 +100 或 -50"/><input value={reason} onChange={event=>setReason(event.target.value)} placeholder="調整原因（必填）"/><button disabled={!points||!reason.trim()} onClick={()=>void save(member.id)}>確認儲存</button></div>}</article>)}</div>:<div className="moduleEmpty"><h3>尚無會員資料</h3><p>客戶完成 Google 登入後，會顯示在這裡。</p></div>}</section></section>;
}

function SettingsPanel(){
  const [settings,setSettings]=useState({returnAddress:"",returnRecipient:"",returnPhone:"",notificationEmail:""}),[message,setMessage]=useState(""),[busy,setBusy]=useState(false);
  useEffect(()=>{fetch("/api/admin/settings").then(async response=>{if(!response.ok)throw new Error();const data=await response.json() as {settings?:typeof settings};if(data.settings)setSettings(data.settings);}).catch(()=>setMessage("設定資料暫時無法載入。"));},[]);
  const save=async(event:React.FormEvent<HTMLFormElement>)=>{event.preventDefault();setBusy(true);setMessage("");const response=await fetch("/api/admin/settings",{method:"PUT",headers:{"Content-Type":"application/json"},body:JSON.stringify(settings)});const data=await response.json() as ApiError;setBusy(false);setMessage(response.ok?"退貨與通知資料已儲存；退貨地址只會在你核准後提供給客戶。":data.error||"儲存失敗。");};
  return <section className="adminBody"><section className="moduleCard"><div className="moduleHead"><div><p>STORE SETTINGS</p><h2>退貨與通知設定</h2><span>這些資料不會公開顯示；退貨地址僅供核准退貨後的處理使用。</span></div></div><form className="settingsForm" onSubmit={save}><label>退貨地址<textarea value={settings.returnAddress} onChange={event=>setSettings(current=>({...current,returnAddress:event.target.value}))} placeholder="完整地址" required/></label><label>退貨收件人<input value={settings.returnRecipient} onChange={event=>setSettings(current=>({...current,returnRecipient:event.target.value}))} required/></label><label>退貨聯絡電話<input value={settings.returnPhone} onChange={event=>setSettings(current=>({...current,returnPhone:event.target.value}))} required/></label><label>訂單通知寄件 Gmail<input type="email" value={settings.notificationEmail} onChange={event=>setSettings(current=>({...current,notificationEmail:event.target.value}))} required/></label><button disabled={busy}>{busy?"儲存中…":"儲存設定"}</button>{message&&<p>{message}</p>}</form></section></section>;
}

function ProductModal({ editing, setEditing, save, upload, options }: { editing: Partial<CatalogProduct>; setEditing: (value: Partial<CatalogProduct> | null) => void; save: (e: React.FormEvent<HTMLFormElement>) => void; upload: (file:File) => Promise<string|undefined>; options:CatalogOptions }) {
  const [images,setImages]=useState<string[]>(editing.images?.length?editing.images:(editing.image?[editing.image]:[]));
  const [specifications,setSpecifications]=useState<ProductSpecification[]>(editing.specifications||[]);
  const [specDrafts,setSpecDrafts]=useState<string[]>((editing.specifications||[]).map(()=>""));
  const [variants,setVariants]=useState<ProductVariant[]>(editing.variants||[]);
  const [bulkPrice,setBulkPrice]=useState("");
  const [bulkStock,setBulkStock]=useState("");
  const [uploading,setUploading]=useState(false);
  const [dragIndex,setDragIndex]=useState<number|null>(null);
  const brandOptions=includeCurrent(options.brands,editing.brand),categoryOptions=includeCurrent(options.categories,editing.cat),vehicleOptions=[...new Set([...options.vehicles,...(editing.fit||[])])];
  const addImages=async(files:FileList|null)=>{if(!files)return;const available=8-images.length,selected=[...files].slice(0,available);if(!selected.length)return;setUploading(true);const uploaded:string[]=[];for(const file of selected){const url=await upload(file);if(url)uploaded.push(url);}setImages((current)=>[...current,...uploaded].slice(0,8));setUploading(false);};
  const moveImage=(from:number,to:number)=>setImages((current)=>{if(to<0||to>=current.length||from===to)return current;const next=[...current],item=next.splice(from,1)[0];next.splice(to,0,item);return next;});
  const dropImage=(to:number)=>{if(dragIndex!==null)moveImage(dragIndex,to);setDragIndex(null);};
  const updateSpecName=(index:number,name:string)=>setSpecifications((current)=>current.map((spec,i)=>i===index?{...spec,name}:spec));
  const addSpec=()=>{setSpecifications((current)=>[...current,{name:"",values:[]}]);setSpecDrafts((current)=>[...current,""]);};
  const removeSpec=(index:number)=>{setSpecifications((current)=>current.filter((_,i)=>i!==index));setSpecDrafts((current)=>current.filter((_,i)=>i!==index));};
  const addSpecValues=(index:number)=>{const raw=specDrafts[index]||"";const values=[...new Set(raw.split(/[,，\n]/).map((value)=>value.trim()).filter(Boolean))].slice(0,30);if(!values.length)return;setSpecifications((current)=>current.map((spec,i)=>i===index?{...spec,values:[...new Set([...spec.values,...values])].slice(0,30)}:spec));setSpecDrafts((current)=>current.map((value,i)=>i===index?"":value));};
  const removeSpecValue=(index:number,value:string)=>setSpecifications((current)=>current.map((spec,i)=>i===index?{...spec,values:spec.values.filter((item)=>item!==value)}:spec));
  const combinations=useMemo(()=>specCombinations(specifications),[specifications]);
  const combinationCount=useMemo(()=>specificationCombinationCount(specifications),[specifications]);
  const variantRows=useMemo(()=>combinations.map((options)=>{const key=variantKey(options,specifications),saved=variants.find((variant)=>variantKey(variant.options,specifications)===key);return saved||{sku:"",options,price:Number(editing.price||0),stock:Number(editing.stock||0),isActive:true} satisfies ProductVariant;}),[combinations,editing.price,editing.stock,specifications,variants]);
  const updateVariant=(key:string,field:keyof Pick<ProductVariant,"sku"|"price"|"stock"|"image"|"isActive">,value:string|number|boolean)=>setVariants((current)=>{const base=variantRows.find((variant)=>variantKey(variant.options,specifications)===key);if(!base)return current;const next={...base,[field]:value};const found=current.findIndex((variant)=>variantKey(variant.options,specifications)===key);return found<0?[...current,next]:current.map((variant,index)=>index===found?next:variant);});
  const applyToVariants=(field:"price"|"stock",value:string)=>{const number=Math.max(0,Number(value));if(!value.trim()||Number.isNaN(number)||!variantRows.length)return;setVariants(variantRows.map((variant)=>({...variant,[field]:number})));};
  const hasVariants=variantRows.length>0;
  return <div className="modal"><form onSubmit={save}><div className="modalHead"><div><small>PRODUCT DATABASE</small><h2>{editing.id ? "編輯商品" : "新增商品"}</h2></div><button type="button" onClick={() => setEditing(null)}>×</button></div><div className="fields">
    <label className="wide">商品名稱<input name="name" required defaultValue={editing.name}/></label>
    <label>商品編號（留空自動產生）<input name="sku" defaultValue={editing.sku} placeholder="例如 YD-20260905-123045-A1B2"/><small>新商品留空即可，儲存時依台灣日期時間產生。</small></label>
    <label>品牌<select name="brand" required defaultValue={editing.brand||""}><option value="" disabled>請選擇品牌</option>{brandOptions.map((name)=><option key={name} value={name}>{name}</option>)}</select><small>{brandOptions.length?"選項來自品牌管理資料庫。":"請先到品牌資料新增選項。"}</small></label>
    <label>分類<select name="cat" required defaultValue={editing.cat||""}><option value="" disabled>請選擇分類</option>{categoryOptions.map((name)=><option key={name} value={name}>{name}</option>)}</select><small>{categoryOptions.length?"選項來自分類管理資料庫。":"請先到商品分類新增選項。"}</small></label>
    <label>基本售價<input name="price" type="number" min="0" required defaultValue={editing.price}/><small>{hasVariants?"已有規格組合時，顧客實際看到的是各組合售價。":"沒有規格時，這就是商品售價。"}</small></label><label>基本庫存<input name="stock" type="number" min="0" required defaultValue={editing.stock}/><small>{hasVariants?"已有規格組合時，總庫存會由各組合自動加總。":"沒有規格時，這就是可售庫存。"}</small></label>
    <label>狀態<select name="status" defaultValue={editing.status}><option value="active">上架中</option><option value="draft">草稿</option><option value="out_of_stock">缺貨</option></select></label><label>配送<select name="shippingType" defaultValue={editing.shippingType}><option value="small">小型／超商</option><option value="home">一般宅配</option><option value="quote">大型／另行報價</option></select></label>
    <fieldset className="wide imageField"><legend>商品圖片（最多 8 張）</legend><label className={`imagePicker ${images.length>=8?"disabled":""}`}>＋ 選擇圖片<input type="file" multiple disabled={uploading||images.length>=8} accept="image/jpeg,image/png,image/webp" onChange={(event)=>{void addImages(event.target.files);event.currentTarget.value="";}}/></label><small>{uploading?"圖片上傳中…":`已選擇 ${images.length}/8 張；拖曳縮圖可調整順序，第一張是前台主圖。`}</small><div className="imagePreviews">{images.map((url,index)=><article key={url} draggable onDragStart={()=>setDragIndex(index)} onDragOver={(event)=>event.preventDefault()} onDrop={()=>dropImage(index)}><img src={url} alt={`商品圖片 ${index+1}`}/>{index===0&&<b>主圖</b>}<span>{index+1}</span><div><button type="button" disabled={index===0} onClick={()=>moveImage(index,index-1)} aria-label="往前移">←</button><button type="button" disabled={index===images.length-1} onClick={()=>moveImage(index,index+1)} aria-label="往後移">→</button><button type="button" onClick={()=>setImages((current)=>current.filter((_,i)=>i!==index))} aria-label="移除圖片">×</button></div><input type="hidden" name="images" value={url}/></article>)}</div></fieldset>
    <fieldset className="wide fitmentField"><legend>適用車種</legend><details><summary>{editing.fit?.length ? `已選擇 ${editing.fit.length} 項` : "請展開選擇適用車種"}</summary><div>{vehicleOptions.length?vehicleOptions.map((name)=><label key={name}><input type="checkbox" name="fit" value={name} defaultChecked={editing.fit?.includes(name)}/><span>{name}</span></label>):<p>請先到車種資料庫新增選項。</p>}</div></details></fieldset>
    <fieldset className="wide specificationField"><legend>商品規格與選項</legend><div className="specificationIntro"><div><b>需要不同的顏色、尺寸或車種才新增規格</b><small>例如「顏色：黑、白」或「尺寸：S、M、L」。沒有規格的商品可直接保留空白。</small></div><span>{combinationCount ? `${Math.min(combinationCount,100)} 個可設定組合` : "尚未建立規格"}</span></div>{specifications.map((spec,index)=><section className="specCard" key={index}><div className="specCardHead"><label>規格名稱<input aria-label="規格名稱" placeholder="例如：顏色、尺寸" value={spec.name} onChange={(event)=>updateSpecName(index,event.target.value)}/></label><button type="button" className="removeSpec" onClick={()=>removeSpec(index)}>移除此規格</button></div><div className="specValueComposer"><input aria-label={`${spec.name||"規格"}選項`} placeholder="輸入選項後按新增；可用逗號一次貼上多個" value={specDrafts[index]||""} onChange={(event)=>setSpecDrafts((current)=>current.map((value,i)=>i===index?event.target.value:value))} onKeyDown={(event)=>{if(event.key==="Enter"){event.preventDefault();addSpecValues(index);}}}/><button type="button" onClick={()=>addSpecValues(index)}>新增選項</button></div>{spec.values.length?<div className="specValueTags">{spec.values.map((value)=><span key={value}>{value}<button type="button" onClick={()=>removeSpecValue(index,value)} aria-label={`移除 ${value}`}>×</button></span>)}</div>:<p className="specHint">先輸入至少一個選項，系統才會產生對應的售價與庫存欄位。</p>}</section>)}<button className="addSpec" type="button" onClick={addSpec}>＋ 新增規格</button><input type="hidden" name="specifications" value={JSON.stringify(specifications)}/><small>{combinationCount>100?`目前會產生 ${combinationCount} 個組合；為保持操作順暢，最多儲存前 100 個。請減少選項。`:"規格選項儲存後會自動建立所有組合；每一組都可設定獨立售價、庫存與圖片。"}</small></fieldset>
    {hasVariants&&<fieldset className="wide variantField"><legend>規格組合、售價與庫存</legend><div className="variantSummary"><div><b>已產生 {variantRows.length} 個組合</b><small>前台會顯示 {variantPriceLabel(variantRows)}，顧客選完規格後會看到該組合的確切價格。</small></div><div className="variantBulk"><label>批次售價<input type="number" min="0" placeholder="例如 1280" value={bulkPrice} onChange={(event)=>setBulkPrice(event.target.value)}/></label><button type="button" onClick={()=>applyToVariants("price",bulkPrice)}>套用全部</button><label>批次庫存<input type="number" min="0" placeholder="例如 10" value={bulkStock} onChange={(event)=>setBulkStock(event.target.value)}/></label><button type="button" onClick={()=>applyToVariants("stock",bulkStock)}>套用全部</button></div></div><div className="variantTable"><div className="variantTableHead"><b>規格組合</b><b>商品編號</b><b>售價（NT$）</b><b>庫存</b><b>代表圖片</b><b>販售</b></div>{variantRows.map((variant,index)=>{const key=variantKey(variant.options,specifications);return <div className="variantRow" key={key}><strong>{specifications.map((group)=>variant.options[group.name]).join(" / ")}</strong><input aria-label={`${key} 商品編號`} placeholder={`儲存後自動產生 ${index+1}`} value={variant.sku} onChange={(event)=>updateVariant(key,"sku",event.target.value)}/><label className="variantMoney"><span>NT$</span><input aria-label={`${key} 售價`} type="number" min="0" value={variant.price} onChange={(event)=>updateVariant(key,"price",Number(event.target.value))}/></label><input aria-label={`${key} 庫存`} type="number" min="0" value={variant.stock} onChange={(event)=>updateVariant(key,"stock",Number(event.target.value))}/><select aria-label={`${key} 圖片`} value={variant.image||""} onChange={(event)=>updateVariant(key,"image",event.target.value)}><option value="">使用商品主圖</option>{images.map((url,imageIndex)=><option value={url} key={url}>圖片 {imageIndex+1}</option>)}</select><label className="variantToggle"><input type="checkbox" checked={variant.isActive} onChange={(event)=>updateVariant(key,"isActive",event.target.checked)}/><span>{variant.isActive?"販售中":"停用"}</span></label></div>})}</div><input type="hidden" name="variants" value={JSON.stringify(variantRows)}/></fieldset>}
    <label className="wide">商品說明<textarea name="description" rows={5} defaultValue={editing.description}/></label>
  </div><div className="actions"><button type="button" onClick={() => setEditing(null)}>取消</button><button type="submit" disabled={uploading}>儲存商品</button></div></form></div>;
}

function includeCurrent(options:string[],current?:string){return current&& !options.includes(current)?[current,...options]:options;}

function variantKey(options:Record<string,string>,specifications:ProductSpecification[]){return specifications.map((group)=>`${group.name}:${options[group.name]||""}`).join("|");}
function specCombinations(specifications:ProductSpecification[]){const valid=specifications.filter((group)=>group.name.trim()&&group.values.length);if(!valid.length)return[];let combinations:Record<string,string>[]=[{}];for(const group of valid){combinations=combinations.flatMap((current)=>group.values.map((value)=>({...current,[group.name]:value}))).slice(0,100);}return combinations;}
function specificationCombinationCount(specifications:ProductSpecification[]){const valid=specifications.filter((group)=>group.name.trim()&&group.values.length);return valid.length?valid.reduce((total,group)=>total*group.values.length,1):0;}
function variantPriceLabel(variants:ProductVariant[]){const prices=variants.filter((variant)=>variant.isActive&&variant.price>0).map((variant)=>variant.price);if(!prices.length)return"尚未設定售價";const min=Math.min(...prices),max=Math.max(...prices),currency=(value:number)=>`NT$ ${value.toLocaleString()}`;return min===max?currency(min):`${currency(min)} ～ ${currency(max)}`;}

function aggregate(values: string[]) { const counts = new Map<string, number>(); values.filter(Boolean).forEach((value) => counts.set(value, (counts.get(value) || 0) + 1)); return [...counts].map(([name, count]) => ({ name, count })).sort((a, b) => b.count - a.count || a.name.localeCompare(b.name, "zh-Hant")); }
