"use client";

import { useEffect, useMemo, useState } from "react";
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
type AdminOrder = { id:number; number:string; customerName:string; customerPhone:string; total:number; status:string; paymentMethod:string; paymentStatus:string; shippingMethod:string; createdAt:string };
type AdminReturn = { id:number; orderNumber:string; customerName:string; reason:string; status:string; createdAt:string; resolutionNote:string|null };

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

const moduleCopy: Record<Exclude<Tab, "overview" | "products" | "categories" | "brands" | "vehicles" | "orders">, { eyebrow: string; title: string; text: string; features: string[] }> = {
  returns: { eyebrow: "RETURN WORKFLOW", title: "目前沒有正式退貨申請", text: "退貨入口已恢復。之後會接上申請審核、退款、商品回收與庫存回補。", features: ["退貨申請審核", "退款狀態", "退回物流", "庫存回補"] },
  members: { eyebrow: "CUSTOMER DATABASE", title: "會員管理入口已恢復", text: "不再顯示假會員。下一階段會從正式會員資料庫載入會員、訂單與帳號狀態。", features: ["會員搜尋", "帳號狀態", "歷史訂單", "權限與操作紀錄"] },
  settings: { eyebrow: "STORE SETTINGS", title: "網站設定入口已恢復", text: "之後可以集中管理商店資料、首頁內容、付款、物流與系統通知。", features: ["商店基本資料", "首頁內容", "付款與物流", "通知設定"] },
};

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

  const load = async () => {
    const [p, o, c, ordersResponse, returnsResponse] = await Promise.all([fetch("/api/admin/products"), fetch("/api/admin/overview"), fetch("/api/admin/catalog-options"), fetch("/api/admin/orders"), fetch("/api/admin/returns")]);
    if (p.ok) setProducts(((await p.json()) as { products: CatalogProduct[] }).products);
    if (o.ok) setOverview(((await o.json()) as { overview: Overview }).overview);
    if (c.ok) setOptions(((await c.json()) as { options: CatalogOptions }).options);
    if(ordersResponse.ok)setOrders(((await ordersResponse.json()) as {orders:AdminOrder[]}).orders);
    if(returnsResponse.ok)setReturns(((await returnsResponse.json()) as {returns:AdminReturn[]}).returns);
  };
  useEffect(() => { load(); }, []);

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
  const updateOrder = async(id:number,status:string)=>{const response=await fetch("/api/admin/orders",{method:"PATCH",headers:{"Content-Type":"application/json"},body:JSON.stringify({id,status})});const data=await response.json() as ApiError;if(!response.ok){setMessage(data.error||"訂單更新失敗。");return;}setMessage("訂單狀態已更新。");await load();};
  const updateReturn = async(id:number,status:string,note:string)=>{const response=await fetch("/api/admin/returns",{method:"PATCH",headers:{"Content-Type":"application/json"},body:JSON.stringify({id,status,note})});const data=await response.json() as ApiError;if(!response.ok){setMessage(data.error||"退貨更新失敗。");return;}setMessage("退貨狀態已更新。");await load();};
  const exportOverview = () => { const rows = [["指標", "數值"], ["商品總數", overview.products], ["訂單總數", overview.orders], ["待處理訂單", overview.pendingOrders], ["累計營業額", overview.revenue]]; const blob = new Blob(["\ufeff" + rows.map((r) => r.join(",")).join("\n")], { type: "text/csv;charset=utf-8" }); const url = URL.createObjectURL(blob); const link = document.createElement("a"); link.href = url; link.download = `yada-overview-${new Date().toISOString().slice(0, 10)}.csv`; link.click(); URL.revokeObjectURL(url); };

  const title = nav.find((item) => item.id === tab)?.label || "後台管理";
  return <div className="realAdmin">
    <aside>
      <div className="brand"><b>燁達</b><span>STORE ADMIN</span></div>
      <nav>{nav.map((item) => <button key={item.id} className={tab === item.id ? "active" : ""} onClick={() => openTab(item.id)}><i>{item.icon}</i>{item.label}{item.id === "orders" && overview.pendingOrders > 0 && <em>{overview.pendingOrders}</em>}</button>)}</nav>
      <a href="/">← 返回前台商城</a>
    </aside>
    <main>
      <header><div><small>燁達機車精品 / {title}</small><h1>{title}</h1></div><div className="identity"><span>{user.name.slice(0, 1).toUpperCase()}</span><div><b>{user.name}</b><small>{user.role.toUpperCase()}</small></div><button onClick={signOut}>登出</button></div></header>
      {message && <div className="notice">{message}</div>}
      {tab === "overview" && <OverviewPanel overview={overview} beginProduct={beginProduct} openTab={openTab} exportOverview={exportOverview} />}
      {tab === "products" && <ProductsPanel products={shown} query={query} setQuery={setQuery} setEditing={setEditing} remove={remove} beginProduct={beginProduct} selected={selected} toggleSelected={toggleSelected} toggleShown={toggleShown} bulkStatus={bulkStatus} bulkDelete={bulkDelete} clearSelected={()=>setSelected(new Set())} />}
      {tab === "categories" && <IndexPanel eyebrow="PRODUCT CATEGORIES" title="商品分類" kind="category" names={options.categories} counts={categories} noun="項商品" empty="目前沒有商品分類" onAdd={()=>addOption("category","分類")} onReorder={reorderOptions} impact="前台首頁的「本週焦點分類」與商品分類篩選，會依此順序顯示。" />}
      {tab === "brands" && <IndexPanel eyebrow="PRODUCT BRANDS" title="品牌資料" kind="brand" names={options.brands} counts={brands} noun="項商品" empty="目前沒有品牌資料" onAdd={()=>addOption("brand","品牌")} onReorder={reorderOptions} impact="前台「品牌專區」與品牌篩選，會依此順序顯示。" />}
      {tab === "vehicles" && <IndexPanel eyebrow="FITMENT DATABASE" title="適用車種" kind="vehicle" names={options.vehicles} counts={vehicles} noun="項相容商品" empty="目前沒有車種資料" onAdd={()=>addOption("vehicle","車種")} onReorder={reorderOptions} impact="新增商品時的適用車種選單，會依此順序顯示。" />}
      {tab === "orders" && <OrdersPanel orders={orders} update={updateOrder} />}
      {tab === "returns" && <ReturnsPanel returns={returns} update={updateReturn} />}
      {(tab === "members" || tab === "settings") && <ModulePanel {...moduleCopy[tab]} />}
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
  useEffect(()=>setOrdered(names),[names]);
  const countMap=new Map(counts.map((row)=>[row.name,row.count]));
  const move=(target:string)=>{if(!dragging||dragging===target)return;const next=[...ordered],from=next.indexOf(dragging),to=next.indexOf(target);next.splice(from,1);next.splice(to,0,dragging);setOrdered(next);void onReorder(kind,next);setDragging(null);};
  return <section className="adminBody"><section className="moduleCard"><div className="moduleHead"><div><p>{eyebrow}</p><h2>{title}</h2><span>這些選項儲存在資料庫，新增商品時會出現在下拉選單。</span></div><button onClick={onAdd}>＋ 新增項目</button></div><div className="priorityGuide"><b>拖曳調整顯示優先順序</b><span>{impact}</span></div>{ordered.length ? <div className="indexGrid sortableIndex">{ordered.map((name,index) => <article key={name} draggable onDragStart={()=>setDragging(name)} onDragOver={(event)=>event.preventDefault()} onDrop={()=>move(name)}><i>⠿</i><em>#{String(index+1).padStart(2,"0")}</em><b>{name}</b><span>{countMap.get(name)||0} {noun}</span></article>)}</div> : <div className="moduleEmpty"><h3>{empty}</h3><p>請先新增一個選項，再建立商品。</p></div>}</section></section>;
}

function OptionDialog({ label, save, close }: { label:string; save:(name:string)=>Promise<boolean>; close:()=>void }) {
  const [name,setName]=useState(""),[error,setError]=useState(""),[busy,setBusy]=useState(false);
  return <div className="modal" role="dialog" aria-modal="true" aria-label={`新增${label}`}><form className="optionDialog" onSubmit={async(event)=>{event.preventDefault();setBusy(true);setError("");const ok=await save(name.trim());setBusy(false);if(!ok)setError(`無法新增${label}，請確認名稱是否重複。`);}}><div className="modalHead"><div><p>ADD NEW OPTION</p><h2>新增{label}</h2></div><button type="button" onClick={close}>×</button></div><div className="optionDialogBody"><label>{label}名稱<input autoFocus value={name} maxLength={150} onChange={(event)=>setName(event.target.value)} placeholder={`例如：${label === "分類" ? "傳動系統" : "品牌名稱"}`} required /></label><small>儲存後會立即出現在商品編輯頁的下拉選單中。</small>{error&&<b>{error}</b>}</div><div className="actions"><button type="button" onClick={close}>取消</button><button type="submit" disabled={busy}>{busy?"儲存中…":`新增${label}`}</button></div></form></div>;
}

function OrdersPanel({ orders, update }: { orders: AdminOrder[]; update:(id:number,status:string)=>void }) {
  const pending=orders.filter((order)=>["pending","confirmed","preparing"].includes(order.status)).length;
  return <section className="adminBody"><div className="statusStrip"><span>全部訂單 <b>{orders.length}</b></span><span>待處理 <b>{pending}</b></span><span>付款待確認 <b>{orders.filter((order)=>order.paymentStatus!=="paid"&&order.paymentStatus!=="cod").length}</b></span></div><section className="moduleCard"><div className="moduleHead"><div><p>ORDER MANAGEMENT</p><h2>訂單與配送處理</h2><span>貨到付款訂單可直接備貨；綠界付款訂單應先確認付款狀態，再安排出貨。</span></div></div>{orders.length?<div className="orderTable"><table><thead><tr><th>訂單</th><th>顧客</th><th>付款／配送</th><th>金額</th><th>目前狀態</th><th>處理</th></tr></thead><tbody>{orders.map((order)=><tr key={order.id}><td><b>{order.number}</b><small>{new Date(order.createdAt).toLocaleString("zh-TW")}</small></td><td>{order.customerName}<small>{order.customerPhone}</small></td><td><b>{order.paymentMethod==="cod"?"貨到付款":order.paymentMethod}</b><small>{order.shippingMethod}</small></td><td>NT$ {order.total.toLocaleString()}</td><td><span className={`orderStatus ${order.status}`}>{order.status}</span></td><td><select value={order.status} onChange={(event)=>update(order.id,event.target.value)}>{[["pending","待確認"],["confirmed","已確認"],["preparing","備貨中"],["shipped","已出貨"],["completed","已完成"],["cancelled","已取消"]].map(([value,label])=><option key={value} value={value}>{label}</option>)}</select></td></tr>)}</tbody></table></div>:<div className="moduleEmpty"><h3>目前沒有訂單</h3><p>顧客完成結帳後，訂單會自動出現在這裡。</p></div>}</section></section>;
}

function ReturnsPanel({ returns, update }: { returns: AdminReturn[]; update:(id:number,status:string,note:string)=>void }) {
  return <section className="adminBody"><section className="moduleCard"><div className="moduleHead"><div><p>RETURN MANAGEMENT</p><h2>退貨與退款處理</h2><span>流程：申請退貨 → 同意退貨 → 收到退件 → 完成退款；拒絕或取消時請留下說明。</span></div></div>{returns.length?<div className="returnList">{returns.map((item)=><article key={item.id}><div><p>{item.orderNumber} · {item.customerName}</p><h3>{item.reason}</h3><small>{new Date(item.createdAt).toLocaleString("zh-TW")}</small></div><label>處理狀態<select value={item.status} onChange={(event)=>update(item.id,event.target.value,item.resolutionNote||"")}>{[["requested","申請中"],["approved","同意退貨"],["received","已收到退件"],["refunded","已退款"],["rejected","拒絕申請"],["cancelled","已取消"]].map(([value,label])=><option key={value} value={value}>{label}</option>)}</select></label></article>)}</div>:<div className="moduleEmpty"><h3>目前沒有退貨申請</h3><p>顧客提出退貨申請後，將在這裡依流程處理與記錄。</p></div>}</section></section>;
}

function ModulePanel({ eyebrow, title, text, features }: { eyebrow: string; title: string; text: string; features: string[] }) {
  return <section className="adminBody"><section className="moduleCard"><div className="moduleHead"><div><p>{eyebrow}</p><h2>{title}</h2><span>{text}</span></div><span className="stageBadge">入口已恢復</span></div><div className="featureGrid">{features.map((feature, index) => <article key={feature}><span>{String(index + 1).padStart(2, "0")}</span><b>{feature}</b><small>等待下一階段實作</small></article>)}</div></section></section>;
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
